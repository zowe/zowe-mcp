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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdpApp } from '../src/server.js';
import { startOidcTestServer, type RunningIdp } from './helpers.js';

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  jwks_uri: string;
  code_challenge_methods_supported: string[];
  grant_types_supported: string[];
  [key: string]: unknown;
}

describe('OIDC discovery and JWKS', () => {
  let running: RunningIdp;

  beforeAll(async () => {
    running = await startOidcTestServer(createIdpApp);
  });

  afterAll(async () => {
    await running.close();
  });

  it('serves a complete openid-configuration', async () => {
    const res = await fetch(`${running.baseUrl}/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as DiscoveryDocument;
    expect(doc.issuer).toBe(running.issuer);
    expect(doc.authorization_endpoint).toBe(`${running.issuer}/auth`);
    expect(doc.token_endpoint).toBe(`${running.issuer}/token`);
    expect(doc.registration_endpoint).toBe(`${running.issuer}/reg`);
    expect(doc.jwks_uri).toBe(`${running.issuer}/jwks`);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.grant_types_supported).toContain('authorization_code');
    expect(doc.grant_types_supported).toContain('refresh_token');
  });

  it('serves the identical document at the RFC 8414 path', async () => {
    const [oidc, rfc8414] = await Promise.all([
      fetch(`${running.baseUrl}/.well-known/openid-configuration`).then(
        r => r.json() as Promise<unknown>
      ),
      fetch(`${running.baseUrl}/.well-known/oauth-authorization-server`).then(
        r => r.json() as Promise<unknown>
      ),
    ]);
    expect(rfc8414).toEqual(oidc);
  });

  it('serves the same single RSA key from /jwks and the legacy /.well-known/jwks.json', async () => {
    const [providerJwks, legacyJwks] = (await Promise.all([
      fetch(`${running.baseUrl}/jwks`).then(r => r.json()),
      fetch(`${running.baseUrl}/.well-known/jwks.json`).then(r => r.json()),
    ])) as { keys: Record<string, unknown>[] }[];
    expect(providerJwks.keys).toHaveLength(1);
    expect(legacyJwks.keys).toHaveLength(1);
    expect(providerJwks.keys[0].kid).toBe(legacyJwks.keys[0].kid);
    expect(providerJwks.keys[0].n).toBe(legacyJwks.keys[0].n);
    expect(providerJwks.keys[0].kty).toBe('RSA');
    // Private key material must never leak from either endpoint.
    for (const key of [providerJwks.keys[0], legacyJwks.keys[0]]) {
      expect(key.d).toBeUndefined();
      expect(key.p).toBeUndefined();
      expect(key.q).toBeUndefined();
    }
  });
});
