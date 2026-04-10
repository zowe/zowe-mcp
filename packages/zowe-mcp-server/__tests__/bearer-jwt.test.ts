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

import { createSign, generateKeyPairSync, type JsonWebKey, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __clearJwtJwksCacheForTests,
  extractBearerToken,
  loadJwtAuthConfigFromEnv,
  verifyBearerJwt,
} from '../src/auth/bearer-jwt.js';

const TEST_ISSUER = 'https://idp.example.com';
const TEST_JWKS_URI = 'https://idp.example.com/.well-known/jwks.json';
const KID = 'unit-test-kid';

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
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  it('returns sub and email for a valid RS256 JWT', async () => {
    const token = signJwt({ ...basePayload, email: 'u@example.com' });
    const claims = await verifyBearerJwt(token, {
      issuer: TEST_ISSUER,
      jwksUri: TEST_JWKS_URI,
    });
    expect(claims.sub).toBe('user-42');
    expect(claims.email).toBe('u@example.com');
  });

  it('throws on invalid segment count', async () => {
    await expect(
      verifyBearerJwt('a.b', { issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI })
    ).rejects.toThrow('Invalid JWT format');
  });

  it('throws on non-RS256 alg', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', kid: KID }));
    const payload = b64url(JSON.stringify(basePayload));
    const token = `${header}.${payload}.sig`;
    await expect(
      verifyBearerJwt(token, { issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI })
    ).rejects.toThrow('Unsupported JWT alg');
  });

  it('throws on issuer mismatch', async () => {
    const token = signJwt({ ...basePayload, iss: 'https://evil.example.com' });
    await expect(
      verifyBearerJwt(token, { issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI })
    ).rejects.toThrow('issuer mismatch');
  });

  it('throws when audience is required but wrong', async () => {
    const token = signJwt({ ...basePayload, aud: 'expected-aud' });
    await expect(
      verifyBearerJwt(token, {
        issuer: TEST_ISSUER,
        jwksUri: TEST_JWKS_URI,
        audience: 'other-aud',
      })
    ).rejects.toThrow('audience mismatch');
  });

  it('accepts audience when it matches (string)', async () => {
    const token = signJwt({ ...basePayload, aud: 'api://mcp' });
    const claims = await verifyBearerJwt(token, {
      issuer: TEST_ISSUER,
      jwksUri: TEST_JWKS_URI,
      audience: 'api://mcp',
    });
    expect(claims.sub).toBe('user-42');
  });

  it('throws on expired JWT', async () => {
    const token = signJwt({ ...basePayload, exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(
      verifyBearerJwt(token, { issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI })
    ).rejects.toThrow('expired');
  });

  it('throws when signature does not match', async () => {
    const token = signJwt(basePayload);
    const [h, p] = token.split('.');
    const bad = `${h}.${p}.aaaa`;
    await expect(
      verifyBearerJwt(bad, { issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI })
    ).rejects.toThrow('signature verification failed');
  });

  it('throws when sub is missing', async () => {
    const { sub: _s, ...rest } = basePayload;
    const token = signJwt(rest as Record<string, unknown>);
    await expect(
      verifyBearerJwt(token, { issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI })
    ).rejects.toThrow('missing sub');
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

  it('throws when only issuer is set', () => {
    process.env.ZOWE_MCP_JWT_ISSUER = TEST_ISSUER;
    expect(() => loadJwtAuthConfigFromEnv()).toThrow(/Both ZOWE_MCP_JWT_ISSUER/);
  });

  it('throws when only JWKS URI is set', () => {
    process.env.ZOWE_MCP_JWKS_URI = TEST_JWKS_URI;
    expect(() => loadJwtAuthConfigFromEnv()).toThrow(/Both ZOWE_MCP_JWT_ISSUER/);
  });

  it('returns issuer, jwksUri, and optional audience when set', () => {
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
