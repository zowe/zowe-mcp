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
 * Returns a short, non-reversible fingerprint of a password for use in log messages.
 * Use this whenever logging context that involves a password (e.g. SSH auth)
 * so logs can be correlated without exposing the password.
 *
 * Keyed with a random, in-memory-only secret (not a plain hash of the password) so a
 * log reader cannot dictionary/rainbow-table the fingerprint back to the password.
 */
import { createHmac, randomBytes } from 'node:crypto';

const processKey = randomBytes(32);

export function passwordHash(password: string): string {
  if (password === '') return '<empty>';
  // codeql[js/insufficient-password-hash]: keyed HMAC fingerprint for log correlation only,
  // never stored or used to verify credentials. The random per-process key (never logged or
  // persisted) means this cannot be dictionary/rainbow-table attacked without it — a stronger
  // property than a slow keyless KDF (bcrypt/scrypt/PBKDF2) would give for this use case.
  return createHmac('sha256', processKey).update(password, 'utf8').digest('hex').slice(0, 16);
}
