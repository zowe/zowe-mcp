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
 * Shared SAF credential-check sequence (rate limit -> SAF verify -> record)
 * used by both the legacy `POST /login` route and the OIDC interaction login,
 * so both endpoints feed the same limiter with identical keys and semantics.
 */

import type { LoginRateLimiter } from './rate-limit.js';
import { toSafUserid } from './saf-userid.js';
import type { SafVerifier, SafVerifyResult } from './saf-verify.js';

export type SafLoginAttemptResult =
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'invalid_credentials' }
  /** The password was CORRECT but expired — safe to surface, not a guess oracle. */
  | { outcome: 'expired_password' }
  /** The check itself failed; detail is for the operator log, never the client. */
  | { outcome: 'unavailable'; detail: string }
  | { outcome: 'authenticated' };

export interface SafLoginAttemptOptions {
  username: string;
  password: string;
  remoteAddress: string | undefined;
  rateLimiter: LoginRateLimiter;
  verifier: SafVerifier;
}

export async function attemptSafLogin(
  options: SafLoginAttemptOptions
): Promise<SafLoginAttemptResult> {
  const { username, password, rateLimiter } = options;
  // Key on the canonical SAF userid: case variants of one userid must share
  // one attempt budget (SAF folds case, so they hit the same account).
  const rateLimitKey = `${toSafUserid(username)}\u0000${options.remoteAddress ?? 'unknown'}`;

  // Reserve the attempt slot BEFORE the awaited verification: checking only
  // recorded failures would let a concurrent burst all pass check() while the
  // first verifications are still in flight (check/record race).
  const rateLimit = rateLimiter.reserve(rateLimitKey);
  if (!rateLimit.allowed) {
    return { outcome: 'rate_limited', retryAfterSeconds: rateLimit.retryAfterSeconds ?? 1 };
  }

  let result: SafVerifyResult;
  try {
    result = await options.verifier(username, password);
  } finally {
    rateLimiter.release(rateLimitKey);
  }
  switch (result.outcome) {
    case 'authenticated':
      rateLimiter.recordSuccess(rateLimitKey);
      return { outcome: 'authenticated' };
    case 'invalid_credentials':
      rateLimiter.recordFailure(rateLimitKey);
      return { outcome: 'invalid_credentials' };
    case 'expired_password':
      // Correct password: clear the failure count, but do not authenticate.
      rateLimiter.recordSuccess(rateLimitKey);
      return { outcome: 'expired_password' };
    case 'unavailable':
      // Backend failure, not a credential failure — don't count it against the user.
      return { outcome: 'unavailable', detail: result.detail };
  }
}
