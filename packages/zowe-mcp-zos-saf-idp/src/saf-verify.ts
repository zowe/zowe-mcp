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
 * SAF verification backend selection: the portable SSH connect-probe
 * (saf-check.ts) or the native z/OS `__passwd()` path via node-racf
 * (saf-check-native.ts), chosen by `--saf-check auto|native|ssh`.
 */

import {
  loadRacfModule,
  probeNativeEnvironment,
  verifyWithRacfModule,
  type RacfModule,
} from './saf-check-native.js';
import { verifySafCredential } from './saf-check.js';

export type SafCheckMode = 'auto' | 'native' | 'ssh';

export const SAF_CHECK_MODES: readonly SafCheckMode[] = ['auto', 'native', 'ssh'];

export type SafVerifyResult =
  | { outcome: 'authenticated' }
  | { outcome: 'invalid_credentials' }
  /** Correct password, but it has expired — safe to tell the user. */
  | { outcome: 'expired_password' }
  /** The check itself failed (not the user's fault); detail is operator-facing only. */
  | { outcome: 'unavailable'; detail: string };

/** One credential check. Implementations never reject and never log the password. */
export type SafVerifier = (username: string, password: string) => Promise<SafVerifyResult>;

export interface ResolveSafVerifierOptions {
  mode?: SafCheckMode;
  /** SSH backend target — defaults to loopback (127.0.0.1:22). */
  safHost?: string;
  safPort?: number;
  /** Test/embedding hook: use this module instead of loading 'racf'. */
  racfModule?: RacfModule;
  log?: (message: string) => void;
}

export interface ResolvedSafVerifier {
  verifier: SafVerifier;
  backend: 'native' | 'ssh';
}

function createSshVerifier(host?: string, port?: number): SafVerifier {
  return async (username, password) => {
    const result = await verifySafCredential(username, password, { host, port });
    switch (result.outcome) {
      case 'authenticated':
        return { outcome: 'authenticated' };
      case 'denied':
        return { outcome: 'invalid_credentials' };
      case 'unavailable':
        // Backend failure, not a credential verdict: surfaces as 503 and is
        // not counted against the user's rate-limit budget.
        return { outcome: 'unavailable', detail: result.detail };
    }
  };
}

/**
 * Picks the verification backend once, at startup:
 * - `ssh` (default): the portable SSH connect probe, as before.
 * - `native`: require node-racf — startup fails with an actionable error when
 *   it cannot be loaded (never silently degrades to SSH).
 * - `auto`: native when the platform is z/OS and node-racf loads, else SSH.
 */
export function resolveSafVerifier(options: ResolveSafVerifierOptions = {}): ResolvedSafVerifier {
  const mode = options.mode ?? 'ssh';
  const log = options.log ?? ((): void => undefined);

  // 'os390' is the z/OS platform tag; @types/node's Platform union omits it.
  const isZos = (process.platform as string) === 'os390';
  if (mode === 'native' || (mode === 'auto' && isZos)) {
    try {
      const racf = options.racfModule ?? loadRacfModule();
      // No-credential startup probe: a dirty environment must surface here as
      // an actionable startup condition, not as 503s on every login later.
      const probe = probeNativeEnvironment(racf);
      if (probe.outcome === 'unavailable') {
        throw new Error(probe.detail);
      }
      log('SAF check backend: native (node-racf / __passwd; environment probe passed)');
      return {
        backend: 'native',
        verifier: (username, password) =>
          Promise.resolve(verifyWithRacfModule(racf, username, password)),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (mode === 'native') {
        throw new Error(
          `--saf-check native: ${reason}. ` +
            "Run 'zowe-mcp-zos-saf-idp doctor' for environment checks and setup " +
            'instructions (building node-racf, ZOWE_MCP_IDP_RACF_MODULE, extattr +p, ' +
            'PROGRAM class) — see docs/zos-saf-idp.md.'
        );
      }
      log(`SAF check backend: ssh (native backend not usable: ${reason})`);
      return { backend: 'ssh', verifier: createSshVerifier(options.safHost, options.safPort) };
    }
  }

  log(mode === 'auto' ? 'SAF check backend: ssh (not running on z/OS)' : 'SAF check backend: ssh');
  return { backend: 'ssh', verifier: createSshVerifier(options.safHost, options.safPort) };
}
