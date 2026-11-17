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
 * Round-trips tokens minted by `mintAccessToken` through the *real*
 * `verifyBearerJwt` from `@zowe/mcp-server` (not a copy) — the proof that this
 * IdP's tokens are accepted by the unmodified resource-server verifier.
 * Requires `@zowe/mcp-server` already built (see this package's `pretest`).
 */

import {
  __clearJwtJwksCacheForTests,
  verifyBearerJwt,
} from '@zowe/mcp-server/dist/auth/bearer-jwt.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintAccessToken } from '../src/jwt-sign.js';
import { generateIdpKeyPair } from '../src/keys.js';

const ISSUER = 'http://127.0.0.1:8089';
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;
const MCP_RESOURCE = 'http://127.0.0.1:7542/mcp';

function stubJwksFetch(publicJwk: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      expect(url).toBe(JWKS_URI);
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

describe('mintAccessToken + verifyBearerJwt round trip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearJwtJwksCacheForTests();
  });

  it('verifies successfully and carries the SAF-verified username as sub', async () => {
    const keyPair = generateIdpKeyPair();
    stubJwksFetch(keyPair.publicJwk);

    const token = mintAccessToken({
      username: 'userb',
      issuer: ISSUER,
      audience: MCP_RESOURCE,
      kid: keyPair.kid,
      privateKey: keyPair.privateKey,
    });

    const claims = await verifyBearerJwt(token, {
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      audience: MCP_RESOURCE,
    });
    expect(claims.sub).toBe('userb');
  });

  it('rejects a token that has already expired', async () => {
    const keyPair = generateIdpKeyPair();
    stubJwksFetch(keyPair.publicJwk);

    const token = mintAccessToken({
      username: 'userb',
      issuer: ISSUER,
      audience: MCP_RESOURCE,
      kid: keyPair.kid,
      privateKey: keyPair.privateKey,
      ttlSeconds: -1000,
    });

    await expect(
      verifyBearerJwt(token, { issuer: ISSUER, jwksUri: JWKS_URI, audience: MCP_RESOURCE })
    ).rejects.toThrow(/expired/i);
  });

  it('rejects a token minted for a different resource (audience mismatch)', async () => {
    const keyPair = generateIdpKeyPair();
    stubJwksFetch(keyPair.publicJwk);

    const token = mintAccessToken({
      username: 'userb',
      issuer: ISSUER,
      audience: 'http://other-mcp.example:7542/mcp',
      kid: keyPair.kid,
      privateKey: keyPair.privateKey,
    });

    await expect(
      verifyBearerJwt(token, { issuer: ISSUER, jwksUri: JWKS_URI, audience: MCP_RESOURCE })
    ).rejects.toThrow(/audience mismatch/i);
  });

  it('rejects a token signed by a different key (kid mismatch)', async () => {
    const keyPair = generateIdpKeyPair();
    const otherKeyPair = generateIdpKeyPair();
    stubJwksFetch(keyPair.publicJwk);

    const token = mintAccessToken({
      username: 'userb',
      issuer: ISSUER,
      audience: MCP_RESOURCE,
      kid: otherKeyPair.kid,
      privateKey: otherKeyPair.privateKey,
    });

    await expect(
      verifyBearerJwt(token, { issuer: ISSUER, jwksUri: JWKS_URI, audience: MCP_RESOURCE })
    ).rejects.toThrow(/No matching JWK/i);
  });
});
