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
 * Integration tests for the z/OSMF mock authentication lifecycle.
 *
 * Spins the daemon in-process on ephemeral ports and exercises:
 *  - POST  /zosmf/services/authenticate     (login → 200 + Set-Cookie)
 *  - GET   /zosmf/info                      (verify via cookie)
 *  - DELETE /zosmf/services/authenticate    (logout → 204 + cleared cookie)
 *  - Re-using the revoked cookie            (→ 401)
 *  - Edge cases: missing Authorization, missing CSRF, Basic-only GET /info
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  disposeMockZos,
  extractLtpaCookie,
  spawnMockZos,
  type SpawnedMockZos,
} from './helpers/spawn-mock-zos.js';

describe('mock-zos z/OSMF authentication lifecycle', () => {
  let env: SpawnedMockZos;

  beforeEach(async () => {
    env = await spawnMockZos();
  });

  afterEach(async () => {
    await disposeMockZos(env);
  });

  it('full login → /zosmf/info → logout → 401 cycle', async () => {
    const base = env.httpBaseUrl!;

    // 1. Login as USER1 with Basic auth + CSRF
    const loginRes = await fetch(`${base}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get('set-cookie');
    expect(setCookie).toMatch(/^LtpaToken2=[a-f0-9]{64};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    const token = extractLtpaCookie(setCookie ?? undefined);
    expect(token).toBeTruthy();

    // 2. GET /zosmf/info with the cookie
    const infoRes = await fetch(`${base}/zosmf/info`, {
      headers: {
        Cookie: `LtpaToken2=${token!}`,
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(infoRes.status).toBe(200);
    const infoBody = (await infoRes.json()) as Record<string, unknown>;
    expect(infoBody.zos_version).toBe('05.30.00');
    expect(infoBody.zosmf_version).toBe('30');
    expect(infoBody.zosmf_full_version).toBe('30.0');
    expect(infoBody.plugins).toBeInstanceOf(Array);
    // zos_subreleases must NOT appear — removed in conformance fix
    expect(infoBody).not.toHaveProperty('zos_subreleases');

    // 3. Logout
    const logoutRes = await fetch(`${base}/zosmf/services/authenticate`, {
      method: 'DELETE',
      headers: {
        Cookie: `LtpaToken2=${token!}`,
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(logoutRes.status).toBe(204);
    const clearCookie = logoutRes.headers.get('set-cookie') ?? '';
    expect(clearCookie).toContain('LtpaToken2=;');
    expect(clearCookie).toContain('Max-Age=0');

    // 4. Re-using the revoked cookie → 401
    const afterLogoutRes = await fetch(`${base}/zosmf/info`, {
      headers: {
        Cookie: `LtpaToken2=${token!}`,
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(afterLogoutRes.status).toBe(401);
    expect(afterLogoutRes.headers.get('www-authenticate')).toMatch(/^Basic realm="z\/OSMF"/);
  });

  it('GET /zosmf/info accepts Basic auth without a cookie', async () => {
    const res = await fetch(`${env.httpBaseUrl!}/zosmf/info`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(200);
  });

  it('GET /zosmf/info is lenient: works without X-CSRF-ZOSMF-HEADER', async () => {
    const res = await fetch(`${env.httpBaseUrl!}/zosmf/info`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
      },
    });
    expect(res.status).toBe(200);
  });

  it('POST authenticate without Authorization → 401 + WWW-Authenticate challenge', async () => {
    const res = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: { 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm="z\/OSMF"/);
  });

  it('POST authenticate without X-CSRF-ZOSMF-HEADER → 403 + IZUM112E', async () => {
    const res = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/IZUM112E/);
  });

  it('wrong password → 401 + IZUG1126E', async () => {
    const res = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:wrong').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm="z\/OSMF"/);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/IZUG1126E/);
  });

  it('unknown user → 401 + IZUG1126E (same code as wrong password — by design)', async () => {
    const res = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('NOBODY:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/IZUG1126E/);
  });

  it('logout without auth → 401', async () => {
    const res = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'DELETE',
      headers: { 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(401);
  });
});
