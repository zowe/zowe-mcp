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
 * Regression tests for ZOWE-MCP-07: the login rate limiter must reserve the
 * attempt slot BEFORE the awaited SAF verification. The old check-then-record
 * sequence let a concurrent burst all pass check() while the first (slow, SSH)
 * verifications were still in flight — an unbounded password-guessing window
 * against live RACF, and a ready-made way to trip a userid's revoke threshold.
 */

import { describe, expect, it } from 'vitest';
import { attemptSafLogin } from '../src/auth-attempt.js';
import { LoginRateLimiter } from '../src/rate-limit.js';
import type { SafVerifyResult } from '../src/saf-verify.js';

/** A verifier that blocks until the test releases it, like a real SSH probe. */
function deferredVerifier(): {
  verifier: (username: string, password: string) => Promise<SafVerifyResult>;
  calls: number;
  settleAll: (result: SafVerifyResult) => void;
} {
  const pending: ((result: SafVerifyResult) => void)[] = [];
  const state = {
    calls: 0,
    verifier: (_username: string, _password: string): Promise<SafVerifyResult> => {
      state.calls++;
      return new Promise<SafVerifyResult>(resolve => pending.push(resolve));
    },
    settleAll: (result: SafVerifyResult): void => {
      for (const resolve of pending.splice(0)) resolve(result);
    },
  };
  return state;
}

function attempt(
  rateLimiter: LoginRateLimiter,
  verifier: (username: string, password: string) => Promise<SafVerifyResult>,
  password = 'guess'
) {
  return attemptSafLogin({
    username: 'IBMUSER',
    password,
    remoteAddress: '198.51.100.7',
    rateLimiter,
    verifier,
  });
}

describe('attemptSafLogin concurrency (check/record race)', () => {
  it('a concurrent burst gets at most maxAttempts verifications, the rest are rate_limited', async () => {
    const rateLimiter = new LoginRateLimiter(3, 60_000);
    const deferred = deferredVerifier();

    const burst = Array.from({ length: 10 }, (_, i) =>
      attempt(rateLimiter, deferred.verifier, `guess-${i}`)
    );
    // All ten are now past the reserve point; none of the verifications has
    // settled yet — exactly the window the old code left open.
    expect(deferred.calls).toBe(3);

    deferred.settleAll({ outcome: 'invalid_credentials' });
    const results = await Promise.all(burst);
    expect(results.filter(r => r.outcome === 'rate_limited')).toHaveLength(7);
    expect(results.filter(r => r.outcome === 'invalid_credentials')).toHaveLength(3);

    // The three failures are recorded: the budget stays exhausted afterwards.
    const after = await attempt(rateLimiter, deferred.verifier);
    expect(after.outcome).toBe('rate_limited');
    expect(deferred.calls).toBe(3);
  });

  it('releases reserved slots so a successful login still clears the budget', async () => {
    const rateLimiter = new LoginRateLimiter(2, 60_000);
    const deferred = deferredVerifier();

    const first = attempt(rateLimiter, deferred.verifier);
    deferred.settleAll({ outcome: 'authenticated' });
    expect((await first).outcome).toBe('authenticated');

    // recordSuccess cleared the history and release() returned the in-flight
    // slot — the full budget is available again.
    const second = attempt(rateLimiter, deferred.verifier);
    const third = attempt(rateLimiter, deferred.verifier);
    expect(deferred.calls).toBe(3);
    deferred.settleAll({ outcome: 'invalid_credentials' });
    await Promise.all([second, third]);
  });

  it('releases the slot when the verifier throws (no leaked reservations)', async () => {
    const rateLimiter = new LoginRateLimiter(2, 60_000);
    let calls = 0;
    const throwing = (): Promise<SafVerifyResult> => {
      calls++;
      return Promise.reject(new Error('ssh connect failed'));
    };

    await expect(attempt(rateLimiter, throwing)).rejects.toThrow('ssh connect failed');
    await expect(attempt(rateLimiter, throwing)).rejects.toThrow('ssh connect failed');
    // Reservations were released on throw; only recorded failures could deny,
    // and none were recorded — the budget is intact.
    await expect(attempt(rateLimiter, throwing)).rejects.toThrow('ssh connect failed');
    expect(calls).toBe(3);
  });
});

describe('LoginRateLimiter growth bounds', () => {
  it('check() of an unknown key does not insert a tracking entry', () => {
    const limiter = new LoginRateLimiter(5, 60_000);
    for (let i = 0; i < 1000; i++) {
      expect(limiter.check(`USER${String(i)}\u0000198.51.100.7`).allowed).toBe(true);
    }
    // Internal map — accessed reflectively only to assert the bound.
    const failures = (limiter as unknown as { failures: Map<string, number[]> }).failures;
    expect(failures.size).toBe(0);
  });

  it('recordFailure() with attacker-chosen keys stays under the hard cap', () => {
    const limiter = new LoginRateLimiter(5, 60_000);
    for (let i = 0; i < 12_000; i++) {
      limiter.recordFailure(`USER${String(i)}\u0000198.51.100.7`);
    }
    const failures = (limiter as unknown as { failures: Map<string, number[]> }).failures;
    expect(failures.size).toBeLessThanOrEqual(10_000);
    // The newest key is still tracked (eviction drops the oldest, not the latest).
    expect(failures.has('USER11999\u0000198.51.100.7')).toBe(true);
  });
});
