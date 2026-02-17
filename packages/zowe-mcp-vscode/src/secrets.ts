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
 * Shared Zowe OSS secret storage key for SSH passwords.
 *
 * Format: zowe.ssh.password.${user}.${hostNormalized}
 * Other Zowe extensions can use this key to share credentials for the same user@host.
 */

/**
 * Returns the secret storage key for an SSH password (user@host).
 * Must match the server's toSecretStorageKey convention.
 */
export function getNativePasswordKey(user: string, host: string): string {
  const userPart = user.toUpperCase();
  const hostNormalized = host.replace(/\./g, '_').toLowerCase();
  return `zowe.ssh.password.${userPart}.${hostNormalized}`;
}
