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
 * External TLS termination (`tlsTerminated`, z/OS AT-TLS): the app serves an
 * `https://` issuer over a plain local socket with no proxy headers on the
 * wire. These tests simulate that by talking plain http to the app while the
 * issuer is https.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SshSafCheckResult } from '../src/saf-check.js';

const verifySafCredentialMock =
  vi.fn<(username: string, password: string) => Promise<SshSafCheckResult>>();

vi.mock('../src/saf-check.js', () => ({
  verifySafCredential: verifySafCredentialMock,
}));

const { createIdpApp, startIdpHttp } = await import('../src/server.js');
const { startOidcTestServer, registerClient, runCodeFlow, exchangeCode, decodeJwtPayload } =
  await import('./helpers.js');

const MCP_RESOURCE = 'http://127.0.0.1:7542/mcp';

describe('tlsTerminated configuration validation', () => {
  it('rejects combining tlsTerminated with trustProxy', () => {
    expect(() =>
      createIdpApp('https://idp.example', { tlsTerminated: true, trustProxy: true })
    ).toThrow(/mutually exclusive/);
  });

  it('rejects a non-https issuer', () => {
    expect(() => createIdpApp('http://idp.example', { tlsTerminated: true })).toThrow(
      /requires an https:\/\/ issuer/
    );
  });

  it('allows a non-loopback bind without --allow-nonloopback', async () => {
    const logs: string[] = [];
    const handle = await startIdpHttp({
      host: '0.0.0.0',
      port: 0,
      issuer: 'https://idp.example',
      tlsTerminated: true,
      log: m => logs.push(m),
    });
    await handle.close();
    expect(logs.join('\n')).toContain('external TLS termination');
  });

  it('still refuses a non-loopback bind without tlsTerminated or allow-nonloopback', async () => {
    await expect(startIdpHttp({ host: '0.0.0.0', port: 0 })).rejects.toThrow(
      /refusing to bind non-loopback host/
    );
  });
});

describe('tlsTerminated over a plain socket (AT-TLS simulation)', () => {
  let running: Awaited<ReturnType<typeof startOidcTestServer>>;

  beforeEach(async () => {
    verifySafCredentialMock.mockReset();
    running = await startOidcTestServer(
      createIdpApp,
      { tlsTerminated: true, mcpResource: MCP_RESOURCE },
      port => `https://127.0.0.1:${port}`
    );
  });

  afterEach(async () => {
    await running.close();
  });

  it('serves the https discovery document, ignoring a spoofed X-Forwarded-Proto', async () => {
    const res = await fetch(`${running.baseUrl}/.well-known/openid-configuration`, {
      headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.example' },
    });
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, string>;
    expect(doc.issuer).toBe(running.issuer);
    expect(doc.authorization_endpoint).toBe(`${running.issuer}/auth`);
    expect(doc.token_endpoint).toBe(`${running.issuer}/token`);
    expect(doc.jwks_uri).toBe(`${running.issuer}/jwks`);
  });

  it('sets Secure session cookies on the authorization request', async () => {
    const client = await registerClient(running.baseUrl);
    const res = await fetch(
      `${running.baseUrl}/auth?` +
        new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: client.redirect_uri,
          response_type: 'code',
          scope: 'openid',
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          state: 'x',
        }).toString(),
      { redirect: 'manual' }
    );
    expect([302, 303]).toContain(res.status);
    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.toLowerCase()).toContain('secure');
    }
  });

  it('completes the full code flow and mints a token with the https issuer', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const client = await registerClient(running.baseUrl);
    const flow = await runCodeFlow({
      baseUrl: running.baseUrl,
      client,
      username: 'USER1',
      password: 'pass',
      // The provider redirects to its https origin; route those hops back to
      // the plain test socket the way AT-TLS decryption would.
      rewriteLocation: l => l.replace(running.issuer, running.baseUrl),
    });
    expect(flow.outcome).toBe('code');
    if (flow.outcome !== 'code') return;
    const token = await exchangeCode(running.baseUrl, client, flow);
    expect(token.status).toBe(200);
    const payload = decodeJwtPayload(token.body.access_token ?? '');
    expect(payload.iss).toBe(running.issuer);
    expect(payload.aud).toBe(MCP_RESOURCE);
  });
});
