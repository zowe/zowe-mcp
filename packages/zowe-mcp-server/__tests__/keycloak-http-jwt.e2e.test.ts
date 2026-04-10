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
 * Opt-in E2E: real Keycloak (or compatible OIDC) issues RS256 JWTs; MCP HTTP validates via JWKS.
 * Includes a **`getContext` tools/call** via the MCP Streamable HTTP client (Bearer token).
 *
 * Requires a running Keycloak with realm `demo`, client `demo` (Direct Access Grants), user
 * `user` — see `docs/dev-oidc-tinyauth.md`.
 *
 * Enable: ZOWE_MCP_KEYCLOAK_E2E=1 (or `true`). Default `npm test` skips this file.
 */

import { request as httpRequest } from 'node:http';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { __clearJwtJwksCacheForTests } from '../src/auth/bearer-jwt.js';
import { createServer, getLogger, getServer } from '../src/server.js';
import { startHttp } from '../src/transports/http.js';

const KEYCLOAK_E2E =
  process.env.ZOWE_MCP_KEYCLOAK_E2E === '1' || process.env.ZOWE_MCP_KEYCLOAK_E2E === 'true';

/** Keycloak base URL (no trailing slash). Default matches `docs/dev-oidc-tinyauth.md` port mapping. */
const KC = (process.env.ZOWE_MCP_KEYCLOAK_URL ?? 'http://localhost:18080').replace(/\/$/, '');
const REALM = process.env.ZOWE_MCP_KEYCLOAK_REALM ?? 'demo';
const CLIENT_ID = process.env.ZOWE_MCP_KEYCLOAK_CLIENT ?? 'demo';
const KC_USER = process.env.ZOWE_MCP_KEYCLOAK_USER ?? 'user';
const KC_PASSWORD = process.env.ZOWE_MCP_KEYCLOAK_PASSWORD ?? 'password';

const MCP_INIT_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'keycloak-jwt-e2e', version: '1.0.0' },
  },
};

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

async function getKeycloakAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    username: KC_USER,
    password: KC_PASSWORD,
    grant_type: 'password',
    scope: 'openid profile email',
  });
  const res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Keycloak token endpoint ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Keycloak token response missing access_token');
  }
  return json.access_token;
}

describe.skipIf(!KEYCLOAK_E2E)('Keycloak HTTP JWT e2e (opt-in)', () => {
  const issuer = `${KC}/realms/${REALM}`;
  const jwksUri = `${issuer}/protocol/openid-connect/certs`;

  beforeAll(async () => {
    const probe = await fetch(`${KC}/realms/${REALM}/.well-known/openid-configuration`);
    if (!probe.ok) {
      throw new Error(
        `Keycloak not reachable or realm missing: GET ${KC}/realms/${REALM}/.well-known/openid-configuration → ${probe.status}. ` +
          `Start Keycloak (see docs/dev-oidc-tinyauth.md) or set ZOWE_MCP_KEYCLOAK_URL.`
      );
    }
  });

  afterEach(() => {
    __clearJwtJwksCacheForTests();
  });

  it('rejects initialize without Bearer token', async () => {
    const logger = getLogger();
    const handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      { jwtAuth: { issuer, jwksUri } }
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

  it('accepts initialize with Keycloak-issued Bearer token', async () => {
    const token = await getKeycloakAccessToken();
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as { iss?: string; sub?: string };
    expect(payload.iss).toBe(issuer);

    const logger = getLogger();
    const handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      { jwtAuth: { issuer, jwksUri } }
    );
    try {
      const res = await postMcpLocal(handle.port, MCP_INIT_BODY, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.text).toMatch(/"jsonrpc"\s*:\s*"2\.0"/);
      expect(res.text).toMatch(/"result"/);
    } finally {
      await handle.close();
    }
  });

  it('invokes getContext via MCP Streamable HTTP client with Keycloak Bearer token', async () => {
    const token = await getKeycloakAccessToken();
    const logger = getLogger();
    const handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      { jwtAuth: { issuer, jwksUri } }
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
    const client = new Client({ name: 'keycloak-jwt-tool-e2e', version: '1.0.0' });
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
