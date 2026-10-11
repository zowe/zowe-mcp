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

export interface RateLimitResult {
  allowed: boolean;
  /** Present only when `allowed` is false. */
  retryAfterSeconds?: number;
}

/**
 * Sliding-window limiter over failed `/login` attempts, keyed by (username, source IP).
 *
 * Every failed attempt here is a real RACF authentication attempt against a live LPAR:
 * without this limit, `/login` is a password-guessing oracle that risks locking out real
 * RACF IDs long before anyone worries about misuse of the endpoint itself.
 */
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();
  /** Attempts whose SAF verification is still in flight, counted against the budget. */
  private readonly inFlight = new Map<string, number>();

  /**
   * Hard cap on tracked (username, source) keys. Keys are attacker-chosen —
   * a scripted client inventing a username per request would otherwise grow
   * the map until the heap is gone (the DCR endpoint has its own cap for the
   * same reason). On overflow, expired entries are swept first, then the
   * oldest-inserted key is evicted; evicting a key only ever FORGETS failures
   * (fails open for one key), it never blocks a legitimate user.
   */
  private static readonly MAX_TRACKED_KEYS = 10_000;

  constructor(
    private readonly maxAttempts = 5,
    private readonly windowMs = 15 * 60 * 1000
  ) {}

  private recentFailures(key: string, now: number): number[] {
    return (this.failures.get(key) ?? []).filter(t => now - t < this.windowMs);
  }

  /** Drops entries whose failures all aged out; then the oldest, until under the cap. */
  private evictOverflow(now: number): void {
    if (this.failures.size < LoginRateLimiter.MAX_TRACKED_KEYS) return;
    for (const [key, attempts] of this.failures) {
      if (!attempts.some(t => now - t < this.windowMs)) {
        this.failures.delete(key);
      }
    }
    // Map iteration is insertion-ordered: delete oldest keys first.
    for (const key of this.failures.keys()) {
      if (this.failures.size < LoginRateLimiter.MAX_TRACKED_KEYS) break;
      this.failures.delete(key);
    }
  }

  /** Checks the limit (recorded failures + in-flight attempts) without recording an attempt. */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const attempts = this.recentFailures(key, now);
    // Never INSERT on a read: a key with no live failures stays untracked,
    // so probing random usernames cannot grow the map through check() alone.
    if (attempts.length > 0) {
      this.failures.set(key, attempts);
    } else {
      this.failures.delete(key);
    }
    const pending = this.inFlight.get(key) ?? 0;
    if (attempts.length + pending >= this.maxAttempts) {
      // An in-flight-only denial has no oldest failure to age out — retry shortly.
      const retryAfterMs = attempts.length > 0 ? this.windowMs - (now - attempts[0]) : 1000;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    return { allowed: true };
  }

  /**
   * Reserves one attempt slot BEFORE the (awaited, slow) SAF verification and
   * counts it against the budget, so a concurrent burst cannot all pass the
   * check while no failure has been recorded yet (check/record race). Every
   * allowed reservation MUST be paired with `release()` once the verification
   * settles; record the outcome via recordFailure()/recordSuccess() as before.
   */
  reserve(key: string): RateLimitResult {
    const result = this.check(key);
    if (result.allowed) {
      this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
    }
    return result;
  }

  /** Releases an attempt slot reserved by `reserve()`. */
  release(key: string): void {
    const pending = this.inFlight.get(key) ?? 0;
    if (pending <= 1) {
      this.inFlight.delete(key);
    } else {
      this.inFlight.set(key, pending - 1);
    }
  }

  /** Records a failed SAF authentication attempt. */
  recordFailure(key: string): void {
    const now = Date.now();
    this.evictOverflow(now);
    const attempts = this.recentFailures(key, now);
    attempts.push(now);
    this.failures.set(key, attempts);
  }

  /** Clears the failure history after a successful login. */
  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}
