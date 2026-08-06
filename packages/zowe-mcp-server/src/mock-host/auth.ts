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
 * Shared authentication-decision logic for the mock z/OS host.
 *
 * Both the SSH listener (`server.ts`) and the z/OSMF HTTP listener (`zosmf/`)
 * call this pure function with the same `users` catalog so a single set of
 * fixtures (`<mockDir>/_ssh/users.json`) gates both transports identically.
 *
 * The function is intentionally pure / synchronous:
 *   - No I/O (callers handle persistence such as `recordAuthOutcome`).
 *   - The `authDelay` scenario is NOT honored here — delays are a
 *     transport-level concern (ssh2 uses `setTimeout` before `accept`,
 *     the HTTP route uses `await sleep` before responding).
 */

import { findUser, type MockUser } from './users.js';

export type AuthFailReason = 'unknownUser' | 'wrongPassword' | 'racfRevoked' | 'passwordExpired';

export interface AuthWarning {
  kind: 'passwordExpiresInDays';
  days: number;
}

export type AuthResult =
  { ok: true; user: MockUser; warning?: AuthWarning } | { ok: false; reason: AuthFailReason };

/**
 * Resolve a (username, password) pair against the mock catalog, mirroring the
 * SSH branch's decision order exactly:
 *
 *   1. Unknown user                    → `{ok: false, reason: 'unknownUser'}`
 *   2. Scenario `racfRevoked`          → `{ok: false, reason: 'racfRevoked'}` (no password check)
 *   3. Password mismatch               → `{ok: false, reason: 'wrongPassword'}`
 *   4. Scenario `passwordExpired`      → `{ok: false, reason: 'passwordExpired'}`
 *   5. Scenario `passwordExpiresInDays`→ `{ok: true, user, warning: {...}}`
 *   6. Otherwise                       → `{ok: true, user}`
 */
export function authenticateUser(
  users: MockUser[],
  username: string,
  password: string
): AuthResult {
  const candidate = findUser(users, username);
  if (!candidate) return { ok: false, reason: 'unknownUser' };

  // RACF revoke is checked before password — matches real z/OS auth flow and
  // the SSH handler in server.ts. The mock leaks information here (a revoked
  // user is distinguishable from a wrong password) which is a deliberate
  // testing affordance, not a security stance.
  if (candidate.scenario === 'racfRevoked') {
    return { ok: false, reason: 'racfRevoked' };
  }

  if (!candidate.password || candidate.password !== password) {
    return { ok: false, reason: 'wrongPassword' };
  }

  if (candidate.scenario === 'passwordExpired') {
    return { ok: false, reason: 'passwordExpired' };
  }

  if (
    candidate.scenario === 'passwordExpiresInDays' &&
    typeof candidate.scenarioValue === 'number' &&
    candidate.scenarioValue > 0
  ) {
    return {
      ok: true,
      user: candidate,
      warning: { kind: 'passwordExpiresInDays', days: candidate.scenarioValue },
    };
  }

  return { ok: true, user: candidate };
}
