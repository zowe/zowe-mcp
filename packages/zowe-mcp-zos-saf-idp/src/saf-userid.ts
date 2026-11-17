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
 * Canonicalize a typed username to the SAF userid form: trimmed and uppercase.
 *
 * SAF userids are case-insensitive — RACF folds a lowercase login to uppercase
 * before verifying it — so `userb` and `USERB` are the same identity. Tokens
 * must carry the canonical (uppercase) form in `sub`: downstream consumers use
 * `sub` as a z/OS userid (see docs/zos-local-zowex-identity.md), and the rate
 * limiter must not grant case variants of one userid separate attempt budgets.
 *
 * The *typed* username still goes to the verifier unchanged — SAF does its own
 * folding, and the native/SSH backends are validated with as-typed input.
 */
export function toSafUserid(username: string): string {
  return username.trim().toUpperCase();
}
