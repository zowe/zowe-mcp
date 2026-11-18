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

import { createHash } from 'node:crypto';
import type { RestSessionAuthOptions } from './rest-session-auth.js';

const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const MAX_HISTORY = 8;
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

export interface OidcTokenExchangeConfig {
  url: string;
  audience?: string;
  resource?: string;
  scope?: string;
  clientId?: string;
  clientSecretEnv?: string;
}

export interface OidcTokenExchangeStatus {
  stage: 'proof-of-concept';
  state: 'not-tested' | 'valid' | 'expired' | 'rejected' | 'unavailable';
  expiresAt?: number;
  lastHttpStatus?: number;
}

export interface OidcTokenExchangeOptions {
  config: OidcTokenExchangeConfig;
  send: RestSessionAuthOptions['send'];
  getClientSecret?: () => string | undefined;
  now?: () => number;
}

interface Authentication {
  authorization: string;
}

interface ExchangeEntry {
  generation: number;
  status: OidcTokenExchangeStatus;
  authentication?: Authentication;
}

interface PendingExchange {
  entry: ExchangeEntry;
  generation: number;
  promise: Promise<Authentication>;
}

/** Deliberately contains no remote body, credentials, URL, or untrusted exception details. */
export class OidcTokenExchangeError extends Error {
  constructor(
    message: string,
    readonly fallbackAllowed: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = 'OidcTokenExchangeError';
  }
}

function invalidResponse(status: number): OidcTokenExchangeError {
  return new OidcTokenExchangeError(
    'OAuth token exchange returned an unusable token response.',
    false,
    status
  );
}

function fingerprint(subjectToken: string): string {
  return createHash('sha256').update(subjectToken).digest('hex');
}

function isBearerToken(token: string): boolean {
  // JavaScript's $ anchor also matches before a final line terminator. Reject
  // surrounding whitespace explicitly so an unsafe header value cannot pass.
  return token.trim() === token && BEARER_TOKEN.test(token);
}

/** Expiry is only a retention bound, never proof of the returned token's identity or signature. */
function jwtExpiry(token: string, status: number): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!payload || typeof payload !== 'object' || !('exp' in payload)) return undefined;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp * 1000))
    throw invalidResponse(status);
  return payload.exp * 1000;
}

/** OAuth client Basic authentication encodes each credential as form data before joining. */
function formCredential(value: string): string {
  return new URLSearchParams({ value }).toString().slice('value='.length);
}

/**
 * Opt-in RFC8693 exchange. Instantiate separately per tenant and downstream configuration.
 * Incoming tokens exist only in active request closures; history keys are fingerprints.
 * Only backend access tokens are cached. Refresh tokens are never retained or used.
 */
export class OidcTokenExchange {
  private readonly config: OidcTokenExchangeConfig;
  private readonly endpoint: URL;
  private readonly entries = new Map<string, ExchangeEntry>();
  /** In-flight work is coalesced even if its history entry is evicted by other subjects. */
  private readonly pending = new Map<string, PendingExchange>();
  private readonly authenticationGenerations = new WeakMap<Authentication, number>();
  private generation = 0;

  constructor(private readonly options: OidcTokenExchangeOptions) {
    this.config = { ...options.config };
    try {
      this.endpoint = new URL(this.config.url);
    } catch {
      throw new OidcTokenExchangeError('OAuth token exchange requires a valid HTTPS URL.', false);
    }
    if (
      this.endpoint.protocol !== 'https:' ||
      this.endpoint.username ||
      this.endpoint.password ||
      this.endpoint.href.includes('?') ||
      this.endpoint.href.includes('#')
    ) {
      throw new OidcTokenExchangeError(
        'OAuth token exchange requires HTTPS without credentials, query, or fragment.',
        false
      );
    }
    for (const value of [
      this.config.audience,
      this.config.resource,
      this.config.scope,
      this.config.clientId,
      this.config.clientSecretEnv,
    ]) {
      if (
        value !== undefined &&
        (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))
      ) {
        throw new OidcTokenExchangeError(
          'OAuth token exchange configuration contains an invalid parameter.',
          false
        );
      }
    }
    if (!this.config.audience && !this.config.resource)
      throw new OidcTokenExchangeError(
        'OAuth token exchange requires an audience or resource.',
        false
      );
    if (this.config.resource) {
      try {
        const resource = new URL(this.config.resource);
        if (resource.username || resource.password || this.config.resource.includes('#'))
          throw new Error();
      } catch {
        throw new OidcTokenExchangeError(
          'OAuth token exchange resource must be an absolute URI without credentials or a fragment.',
          false
        );
      }
    }
    if (this.config.clientSecretEnv && !this.config.clientId)
      throw new OidcTokenExchangeError('OAuth client authentication requires clientId.', false);
  }

  private entry(key: string): ExchangeEntry {
    const pending = this.pending.get(key);
    if (pending && pending.entry.generation === pending.generation) return pending.entry;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        generation: ++this.generation,
        status: { stage: 'proof-of-concept', state: 'not-tested' },
      };
      if (this.entries.size >= MAX_HISTORY) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, entry);
    }
    this.expire(entry);
    return entry;
  }

  private expire(entry: ExchangeEntry): void {
    if (
      entry.authentication &&
      entry.status.expiresAt !== undefined &&
      entry.status.expiresAt <= (this.options.now?.() ?? Date.now())
    ) {
      delete entry.authentication;
      entry.status.state = 'expired';
      entry.generation = ++this.generation;
    }
  }

  getStatus(subjectToken?: string): OidcTokenExchangeStatus {
    const key = subjectToken ? fingerprint(subjectToken) : undefined;
    const entry = key ? (this.entries.get(key) ?? this.pending.get(key)?.entry) : undefined;
    if (!entry) return { stage: 'proof-of-concept', state: 'not-tested' };
    this.expire(entry);
    return { ...entry.status };
  }

  getCacheIdentity(subjectToken?: string): string {
    if (!subjectToken) return 'proof-of-concept/no-subject';
    const entry = this.entry(fingerprint(subjectToken));
    // Fresh generations on eviction/expiry/invalidation cannot revive an older cache key.
    return `${entry.generation}/${entry.status.state}`;
  }

  async getAuthentication(subjectToken: string): Promise<Authentication> {
    if (typeof subjectToken !== 'string' || !isBearerToken(subjectToken)) {
      throw new OidcTokenExchangeError(
        'OAuth token exchange requires a valid subject access token.',
        false
      );
    }
    const key = fingerprint(subjectToken);
    const entry = this.entry(key);
    if (entry.authentication) return entry.authentication;
    const previous = this.pending.get(key);
    if (previous?.entry === entry && previous.generation === entry.generation)
      return previous.promise;
    // Distinguish successive one-shot acquisitions: a late rejection of an
    // expiry-less token must not invalidate its new acquisition in progress.
    entry.generation = ++this.generation;
    const pending: PendingExchange = {
      entry,
      generation: entry.generation,
      promise: this.acquire(entry, entry.generation, subjectToken),
    };
    pending.promise = pending.promise.finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    });
    this.pending.set(key, pending);
    return pending.promise;
  }

  /** Pass the exact returned authentication to ignore delayed failures of a replaced token. */
  invalidate(subjectToken: string, expectedAuthentication?: Authentication): boolean {
    const key = fingerprint(subjectToken);
    const entry = this.entries.get(key) ?? this.pending.get(key)?.entry;
    if (
      !entry ||
      (expectedAuthentication &&
        this.authenticationGenerations.get(expectedAuthentication) !== entry.generation)
    )
      return false;
    delete entry.authentication;
    entry.status.state = 'rejected';
    delete entry.status.expiresAt;
    entry.generation = ++this.generation;
    return true;
  }

  private async acquire(
    entry: ExchangeEntry,
    generation: number,
    subjectToken: string
  ): Promise<Authentication> {
    try {
      const form = new URLSearchParams({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
        subject_token: subjectToken,
      });
      for (const [key, value] of Object.entries({
        audience: this.config.audience,
        resource: this.config.resource,
        scope: this.config.scope,
      })) {
        if (value !== undefined) form.set(key, value);
      }
      const secret = this.options.getClientSecret?.();
      if (
        (this.config.clientSecretEnv && !secret) ||
        (secret !== undefined && (!secret || !this.config.clientId))
      ) {
        throw new OidcTokenExchangeError(
          'OAuth client credentials are unavailable or incomplete.',
          false
        );
      }
      const authorization =
        secret === undefined
          ? undefined
          : `Basic ${Buffer.from(`${formCredential(this.config.clientId!)}:${formCredential(secret)}`, 'utf8').toString('base64')}`;
      if (this.config.clientId && authorization === undefined)
        form.set('client_id', this.config.clientId);
      const response = await this.options.send(new URL(this.endpoint), authorization, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (entry.generation !== generation)
        throw new OidcTokenExchangeError(
          'OAuth token exchange was invalidated while pending.',
          false
        );
      entry.status.lastHttpStatus = response.status;
      if (response.status !== 200) {
        const fallbackAllowed = [400, 401, 404, 405, 501].includes(response.status);
        throw new OidcTokenExchangeError(
          `OAuth token exchange failed (HTTP ${response.status}).`,
          fallbackAllowed,
          response.status
        );
      }
      let data: {
        access_token?: unknown;
        token_type?: unknown;
        issued_token_type?: unknown;
        expires_in?: unknown;
      };
      try {
        data = JSON.parse(response.body.toString('utf8')) as typeof data;
      } catch {
        throw invalidResponse(response.status);
      }
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.access_token !== 'string' ||
        !isBearerToken(data.access_token) ||
        data.access_token === subjectToken ||
        typeof data.token_type !== 'string' ||
        data.token_type.toLowerCase() !== 'bearer' ||
        data.issued_token_type !== ACCESS_TOKEN_TYPE
      )
        throw invalidResponse(response.status);
      const now = this.options.now?.() ?? Date.now();
      const expiries: number[] = [];
      if (data.expires_in !== undefined) {
        if (
          typeof data.expires_in !== 'number' ||
          !Number.isFinite(data.expires_in) ||
          data.expires_in <= 0 ||
          !Number.isFinite(now + data.expires_in * 1000)
        )
          throw invalidResponse(response.status);
        expiries.push(now + data.expires_in * 1000);
      }
      const jwtExpiresAt = jwtExpiry(data.access_token, response.status);
      if (jwtExpiresAt !== undefined) expiries.push(jwtExpiresAt);
      const expiresAt = expiries.length ? Math.min(...expiries) : undefined;
      if (expiresAt !== undefined && expiresAt <= now) throw invalidResponse(response.status);
      const authentication = Object.freeze({ authorization: `Bearer ${data.access_token}` });
      if (expiresAt !== undefined) {
        entry.authentication = authentication;
        entry.status.expiresAt = expiresAt;
        entry.status.state = 'valid';
      } else {
        // Opaque tokens without a trustworthy lifetime are one-shot, never reusable.
        delete entry.authentication;
        delete entry.status.expiresAt;
        entry.status.state = 'expired';
        entry.generation = ++this.generation;
      }
      this.authenticationGenerations.set(authentication, entry.generation);
      return authentication;
    } catch (error) {
      if (entry.generation !== generation)
        throw new OidcTokenExchangeError(
          'OAuth token exchange was invalidated while pending.',
          false
        );
      const failure =
        error instanceof OidcTokenExchangeError
          ? error
          : new OidcTokenExchangeError('OAuth token exchange could not be completed.', false);
      delete entry.authentication;
      delete entry.status.expiresAt;
      entry.status.state =
        failure.status === 400 ||
        failure.status === 401 ||
        failure.status === 403 ||
        (failure.status !== undefined && failure.status >= 200 && failure.status < 300)
          ? 'rejected'
          : 'unavailable';
      throw failure;
    }
  }
}
