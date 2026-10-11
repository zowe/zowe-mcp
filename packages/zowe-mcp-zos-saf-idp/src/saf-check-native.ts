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
 * Native SAF credential verification via IBM's `racf` addon (node-racf), which
 * calls the z/OS `__passwd()` service directly. Available only on z/OS with the
 * addon built and the address space program-controlled; loaded lazily so this
 * package still installs and runs everywhere else (SSH backend, saf-check.ts).
 *
 * Validated on a live RACF LPAR (2026-09-11) — see docs/zos-saf-idp.md for the
 * build recipe (node-addon-api 8.x swap, Open XL flags) and the RACF setup
 * (extattr +p on node/libnode/racf.node, PROGRAM class for STEPLIB datasets).
 */

import { createRequire } from 'node:module';
import type { SafVerifyResult } from './saf-verify.js';

/** The subset of node-racf this package uses. `authenticate` is synchronous. */
export interface RacfModule {
  authenticate(username: string, password: string): boolean;
}

/**
 * Loads the `racf` addon. Resolution order: the `ZOWE_MCP_IDP_RACF_MODULE`
 * env var (explicit path for deployments that build the addon out-of-tree),
 * then a plain `require('racf')`. Throws with the loader's message on failure —
 * callers decide whether that is fatal (--saf-check native) or a fallback
 * (--saf-check auto).
 */
export function loadRacfModule(): RacfModule {
  const require = createRequire(import.meta.url);
  const explicitPath = process.env.ZOWE_MCP_IDP_RACF_MODULE;
  const loaded: unknown = explicitPath ? require(explicitPath) : require('racf');
  const candidate = loaded as Partial<RacfModule>;
  if (typeof candidate.authenticate !== 'function') {
    throw new Error(
      `module loaded from ${explicitPath ?? "'racf'"} has no authenticate() function`
    );
  }
  return candidate as RacfModule;
}

/**
 * node-racf maps only EACCES to `false`; every other __passwd failure is thrown
 * with the C runtime's strerror text (EDC*I messages). Observed on a live RACF
 * LPAR:
 *   - unknown user      -> throws ESRCH  "EDC5143I No such process."
 *   - dirty environment -> throws EMVSERR "EDC5157I An internal error has
 *     occurred." (JRENVDIRTY: a module in the address space is not
 *     program-controlled)
 *   - expired password  -> throws EMVSEXPIRE (message mentions the expiry)
 */
export function classifyRacfError(message: string): SafVerifyResult {
  // Unknown user: report as plain invalid credentials — routes must stay
  // generic ("no such user" vs "bad password" must be indistinguishable).
  if (message.includes('EDC5143I') || /no such process/i.test(message)) {
    return { outcome: 'invalid_credentials' };
  }
  if (/expired/i.test(message)) {
    // Safe to surface: __passwd only reports expiry for a CORRECT password,
    // so this is no oracle for guessing.
    return { outcome: 'expired_password' };
  }
  if (message.includes('EDC5157I')) {
    return {
      outcome: 'unavailable',
      detail:
        'native SAF check failed: the address space is not program-controlled (JRENVDIRTY). ' +
        'Ensure extattr +p is set on the node binary, libnode*.so, and racf.node, and that ' +
        'every STEPLIB dataset the runtime loads from (e.g. an LE runtime override) is ' +
        'defined to the RACF PROGRAM class. Original error: ' +
        message,
    };
  }
  return { outcome: 'unavailable', detail: `native SAF check failed: ${message}` };
}

/**
 * Reserved userid for the no-credential environment probe. Verifying it needs
 * no real password: an unknown user yields ESRCH (mapped to
 * invalid_credentials) only after __passwd actually reached RACF from a clean,
 * program-controlled address space — while a dirty environment fails first
 * with JRENVDIRTY. So the probe verdict separates "native path functional"
 * from "environment misconfigured" without touching any real account. (In the
 * unlikely event the userid exists, the probe records one failed password
 * attempt against it — the name is chosen to make that implausible.)
 */
export const SAF_PROBE_USERID = 'ZWEMCPRB';
const SAF_PROBE_PASSWORD = 'ZWEPROBE';

/**
 * Checks that the native path is usable end-to-end: module callable, address
 * space clean, RACF reachable. `invalid_credentials` (or, theoretically,
 * `authenticated`) means the environment is good; `unavailable` carries the
 * remediation detail.
 */
export function probeNativeEnvironment(racf: RacfModule): SafVerifyResult {
  return verifyWithRacfModule(racf, SAF_PROBE_USERID, SAF_PROBE_PASSWORD);
}

/**
 * Verifies a credential with a loaded racf module. Synchronous under the hood
 * (__passwd blocks for the duration of the RACF check — milliseconds); wrapped
 * as a Promise to match the SSH backend's shape. Never lets the password reach
 * an error message: node-racf throws only strerror text.
 */
export function verifyWithRacfModule(
  racf: RacfModule,
  username: string,
  password: string
): SafVerifyResult {
  try {
    return racf.authenticate(username, password)
      ? { outcome: 'authenticated' }
      : { outcome: 'invalid_credentials' };
  } catch (err) {
    return classifyRacfError(err instanceof Error ? err.message : String(err));
  }
}
