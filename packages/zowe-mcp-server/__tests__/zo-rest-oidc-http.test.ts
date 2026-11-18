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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearJwtJwksCacheForTests } from '../src/auth/bearer-jwt.js';
import { Logger } from '../src/log.js';
import { createServer, getLogger, getServer } from '../src/server.js';
import { startHttp } from '../src/transports/http.js';
import type { BackendConnectionStatus } from '../src/zos/backend.js';
import { createStandalonePasswordElicitation } from '../src/zos/native/password-elicitation.js';
import { WaitablePasswordStore } from '../src/zos/native/password-store.js';
import { cacheKey } from '../src/zos/native/ssh-client-cache.js';
import type { RestConnection } from '../src/zos/rest/connection.js';
import {
  loadRest,
  loadRestForHttpTenant,
  type LoadRestOptions,
  type RestSetup,
} from '../src/zos/rest/load-rest.js';
import { generateHttpsTestCertificate } from './helpers/https-test-certificate.js';
import { postMcpLocal, signJwt } from './helpers/jwt-test-utils.js';

const HOST = '127.0.0.1';
const USER = 'USER1';
const PASSWORD = 'dummy-http-oidc-fallback-password';
const BASIC = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
const KID = 'zo-rest-http-test-key';
const AUDIENCE = 'zo-rest-http-tests';

interface DownstreamRequest {
  method: string;
  path: string;
  pattern: string | null;
  authorization: string | undefined;
  cookie: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

interface DownstreamResponse {
  status?: number;
  headers?: Record<string, string | string[]>;
  disconnect?: boolean;
  body: object;
}

const cleanups: (() => Promise<void>)[] = [];
let key: Buffer;
let cert: Buffer;
let signingKey: KeyObject;
let jwk: Record<string, unknown>;

beforeAll(() => {
  ({ key, cert } = generateHttpsTestCertificate());
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  signingKey = pair.privateKey;
  jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
});

beforeEach(() => {
  __clearJwtJwksCacheForTests();
  for (const name of [
    'ZOWE_MCP_PASSWORD_USER1_127_0_0_1',
    'ZOWE_MCP_CREDENTIALS',
    'ZOWE_MCP_VAULT_ADDR',
    'ZOWE_MCP_VAULT_TOKEN',
    'ZOWE_MCP_VAULT_KV_PATH',
  ])
    vi.stubEnv(name, '');
});

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __clearJwtJwksCacheForTests();
});

async function listen(server: Server): Promise<string> {
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })
  );
  await new Promise<void>(resolve => server.listen(0, HOST, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return `${HOST}:${address.port}`;
}

/** Only signed tokens accepted by the local JWKS may reach this real HTTPS service. */
async function downstream(
  handler: (request: DownstreamRequest) => DownstreamResponse | Promise<DownstreamResponse>
) {
  const requests: DownstreamRequest[] = [];
  const server = createHttpsServer({ key, cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'https://localhost');
      const request = {
        method: req.method ?? 'GET',
        path: url.pathname,
        pattern: url.searchParams.get('pattern'),
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(request);
      void Promise.resolve(handler(request)).then(response => {
        if (response.disconnect) {
          req.socket.destroy();
          return;
        }
        res.writeHead(response.status ?? 200, {
          'Content-Type': 'application/json',
          ...response.headers,
        });
        res.end(JSON.stringify(response.body));
      });
    });
  });
  return { origin: `https://${await listen(server)}`, requests };
}

function info(request: DownstreamRequest): DownstreamResponse | undefined {
  if (request.path.endsWith('/system/info')) return { body: { success: true, version: '0.6.0' } };
  return undefined;
}

function listing(name = 'USER1.DATA'): DownstreamResponse {
  return { body: { items: [{ name, dsorg: 'PS', recfm: 'FB', lrecl: 80 }], moreRows: false } };
}

async function harness(
  origin: string,
  options: {
    jwt?: boolean;
    cache?: boolean;
    deployment?: 'direct' | 'apiml';
    oidcTokenExchange?: RestConnection['oidcTokenExchange'];
    httpTenantCredentials?: Pick<
      LoadRestOptions,
      'useEnvForPassword' | 'passwordStore' | 'requestPasswordCallback' | 'onElicitedPasswordUsed'
    >;
  } = {}
) {
  const idp = createHttpServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/jwks' ? { keys: [jwk] } : {}));
  });
  const issuer = `http://${await listen(idp)}`;
  const prompt = vi.fn().mockResolvedValue(PASSWORD);
  const systems = [
    {
      url: origin,
      user: USER,
      deployment: options.deployment ?? 'direct',
      rejectUnauthorized: false,
      ...(options.oidcTokenExchange ? { oidcTokenExchange: options.oidcTokenExchange } : {}),
    },
  ];
  const rest = loadRest({
    systems,
    useEnvForPassword: true,
    requestPasswordViaElicitation: prompt,
  });
  let publicBaseUrl = '';
  const elicit = createStandalonePasswordElicitation({
    getPublicBaseUrl: () => publicBaseUrl,
    log: getLogger(),
  });
  const tenantSetups = new Map<string, RestSetup>();
  const handle = await startHttp(
    tenant => {
      // Share the backend across sessions to expose accidental process-wide token retention.
      let setup = rest;
      if (options.httpTenantCredentials) {
        if (!tenant) throw new Error('HTTP tenant fixture requires a verified subject');
        const cached = tenantSetups.get(tenant.sub);
        setup =
          cached ??
          loadRestForHttpTenant({
            ...options.httpTenantCredentials,
            systems,
            requestPasswordViaElicitation: elicit,
          });
        tenantSetups.set(tenant.sub, setup);
      }
      const server = getServer(
        createServer({
          ...setup,
          capabilityTier: 'read',
          responseCache: options.cache ? {} : false,
          tenantSub: tenant?.sub,
        })
      );
      cleanups.push(() => server.close());
      return server;
    },
    0,
    getLogger(),
    {
      host: HOST,
      ...(options.jwt === false
        ? {}
        : { jwtAuth: { issuer, jwksUri: `${issuer}/jwks`, audience: AUDIENCE } }),
    }
  );
  publicBaseUrl = `http://${HOST}:${handle.port}`;
  cleanups.push(handle.close);
  return {
    port: handle.port,
    prompt,
    token: (sub: string, jti = 'initial', overrides: Record<string, unknown> = {}) =>
      signJwt(
        {
          iss: issuer,
          sub,
          aud: AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
          jti,
          ...overrides,
        },
        signingKey,
        KID
      ),
    async connect(token: string, elicitPassword?: () => Promise<string>) {
      const auth = { token };
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://${HOST}:${handle.port}/mcp`),
        {
          fetch: (input, init) => {
            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${auth.token}`);
            return fetch(input, { ...init, headers });
          },
        }
      );
      const client = new Client(
        { name: 'zo-rest-http-oidc-test', version: '1.0.0' },
        {
          capabilities: elicitPassword ? { elicitation: { url: {} } } : {},
        }
      );
      const elicitations: unknown[] = [];
      if (elicitPassword)
        client.setRequestHandler(ElicitRequestSchema, async request => {
          elicitations.push(request.params);
          if (request.params.mode !== 'url') throw new Error('Expected URL password elicitation');
          const response = await fetch(request.params.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ password: await elicitPassword() }),
          });
          if (response.status !== 200) throw new Error('Password URL submission failed');
          await response.text();
          return { action: 'accept' as const };
        });
      cleanups.push(async () => {
        await transport.terminateSession().catch(() => undefined);
        await client.close();
      });
      await client.connect(transport);
      return { client, transport, auth, elicitations };
    },
  };
}

function list(client: Client, dsnPattern = 'USER1.*') {
  return client.callTool({ name: 'listDatasets', arguments: { system: HOST, dsnPattern } });
}

async function status(client: Client) {
  const result = await client.callTool({ name: 'getBackendStatus', arguments: {} });
  expect(result.isError).not.toBe(true);
  const data = result.structuredContent as { connections: BackendConnectionStatus[] };
  expect(data.connections).toHaveLength(1);
  return { result, connection: data.connections[0] };
}

function expectNoSecrets(payloads: unknown[], tokens: string[]) {
  const serialized = JSON.stringify(payloads);
  for (const secret of [PASSWORD, BASIC, BASIC.slice('Basic '.length), ...tokens])
    expect(serialized).not.toContain(secret);
}

describe('zo-rest OIDC through authenticated HTTP MCP', () => {
  it('forwards a verified bearer through APIML discovery and protected reads without password prompts', async () => {
    const target = await downstream(request =>
      request.path === '/gateway/api/v1/auth/login'
        ? { status: 404, body: { message: 'Session login unsupported by this fixture' } }
        : request.path.startsWith('/gateway/')
          ? { body: { apiml: { apiInfo: [{ basePath: '/zo/api/v1', defaultApi: true }] } } }
          : (info(request) ?? listing())
    );
    const app = await harness(target.origin, { deployment: 'apiml' });
    const token = app.token('oidc-reader');
    const { client } = await app.connect(token);
    const before = await status(client);
    expect(before.connection.authentication).toMatchObject({
      active: 'not-tested',
      oidcStatus: 'not-tested',
      verified: false,
    });
    expect(target.requests).toHaveLength(0);
    expect(app.prompt).not.toHaveBeenCalled();

    const result = await list(client);
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('USER1.DATA');
    const after = await status(client);
    expect(after.connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'accepted',
      verified: true,
    });
    expect(target.requests.map(request => request.path)).toEqual([
      '/gateway/api/v1/services/zo',
      '/zo/api/v1/system/info',
      '/zo/api/v1/ds',
    ]);
    expect(target.requests.every(request => request.authorization === `Bearer ${token}`)).toBe(
      true
    );
    expect(app.prompt).not.toHaveBeenCalled();
    expectNoSecrets([before.result, result, after.result], [token]);
  });

  it.each(['configured', 'elicited'] as const)(
    'falls back after a downstream 401 using %s credentials and reports it',
    async source => {
      if (source === 'configured') vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', PASSWORD);
      const target = await downstream(
        request =>
          info(request) ??
          (request.authorization?.startsWith('Bearer ')
            ? { status: 401, body: { message: 'Token cannot be mapped to SAF' } }
            : listing('USER1.FALLBACK'))
      );
      const app = await harness(target.origin);
      const token = app.token('fallback-reader');
      const { client } = await app.connect(token);
      const result = await list(client);
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.structuredContent)).toContain('USER1.FALLBACK');
      const snapshot = await status(client);
      expect(snapshot.connection.authentication).toMatchObject({
        active: 'password',
        oidcStatus: 'rejected',
        passwordSource: source,
        fallbackReason: 'oidc-rejected',
        verified: true,
        lastHttpStatus: 200,
      });
      expect(
        target.requests
          .filter(request => request.path.endsWith('/ds'))
          .map(request => request.authorization)
      ).toEqual([`Bearer ${token}`, BASIC]);
      expect(app.prompt).toHaveBeenCalledTimes(source === 'elicited' ? 1 : 0);
      const count = target.requests.length;
      const again = await status(client);
      expect(target.requests).toHaveLength(count);
      expect(app.prompt).toHaveBeenCalledTimes(source === 'elicited' ? 1 : 0);
      expectNoSecrets([result, snapshot.result, again.result], [token]);
    }
  );

  it.each(['configured', 'elicited'] as const)(
    'exchanges %s credentials for an APIML cookie and requires fresh elicitation after expiry or rejection',
    async source => {
      vi.useFakeTimers({ toFake: ['Date'] });
      if (source === 'configured') vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', PASSWORD);
      const initialPrompts = source === 'elicited' ? 1 : 0;
      const sessionTokens: string[] = [];
      const rejectedCookies = new Set<string>();
      const replacementPassword = 'dummy-elicited-after-session-expiry';
      const replacementBasic = `Basic ${Buffer.from(`${USER}:${replacementPassword}`).toString('base64')}`;
      const target = await downstream(request => {
        if (request.path === '/gateway/api/v1/auth/login') {
          const cookieToken = signJwt(
            { exp: Math.floor(Date.now() / 1000) + 2, jti: `session-${sessionTokens.length}` },
            signingKey,
            KID
          );
          sessionTokens.push(cookieToken);
          return {
            headers: {
              'Set-Cookie': [`apimlAuthenticationToken=${cookieToken}; Secure; HttpOnly; Path=/`],
            },
            body: {},
          };
        }
        if (request.path.startsWith('/gateway/api/v1/services/')) {
          return { body: { apiml: { apiInfo: [{ basePath: '/zo/api/v1', defaultApi: true }] } } };
        }
        const probe = info(request);
        if (probe) return probe;
        if (request.authorization?.startsWith('Bearer '))
          return { status: 401, body: { message: 'Frontend OIDC cannot be mapped to SAF' } };
        if (request.cookie && rejectedCookies.has(request.cookie))
          return { status: 401, body: { message: `Session rejected: ${request.cookie}` } };
        if (request.pattern === 'USER1.DENIED')
          return {
            status: 403,
            body: {
              message: `SAF denied Cookie: ${request.cookie ?? ''}; token=${sessionTokens.at(-1) ?? ''}`,
            },
          };
        return request.cookie === `apimlAuthenticationToken=${sessionTokens.at(-1)}`
          ? listing('USER1.SESSION')
          : { status: 403, body: { message: 'This resource requires a session cookie' } };
      });
      const app = await harness(target.origin, { deployment: 'apiml', cache: true });
      if (source === 'elicited') app.prompt.mockResolvedValueOnce(PASSWORD);
      app.prompt.mockResolvedValueOnce(replacementPassword);
      const frontendToken = app.token(`apiml-session-reader-${source}`);
      const { client } = await app.connect(frontendToken);

      const first = await list(client);
      expect(first.isError).not.toBe(true);
      expect(JSON.stringify(first.structuredContent)).toContain('USER1.SESSION');
      expect(app.prompt).toHaveBeenCalledTimes(initialPrompts);
      const active = await status(client);
      expect(active.connection.authentication).toMatchObject({
        active: 'session-token',
        oidcStatus: 'rejected',
        passwordSource: source,
        verified: true,
        session: { exchange: 'available', token: 'valid', credentialStorage: 'none' },
      });
      await list(client);
      const warmed = target.requests.length;
      expect((await list(client)).isError).not.toBe(true);
      expect(target.requests).toHaveLength(warmed);

      vi.setSystemTime(Date.now() + 3000);
      const expired = await status(client);
      expect(expired.connection.authentication).toMatchObject({
        active: 'not-tested',
        verified: false,
        session: { exchange: 'available', token: 'expired', credentialStorage: 'none' },
      });
      expect(target.requests).toHaveLength(warmed);
      expect(app.prompt).toHaveBeenCalledTimes(initialPrompts);

      const afterExpiry = await list(client);
      expect(afterExpiry.isError).not.toBe(true);
      expect(app.prompt).toHaveBeenCalledTimes(initialPrompts + 1);
      const loginRequests = target.requests.filter(request =>
        request.path.endsWith('/auth/login')
      );
      expect(loginRequests.map(request => [request.method, request.authorization])).toEqual([
        ['POST', BASIC],
        ['POST', replacementBasic],
      ]);
      expect(sessionTokens).toHaveLength(2);
      const reads = target.requests.filter(request => request.path.endsWith('/ds'));
      expect(reads.map(request => request.authorization)).toEqual([
        `Bearer ${frontendToken}`,
        undefined,
        undefined,
        undefined,
      ]);
      expect(reads.map(request => request.cookie)).toEqual([
        undefined,
        `apimlAuthenticationToken=${sessionTokens[0]}`,
        `apimlAuthenticationToken=${sessionTokens[0]}`,
        `apimlAuthenticationToken=${sessionTokens[1]}`,
      ]);
      const finalStatus = await status(client);
      expect(finalStatus.connection.authentication).toMatchObject({
        active: 'session-token',
        verified: true,
        session: { exchange: 'available', token: 'valid', credentialStorage: 'none' },
      });
      const rejectedPassword = 'dummy-elicited-after-cookie-rejection';
      const rejectedBasic = `Basic ${Buffer.from(`${USER}:${rejectedPassword}`).toString('base64')}`;
      app.prompt.mockResolvedValueOnce(rejectedPassword);
      const rejectedCookie = `apimlAuthenticationToken=${sessionTokens[1]}`;
      rejectedCookies.add(rejectedCookie);
      const afterRejection = await list(client, 'USER1.REJECT');
      expect(afterRejection.isError).not.toBe(true);
      expect(app.prompt).toHaveBeenCalledTimes(initialPrompts + 2);
      expect(sessionTokens).toHaveLength(3);
      expect(
        target.requests
          .filter(request => request.path.endsWith('/auth/login'))
          .map(request => request.authorization)
      ).toEqual([BASIC, replacementBasic, rejectedBasic]);
      expect(
        target.requests
          .filter(request => request.pattern === 'USER1.REJECT')
          .map(request => [request.authorization, request.cookie])
      ).toEqual([
        [undefined, rejectedCookie],
        [undefined, `apimlAuthenticationToken=${sessionTokens[2]}`],
      ]);
      const denied = await list(client, 'USER1.DENIED');
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied.content)).toContain('403');
      expect(app.prompt).toHaveBeenCalledTimes(initialPrompts + 2);
      expectNoSecrets(
        [
          first,
          active.result,
          expired.result,
          afterExpiry,
          finalStatus.result,
          afterRejection,
          denied,
        ],
        [
          frontendToken,
          replacementPassword,
          replacementBasic,
          rejectedPassword,
          rejectedBasic,
          ...sessionTokens,
        ]
      );
    }
  );

  it('preserves a downstream SAF authorization denial without trying password credentials', async () => {
    const target = await downstream(
      request => info(request) ?? { status: 403, body: { message: 'SAF READ access denied' } }
    );
    const app = await harness(target.origin);
    const token = app.token('denied-reader');
    const { client } = await app.connect(token);
    const result = await list(client);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('403');
    const snapshot = await status(client);
    expect(snapshot.connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'forbidden',
      verified: false,
      lastHttpStatus: 403,
    });
    expect(app.prompt).not.toHaveBeenCalled();
    expect(target.requests.every(request => request.authorization === `Bearer ${token}`)).toBe(
      true
    );
    expectNoSecrets([result, snapshot.result], [token]);
  });

  it.each(['oidc', 'password'] as const)(
    'redacts %s credentials echoed in downstream JSON error diagnostics',
    async mode => {
      vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', PASSWORD);
      const target = await downstream(request => {
        const probe = info(request);
        if (probe) return probe;
        if (mode === 'password' && request.authorization?.startsWith('Bearer ')) {
          return { status: 401, body: { message: 'OIDC mapping unavailable' } };
        }
        return {
          status: 403,
          body: {
            message: `SAF denied Authorization: ${request.authorization ?? ''}${mode === 'password' ? `; password=${PASSWORD}` : ''}`,
          },
        };
      });
      const app = await harness(target.origin);
      const token = app.token('error-diagnostic-reader');
      const { client } = await app.connect(token);
      const result = await list(client);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('403');
      const snapshot = await status(client);
      expectNoSecrets([result, snapshot.result], [token]);
    }
  );

  it('rejects invalid JWT signatures, expiration, audience and issuer before executing any tool', async () => {
    const target = await downstream(request => info(request) ?? listing());
    const app = await harness(target.origin);
    const valid = app.token('validated-reader');
    const { client, transport } = await app.connect(valid);
    const forged = valid.split('.');
    forged[2] = (forged[2].startsWith('A') ? 'B' : 'A') + forged[2].slice(1);
    const tokens = [
      forged.join('.'),
      app.token('validated-reader', 'expired', { exp: Math.floor(Date.now() / 1000) - 3600 }),
      app.token('validated-reader', 'wrong-audience', { aud: 'different-service' }),
      app.token('validated-reader', 'wrong-issuer', { iss: 'https://other-idp.invalid' }),
    ];
    for (const token of tokens) {
      const result = await postMcpLocal(
        app.port,
        {
          jsonrpc: '2.0',
          id: 40,
          method: 'tools/call',
          params: { name: 'listDatasets', arguments: { system: HOST, dsnPattern: 'USER1.*' } },
        },
        { Authorization: `Bearer ${token}`, 'mcp-session-id': transport.sessionId! }
      );
      expect(result.statusCode).toBe(401);
      expectNoSecrets([result.text], [token]);
    }
    expect(target.requests).toHaveLength(0);
    expect(app.prompt).not.toHaveBeenCalled();
    expect((await list(client)).isError).not.toBe(true);
    expect(target.requests.every(request => request.authorization === `Bearer ${valid}`)).toBe(
      true
    );
  });

  it('rejects a different signed subject on an existing MCP session', async () => {
    const target = await downstream(request => info(request) ?? listing());
    const app = await harness(target.origin);
    const token = app.token('session-owner');
    const intruder = app.token('other-subject');
    const { client, transport } = await app.connect(token);
    const result = await postMcpLocal(
      app.port,
      {
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: { name: 'listDatasets', arguments: { system: HOST, dsnPattern: 'USER1.*' } },
      },
      { Authorization: `Bearer ${intruder}`, 'mcp-session-id': transport.sessionId! }
    );
    expect(result.statusCode).toBe(403);
    expect(result.text).toContain('subject does not match MCP session');
    expect(target.requests).toHaveLength(0);
    expect(app.prompt).not.toHaveBeenCalled();
    expect((await list(client)).isError).not.toBe(true);
    expect(target.requests.every(request => request.authorization === `Bearer ${token}`)).toBe(
      true
    );
    expectNoSecrets([result.text], [token, intruder]);
  });

  it('uses a refreshed JWT on the same session and partitions cached reads by token', async () => {
    let first = '';
    const target = await downstream(
      request =>
        info(request) ??
        listing(request.authorization === `Bearer ${first}` ? 'USER1.BEFORE' : 'USER1.AFTER')
    );
    const app = await harness(target.origin, { cache: true });
    first = app.token('refresh-reader');
    const next = app.token('refresh-reader', 'refreshed');
    const session = await app.connect(first);
    const sessionId = session.transport.sessionId;
    await list(session.client);
    await list(session.client);
    const warmed = target.requests.length;
    expect(JSON.stringify((await list(session.client)).structuredContent)).toContain(
      'USER1.BEFORE'
    );
    expect(target.requests).toHaveLength(warmed);

    session.auth.token = next;
    const untested = await status(session.client);
    expect(untested.connection.authentication).toMatchObject({
      active: 'not-tested',
      oidcStatus: 'not-tested',
      verified: false,
    });
    expect(target.requests).toHaveLength(warmed);
    const result = await list(session.client);
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('USER1.AFTER');
    expect(JSON.stringify(result.structuredContent)).not.toContain('USER1.BEFORE');
    expect(session.transport.sessionId).toBe(sessionId);
    expect(target.requests.at(-1)?.authorization).toBe(`Bearer ${next}`);
    expect((await status(session.client)).connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'accepted',
      verified: true,
    });
    expect(app.prompt).not.toHaveBeenCalled();
    expectNoSecrets([untested.result, result], [first, next]);
  });

  it('does not reuse OIDC cached data after the same token falls back to a password', async () => {
    vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', PASSWORD);
    let rejectBearer = false;
    const target = await downstream(
      request =>
        info(request) ??
        (request.authorization === BASIC
          ? listing('USER1.PASSWORD')
          : rejectBearer
            ? { status: 401, body: { message: 'Mapping no longer accepted' } }
            : listing('USER1.OIDC'))
    );
    const app = await harness(target.origin, { cache: true });
    const token = app.token('mode-change');
    const { client } = await app.connect(token);
    await list(client);
    await list(client);
    const warmed = target.requests.length;
    const cached = await list(client);
    expect(JSON.stringify(cached.structuredContent)).toContain('USER1.OIDC');
    expect(target.requests).toHaveLength(warmed);

    rejectBearer = true;
    expect((await list(client, 'USER1.FORCE')).isError).not.toBe(true);
    const snapshot = await status(client);
    expect(snapshot.connection.authentication.active).toBe('password');
    const result = await list(client);
    expect(JSON.stringify(result.structuredContent)).toContain('USER1.PASSWORD');
    expect(JSON.stringify(result.structuredContent)).not.toContain('USER1.OIDC');
    expect(target.requests.at(-1)?.authorization).toBe(BASIC);
    expectNoSecrets([cached, snapshot.result, result], [token]);
  });

  it('does not revive an earlier OIDC cache entry when bounded authentication history evicts a rejected token', async () => {
    vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', PASSWORD);
    let rejectBearer = false;
    const target = await downstream(
      request =>
        info(request) ??
        (request.authorization === BASIC
          ? listing('USER1.PASSWORD')
          : rejectBearer
            ? { status: 401, body: { message: 'Mapping was revoked' } }
            : listing('USER1.OIDC'))
    );
    const app = await harness(target.origin, { cache: true });
    const token = app.token('eviction-reader');
    const session = await app.connect(token);
    expect(JSON.stringify((await list(session.client)).structuredContent)).toContain('USER1.OIDC');
    rejectBearer = true;
    expect((await list(session.client, 'USER1.FORCE')).isError).not.toBe(true);
    expect((await status(session.client)).connection.authentication.active).toBe('password');

    // Simulate multiple frontend refreshes on one long-lived MCP session.
    for (let index = 0; index < 8; index++) {
      session.auth.token = app.token('eviction-reader', `refreshed-${index}`);
      await status(session.client);
    }
    session.auth.token = token;
    const result = await list(session.client);
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('USER1.PASSWORD');
    expect(JSON.stringify(result.structuredContent)).not.toContain('USER1.OIDC');
    expectNoSecrets([result], [token]);
  });

  it('isolates simultaneous subjects and their authentication status on a shared backend', async () => {
    let first = '';
    let second = '';
    let release: () => void = () => undefined;
    const bothArrived = new Promise<void>(resolve => {
      release = resolve;
    });
    let reads = 0;
    const target = await downstream(async request => {
      const probe = info(request);
      if (probe) return probe;
      reads++;
      if (reads === 2) release();
      await bothArrived;
      return request.authorization === `Bearer ${first}`
        ? listing('USER1.FIRST')
        : { status: 403, body: { message: 'Second subject has no SAF permission' } };
    });
    const app = await harness(target.origin);
    first = app.token('first-subject');
    second = app.token('second-subject');
    const [a, b] = await Promise.all([app.connect(first), app.connect(second)]);
    const [aResult, bResult] = await Promise.all([list(a.client), list(b.client)]);
    expect(aResult.isError).not.toBe(true);
    expect(JSON.stringify(aResult.structuredContent)).toContain('USER1.FIRST');
    expect(bResult.isError).toBe(true);
    const [aStatus, bStatus] = await Promise.all([status(a.client), status(b.client)]);
    expect(aStatus.connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'accepted',
      verified: true,
    });
    expect(bStatus.connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'forbidden',
      verified: false,
    });
    expect(
      target.requests
        .filter(request => request.path.endsWith('/ds'))
        .map(request => request.authorization)
        .sort()
    ).toEqual([`Bearer ${first}`, `Bearer ${second}`].sort());
    expect(app.prompt).not.toHaveBeenCalled();
    expectNoSecrets([aResult, bResult, aStatus.result, bStatus.result], [first, second]);
  });

  it('isolates HTTP tenant URL elicitation from a prefilled editor pipe store and editor callbacks', async () => {
    vi.stubEnv('ZOWE_MCP_PASSWORD_ELICIT_MODE', 'url');
    const firstPassword = 'dummy-first-http-tenant-password';
    const secondPassword = 'dummy-second-http-tenant-password';
    const editorPassword = 'dummy-local-editor-password';
    const firstBasic = `Basic ${Buffer.from(`${USER}:${firstPassword}`).toString('base64')}`;
    const secondBasic = `Basic ${Buffer.from(`${USER}:${secondPassword}`).toString('base64')}`;
    const target = await downstream(request => {
      const probe = info(request);
      if (probe) return probe;
      if (request.authorization === firstBasic) return listing('USER1.FIRST');
      if (request.authorization === secondBasic) return listing('USER1.SECOND');
      return { status: 401, body: { message: 'Use credentials supplied by this HTTP tenant' } };
    });
    const sharedEditorStore = new WaitablePasswordStore();
    const key = cacheKey({ user: USER, host: HOST, port: Number(new URL(target.origin).port) });
    sharedEditorStore.set(key, editorPassword);
    const editorStoreGet = vi.spyOn(sharedEditorStore, 'get');
    const editorStoreSet = vi.spyOn(sharedEditorStore, 'set');
    const editorStoreWait = vi.spyOn(sharedEditorStore, 'waitFor');
    const editorStoreDelete = vi.spyOn(sharedEditorStore, 'delete');
    const editorPrompt = vi.fn();
    const editorPersist = vi.fn();
    const app = await harness(target.origin, {
      httpTenantCredentials: {
        useEnvForPassword: false,
        passwordStore: sharedEditorStore,
        requestPasswordCallback: editorPrompt,
        onElicitedPasswordUsed: editorPersist,
      },
    });
    const firstToken = app.token('isolated-first-http-tenant');
    const secondToken = app.token('isolated-second-http-tenant');
    const firstPrompt = vi.fn().mockResolvedValue(firstPassword);
    const secondPrompt = vi.fn().mockResolvedValue(secondPassword);
    const [first, second] = await Promise.all([
      app.connect(firstToken, firstPrompt),
      app.connect(secondToken, secondPrompt),
    ]);
    const [beforeFirst, beforeSecond] = await Promise.all([
      status(first.client),
      status(second.client),
    ]);
    expect(firstPrompt).not.toHaveBeenCalled();
    expect(secondPrompt).not.toHaveBeenCalled();
    expect(target.requests).toHaveLength(0);

    const [firstResult, secondResult] = await Promise.all([
      list(first.client),
      list(second.client),
    ]);
    expect(firstResult.isError).not.toBe(true);
    expect(secondResult.isError).not.toBe(true);
    expect(JSON.stringify(firstResult.structuredContent)).toContain('USER1.FIRST');
    expect(JSON.stringify(firstResult.structuredContent)).not.toContain('USER1.SECOND');
    expect(JSON.stringify(secondResult.structuredContent)).toContain('USER1.SECOND');
    expect(JSON.stringify(secondResult.structuredContent)).not.toContain('USER1.FIRST');
    expect(firstPrompt).toHaveBeenCalledTimes(1);
    expect(secondPrompt).toHaveBeenCalledTimes(1);
    const repeatedFirst = await list(first.client);
    const repeatedSecond = await list(second.client);
    expect(repeatedFirst.isError).not.toBe(true);
    expect(repeatedSecond.isError).not.toBe(true);
    expect(firstPrompt).toHaveBeenCalledTimes(1);
    expect(secondPrompt).toHaveBeenCalledTimes(1);
    expect(editorStoreGet).not.toHaveBeenCalled();
    expect(editorStoreSet).not.toHaveBeenCalled();
    expect(editorStoreWait).not.toHaveBeenCalled();
    expect(editorStoreDelete).not.toHaveBeenCalled();
    expect(editorPrompt).not.toHaveBeenCalled();
    expect(editorPersist).not.toHaveBeenCalled();
    expect(app.prompt).not.toHaveBeenCalled();
    const [afterFirst, afterSecond] = await Promise.all([
      status(first.client),
      status(second.client),
    ]);
    expect(afterFirst.connection.authentication).toMatchObject({
      active: 'password',
      passwordSource: 'elicited',
      verified: true,
      session: { exchange: 'unknown', credentialStorage: 'memory' },
    });
    expect(afterSecond.connection.authentication).toMatchObject({
      active: 'password',
      passwordSource: 'elicited',
      verified: true,
      session: { exchange: 'unknown', credentialStorage: 'memory' },
    });
    expect(first.elicitations).toHaveLength(1);
    expect(second.elicitations).toHaveLength(1);
    expectNoSecrets(
      [
        beforeFirst.result,
        beforeSecond.result,
        firstResult,
        secondResult,
        repeatedFirst,
        repeatedSecond,
        afterFirst.result,
        afterSecond.result,
        first.elicitations,
        second.elicitations,
      ],
      [
        firstToken,
        secondToken,
        firstPassword,
        secondPassword,
        editorPassword,
        firstBasic,
        secondBasic,
      ]
    );
  });

  it('does not forward an unverified Authorization header when HTTP JWT authentication is disabled', async () => {
    vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', PASSWORD);
    const target = await downstream(request => info(request) ?? listing());
    const app = await harness(target.origin, { jwt: false });
    const unverified = 'dummy-unverified-bearer';
    const { client } = await app.connect(unverified);
    const result = await list(client);
    expect(result.isError).not.toBe(true);
    expect(
      target.requests.find(request => request.path.endsWith('/system/info'))?.authorization
    ).toBeUndefined();
    expect(
      target.requests
        .filter(request => request.path.endsWith('/ds'))
        .map(request => request.authorization)
    ).toEqual([BASIC]);
    expect(target.requests.map(request => request.authorization)).not.toContain(
      `Bearer ${unverified}`
    );
    const snapshot = await status(client);
    expect(snapshot.connection.authentication).toMatchObject({
      active: 'password',
      oidcAvailable: false,
      oidcStatus: 'not-available',
      passwordSource: 'configured',
      fallbackReason: 'no-frontend-token',
      verified: true,
    });
    expectNoSecrets([result, snapshot.result], [unverified]);
  });
});

describe('opt-in OIDC token exchange through signed HTTP MCP', () => {
  it.each([
    { name: 'MCP-only audience', aud: AUDIENCE },
    { name: 'unrelated backend audience', aud: 'different-backend' },
    { name: 'missing audience', aud: undefined },
  ])(
    'does not send an exchanged JWT with $name to the business API or elicit a password',
    async ({ aud }) => {
      let issuedToken = '';
      const exchange = await downstream(() => ({
        body: {
          access_token: issuedToken,
          token_type: 'Bearer',
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          expires_in: 300,
        },
      }));
      const business = await downstream(request => info(request) ?? listing('USER1.WRONG'));
      const app = await harness(business.origin, {
        oidcTokenExchange: { url: `${exchange.origin}/token`, audience: 'zo-backend' },
      });
      const frontendToken = app.token('audience-check-reader');
      issuedToken = app.token('audience-check-reader', 'issued-backend-token', { aud });
      expect(issuedToken).not.toBe(frontendToken);
      const { client } = await app.connect(frontendToken);
      const result = await list(client);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        'OAuth token exchange returned a JWT for an unexpected audience. Check audience/resource and issuer policy.'
      );
      expect(business.requests).toHaveLength(0);
      expect(app.prompt).not.toHaveBeenCalled();
      expect(exchange.requests).toHaveLength(1);
      const snapshot = await status(client);
      expect(snapshot.connection.authentication).toMatchObject({
        oidcFlow: 'token-exchange-poc',
        verified: false,
        tokenExchange: { stage: 'proof-of-concept', state: 'rejected', lastHttpStatus: 200 },
      });
      expect(['password', 'session-token']).not.toContain(
        snapshot.connection.authentication.active
      );
      expectNoSecrets([result, snapshot.result], [frontendToken, issuedToken]);
    }
  );

  it.each([400, 501])(
    'logs a secret-free warning before credential fallback after exchange HTTP %i',
    async exchangeStatus => {
      const warning = vi.spyOn(Logger.prototype, 'warning');
      try {
        const exchange = await downstream(request => ({
          status: exchangeStatus,
          body: {
            error: 'invalid_target',
            error_description: `Untrusted diagnostics ${request.body}`,
          },
        }));
        const business = await downstream(request => info(request) ?? listing('USER1.FALLBACK'));
        const app = await harness(business.origin, {
          oidcTokenExchange: { url: `${exchange.origin}/token`, audience: 'zo-backend' },
        });
        const frontendToken = app.token(`warn-exchange-fallback-${exchangeStatus}`);
        const { client } = await app.connect(frontendToken);
        const result = await list(client);
        expect(result.isError).not.toBe(true);
        expect(app.prompt).toHaveBeenCalledTimes(1);
        const fallbackWarnings = warning.mock.calls.filter(
          ([, data]) =>
            data !== null &&
            typeof data === 'object' &&
            (data as Record<string, unknown>).fallbackReason === 'oidc-exchange-unavailable'
        );
        expect(fallbackWarnings).toHaveLength(1);
        const data = fallbackWarnings[0][1] as Record<string, unknown>;
        expect(Object.keys(data)).toHaveLength(2);
        expect(Object.values(data)).toContain(exchangeStatus);
        const snapshot = await status(client);
        expect(snapshot.connection.authentication.fallbackReason).toBe(
          'oidc-exchange-unavailable'
        );
        expectNoSecrets([fallbackWarnings, result, snapshot.result], [frontendToken]);
        expect(JSON.stringify(fallbackWarnings)).not.toContain('Untrusted diagnostics');
      } finally {
        warning.mockRestore();
      }
    }
  );

  it('exchanges only verified frontend tokens and uses the issued token for discovery and protected reads', async () => {
    const backendToken = 'dummy-issued-backend-token';
    const refreshToken = 'dummy-exchange-refresh-token';
    const exchange = await downstream(() => ({
      body: {
        access_token: backendToken,
        token_type: 'Bearer',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        expires_in: 300,
        refresh_token: refreshToken,
      },
    }));
    const business = await downstream(request => {
      if (request.authorization !== `Bearer ${backendToken}`)
        return {
          status: 401,
          body: { message: 'The backend requires the separately issued token' },
        };
      if (request.path.startsWith('/gateway/api/v1/services/'))
        return { body: { apiml: { apiInfo: [{ basePath: '/zo/api/v1', defaultApi: true }] } } };
      return info(request) ?? listing('USER1.EXCHANGE');
    });
    const app = await harness(business.origin, {
      deployment: 'apiml',
      oidcTokenExchange: {
        url: `${exchange.origin}/token`,
        audience: 'zo-backend',
        resource: 'https://resource.example.test/zo',
        scope: 'zos.read',
        clientId: 'test-mcp-client',
      },
    });
    const frontendToken = app.token('exchange-reader');
    const { client, transport } = await app.connect(frontendToken);
    const before = await status(client);
    expect(before.connection.authentication).toMatchObject({
      oidcFlow: 'token-exchange-poc',
      active: 'not-tested',
      verified: false,
      tokenExchange: { stage: 'proof-of-concept', state: 'not-tested' },
    });
    expect(exchange.requests).toHaveLength(0);
    expect(business.requests).toHaveLength(0);
    expect(app.prompt).not.toHaveBeenCalled();

    const forged = frontendToken.split('.');
    forged[2] = (forged[2].startsWith('A') ? 'B' : 'A') + forged[2].slice(1);
    const invalid = await postMcpLocal(
      app.port,
      {
        jsonrpc: '2.0',
        id: 91,
        method: 'tools/call',
        params: { name: 'listDatasets', arguments: { system: HOST, dsnPattern: 'USER1.*' } },
      },
      { Authorization: `Bearer ${forged.join('.')}`, 'mcp-session-id': transport.sessionId! }
    );
    expect(invalid.statusCode).toBe(401);
    expect(exchange.requests).toHaveLength(0);
    expect(business.requests).toHaveLength(0);

    const result = await list(client);
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('USER1.EXCHANGE');
    const repeated = await list(client);
    expect(repeated.isError).not.toBe(true);
    expect(exchange.requests).toHaveLength(1);
    const exchangeRequest = exchange.requests[0];
    expect(exchangeRequest.method).toBe('POST');
    expect(exchangeRequest.path).toBe('/token');
    expect(exchangeRequest.headers['content-type']).toMatch(
      /^application\/x-www-form-urlencoded/i
    );
    const form = new URLSearchParams(exchangeRequest.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(form.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(form.get('subject_token')).toBe(frontendToken);
    expect(form.get('audience')).toBe('zo-backend');
    expect(form.get('resource')).toBe('https://resource.example.test/zo');
    expect(form.get('scope')).toBe('zos.read');
    expect(form.get('client_id')).toBe('test-mcp-client');
    expect(
      business.requests.every(request => request.authorization === `Bearer ${backendToken}`)
    ).toBe(true);
    expect(business.requests.filter(request => request.path.endsWith('/ds'))).toHaveLength(2);
    expect(JSON.stringify(business.requests)).not.toContain(frontendToken);
    const after = await status(client);
    expect(after.connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'accepted',
      oidcFlow: 'token-exchange-poc',
      verified: true,
      tokenExchange: {
        stage: 'proof-of-concept',
        state: 'valid',
        lastHttpStatus: 200,
      },
    });
    expect(after.connection.authentication.tokenExchange?.expiresAt).toBeGreaterThan(Date.now());
    expect(app.prompt).not.toHaveBeenCalled();
    expectNoSecrets(
      [before.result, invalid.text, result, repeated, after.result],
      [frontendToken, backendToken, refreshToken]
    );
  });

  it('uses a separately exchanged token after a frontend refresh on the same cached MCP session', async () => {
    const clientSecret = 'dummy-confidential-exchange-client-secret';
    const clientAuthorization = `Basic ${Buffer.from(`test-mcp-client:${clientSecret}`).toString('base64')}`;
    vi.stubEnv('ZOWE_MCP_TEST_EXCHANGE_CLIENT_SECRET', clientSecret);
    const issued = new Map<string, string>();
    const exchange = await downstream(request => ({
      body: {
        access_token: issued.get(new URLSearchParams(request.body).get('subject_token') ?? ''),
        token_type: 'Bearer',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        expires_in: 300,
      },
    }));
    const business = await downstream(request => {
      if (request.authorization === 'Bearer dummy-before-exchange-token')
        return info(request) ?? listing('USER1.BEFORE');
      if (request.authorization === 'Bearer dummy-after-exchange-token')
        return info(request) ?? listing('USER1.AFTER');
      return { status: 401, body: { message: 'A backend token is required' } };
    });
    const app = await harness(business.origin, {
      cache: true,
      oidcTokenExchange: {
        url: `${exchange.origin}/token`,
        audience: 'zo-backend',
        clientId: 'test-mcp-client',
        clientSecretEnv: 'ZOWE_MCP_TEST_EXCHANGE_CLIENT_SECRET',
      },
    });
    const first = app.token('exchanged-refresh-reader');
    const next = app.token('exchanged-refresh-reader', 'refreshed');
    issued.set(first, 'dummy-before-exchange-token');
    issued.set(next, 'dummy-after-exchange-token');
    const session = await app.connect(first);
    await list(session.client);
    await list(session.client);
    const warmed = business.requests.length;
    const cached = await list(session.client);
    expect(JSON.stringify(cached.structuredContent)).toContain('USER1.BEFORE');
    expect(business.requests).toHaveLength(warmed);
    session.auth.token = next;
    const before = await status(session.client);
    expect(before.connection.authentication.tokenExchange).toMatchObject({
      stage: 'proof-of-concept',
      state: 'not-tested',
    });
    expect(exchange.requests).toHaveLength(1);
    const result = await list(session.client);
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('USER1.AFTER');
    expect(JSON.stringify(result.structuredContent)).not.toContain('USER1.BEFORE');
    expect(
      exchange.requests.map(request => new URLSearchParams(request.body).get('subject_token'))
    ).toEqual([first, next]);
    expect(exchange.requests.every(request => request.authorization === clientAuthorization)).toBe(
      true
    );
    expect(business.requests.at(-1)?.authorization).toBe('Bearer dummy-after-exchange-token');
    expect(JSON.stringify(business.requests)).not.toContain(first);
    expect(JSON.stringify(business.requests)).not.toContain(next);
    expect(JSON.stringify(business.requests)).not.toContain(clientSecret);
    expect(JSON.stringify(business.requests)).not.toContain(clientAuthorization);
    expect(app.prompt).not.toHaveBeenCalled();
    expectNoSecrets(
      [cached, before.result, result],
      [first, next, clientSecret, clientAuthorization, ...issued.values()]
    );
  });

  it.each([400, 401, 404, 405, 501])(
    'falls back to elicited credentials after exchange HTTP %i without frontend passthrough',
    async exchangeStatus => {
      const exchange = await downstream(() => ({
        status: exchangeStatus,
        body: {
          error: 'unsupported_exchange',
          error_description: 'Use interactive backend credentials',
        },
      }));
      const business = await downstream(
        request =>
          info(request) ??
          (request.authorization === BASIC
            ? listing('USER1.FALLBACK')
            : { status: 401, body: { message: 'Interactive credentials required' } })
      );
      const app = await harness(business.origin, {
        oidcTokenExchange: { url: `${exchange.origin}/token`, audience: 'zo-backend' },
      });
      const frontendToken = app.token(`exchange-fallback-${exchangeStatus}`);
      const { client } = await app.connect(frontendToken);
      const result = await list(client);
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.structuredContent)).toContain('USER1.FALLBACK');
      expect(app.prompt).toHaveBeenCalledTimes(1);
      expect(exchange.requests.length).toBeGreaterThanOrEqual(1);
      expect(
        business.requests
          .filter(request => request.path.endsWith('/ds'))
          .every(request => request.authorization === BASIC)
      ).toBe(true);
      expect(JSON.stringify(business.requests)).not.toContain(frontendToken);
      const snapshot = await status(client);
      expect(snapshot.connection.authentication).toMatchObject({
        active: 'password',
        oidcFlow: 'token-exchange-poc',
        fallbackReason: 'oidc-exchange-unavailable',
        passwordSource: 'elicited',
        verified: true,
        tokenExchange: {
          stage: 'proof-of-concept',
          state: exchangeStatus === 400 || exchangeStatus === 401 ? 'rejected' : 'unavailable',
          lastHttpStatus: exchangeStatus,
        },
      });
      const activity = [exchange.requests.length, business.requests.length];
      const again = await status(client);
      expect([exchange.requests.length, business.requests.length]).toEqual(activity);
      expect(app.prompt).toHaveBeenCalledTimes(1);
      expectNoSecrets([result, snapshot.result, again.result], [frontendToken]);
    }
  );

  it('does not switch identity after a delayed exchanged-token 401 when a replacement already succeeded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const previousBackendToken = 'dummy-stale-exchange-token';
    const currentBackendToken = 'dummy-current-exchange-token';
    let exchanges = 0;
    const exchange = await downstream(() => ({
      body: {
        access_token: exchanges++ === 0 ? previousBackendToken : currentBackendToken,
        token_type: 'Bearer',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        expires_in: exchanges === 1 ? 1 : 300,
      },
    }));
    let markLateRequest!: () => void;
    let releaseLateRequest!: () => void;
    const lateRequestStarted = new Promise<void>(resolve => {
      markLateRequest = resolve;
    });
    const lateResponse = new Promise<void>(resolve => {
      releaseLateRequest = resolve;
    });
    const business = await downstream(async request => {
      if (request.authorization === BASIC) return listing('USER1.PASSWORD');
      if (
        request.authorization === `Bearer ${previousBackendToken}` &&
        request.pattern === 'USER1.LATE'
      ) {
        markLateRequest();
        await lateResponse;
        return { status: 401, body: { message: 'The old issued token expired' } };
      }
      if (
        request.authorization === `Bearer ${previousBackendToken}` ||
        request.authorization === `Bearer ${currentBackendToken}`
      )
        return info(request) ?? listing('USER1.CURRENT');
      return { status: 403, body: { message: 'A separately issued backend token is required' } };
    });
    const app = await harness(business.origin, {
      oidcTokenExchange: { url: `${exchange.origin}/token`, audience: 'zo-backend' },
    });
    const frontendToken = app.token('stale-exchanged-token-reader');
    const { client } = await app.connect(frontendToken);
    await list(client, 'USER1.WARM');
    const late = list(client, 'USER1.LATE').catch((error: unknown) => error);
    await lateRequestStarted;
    vi.setSystemTime(Date.now() + 2000);
    const fresh = await list(client, 'USER1.FRESH').finally(() => releaseLateRequest());
    const lateResult = await late;
    expect(fresh.isError).not.toBe(true);
    expect(JSON.stringify(fresh.structuredContent)).toContain('USER1.CURRENT');
    expect(exchanges).toBe(2);
    expect(app.prompt).not.toHaveBeenCalled();
    expect(lateResult).toMatchObject({ isError: true });
    const beforeNext = await status(client);
    expect(beforeNext.connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'accepted',
      verified: true,
      lastHttpStatus: 200,
      tokenExchange: { state: 'valid' },
    });
    const next = await list(client, 'USER1.NEXT');
    expect(next.isError).not.toBe(true);
    expect(JSON.stringify(next.structuredContent)).toContain('USER1.CURRENT');
    expect(business.requests.at(-1)?.authorization).toBe(`Bearer ${currentBackendToken}`);
    expect(app.prompt).not.toHaveBeenCalled();
    const snapshot = await status(client);
    expect(snapshot.connection.authentication).toMatchObject({
      active: 'oidc',
      oidcStatus: 'accepted',
      verified: true,
      tokenExchange: { state: 'valid' },
    });
    expectNoSecrets(
      [fresh, lateResult, beforeNext.result, next, snapshot.result],
      [frontendToken, previousBackendToken, currentBackendToken]
    );
  });

  it.each([403, 429, 503, 'network'] as const)(
    'fails exchange %s without changing to a password identity or exposing the subject token',
    async exchangeStatus => {
      const exchange = await downstream(request => ({
        ...(exchangeStatus === 'network' ? { disconnect: true } : { status: exchangeStatus }),
        body: {
          error: 'temporarily_unavailable',
          error_description: `Diagnostic subject_token=${new URLSearchParams(request.body).get('subject_token') ?? ''}`,
        },
      }));
      const business = await downstream(request => info(request) ?? listing('USER1.UNEXPECTED'));
      const app = await harness(business.origin, {
        oidcTokenExchange: { url: `${exchange.origin}/token`, audience: 'zo-backend' },
      });
      const frontendToken = app.token(`exchange-denial-${exchangeStatus}`);
      const { client } = await app.connect(frontendToken);
      const result = await list(client);
      expect(result.isError).toBe(true);
      expect(exchange.requests).toHaveLength(1);
      expect(business.requests).toHaveLength(0);
      expect(app.prompt).not.toHaveBeenCalled();
      const snapshot = await status(client);
      expect(snapshot.connection.authentication).toMatchObject({
        oidcFlow: 'token-exchange-poc',
        verified: false,
        tokenExchange: {
          stage: 'proof-of-concept',
          state: exchangeStatus === 403 ? 'rejected' : 'unavailable',
          ...(exchangeStatus === 'network' ? {} : { lastHttpStatus: exchangeStatus }),
        },
      });
      expect(['password', 'session-token']).not.toContain(
        snapshot.connection.authentication.active
      );
      expectNoSecrets([result, snapshot.result], [frontendToken]);
    }
  );
});
