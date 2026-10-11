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
 * Same-system ("local") zowex execution: connection-spec form and activation
 * gating. Design: docs/zos-local-zowex-identity.md.
 *
 * A `local` entry in the native config `systems` / `--system` binds a system
 * id to "this z/OS host, as the authenticated user". The effective userid is
 * the session's JWT `sub` — a canonical uppercase SAF userid when minted by
 * zowe-mcp-zos-saf-idp — and the identity switch is performed by the
 * program-controlled zowex-launcher under SURROGAT authority
 * (packages/zowe-mcp-server/zos-launcher/), never by the Node process.
 *
 * "Same system" and "`sub` is a local userid" are OPERATOR ASSERTIONS, not
 * hostname heuristics — hence the explicit gating in
 * {@link checkLocalGating}. Everything in this module is part of the
 * identity-switch path and inside the mandatory security/integrity review
 * scope.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { isEnvFlagSet } from './connection-spec.js';

/** System id under which local zowex execution is registered. */
export const LOCAL_SYSTEM_ID = 'local';

/**
 * Where the SDK's SSH transport deploys zowex per user — usable as the stdio
 * same-user default because there the user is fixed for the process lifetime
 * (unlike the launcher path, which needs one shared binary for per-request
 * target users).
 */
export const LOCAL_DEFAULT_ZOWEX_SUBPATH = '.zowe-server/zowex';

/** Environment variable: operator assertion that the JWT issuer authenticates against THIS system's SAF. */
export const LOCAL_SUB_IS_USERID_ENV = 'ZOWE_MCP_LOCAL_SUB_IS_USERID';

/** Environment variable: absolute path to the program-controlled zowex-launcher binary. */
export const LOCAL_LAUNCHER_ENV = 'ZOWE_MCP_LOCAL_LAUNCHER';

/**
 * Environment variable: absolute path of the zowex binary the launcher execs
 * (`zowex server` as the authenticated user). The launcher refuses relative
 * program paths, and the per-user SSH default (`~/.zowe-server`) cannot name a
 * file for a user that is only known per request — so local execution uses one
 * explicit shared binary, executable by every permitted target user.
 */
export const LOCAL_ZOWEX_ENV = 'ZOWE_MCP_LOCAL_ZOWEX';

/**
 * True when a systems entry selects local zowex execution.
 * Accepted form: the literal `local` (trimmed, case-insensitive) — no user@,
 * no host: the user comes from the JWT and the host is this one.
 */
export function isLocalConnectionSpec(spec: string): boolean {
  return spec.trim().toLowerCase() === LOCAL_SYSTEM_ID;
}

/**
 * Shape of a SAF userid accepted as the local execution identity: 1-8
 * characters, uppercase A-Z, 0-9, #, $, @ — the same rule the launcher
 * enforces. Deliberately does NOT case-fold: the IdP mints `sub` in canonical
 * uppercase (see zowe-mcp-zos-saf-idp saf-userid.ts); a sub in any other
 * shape is not one of ours and gets no local identity.
 */
const SAF_USERID_RE = /^[A-Z0-9#$@]{1,8}$/;

/** True when `sub` has the canonical SAF-userid shape usable as the local execution identity. */
export function isValidSafUserid(sub: string): boolean {
  return SAF_USERID_RE.test(sub);
}

/**
 * Resolves the invoking process's userid for stdio same-user execution.
 * USS presents the SAF userid in lowercase; SAF userids are case-insensitive
 * with an uppercase canonical form, so folding is safe HERE — unlike a JWT
 * `sub`, whose shape is the issuer's contract and is never repaired.
 * Returns undefined when the OS username does not fold to a SAF userid.
 */
export function resolveProcessUserid(username: string | undefined): string | undefined {
  const folded = username?.trim().toUpperCase();
  return folded && isValidSafUserid(folded) ? folded : undefined;
}

/**
 * Resolves the zowex binary for stdio same-user execution: the explicit
 * `ZOWE_MCP_LOCAL_ZOWEX` override when set, else the per-user SSH-deploy
 * default `~/.zowe-server/zowex`. Existence is NOT checked here — the gating
 * and the doctor check it with their own hooks; the transport checks at spawn.
 */
export function resolveStdioZowexPath(
  env: Record<string, string | undefined>,
  home: string = homedir()
): { path: string; source: 'env' | 'default' } {
  const fromEnv = env[LOCAL_ZOWEX_ENV]?.trim();
  if (fromEnv) return { path: fromEnv, source: 'env' };
  return { path: posix.join(home, LOCAL_DEFAULT_ZOWEX_SUBPATH), source: 'default' };
}

export interface LocalGatingInput {
  /** `process.platform`. */
  platform: string;
  /**
   * Transport the server is starting with. Omit when unknown (the standalone
   * doctor) — the transport check is then skipped and only noted.
   */
  transport?: 'stdio' | 'http';
  /** True when ZOWE_MCP_JWT_ISSUER is set (HTTP JWT auth will be enabled). */
  jwtIssuerSet: boolean;
  env: Record<string, string | undefined>;
  /** Test hook: file-existence check for the launcher path. */
  launcherExists?: (path: string) => boolean;
  /**
   * stdio same-user arm only: the raw OS username of this process
   * (`os.userInfo().username`) — resolved via {@link resolveProcessUserid}.
   */
  processUsername?: string;
  /** stdio same-user arm only: home directory for the `~/.zowe-server/zowex` default. */
  home?: string;
}

/**
 * Validates the activation conditions for a configured `local` system.
 * Returns actionable error strings — empty means `local` may be activated.
 * All conditions are checked (not fail-fast) so the operator sees the full
 * list at once.
 */
export function checkLocalGating(input: LocalGatingInput): string[] {
  const errors: string[] = [];

  if (input.platform !== 'os390') {
    errors.push(
      `The "local" system requires the server to run on z/OS (process.platform "os390"); ` +
        `this platform is "${input.platform}". Remove "local" from systems or run the server ` +
        `on the z/OS system it should operate on.`
    );
  }

  // stdio: same-user execution (deployment shape 2). No identity switch
  // happens — zowex is spawned directly as the invoking user — so none of the
  // HTTP arm's JWT/assertion/launcher conditions apply. Only the identity must
  // resolve and a zowex must be reachable.
  if (input.transport === 'stdio') {
    if (resolveProcessUserid(input.processUsername) === undefined) {
      errors.push(
        `The invoking user ("${input.processUsername ?? ''}") does not resolve to a SAF userid ` +
          '(1-8 chars, A-Z 0-9 # $ @ after upper-folding) — the "local" system has no identity ' +
          'to run zowex as.'
      );
    }
    const exists = input.launcherExists ?? existsSync;
    const zowex = resolveStdioZowexPath(input.env, input.home);
    if (zowex.source === 'env' && !zowex.path.startsWith('/')) {
      errors.push(`${LOCAL_ZOWEX_ENV} must be an absolute path (got "${zowex.path}").`);
    } else if (!exists(zowex.path)) {
      errors.push(
        zowex.source === 'env'
          ? `${LOCAL_ZOWEX_ENV} points to "${zowex.path}", which does not exist.`
          : `No zowex found at the per-user default "${zowex.path}". Deploy zowex there ` +
              `(e.g. via an SSH-transport connection once) or set ${LOCAL_ZOWEX_ENV} to the ` +
              'absolute path of a zowex binary.'
      );
    }
    return errors;
  }
  if (!input.jwtIssuerSet) {
    errors.push(
      'The "local" system requires JWT authentication (set ZOWE_MCP_JWT_ISSUER): without an ' +
        'authenticated "sub" there is no userid to run zowex as, and falling back to a shared ' +
        'identity is never done. Configure JWT auth or remove "local".'
    );
  }

  if (!isEnvFlagSet(input.env[LOCAL_SUB_IS_USERID_ENV])) {
    errors.push(
      `Set ${LOCAL_SUB_IS_USERID_ENV}=1 to assert that the configured JWT issuer authenticates ` +
        `against THIS system's SAF database, so the token "sub" is a userid on this system. ` +
        "This is an explicit operator assertion (same pattern as the IdP's --allow-nonloopback); " +
        'it is intentionally not inferred from hostnames.'
    );
  }

  const exists = input.launcherExists ?? existsSync;
  checkConfiguredBinary(errors, input.env, exists, {
    envName: LOCAL_LAUNCHER_ENV,
    setHint:
      'the absolute path of the program-controlled zowex-launcher binary ' +
      '(see packages/zowe-mcp-server/zos-launcher/README.md for build and RACF setup)',
    missingHint:
      'Build and deploy the launcher (packages/zowe-mcp-server/zos-launcher/) and mark it ' +
      'program-controlled (extattr +p).',
  });
  checkConfiguredBinary(errors, input.env, exists, {
    envName: LOCAL_ZOWEX_ENV,
    setHint:
      'the absolute path of the zowex binary the launcher runs as the authenticated user ' +
      '(one shared install, executable by every permitted target user — the per-user ' +
      '~/.zowe-server default cannot be resolved for a per-request userid)',
    missingHint:
      'Deploy zowex to a shared location every permitted target user can execute and point ' +
      `${LOCAL_ZOWEX_ENV} at the binary itself.`,
  });

  return errors;
}

/**
 * Shared "set → absolute → exists" validation for the two configured binaries
 * (launcher and zowex). The launcher refuses relative program paths, so the
 * absolute-path requirement applies to both.
 */
function checkConfiguredBinary(
  errors: string[],
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
  what: { envName: string; setHint: string; missingHint: string }
): void {
  const value = env[what.envName]?.trim();
  if (!value) {
    errors.push(`Set ${what.envName} to ${what.setHint}.`);
  } else if (!value.startsWith('/')) {
    errors.push(
      `${what.envName} must be an absolute path (got "${value}") — the launcher refuses ` +
        'relative program paths and so does this check.'
    );
  } else if (!exists(value)) {
    errors.push(`${what.envName} points to "${value}", which does not exist. ${what.missingHint}`);
  }
}

/**
 * Maps a zowex-launcher exit to an operator-actionable message. The exit codes
 * are the launcher's contract (zos-launcher/zowex-launcher.c): 2 usage, 3 bad
 * input, 4 unknown user, 5 switch failed, 6 UID 0 refused, 127 exec failed.
 * Shared by the LocalClient transport and the doctor probe so both surface the
 * same guidance.
 */
export function describeLauncherFailure(
  status: number | null,
  stderr: string,
  targetUserid: string
): string {
  const output = stderr.trim();
  const suffix = output ? ` (launcher output: ${output})` : '';
  switch (status) {
    case 2:
    case 3:
      return `the launcher rejected its input (exit ${status})${suffix}`;
    case 4:
      return `userid ${targetUserid} is unknown or has no OMVS segment`;
    case 5:
      return (
        `identity switch to ${targetUserid} failed${suffix} — EPERM means the server userid ` +
        `lacks READ on BPX.SRV.${targetUserid} in SURROGAT; EMVSERR/JRENVDIRTY means the ` +
        'address space is not program-controlled (extattr +p, PROGRAM-class STEPLIB coverage)'
      );
    case 6:
      return `${targetUserid} resolves to UID 0 — the launcher refuses superuser targets`;
    case 127:
      return (
        `the launcher could not exec zowex${suffix} — check that ${LOCAL_ZOWEX_ENV} names the ` +
        `binary itself and that ${targetUserid} may execute it and traverse its directories`
      );
    default:
      return status === null
        ? `the launcher was ended by a signal${suffix}`
        : `the launcher exited with ${status}${suffix}`;
  }
}

/**
 * The SURROGAT + program-control setup for one permitted target user,
 * printed for the RACF administrator — NEVER executed (system-wide security
 * policy; same split as the IdP doctor).
 */
export function buildSurrogatInstructions(targetUserid: string, serverUserid: string): string[] {
  return [
    'RACF setup (RACF administrator — needs SPECIAL; one profile per permitted user keeps',
    'the blast radius explicit — do NOT define a generic BPX.SRV.* grant):',
    '  SETROPTS CLASSACT(SURROGAT)            /* if not already active */',
    `  RDEFINE SURROGAT BPX.SRV.${targetUserid} UACC(NONE)`,
    `  PERMIT BPX.SRV.${targetUserid} CLASS(SURROGAT) ID(${serverUserid}) ACCESS(READ)`,
    '  SETROPTS RACLIST(SURROGAT) REFRESH     /* if SURROGAT is RACLISTed */',
  ];
}
