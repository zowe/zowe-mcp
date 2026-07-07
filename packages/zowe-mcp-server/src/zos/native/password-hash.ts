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
 * Derived via PBKDF2 salted with a random, in-memory-only, per-process secret (not a
 * plain hash of the password) so a log reader cannot dictionary/rainbow-table the
 * fingerprint back to the password even offline.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const processSalt = randomBytes(32);
const ITERATIONS = 10_000;
const FINGERPRINT_BYTES = 8;

export function passwordHash(password: string): string {
  if (password === '') return '<empty>';
  return pbkdf2Sync(password, processSalt, ITERATIONS, FINGERPRINT_BYTES, 'sha256').toString(
    'hex'
  );
}
