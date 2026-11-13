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
import { createRedirectPolicy } from '../src/oidc/redirect-policy.js';
import { createIdpApp } from '../src/server.js';
import { startOidcTestServer, type RunningIdp } from './helpers.js';

function register(baseUrl: string, metadata: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/reg`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(metadata),
  });
}

describe('redirect policy', () => {
  const policy = createRedirectPolicy(['https://example.test/custom-cb']);

  it.each([
    'http://127.0.0.1:33418/',
    'http://127.0.0.1:7000/some/deep/callback',
    'http://localhost:8080/cb',
    'http://[::1]:9999/',
    'https://vscode.dev/redirect',
    'https://insiders.vscode.dev/redirect',
    'https://example.test/custom-cb',
  ])('allows %s', uri => {
    expect(policy.isAllowed(uri)).toBe(true);
  });

  it.each([
    'https://evil.example.com/cb',
    'https://vscode.dev/other-path',
    'http://127.0.0.1.evil.com/',
    'vscode://callback',
    'not a url',
  ])('rejects %s', uri => {
    expect(policy.isAllowed(uri)).toBe(false);
  });
});

describe('POST /reg (dynamic client registration)', () => {
  let running: RunningIdp;

  beforeAll(async () => {
    running = await startOidcTestServer(createIdpApp, {
      redirectAllow: ['https://allowed.example.test/cb'],
    });
  });

  afterAll(async () => {
    await running.close();
  });

  it('accepts a VS Code-shaped registration and echoes the metadata', async () => {
    const res = await register(running.baseUrl, {
      client_name: 'Visual Studio Code',
      redirect_uris: ['http://127.0.0.1:33418/', 'https://vscode.dev/redirect'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.client_id).toBe('string');
    expect(body.redirect_uris).toEqual(['http://127.0.0.1:33418/', 'https://vscode.dev/redirect']);
    expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('accepts an extra redirect URI added via redirectAllow', async () => {
    const res = await register(running.baseUrl, {
      redirect_uris: ['https://allowed.example.test/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(res.status).toBe(201);
  });

  it('rejects a non-allowlisted redirect URI with invalid_redirect_uri', async () => {
    const res = await register(running.baseUrl, {
      redirect_uris: ['http://127.0.0.1:33418/', 'https://attacker.example.com/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  it('rejects a non-allowlisted post_logout_redirect_uris (open-redirect surface)', async () => {
    // rp-initiated logout (/session/end) redirects the browser to a registered
    // post_logout_redirect_uri — it must satisfy the same policy as redirect_uris.
    const res = await register(running.baseUrl, {
      redirect_uris: ['http://127.0.0.1:33418/'],
      post_logout_redirect_uris: ['https://saf-login.attacker.example/expired'],
      token_endpoint_auth_method: 'none',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; error_description: string };
    expect(body.error).toBe('invalid_redirect_uri');
    expect(body.error_description).toContain('post_logout_redirect_uris');
  });

  it('accepts policy-compliant post_logout_redirect_uris', async () => {
    const res = await register(running.baseUrl, {
      redirect_uris: ['http://127.0.0.1:33418/'],
      post_logout_redirect_uris: ['http://127.0.0.1:33418/', 'https://allowed.example.test/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(res.status).toBe(201);
  });

  it('passes malformed JSON through to oidc-provider for its canonical error', async () => {
    const res = await fetch(`${running.baseUrl}/reg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('rejects an oversized registration body', async () => {
    const res = await fetch(`${running.baseUrl}/reg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'x'.repeat(300 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});

describe('POST /reg registration bounds (anonymous DCR DoS)', () => {
  const metadata = {
    redirect_uris: ['http://127.0.0.1:33418/'],
    token_endpoint_auth_method: 'none',
  };

  it('throttles one source past the per-source window with 429 + Retry-After', async () => {
    const running = await startOidcTestServer(createIdpApp, { dcrMaxPerSource: 3 });
    try {
      for (let i = 0; i < 3; i++) {
        expect((await register(running.baseUrl, metadata)).status).toBe(201);
      }
      const throttled = await register(running.baseUrl, metadata);
      expect(throttled.status).toBe(429);
      expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await running.close();
    }
  });

  it('refuses registrations beyond the total cap with 503 (LRU flush protection)', async () => {
    const running = await startOidcTestServer(createIdpApp, {
      dcrMaxPerSource: 100,
      dcrMaxTotal: 2,
    });
    try {
      // Policy rejections do not count against the total cap...
      const rejected = await register(running.baseUrl, {
        ...metadata,
        redirect_uris: ['https://attacker.example.com/cb'],
      });
      expect(rejected.status).toBe(400);
      // ...but accepted registrations do, and the cap fails closed.
      expect((await register(running.baseUrl, metadata)).status).toBe(201);
      expect((await register(running.baseUrl, metadata)).status).toBe(201);
      const capped = await register(running.baseUrl, metadata);
      expect(capped.status).toBe(503);
    } finally {
      await running.close();
    }
  });
});
