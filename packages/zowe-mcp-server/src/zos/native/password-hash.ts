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
 * Returns a short, non-reversible hash of a password for use in log messages.
 * Use this whenever logging context that involves a password (e.g. SSH auth)
 * so logs can be correlated without exposing the password.
 */
import { createHash } from 'node:crypto';

export function passwordHash(password: string): string {
  if (password === '') return '<empty>';
  return createHash('sha256').update(password, 'utf8').digest('hex').slice(0, 16);
}
