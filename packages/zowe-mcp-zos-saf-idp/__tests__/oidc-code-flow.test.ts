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
 * Full scripted OAuth 2.1 authorization-code + PKCE flow against the real app:
 * DCR -> /auth -> SAF login form -> consent -> code -> /token, with the access
 * token verified by `@zowe/mcp-server`'s REAL `verifyBearerJwt` — proving the
 * resource server accepts these tokens unchanged.
 */

import { verifyBearerJwt } from '@zowe/mcp-server/dist/auth/bearer-jwt.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SshSafCheckResult } from '../src/saf-check.js';

const verifySafCredentialMock =
  vi.fn<(username: string, password: string) => Promise<SshSafCheckResult>>();

vi.mock('../src/saf-check.js', () => ({
  verifySafCredential: verifySafCredentialMock,
}));

const { createIdpApp, DEFAULT_MCP_RESOURCE } = await import('../src/server.js');
const {
  startOidcTestServer,
  registerClient,
  runCodeFlow,
  exchangeCode,
  refreshTokens,
  decodeJwtHeader,
  decodeJwtPayload,
} = await import('./helpers.js');

const MCP_RESOURCE = 'http://127.0.0.1:7542/mcp';
const TOKEN_TTL = 120;

describe('authorization-code + PKCE flow', () => {
  let running: Awaited<ReturnType<typeof startOidcTestServer>>;

  beforeEach(async () => {
    verifySafCredentialMock.mockReset();
    running = await startOidcTestServer(createIdpApp, {
      mcpResource: MCP_RESOURCE,
      tokenTtlSeconds: TOKEN_TTL,
      rateLimitMaxAttempts: 3,
      rateLimitWindowMs: 60_000,
    });
  });

  afterEach(async () => {
    await running.close();
  });

  /** Registers a client and walks the browser flow with the given credentials. */
  async function arrangeFlow(password: string, resource?: string) {
    const client = await registerClient(running.baseUrl);
    const flow = await runCodeFlow({
      baseUrl: running.baseUrl,
      client,
      username: 'ZMCPSAF',
      password,
      resource,
    });
    return { client, flow };
  }

  it('issues a resource-bound RS256 JWT the MCP server verifier accepts', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const { client, flow } = await arrangeFlow('secret', MCP_RESOURCE);
    expect(flow.outcome).toBe('code');
    if (flow.outcome !== 'code') return;
    expect(flow.state).not.toBe('');

    const token = await exchangeCode(running.baseUrl, client, flow, MCP_RESOURCE);
    expect(token.status).toBe(200);
    expect(token.body.token_type?.toLowerCase()).toBe('bearer');
    expect(token.body.expires_in).toBe(TOKEN_TTL);
    expect(typeof token.body.access_token).toBe('string');
    expect(typeof token.body.refresh_token).toBe('string');
    expect(typeof token.body.id_token).toBe('string');

    const accessToken = token.body.access_token!;
    const header = decodeJwtHeader(accessToken);
    expect(header.alg).toBe('RS256');
    expect(typeof header.kid).toBe('string');

    const payload = decodeJwtPayload(accessToken);
    expect(payload.iss).toBe(running.issuer);
    expect(payload.sub).toBe('ZMCPSAF');
    expect(payload.aud).toBe(MCP_RESOURCE);
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp as number).toBeGreaterThan(now);
    expect(payload.exp as number).toBeLessThanOrEqual(now + TOKEN_TTL + 5);

    // The real resource-server verifier, pointed at the legacy JWKS alias.
    const claims = await verifyBearerJwt(accessToken, {
      issuer: running.issuer,
      jwksUri: `${running.baseUrl}/.well-known/jwks.json`,
      audience: MCP_RESOURCE,
    });
    expect(claims.sub).toBe('ZMCPSAF');
  });

  it('a lowercase login yields the canonical uppercase SAF userid as sub', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const client = await registerClient(running.baseUrl);
    const flow = await runCodeFlow({
      baseUrl: running.baseUrl,
      client,
      username: 'zmcpsaf',
      password: 'secret',
      resource: MCP_RESOURCE,
    });
    expect(flow.outcome).toBe('code');
    if (flow.outcome !== 'code') return;

    const token = await exchangeCode(running.baseUrl, client, flow, MCP_RESOURCE);
    expect(token.status).toBe(200);
    const payload = decodeJwtPayload(token.body.access_token!);
    expect(payload.sub).toBe('ZMCPSAF');
    // The verifier still receives the username as typed — SAF folds case itself.
    expect(verifySafCredentialMock).toHaveBeenCalledWith('zmcpsaf', 'secret', expect.anything());
  });

  it('works without an explicit resource parameter (defaultResource)', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const { client, flow } = await arrangeFlow('secret');
    expect(flow.outcome).toBe('code');
    if (flow.outcome !== 'code') return;

    const token = await exchangeCode(running.baseUrl, client, flow);
    expect(token.status).toBe(200);
    const payload = decodeJwtPayload(token.body.access_token!);
    expect(payload.aud).toBe(MCP_RESOURCE);
  });

  it('refresh tokens work and rotate (old refresh token is rejected)', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const { client, flow } = await arrangeFlow('secret', MCP_RESOURCE);
    if (flow.outcome !== 'code') throw new Error('login failed unexpectedly');
    const first = await exchangeCode(running.baseUrl, client, flow, MCP_RESOURCE);
    const firstRefresh = first.body.refresh_token!;

    const second = await refreshTokens(running.baseUrl, client, firstRefresh, MCP_RESOURCE);
    expect(second.status).toBe(200);
    expect(typeof second.body.access_token).toBe('string');
    expect(typeof second.body.refresh_token).toBe('string');
    expect(second.body.refresh_token).not.toBe(firstRefresh);
    const payload = decodeJwtPayload(second.body.access_token!);
    expect(payload.sub).toBe('ZMCPSAF');
    expect(payload.aud).toBe(MCP_RESOURCE);

    // Rotation: reusing the consumed refresh token must fail.
    const replay = await refreshTokens(running.baseUrl, client, firstRefresh, MCP_RESOURCE);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
  });

  it('rejects the token exchange with a wrong PKCE verifier', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const { client, flow } = await arrangeFlow('secret');
    if (flow.outcome !== 'code') throw new Error('login failed unexpectedly');
    flow.pkce.verifier = `${flow.pkce.verifier.slice(0, -4)}XXXX`;
    const token = await exchangeCode(running.baseUrl, client, flow);
    expect(token.status).toBe(400);
    expect(token.body.error).toBe('invalid_grant');
  });

  it('re-renders the login form with a generic error on bad credentials', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'denied' });
    const { flow: result } = await arrangeFlow('wrong');
    expect(result.outcome).toBe('login_failed');
    if (result.outcome !== 'login_failed') return;
    expect(result.status).toBe(401);
    // Generic message; must not echo credentials.
    expect(result.body).toContain('Sign-in failed');
    expect(result.body).not.toContain('wrong');
    expect(result.body).not.toContain('no such user');
  });

  it('rate-limits repeated login failures inside the interaction', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'denied' });
    const client = await registerClient(running.baseUrl);
    let last: Awaited<ReturnType<typeof runCodeFlow>> | undefined;
    for (let i = 0; i < 4; i++) {
      last = await runCodeFlow({
        baseUrl: running.baseUrl,
        client,
        username: 'ZMCPSAF',
        password: 'wrong',
      });
    }
    expect(last!.outcome).toBe('login_failed');
    if (last!.outcome !== 'login_failed') return;
    expect(last!.status).toBe(429);
    expect(last!.retryAfter).toBeTruthy();
    expect(verifySafCredentialMock).toHaveBeenCalledTimes(3);
  });

  it('login page shows host name, generic SAF label, and testing notice by default', async () => {
    const { hostname } = await import('node:os');
    const { fetchLoginPage } = await import('./helpers.js');
    const body = await fetchLoginPage(running.baseUrl);
    expect(body).toContain(`Sign in to ${hostname()}`);
    expect(body).toContain('the system security manager (SAF)');
    expect(body).not.toContain('RACF');
    expect(body).toContain('testing purposes only');
  });

  it('login page uses configured system name, security product, and notice', async () => {
    const { fetchLoginPage } = await import('./helpers.js');
    const custom = await startOidcTestServer(createIdpApp, {
      systemName: 'SYSA-TEST',
      securityProduct: 'Top Secret',
      loginNotice: 'Custom banner for this deployment.',
    });
    try {
      const body = await fetchLoginPage(custom.baseUrl);
      expect(body).toContain('Sign in to SYSA-TEST');
      expect(body).toContain('Top Secret');
      expect(body).toContain('Custom banner for this deployment.');
      expect(body).not.toContain('testing purposes only');
    } finally {
      await custom.close();
    }
  });

  it('legacy POST /login still mints a token verifiable with the same JWKS', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const res = await fetch(`${running.baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ZMCPSAF', password: 'secret' }),
    });
    expect(res.status).toBe(200);
    const { access_token } = (await res.json()) as { access_token: string };
    const claims = await verifyBearerJwt(access_token, {
      issuer: running.issuer,
      jwksUri: `${running.baseUrl}/jwks`,
      // The /login token is audience-bound to the IdP's --mcp-resource.
      audience: DEFAULT_MCP_RESOURCE,
    });
    expect(claims.sub).toBe('ZMCPSAF');
  });
});
