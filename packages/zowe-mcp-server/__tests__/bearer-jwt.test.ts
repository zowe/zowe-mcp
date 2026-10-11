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
 * Unit tests for Bearer JWT verification (RS256 + JWKS) and env config.
 */

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __clearJwtJwksCacheForTests,
  extractBearerToken,
  loadJwtAuthConfigFromEnv,
  resolveJwksUriFromIssuer,
  verifyBearerJwt,
} from '../src/auth/bearer-jwt.js';
import { b64url, requestUrl, signJwt } from './helpers/jwt-test-utils.js';

// @types/node 26 no longer exports JsonWebKey from node:crypto; a structural JWK type suffices here.
type JsonWebKey = Record<string, unknown>;

const TEST_ISSUER = 'https://idp.example.com';
const TEST_AUDIENCE = 'api://zowe-mcp';
const TEST_JWKS_URI = 'https://idp.example.com/.well-known/jwks.json';
const KID = 'unit-test-kid';

let privateKey: KeyObject;
let jwkPublic: JsonWebKey;

beforeEach(() => {
  __clearJwtJwksCacheForTests();
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const exported = pair.publicKey.export({ format: 'jwk' });
  jwkPublic = { ...exported, kid: KID, use: 'sig', alg: 'RS256' };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const u = requestUrl(input);
      if (u === TEST_JWKS_URI) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ keys: [jwkPublic] }),
        } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch URL: ${u}`));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  __clearJwtJwksCacheForTests();
});

/** Wrapper that binds the test-local privateKey and KID. */
function sign(payload: Record<string, unknown>): string {
  return signJwt(payload, privateKey, KID);
}

describe('extractBearerToken', () => {
  it('returns token for standard Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on Bearer prefix', () => {
    expect(extractBearerToken('bearer abc')).toBe('abc');
  });

  it('returns undefined when missing or malformed', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('Basic x')).toBeUndefined();
    expect(extractBearerToken('Bearer ')).toBeUndefined();
    expect(extractBearerToken('')).toBeUndefined();
  });
});

describe('verifyBearerJwt', () => {
  const basePayload = {
    iss: TEST_ISSUER,
    sub: 'user-42',
    aud: TEST_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const baseConfig = { issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI, audience: TEST_AUDIENCE };

  it('returns sub and email for a valid RS256 JWT', async () => {
    const token = sign({ ...basePayload, email: 'u@example.com' });
    const claims = await verifyBearerJwt(token, baseConfig);
    expect(claims.sub).toBe('user-42');
    expect(claims.email).toBe('u@example.com');
  });

  it('throws on invalid segment count', async () => {
    await expect(verifyBearerJwt('a.b', baseConfig)).rejects.toThrow('Invalid JWT format');
  });

  it('throws on non-RS256 alg', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', kid: KID }));
    const payload = b64url(JSON.stringify(basePayload));
    const token = `${header}.${payload}.sig`;
    await expect(verifyBearerJwt(token, baseConfig)).rejects.toThrow('Unsupported JWT alg');
  });

  it('throws on issuer mismatch', async () => {
    const token = sign({ ...basePayload, iss: 'https://evil.example.com' });
    await expect(verifyBearerJwt(token, baseConfig)).rejects.toThrow('issuer mismatch');
  });

  it('throws when audience is required but wrong', async () => {
    const token = sign({ ...basePayload, aud: 'expected-aud' });
    await expect(
      verifyBearerJwt(token, {
        issuer: TEST_ISSUER,
        jwksUri: TEST_JWKS_URI,
        audience: 'other-aud',
      })
    ).rejects.toThrow('audience mismatch');
  });

  it('throws when the aud claim is missing entirely (audience is always validated)', async () => {
    const { aud: _aud, ...noAud } = basePayload;
    const token = sign(noAud);
    await expect(verifyBearerJwt(token, baseConfig)).rejects.toThrow('audience mismatch');
  });

  it('accepts audience when it matches (string)', async () => {
    const token = sign({ ...basePayload, aud: 'api://mcp' });
    const claims = await verifyBearerJwt(token, {
      issuer: TEST_ISSUER,
      jwksUri: TEST_JWKS_URI,
      audience: 'api://mcp',
    });
    expect(claims.sub).toBe('user-42');
  });

  it('throws on expired JWT', async () => {
    const token = sign({ ...basePayload, exp: Math.floor(Date.now() / 1000) - 120 });
    await expect(verifyBearerJwt(token, baseConfig)).rejects.toThrow('expired');
  });

  it('accepts a JWT expired within the clock-skew tolerance', async () => {
    const token = sign({ ...basePayload, exp: Math.floor(Date.now() / 1000) - 10 });
    const claims = await verifyBearerJwt(token, baseConfig);
    expect(claims.sub).toBe('user-42');
  });

  it('throws when exp claim is missing', async () => {
    const { exp: _exp, ...noExp } = basePayload;
    const token = sign(noExp);
    await expect(verifyBearerJwt(token, baseConfig)).rejects.toThrow('missing exp');
  });

  it('throws when nbf is in the future', async () => {
    const token = sign({ ...basePayload, nbf: Math.floor(Date.now() / 1000) + 3600 });
    await expect(verifyBearerJwt(token, baseConfig)).rejects.toThrow('not yet valid');
  });

  it('accepts nbf within the clock-skew tolerance', async () => {
    const token = sign({ ...basePayload, nbf: Math.floor(Date.now() / 1000) + 10 });
    const claims = await verifyBearerJwt(token, baseConfig);
    expect(claims.sub).toBe('user-42');
  });

  it('throws when signature does not match', async () => {
    const token = sign(basePayload);
    const [h, p] = token.split('.');
    const bad = `${h}.${p}.aaaa`;
    await expect(verifyBearerJwt(bad, baseConfig)).rejects.toThrow(
      'signature verification failed'
    );
  });

  it('throws when sub is missing', async () => {
    const { sub: _s, ...rest } = basePayload;
    const token = sign(rest);
    await expect(verifyBearerJwt(token, baseConfig)).rejects.toThrow('missing sub');
  });
});

describe('loadJwtAuthConfigFromEnv', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['ZOWE_MCP_JWT_ISSUER', 'ZOWE_MCP_JWKS_URI', 'ZOWE_MCP_JWT_AUDIENCE']) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('returns undefined when both issuer and jwks are unset', () => {
    expect(loadJwtAuthConfigFromEnv()).toBeUndefined();
  });

  it('returns config without jwksUri when only issuer+audience are set (JWKS resolved via discovery later)', () => {
    process.env.ZOWE_MCP_JWT_ISSUER = TEST_ISSUER;
    process.env.ZOWE_MCP_JWT_AUDIENCE = TEST_AUDIENCE;
    expect(loadJwtAuthConfigFromEnv()).toEqual({ issuer: TEST_ISSUER, audience: TEST_AUDIENCE });
  });

  it('throws when the audience is unset (mandatory audience validation)', () => {
    process.env.ZOWE_MCP_JWT_ISSUER = TEST_ISSUER;
    expect(() => loadJwtAuthConfigFromEnv()).toThrow(/ZOWE_MCP_JWT_AUDIENCE must be set/);
  });

  it('throws when only JWKS URI is set', () => {
    process.env.ZOWE_MCP_JWKS_URI = TEST_JWKS_URI;
    expect(() => loadJwtAuthConfigFromEnv()).toThrow(/ZOWE_MCP_JWT_ISSUER must be set/);
  });

  it('returns issuer, jwksUri, and audience when all are set', () => {
    process.env.ZOWE_MCP_JWT_ISSUER = TEST_ISSUER;
    process.env.ZOWE_MCP_JWKS_URI = TEST_JWKS_URI;
    process.env.ZOWE_MCP_JWT_AUDIENCE = 'api://app';
    expect(loadJwtAuthConfigFromEnv()).toEqual({
      issuer: TEST_ISSUER,
      jwksUri: TEST_JWKS_URI,
      audience: 'api://app',
    });
  });
});

describe('resolveJwksUriFromIssuer', () => {
  const DISCOVERY_URL = `${TEST_ISSUER}/.well-known/openid-configuration`;

  it('resolves jwks_uri from the issuer discovery document (trailing slash trimmed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        expect(requestUrl(input)).toBe(DISCOVERY_URL);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI }),
        } as Response);
      })
    );
    await expect(resolveJwksUriFromIssuer(`${TEST_ISSUER}/`)).resolves.toBe(TEST_JWKS_URI);
  });

  it('rejects when the discovery document lacks jwks_uri', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ issuer: TEST_ISSUER }),
        } as Response)
      )
    );
    await expect(resolveJwksUriFromIssuer(TEST_ISSUER)).rejects.toThrow(/no jwks_uri/);
  });

  it('rejects on a non-2xx discovery response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 404 } as Response))
    );
    await expect(resolveJwksUriFromIssuer(TEST_ISSUER)).rejects.toThrow(/HTTP 404/);
  });
});
