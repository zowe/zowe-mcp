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
 * Regression suite: both SSH and HTTP transports must gate on the SAME
 * `<mockDir>/_ssh/users.json` catalog. Adding a custom user with an unusual
 * scenario should produce consistent decisions across the two transports.
 *
 * We assert via the shared `authenticateUser` helper rather than spinning up a
 * real ssh2 client (which is exercised elsewhere). The helper is what BOTH
 * transports call, so equivalence at this layer is the regression net we want.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticateUser } from '../src/mock-host/auth.js';
import { loadMockUsers } from '../src/mock-host/users.js';
import { disposeMockZos, spawnMockZos, type SpawnedMockZos } from './helpers/spawn-mock-zos.js';

describe('mock-zos shared user catalog', () => {
  let env: SpawnedMockZos;

  beforeEach(async () => {
    env = await spawnMockZos({
      extraUsers: [
        {
          username: 'SHAREDOK',
          password: 'pw1',
          systemId: 'sys1',
          scenario: 'normal',
        },
        {
          username: 'SHAREDLOCK',
          password: 'pw2',
          systemId: 'sys1',
          scenario: 'racfRevoked',
        },
      ],
    });
  });

  afterEach(async () => {
    await disposeMockZos(env);
  });

  it('one catalog gates both transports — HTTP route uses authenticateUser', async () => {
    // Pull the users.json the daemon actually loaded — same source the SSH
    // transport reads.
    const { users } = await loadMockUsers(env.mockDir);

    // The HTTP route exercises authenticateUser directly. We assert the
    // helper decides identically against the loaded catalog.
    const ok = authenticateUser(users, 'SHAREDOK', 'pw1');
    expect(ok.ok).toBe(true);

    const wrong = authenticateUser(users, 'SHAREDOK', 'wrong');
    expect(wrong.ok).toBe(false);
    expect(wrong.ok === false && wrong.reason).toBe('wrongPassword');

    const locked = authenticateUser(users, 'SHAREDLOCK', 'pw2');
    expect(locked.ok).toBe(false);
    expect(locked.ok === false && locked.reason).toBe('racfRevoked');

    const unknown = authenticateUser(users, 'NOBODY', 'whatever');
    expect(unknown.ok).toBe(false);
    expect(unknown.ok === false && unknown.reason).toBe('unknownUser');

    // And the HTTP route observes the same decisions live.
    const httpRes = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('SHAREDOK:pw1').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(httpRes.status).toBe(200);

    const httpLocked = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('SHAREDLOCK:pw2').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(httpLocked.status).toBe(403);
  });
});
