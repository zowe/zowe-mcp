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

/**
 * Test helpers: an ephemeral-port IdP server whose issuer matches its real
 * base URL, a minimal cookie jar, and a scripted OAuth authorization-code +
 * PKCE client that walks the login/consent interaction the way a browser would.
 */

import type { Express } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IdpServerConfig } from '../src/server.js';

export interface RunningIdp {
  baseUrl: string;
  issuer: string;
  close(): Promise<void>;
}

/**
 * Starts the app on an ephemeral port with `issuer` == the actual base URL
 * (listen first on port 0, then build the app once the port is known).
 */
export async function startOidcTestServer(
  createIdpApp: (issuer: string, config?: IdpServerConfig) => Express,
  config: IdpServerConfig = {},
  // Issuer override, e.g. an https:// issuer served over the plain test socket
  // to simulate external TLS termination (AT-TLS).
  makeIssuer?: (port: number) => string
): Promise<RunningIdp> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const issuer = makeIssuer ? makeIssuer(port) : baseUrl;
  const app = createIdpApp(issuer, config);
  server.on('request', app);
  return {
    baseUrl,
    issuer,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

/** Minimal cookie jar: last write per cookie name wins, no path/expiry logic. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(res: Response): void {
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function makePkce(): Pkce {
  const verifier = base64Url(randomBytes(32));
  return { verifier, challenge: base64Url(createHash('sha256').update(verifier).digest()) };
}

/** fetch with manual redirects that records cookies into the jar. */
export async function jarFetch(
  jar: CookieJar,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie: jar.header() },
  });
  jar.store(res);
  return res;
}

export interface RegisteredClient {
  client_id: string;
  redirect_uri: string;
}

/** Registers a VS Code-shaped public client via DCR. */
export async function registerClient(baseUrl: string): Promise<RegisteredClient> {
  const redirectUri = 'http://127.0.0.1:33418/';
  const res = await fetch(`${baseUrl}/reg`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test MCP Client',
      redirect_uris: [redirectUri, 'https://vscode.dev/redirect'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (res.status !== 201) {
    throw new Error(`DCR failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { client_id: string };
  return { client_id: body.client_id, redirect_uri: redirectUri };
}

export interface CodeFlowOptions {
  baseUrl: string;
  client: RegisteredClient;
  username: string;
  password: string;
  scope?: string;
  /** Explicit RFC 8707 resource parameter; omitted -> server's defaultResource. */
  resource?: string;
  /**
   * Maps absolute redirect Locations back to the reachable base URL when the
   * issuer origin differs from it (external-TLS-termination tests).
   */
  rewriteLocation?: (location: string) => string;
}

export interface CodeFlowSuccess {
  outcome: 'code';
  code: string;
  state: string;
  redirectLocation: string;
  pkce: Pkce;
}

export interface CodeFlowFailure {
  outcome: 'login_failed';
  status: number;
  body: string;
  retryAfter: string | null;
}

/**
 * Walks /auth -> login interaction -> consent interaction -> authorization
 * code, following redirects the way a browser would.
 */
export async function runCodeFlow(
  options: CodeFlowOptions
): Promise<CodeFlowSuccess | CodeFlowFailure> {
  const { baseUrl, client } = options;
  const jar = new CookieJar();
  const pkce = makePkce();
  const state = base64Url(randomBytes(12));

  const authParams = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: client.redirect_uri,
    response_type: 'code',
    scope: options.scope ?? 'openid profile email',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
  });
  if (options.resource) {
    authParams.set('resource', options.resource);
  }

  let res = await jarFetch(jar, `${baseUrl}/auth?${authParams.toString()}`);
  for (let hop = 0; hop < 12; hop++) {
    if (res.status === 303 || res.status === 302) {
      let location = res.headers.get('location');
      if (!location) throw new Error('redirect without Location');
      if (options.rewriteLocation) location = options.rewriteLocation(location);
      if (location.startsWith(client.redirect_uri)) {
        const url = new URL(location);
        const code = url.searchParams.get('code');
        if (!code) throw new Error(`authorization response without code: ${location}`);
        return {
          outcome: 'code',
          code,
          state: url.searchParams.get('state') ?? '',
          redirectLocation: location,
          pkce,
        };
      }
      const next = location.startsWith('http') ? location : `${baseUrl}${location}`;
      res = await jarFetch(jar, next);
      continue;
    }

    if (res.status === 200) {
      const body = await res.text();
      const loginAction = /action="(\/interaction\/[^"]+\/login)"/.exec(body);
      if (loginAction) {
        res = await jarFetch(jar, `${baseUrl}${loginAction[1]}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            username: options.username,
            password: options.password,
          }).toString(),
        });
        if ([400, 401, 429, 503].includes(res.status)) {
          return {
            outcome: 'login_failed',
            status: res.status,
            body: await res.text(),
            retryAfter: res.headers.get('retry-after'),
          };
        }
        continue;
      }
      const confirmAction = /action="(\/interaction\/[^"]+\/confirm)"/.exec(body);
      if (confirmAction) {
        res = await jarFetch(jar, `${baseUrl}${confirmAction[1]}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: '',
        });
        continue;
      }
      throw new Error(`unexpected 200 page with no known form: ${body.slice(0, 300)}`);
    }

    throw new Error(`unexpected status ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error('code flow did not converge within 12 hops');
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  [key: string]: unknown;
}

async function postToken(
  baseUrl: string,
  params: URLSearchParams,
  resource?: string
): Promise<{ status: number; body: TokenResponse }> {
  if (resource) params.set('resource', resource);
  const res = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return { status: res.status, body: (await res.json()) as TokenResponse };
}

export function exchangeCode(
  baseUrl: string,
  client: RegisteredClient,
  flow: CodeFlowSuccess,
  resource?: string
): Promise<{ status: number; body: TokenResponse }> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: flow.code,
    redirect_uri: client.redirect_uri,
    client_id: client.client_id,
    code_verifier: flow.pkce.verifier,
  });
  return postToken(baseUrl, params, resource);
}

export function refreshTokens(
  baseUrl: string,
  client: RegisteredClient,
  refreshToken: string,
  resource?: string
): Promise<{ status: number; body: TokenResponse }> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.client_id,
  });
  return postToken(baseUrl, params, resource);
}

/** Registers a client, starts an /auth request, and returns the rendered login page HTML. */
export async function fetchLoginPage(baseUrl: string): Promise<string> {
  const client = await registerClient(baseUrl);
  const jar = new CookieJar();
  const pkce = makePkce();
  const auth = await jarFetch(
    jar,
    `${baseUrl}/auth?` +
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: client.redirect_uri,
        response_type: 'code',
        scope: 'openid',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        state: 'x',
      }).toString()
  );
  const page = await jarFetch(jar, `${baseUrl}${auth.headers.get('location') ?? ''}`);
  return page.text();
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export function decodeJwtHeader(token: string): Record<string, unknown> {
  const [header] = token.split('.');
  return JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>;
}
