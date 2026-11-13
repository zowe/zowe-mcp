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
 * Opt-in E2E: a real SAF/RACF (or local OS account, for a quick sanity run) SSH
 * login mints a JWT from this IdP; `@zowe/mcp-server`'s real `startHttp()` then
 * validates it via this IdP's issuer/JWKS with **zero server-side code changes** —
 * the actual proof that `loadJwtAuthConfigFromEnv()` doesn't know or care that this
 * IdP isn't Keycloak. Modeled on `keycloak-http-jwt.e2e.test.ts` in `@zowe/mcp-server`.
 *
 * Requires a real SSH daemon reachable at the configured host:port and a real
 * account's username/password.
 *
 * Enable: ZOWE_MCP_ZOS_IDP_E2E=1 (or "true"). Configure with:
 *   ZOWE_MCP_ZOS_IDP_SSH_HOST (default 127.0.0.1), ZOWE_MCP_ZOS_IDP_SSH_PORT (default 22),
 *   ZOWE_MCP_ZOS_IDP_SSH_USER, ZOWE_MCP_ZOS_IDP_SSH_PASSWORD (required, no default).
 * Default `npm test` skips this file.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, getLogger, getServer } from '@zowe/mcp-server/dist/server.js';
import { startHttp } from '@zowe/mcp-server/dist/transports/http.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MCP_RESOURCE, startIdpHttp } from '../src/server.js';

const IDP_E2E =
  process.env.ZOWE_MCP_ZOS_IDP_E2E === '1' || process.env.ZOWE_MCP_ZOS_IDP_E2E === 'true';

const SSH_HOST = process.env.ZOWE_MCP_ZOS_IDP_SSH_HOST ?? '127.0.0.1';
const SSH_PORT = Number(process.env.ZOWE_MCP_ZOS_IDP_SSH_PORT ?? 22);
const SSH_USER = process.env.ZOWE_MCP_ZOS_IDP_SSH_USER;
const SSH_PASSWORD = process.env.ZOWE_MCP_ZOS_IDP_SSH_PASSWORD;

describe.skipIf(!IDP_E2E)('zowe-mcp-zos-saf-idp e2e (opt-in)', () => {
  beforeAll(() => {
    if (!SSH_USER || !SSH_PASSWORD) {
      throw new Error(
        'ZOWE_MCP_ZOS_IDP_SSH_USER and ZOWE_MCP_ZOS_IDP_SSH_PASSWORD are required for this e2e test.'
      );
    }
  });

  it('logs in over SAF, then a real tools/call succeeds with the minted JWT', async () => {
    const idp = await startIdpHttp({
      port: 8189,
      host: '127.0.0.1',
      safHost: SSH_HOST,
      safPort: SSH_PORT,
    });
    try {
      const loginRes = await fetch(`http://127.0.0.1:${idp.port}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: SSH_USER, password: SSH_PASSWORD }),
      });
      expect(loginRes.status).toBe(200);
      const { access_token: token } = (await loginRes.json()) as { access_token: string };

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
            issuer: idp.issuer,
            jwksUri: `${idp.issuer}/.well-known/jwks.json`,
            // The IdP mints aud = its --mcp-resource (DEFAULT_MCP_RESOURCE here).
            audience: DEFAULT_MCP_RESOURCE,
          },
        }
      );

      try {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${handle.port}/mcp`),
          { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
        );
        const client = new Client({ name: 'zos-saf-idp-e2e', version: '1.0.0' });
        try {
          await client.connect(transport);
          const result = await client.callTool({ name: 'getContext', arguments: {} });
          expect(result.isError).not.toBe(true);
        } finally {
          await client.close().catch(() => undefined);
        }
      } finally {
        await handle.close();
      }
    } finally {
      await idp.close();
    }
  });
});
