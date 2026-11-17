/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import type { IncomingHttpHeaders } from 'node:http';

/** A declared credential-to-session exchange, independent of any product's data API. */
export interface SessionLoginConfig {
  url: string;
  method: 'basic' | 'json';
  cookieName?: string;
  tokenField?: string;
}

export type SessionCredentialSource = 'configured' | 'elicited' | 'editor';

export interface SessionCredentials {
  user: string;
  password: string;
  source: SessionCredentialSource;
}

export interface SessionHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface SessionAuthentication {
  /** Secret authentication material for the HTTP adapter only. Never log or return it to a client. */
  authorization?: string;
  headers?: Record<string, string>;
  mode: 'password' | 'session-token';
  source: SessionCredentialSource;
}

export interface RestSessionStatus {
  exchange: 'unknown' | 'available' | 'unavailable';
  token: 'none' | 'valid' | 'expired' | 'rejected';
  expiresAt?: number;
  credentialStorage: 'none' | 'memory' | 'configured';
}

export interface RestSessionAuthOptions {
  /** forceElicitation is true after expiry/rejection, even if older configured credentials exist. */
  getCredentials(forceElicitation: boolean): Promise<SessionCredentials>;
  /** Drop provider memory references; do not change external environment/Vault configuration. */
  forgetCredentials(): void;
  send(
    url: URL,
    authorization: string | undefined,
    request: { method: string; headers?: Record<string, string>; body?: string }
  ): Promise<SessionHttpResponse>;
  login?: SessionLoginConfig;
  now?: () => number;
}

interface CachedSession {
  authentication: SessionAuthentication;
  expiresAt?: number;
}

/** APIML's documented login-cookie flow; reusable by any REST service behind a Gateway. */
export function apimlSessionLogin(origin: string): SessionLoginConfig {
  return {
    url: `${new URL(origin).origin}/gateway/api/v1/auth/login`,
    method: 'basic',
    cookieName: 'apimlAuthenticationToken',
  };
}

/** Read expiry as a cache eviction hint, never as proof of signature or identity. */
function jwtExpiry(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : undefined;
  } catch {
    return undefined;
  }
}

function earliestExpiry(...values: (number | undefined)[]): number | undefined {
  const finite = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value)
  );
  return finite.length ? Math.min(...finite) : undefined;
}

/**
 * Per-user, per-connection REST session authentication. Owns only the exchanged token;
 * the credential provider decides how an unknown/no-exchange password is kept in memory.
 * Instantiate separately for each authenticated tenant. No refresh token is retained.
 */
export class RestSessionAuthentication {
  private login?: SessionLoginConfig;
  private bypassLogin?: string;
  private session?: CachedSession;
  private pending?: Promise<SessionAuthentication>;
  private forceElicitation = false;
  private generation = 0;
  private readonly state: RestSessionStatus = {
    exchange: 'unknown',
    token: 'none',
    credentialStorage: 'none',
  };

  constructor(private readonly options: RestSessionAuthOptions) {
    this.setLogin(options.login);
  }

  setLogin(login: SessionLoginConfig | undefined): void {
    if (JSON.stringify(login) === JSON.stringify(this.login)) return;
    if (login) {
      const url = new URL(login.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new Error('Session login must use a credential-free HTTPS URL.');
      if (login.cookieName && !/^[A-Za-z0-9_-]+$/.test(login.cookieName))
        throw new Error('Invalid session cookie name.');
      if (login.method !== 'basic' && login.method !== 'json')
        throw new Error('Session login method must be basic or json.');
    }
    this.login = login ? { ...login } : undefined;
    this.bypassLogin = undefined;
    this.session = undefined;
    this.state.exchange = 'unknown';
    this.state.token = 'none';
    delete this.state.expiresAt;
    this.generation++;
  }

  private expire(): void {
    if (
      this.session?.expiresAt !== undefined &&
      this.session.expiresAt <= (this.options.now?.() ?? Date.now())
    ) {
      this.session = undefined;
      this.state.token = 'expired';
      this.state.credentialStorage = 'none';
      this.forceElicitation = true;
      this.options.forgetCredentials();
      this.generation++;
    }
  }

  getStatus(): RestSessionStatus {
    this.expire();
    return { ...this.state };
  }
  getCacheIdentity(): string {
    this.expire();
    return `${this.generation}/${this.state.token}`;
  }

  /** Existing token only; metadata discovery must not cause elicitation. */
  getCachedAuthentication(): SessionAuthentication | undefined {
    this.expire();
    return this.session?.authentication;
  }

  /** An explicit HTTP401 permits fresh interactive authentication; never silently refresh. */
  invalidate(): void {
    this.session = undefined;
    this.state.token = 'rejected';
    this.state.credentialStorage = 'none';
    this.forceElicitation = true;
    this.options.forgetCredentials();
    this.generation++;
  }

  async getAuthentication(): Promise<SessionAuthentication> {
    const cached = this.getCachedAuthentication();
    if (cached) return cached;
    this.pending ??= this.acquire().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async requestLogin(
    url: URL,
    authorization: string | undefined,
    request: Parameters<RestSessionAuthOptions['send']>[2]
  ): Promise<SessionHttpResponse> {
    try {
      return await this.options.send(url, authorization, request);
    } catch {
      throw new Error(
        'Unable to contact the REST session login endpoint. Check the network, TLS trust, and login URL.'
      );
    }
  }

  private async acquire(): Promise<SessionAuthentication> {
    const credentials = await this.options.getCredentials(this.forceElicitation);
    this.forceElicitation = false;
    const authorization = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`, 'utf8').toString('base64')}`;
    if (this.login && this.bypassLogin !== JSON.stringify(this.login)) {
      const response = await this.requestLogin(
        new URL(this.login.url),
        this.login.method === 'basic' ? authorization : undefined,
        {
          method: 'POST',
          ...(this.login.method === 'json'
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  username: credentials.user,
                  password: credentials.password,
                }),
              }
            : {}),
        }
      );
      if ([404, 405, 501].includes(response.status)) {
        this.state.exchange = 'unavailable';
        this.bypassLogin = JSON.stringify(this.login);
      } else if (response.status < 200 || response.status >= 300) {
        this.options.forgetCredentials();
        this.forceElicitation = true;
        this.state.credentialStorage = 'none';
        throw new Error(
          `REST session login failed (HTTP ${response.status}). Present credentials again through elicitation.`
        );
      } else {
        const token = this.readToken(response);
        if (token) {
          this.options.forgetCredentials();
          this.state.exchange = 'available';
          this.state.token = 'valid';
          this.state.credentialStorage = 'none';
          this.state.expiresAt = token.expiresAt;
          this.session = {
            authentication: {
              mode: 'session-token',
              source: credentials.source,
              ...(token.cookie
                ? { headers: { Cookie: token.cookie } }
                : { authorization: `Bearer ${token.value}` }),
            },
            expiresAt: token.expiresAt,
          };
          this.generation++;
          this.expire();
          if (!this.session)
            throw new Error(
              'REST session login returned an expired token. Present credentials again.'
            );
          return this.session.authentication;
        }
        // A login-shaped endpoint without a token does not establish exchange support.
        this.bypassLogin = JSON.stringify(this.login);
      }
    }
    this.state.credentialStorage = credentials.source === 'configured' ? 'configured' : 'memory';
    return { authorization, mode: 'password', source: credentials.source };
  }

  private readToken(
    response: SessionHttpResponse
  ): { value: string; cookie?: string; expiresAt?: number } | undefined {
    if (this.login?.cookieName) {
      for (const cookie of response.headers['set-cookie'] ?? []) {
        const pair = cookie.split(';', 1)[0];
        const prefix = `${this.login.cookieName}=`;
        if (!pair.startsWith(prefix)) continue;
        const value = pair.slice(prefix.length);
        if (!value || /[\r\n]/.test(value)) continue;
        const maxAge = /;\s*max-age=(-?\d+)/i.exec(cookie)?.[1];
        const expires = /;\s*expires=([^;]+)/i.exec(cookie)?.[1];
        const cookieExpiry = maxAge
          ? (this.options.now?.() ?? Date.now()) + Number(maxAge) * 1000
          : expires
            ? Date.parse(expires)
            : undefined;
        return {
          value,
          cookie: pair,
          expiresAt: earliestExpiry(jwtExpiry(value), cookieExpiry),
        };
      }
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    if (!body || typeof body !== 'object') return undefined;
    const field = this.login?.tokenField;
    const value = field ? body[field] : (body.access_token ?? body.token ?? body.jwtToken);
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) return undefined;
    const expiresIn =
      typeof body.expires_in === 'number'
        ? (this.options.now?.() ?? Date.now()) + body.expires_in * 1000
        : undefined;
    return { value, expiresAt: earliestExpiry(jwtExpiry(value), expiresIn) };
  }
}
