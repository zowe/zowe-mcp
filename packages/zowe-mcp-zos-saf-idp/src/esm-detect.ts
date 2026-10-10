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
 * Best-effort detection of the z/OS External Security Manager, for display on
 * the login page. Runs only on z/OS, uses read-only `tsocmd` probes that need
 * no special authority, and gives up quietly on any failure:
 *
 * - `LISTUSER` (no operands: lists the caller's own profile) exists only on RACF.
 * - `TSS WHOAMI` exists only on Top Secret.
 * - There is no equally safe non-interactive ACF2 probe (the `ACF` command
 *   enters subcommand mode), so ACF2 systems fall back to the generic label
 *   unless `--security-product` is passed.
 *
 * Probes also fail when the server's userid has no TSO segment — that's fine,
 * the caller falls back to the generic "SAF" wording.
 */

import { execFile } from 'node:child_process';

const PROBES: { product: string; command: string }[] = [
  { product: 'RACF', command: 'LISTUSER' },
  { product: 'Top Secret', command: 'TSS WHOAMI' },
];

const PROBE_TIMEOUT_MS = 20_000;

function probe(command: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('tsocmd', [command], { timeout: PROBE_TIMEOUT_MS }, err => {
      resolve(!err);
    });
  });
}

/** Resolves the ESM product name, or undefined when not on z/OS / not detectable. */
export async function detectSecurityProduct(): Promise<string | undefined> {
  // 'os390' comes from IBM's Node.js port and is missing from @types/node's
  // Platform union, hence the widening cast.
  if ((process.platform as string) !== 'os390') {
    return undefined;
  }
  for (const { product, command } of PROBES) {
    try {
      if (await probe(command)) {
        return product;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}
