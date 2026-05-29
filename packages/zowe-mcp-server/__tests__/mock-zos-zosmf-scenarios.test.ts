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
 * Scenario coverage for the z/OSMF mock — the auth catalog's EXPIRED, LOCKED,
 * WARNING, and (synthetic) SLOWAUTH users must produce the expected HTTP
 * responses.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disposeMockZos, spawnMockZos, type SpawnedMockZos } from './helpers/spawn-mock-zos.js';

const POST_AUTH = '/zosmf/services/authenticate';

function basicHeader(user: string, pass = 'password'): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

describe('mock-zos z/OSMF scenarios', () => {
  let env: SpawnedMockZos;

  beforeEach(async () => {
    env = await spawnMockZos({
      extraUsers: [
        {
          username: 'SLOWAUTH',
          password: 'password',
          systemId: 'sys1',
          scenario: 'authDelay',
          scenarioValue: 300,
        },
      ],
    });
  });

  afterEach(async () => {
    await disposeMockZos(env);
  });

  it('EXPIRED user → 401 + IZUG1124E (password expired)', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${POST_AUTH}`, {
      method: 'POST',
      headers: {
        Authorization: basicHeader('EXPIRED'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm="z\/OSMF"/);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/IZUG1124E/);
    expect(body.message).toMatch(/EXPIRED/);
  });

  it('LOCKED user → 403 + IZUG1167E (RACF revoked)', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${POST_AUTH}`, {
      method: 'POST',
      headers: {
        Authorization: basicHeader('LOCKED'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/IZUG1167E/);
    expect(body.message).toMatch(/LOCKED/);
  });

  it('WARNING user → 200 + X-Password-Expiry-Days header + Set-Cookie', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${POST_AUTH}`, {
      method: 'POST',
      headers: {
        Authorization: basicHeader('WARNING'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-password-expiry-days')).toBe('3');
    expect(res.headers.get('set-cookie')).toMatch(/^LtpaToken2=[a-f0-9]{64};/);
  });

  it('SLOWAUTH user → response is delayed by ~scenarioValue ms', async () => {
    const start = Date.now();
    const res = await fetch(`${env.httpBaseUrl!}${POST_AUTH}`, {
      method: 'POST',
      headers: {
        Authorization: basicHeader('SLOWAUTH'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    // Lower bound — the 300ms scenario delay should be honored; allow generous
    // upper bound for slow CI environments.
    expect(elapsed).toBeGreaterThanOrEqual(290);
    expect(elapsed).toBeLessThan(5_000);
  });
});
