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
 * HTTP transport tests: JWT required on /mcp when jwtAuth is configured.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createSign, generateKeyPairSync, type JsonWebKey, type KeyObject } from 'node:crypto';
import { get as httpGet, request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearJwtJwksCacheForTests } from '../src/auth/bearer-jwt.js';
import { createServer, getLogger, getServer } from '../src/server.js';
import { startHttp } from '../src/transports/http.js';

const TEST_ISSUER = 'https://idp.http-test.example.com';
const TEST_JWKS_URI = 'https://idp.http-test.example.com/jwks.json';
const TEST_OIDC_DISCOVERY = `${TEST_ISSUER}/.well-known/openid-configuration`;
const KID = 'http-test-kid';

/** Preserve Node/Web fetch so MCP Streamable HTTP client can POST to localhost while JWKS is mocked. */
const realFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let privateKey: KeyObject;
let jwkPublic: JsonWebKey;

const MCP_INIT_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'http-jwt-test', version: '1.0.0' },
  },
};

beforeEach(() => {
  __clearJwtJwksCacheForTests();
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const exported = pair.publicKey.export({ format: 'jwk' });
  jwkPublic = { ...exported, kid: KID, use: 'sig', alg: 'RS256' };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const u = requestUrl(input);
      if (u === TEST_JWKS_URI) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ keys: [jwkPublic] }),
        } as Response);
      }
      if (u === TEST_OIDC_DISCOVERY) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              issuer: TEST_ISSUER,
              registration_endpoint: `${TEST_ISSUER}/openid-connect/register`,
            }),
        } as Response);
      }
      return realFetch(input, init);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  __clearJwtJwksCacheForTests();
});

function signJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'RS256', kid: KID };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  sign.end();
  const sig = sign.sign(privateKey);
  return `${data}.${b64url(sig)}`;
}

/** POST JSON to local HTTP server without using global `fetch` (tests stub `fetch` for JWKS only). */
function postMcpLocal(
  port: number,
  body: object,
  extraHeaders: Record<string, string> = {}
): Promise<{ statusCode: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...extraHeaders,
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getWellKnownLocal(
  port: number,
  path: string
): Promise<{ statusCode: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('startHttp with jwtAuth', () => {
  it('serves OAuth protected resource metadata without Bearer token (MCP Inspector discovery)', async () => {
    const logger = getLogger();
    const handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      {
        jwtAuth: {
          issuer: TEST_ISSUER,
          jwksUri: TEST_JWKS_URI,
        },
      }
    );
    try {
      const res = await getWellKnownLocal(
        handle.port,
        '/.well-known/oauth-protected-resource/mcp'
      );
      expect(res.statusCode).toBe(200);
      const doc = JSON.parse(res.text) as {
        resource?: string;
        authorization_servers?: string[];
      };
      expect(doc.authorization_servers).toEqual([TEST_ISSUER]);
      expect(doc.resource).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${handle.port}/mcp$`));
    } finally {
      await handle.close();
    }
  });
  it('returns 401 JSON-RPC when initialize lacks Bearer token', async () => {
    const logger = getLogger();
    const handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      {
        jwtAuth: {
          issuer: TEST_ISSUER,
          jwksUri: TEST_JWKS_URI,
        },
      }
    );
    try {
      const res = await postMcpLocal(handle.port, MCP_INIT_BODY);
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.text) as { error?: { message?: string } };
      expect(body.error?.message).toMatch(/Bearer token/i);
    } finally {
      await handle.close();
    }
  });

  it('accepts initialize when Bearer token is valid', async () => {
    const logger = getLogger();
    const token = signJwt({
      iss: TEST_ISSUER,
      sub: 'http-user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      {
        jwtAuth: {
          issuer: TEST_ISSUER,
          jwksUri: TEST_JWKS_URI,
        },
      }
    );
    try {
      const res = await postMcpLocal(handle.port, MCP_INIT_BODY, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.statusCode).toBe(200);
      // Streamable HTTP may return JSON-RPC inside an SSE `data:` frame rather than raw JSON.
      expect(res.text).toMatch(/"jsonrpc"\s*:\s*"2\.0"/);
      expect(res.text).toMatch(/"result"/);
    } finally {
      await handle.close();
    }
  });

  it('invokes getContext via MCP Streamable HTTP client with Bearer JWT', async () => {
    const logger = getLogger();
    const token = signJwt({
      iss: TEST_ISSUER,
      sub: 'http-user-tool',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      {
        jwtAuth: {
          issuer: TEST_ISSUER,
          jwksUri: TEST_JWKS_URI,
        },
      }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle.port}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );
    const client = new Client({ name: 'http-jwt-tool-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'getContext', arguments: {} });
      expect(result.isError).not.toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].type).toBe('text');
      const data = JSON.parse(content[0].text) as { server?: { name: string } };
      expect(data.server?.name).toBe('Zowe MCP Server');
    } finally {
      await client.close().catch(() => undefined);
      await handle.close();
    }
  });
});
