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
 * Optional Bearer JWT verification for HTTP MCP (OAuth2 resource server style).
 * Uses Node.js crypto + JWKS fetch — no extra npm dependency.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/** Parsed JWT claims used as tenant identity for shared MCP. */
export interface TenantJwtClaims {
  /** OIDC subject (stable user key). */
  sub: string;
  /** Optional email claim. */
  email?: string;
}

export interface JwtAuthConfig {
  /** Expected issuer (`iss` claim). */
  issuer: string;
  /** JWKS URL (e.g. https://idp/.well-known/jwks.json). */
  jwksUri: string;
  /** Optional expected audience (`aud` claim — string or first element if array). */
  audience?: string;
}

interface CachedJwks {
  keys: unknown[];
  fetchedAt: number;
}

const JWKS_TTL_MS = 300_000;
const jwksCache = new Map<string, CachedJwks>();

function base64UrlDecodeToBuffer(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function parseJsonPayload<T>(b64: string): T {
  const json = base64UrlDecodeToBuffer(b64).toString('utf8');
  return JSON.parse(json) as T;
}

async function fetchJwks(uri: string): Promise<{ keys: unknown[] }> {
  const now = Date.now();
  const cached = jwksCache.get(uri);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) {
    return { keys: cached.keys };
  }
  const res = await fetch(uri, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { keys?: unknown[] };
  const keys = data.keys ?? [];
  jwksCache.set(uri, { keys, fetchedAt: now });
  return { keys };
}

function findRsaKey(
  keys: unknown[],
  kid: string | undefined
): Record<string, unknown> | undefined {
  for (const k of keys) {
    if (!k || typeof k !== 'object') continue;
    const key = k as Record<string, unknown>;
    if (key.kty !== 'RSA') continue;
    if (kid !== undefined) {
      if (key.kid === kid) return key;
    } else {
      return key;
    }
  }
  return undefined;
}

/** Extracts raw JWT from `Authorization: Bearer <token>` when present. */
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader?.toLowerCase().startsWith('bearer ')) {
    return undefined;
  }
  const t = authorizationHeader.slice(7).trim();
  return t || undefined;
}

/**
 * Verifies an RS256 JWT against JWKS and returns `sub` / `email` when valid.
 */
export async function verifyBearerJwt(
  bearerToken: string,
  config: JwtAuthConfig
): Promise<TenantJwtClaims> {
  const parts = bearerToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const [h64, p64, s64] = parts;
  const header = parseJsonPayload<{ alg: string; kid?: string }>(h64);
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT alg: ${header.alg}`);
  }
  const payload = parseJsonPayload<{
    iss?: string;
    sub?: string;
    aud?: string | string[];
    exp?: number;
    email?: string;
  }>(p64);

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < nowSec) {
    throw new Error('JWT expired');
  }
  if (payload.iss !== config.issuer) {
    throw new Error('JWT issuer mismatch');
  }
  if (config.audience !== undefined) {
    const aud = payload.aud;
    const ok =
      typeof aud === 'string'
        ? aud === config.audience
        : Array.isArray(aud)
          ? aud.includes(config.audience)
          : false;
    if (!ok) {
      throw new Error('JWT audience mismatch');
    }
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('JWT missing sub');
  }

  const { keys } = await fetchJwks(config.jwksUri);
  const jwk = findRsaKey(keys, header.kid);
  if (!jwk) {
    throw new Error('No matching JWK for JWT');
  }
  const publicKey = createPublicKey({
    key: jwk as unknown as import('node:crypto').JsonWebKey,
    format: 'jwk',
  });
  const data = Buffer.from(`${h64}.${p64}`, 'utf8');
  const sig = base64UrlDecodeToBuffer(s64);
  const ok = cryptoVerify('RSA-SHA256', data, publicKey, sig);
  if (!ok) {
    throw new Error('JWT signature verification failed');
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}

/** Clears in-memory JWKS HTTP cache — for tests only. */
export function __clearJwtJwksCacheForTests(): void {
  jwksCache.clear();
}

/**
 * Reads optional JWT auth config from environment variables:
 * - ZOWE_MCP_JWT_ISSUER + ZOWE_MCP_JWKS_URI → JWT required on HTTP /mcp
 * - ZOWE_MCP_JWT_AUDIENCE (optional)
 */
export function loadJwtAuthConfigFromEnv(): JwtAuthConfig | undefined {
  const issuer = process.env.ZOWE_MCP_JWT_ISSUER?.trim();
  const jwksUri = process.env.ZOWE_MCP_JWKS_URI?.trim();
  if (!issuer && !jwksUri) {
    return undefined;
  }
  if (!issuer || !jwksUri) {
    throw new Error(
      'Both ZOWE_MCP_JWT_ISSUER and ZOWE_MCP_JWKS_URI must be set to enable HTTP JWT auth'
    );
  }
  const audience = process.env.ZOWE_MCP_JWT_AUDIENCE?.trim();
  return {
    issuer,
    jwksUri,
    ...(audience ? { audience } : {}),
  };
}
