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
 * True when JES completion indicates condition code 0 (success).
 * Mock backends may use `0000`; Zowe Remote SSH (z/OS) / JES often returns `CC 0000`.
 */
export function isZeroCompletionRetcode(retcode: string | undefined): boolean {
  if (retcode === undefined) return false;
  const s = retcode.trim();
  if (s === '0000') return true;
  return /^CC\s+0+$/i.test(s);
}
