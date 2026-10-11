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
 * Environment doctor for same-system ("local") zowex execution
 * (`zowe-mcp-server doctor-local`). Design: docs/zos-local-zowex-identity.md.
 *
 * Follows the check/setup split established by the SAF IdP doctor:
 * - Checks are read-only and always safe: platform, gating env vars, launcher
 *   file state including the program-control extended attribute.
 * - The SURROGAT probe (`--probe-user`) is opt-in only: it performs a REAL,
 *   SAF-audited surrogate identity switch through the launcher and runs
 *   `id` as the target user.
 * - RACF changes (SURROGAT profiles, PROGRAM class members) are NEVER
 *   executed — the exact commands are printed for the RACF administrator.
 */

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { userInfo } from 'node:os';
import {
  buildSurrogatInstructions,
  checkLocalGating,
  describeLauncherFailure,
  isValidSafUserid,
  LOCAL_LAUNCHER_ENV,
  LOCAL_SUB_IS_USERID_ENV,
  LOCAL_ZOWEX_ENV,
  resolveProcessUserid,
  resolveStdioZowexPath,
} from './local-system.js';

export type LocalDoctorStatus = 'ok' | 'fail' | 'info';

export interface LocalDoctorCheck {
  name: string;
  status: LocalDoctorStatus;
  detail: string;
  /** Setup steps for the user / their RACF admin. Present only on failures. */
  instructions?: string[];
}

export interface LocalDoctorReport {
  checks: LocalDoctorCheck[];
  ok: boolean;
}

export interface LocalDoctorOptions {
  /**
   * Run a real SURROGAT switch probe to this userid through the launcher
   * (SAF-audited; requires the server userid's READ on BPX.SRV.<userid>).
   */
  probeUser?: string;
  /**
   * Check the stdio same-user arm (deployment shape 2) instead of the HTTP
   * launcher arm: platform, the invoking user's SAF-userid shape, and a
   * resolvable zowex — no launcher, SURROGAT, or JWT conditions.
   */
  stdio?: boolean;
  /** Test hooks. */
  platform?: string;
  env?: Record<string, string | undefined>;
  processUsername?: string;
  home?: string;
  statFile?: (path: string) => { isFile: boolean; mode: number } | undefined;
  /** Returns `ls -E` output for the file, or undefined when unavailable. */
  listExtattr?: (path: string) => string | undefined;
  runLauncherProbe?: (
    launcher: string,
    userid: string
  ) => { status: number | null; stdout: string; stderr: string };
}

const LAUNCHER_INSTRUCTIONS = [
  'Build and deploy the launcher (packages/zowe-mcp-server/zos-launcher/):',
  '  ./build.sh                          # IBM Open XL C/C++',
  '  extattr +p zowex-launcher           # needs READ on BPX.FILEATTR.PROGCTL',
  '  chmod 700 zowex-launcher            # only the server userid may exec it',
  `  export ${LOCAL_LAUNCHER_ENV}=/absolute/path/to/zowex-launcher`,
];

/** Parses the extended-attribute flags column of z/OS `ls -E` output (e.g. `-rwx------ -ps-`). */
export function extattrHasProgramControl(lsOutput: string): boolean | undefined {
  const fields = lsOutput.trim().split(/\s+/);
  // ls -E: permissions, then the 4-char extattr column (a p s l flags or '-').
  const ext = fields[1];
  if (!ext || !/^[apsl-]{1,4}$/.test(ext)) {
    return undefined;
  }
  return ext.includes('p');
}

export function runLocalDoctor(options: LocalDoctorOptions = {}): LocalDoctorReport {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const checks: LocalDoctorCheck[] = [];

  if (platform !== 'os390') {
    checks.push({
      name: 'platform',
      status: 'info',
      detail: `not z/OS (${platform}) — local zowex execution is unavailable here; nothing to check.`,
    });
    return { checks, ok: true };
  }
  checks.push({ name: 'platform', status: 'ok', detail: 'z/OS (os390)' });

  // stdio same-user arm: identity + zowex only, then done — no launcher,
  // SURROGAT, or JWT conditions apply (no identity switch happens).
  if (options.stdio) {
    const username = options.processUsername ?? userInfo().username;
    const resolved = resolveProcessUserid(username);
    checks.push({
      name: 'invoking user',
      status: resolved ? 'ok' : 'fail',
      detail: resolved
        ? `${resolved} (tools run as this user — no identity switch)`
        : `"${username}" does not fold to a SAF userid`,
    });
    const stdioGatingErrors = checkLocalGating({
      platform,
      transport: 'stdio',
      jwtIssuerSet: false,
      env,
      processUsername: username,
      home: options.home,
      launcherExists: p => (options.statFile ?? defaultStatFile)(p) !== undefined,
    });
    const zowex = resolveStdioZowexPath(env, options.home);
    checks.push({
      name: 'zowex binary',
      status: stdioGatingErrors.length === 0 ? 'ok' : 'fail',
      detail:
        stdioGatingErrors.length === 0
          ? `${zowex.path} (${zowex.source === 'env' ? LOCAL_ZOWEX_ENV : 'per-user default'})`
          : 'activation conditions not met',
      ...(stdioGatingErrors.length > 0 ? { instructions: stdioGatingErrors } : {}),
    });
    return { checks, ok: checks.every(c => c.status !== 'fail') };
  }

  // Gating env vars. The doctor runs standalone, so the transport cannot be
  // verified — the JWT-issuer and assertion vars can.
  const gatingErrors = checkLocalGating({
    platform,
    jwtIssuerSet: !!env.ZOWE_MCP_JWT_ISSUER?.trim(),
    env,
    launcherExists: p => (options.statFile ?? defaultStatFile)(p) !== undefined,
  });
  checks.push({
    name: 'gating',
    status: gatingErrors.length === 0 ? 'ok' : 'fail',
    detail:
      gatingErrors.length === 0
        ? `${LOCAL_SUB_IS_USERID_ENV}, ${LOCAL_LAUNCHER_ENV}, ${LOCAL_ZOWEX_ENV} and ` +
          'ZOWE_MCP_JWT_ISSUER are set (the HTTP-transport condition is checked at server startup)'
        : 'activation conditions not met',
    ...(gatingErrors.length > 0 ? { instructions: gatingErrors } : {}),
  });

  const launcher = env[LOCAL_LAUNCHER_ENV]?.trim();
  if (launcher?.startsWith('/')) {
    const stat = (options.statFile ?? defaultStatFile)(launcher);
    if (!stat) {
      checks.push({
        name: 'launcher file',
        status: 'fail',
        detail: `"${launcher}" does not exist`,
        instructions: LAUNCHER_INSTRUCTIONS,
      });
    } else if (!stat.isFile) {
      checks.push({
        name: 'launcher file',
        status: 'fail',
        detail: `"${launcher}" is not a regular file`,
        instructions: LAUNCHER_INSTRUCTIONS,
      });
    } else {
      const perms = stat.mode & 0o777;
      const permsOk = (perms & 0o077) === 0 && (perms & 0o700) !== 0;
      checks.push({
        name: 'launcher permissions',
        status: permsOk ? 'ok' : 'fail',
        detail: `mode ${perms.toString(8).padStart(3, '0')}${permsOk ? '' : ' — expected 700 (owner-only)'}`,
        ...(permsOk ? {} : { instructions: [`chmod 700 ${launcher}`] }),
      });

      const lsOut = (options.listExtattr ?? defaultListExtattr)(launcher);
      const progctl = lsOut === undefined ? undefined : extattrHasProgramControl(lsOut);
      if (progctl === undefined) {
        checks.push({
          name: 'launcher program control',
          status: 'info',
          detail: 'could not determine extattr state (ls -E unavailable or unrecognized output)',
        });
      } else {
        checks.push({
          name: 'launcher program control',
          status: progctl ? 'ok' : 'fail',
          detail: progctl
            ? 'extattr +p is set'
            : 'extattr +p is NOT set — setuid will fail with EMVSERR (JRENVDIRTY)',
          ...(progctl
            ? {}
            : {
                instructions: [
                  `extattr +p ${launcher}      # needs READ on BPX.FILEATTR.PROGCTL in FACILITY`,
                  '(re-run after every rebuild — modifying a file drops +p)',
                ],
              }),
        });
      }
    }
  }

  const zowex = env[LOCAL_ZOWEX_ENV]?.trim();
  if (zowex?.startsWith('/')) {
    const stat = (options.statFile ?? defaultStatFile)(zowex);
    if (!stat?.isFile) {
      checks.push({
        name: 'zowex binary',
        status: 'fail',
        detail: `"${zowex}" ${stat ? 'is not a regular file' : 'does not exist'}`,
        instructions: [
          `Deploy zowex to a shared location and point ${LOCAL_ZOWEX_ENV} at the binary itself.`,
        ],
      });
    } else {
      // zowex runs AFTER the identity switch, as the target user — it needs no
      // +p, but every permitted target user must be able to execute it.
      const groupOrOtherExec = (stat.mode & 0o011) !== 0;
      checks.push({
        name: 'zowex binary',
        status: groupOrOtherExec ? 'ok' : 'info',
        detail: groupOrOtherExec
          ? `"${zowex}" exists (mode ${(stat.mode & 0o777).toString(8).padStart(3, '0')})`
          : `"${zowex}" exists but is owner-execute only (mode ` +
            `${(stat.mode & 0o777).toString(8).padStart(3, '0')}) — target users other than ` +
            'the owner will fail to exec it (launcher exit 127); also check directory traversal',
      });
    }
  }

  if (options.probeUser !== undefined) {
    checks.push(runProbe(options, launcher));
  } else {
    checks.push({
      name: 'SURROGAT probe',
      status: 'info',
      detail:
        'not run — pass --probe-user <userid> to perform a real, SAF-audited surrogate switch ' +
        'through the launcher (runs `id` as that user)',
    });
  }

  return { checks, ok: checks.every(check => check.status !== 'fail') };
}

function runProbe(options: LocalDoctorOptions, launcher: string | undefined): LocalDoctorCheck {
  const target = options.probeUser?.trim().toUpperCase() ?? '';
  if (!isValidSafUserid(target)) {
    return {
      name: 'SURROGAT probe',
      status: 'fail',
      detail: `"${options.probeUser}" is not a valid SAF userid (1-8 chars, A-Z 0-9 # $ @)`,
    };
  }
  if (!launcher) {
    return {
      name: 'SURROGAT probe',
      status: 'fail',
      detail: `cannot probe: ${LOCAL_LAUNCHER_ENV} is not set`,
      instructions: LAUNCHER_INSTRUCTIONS,
    };
  }
  const run = options.runLauncherProbe ?? defaultRunLauncherProbe;
  const result = run(launcher, target);
  const serverUserid = userInfo().username.toUpperCase();
  if (result.status === 0) {
    return {
      name: 'SURROGAT probe',
      status: 'ok',
      detail: `switched to ${target}: ${result.stdout.trim().split('\n')[0] ?? ''}`,
    };
  }
  return {
    name: 'SURROGAT probe',
    status: 'fail',
    detail: describeLauncherFailure(result.status, result.stderr, target),
    instructions:
      result.status === 5
        ? [
            ...buildSurrogatInstructions(target, serverUserid),
            'If the launcher reported EMVSERR/JRENVDIRTY instead of EPERM, the address space is',
            'dirty: re-check extattr +p and PROGRAM-class coverage of every STEPLIB dataset',
            "(RALTER PROGRAM * ADDMEM('<dsn>'//NOPADCHK) + SETROPTS WHEN(PROGRAM) REFRESH).",
          ]
        : undefined,
  };
}

function defaultStatFile(path: string): { isFile: boolean; mode: number } | undefined {
  try {
    const s = statSync(path);
    return { isFile: s.isFile(), mode: s.mode };
  } catch {
    return undefined;
  }
}

function defaultListExtattr(path: string): string | undefined {
  const result = spawnSync('ls', ['-E', path], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : undefined;
}

function defaultRunLauncherProbe(
  launcher: string,
  userid: string
): { status: number | null; stdout: string; stderr: string } {
  // The userid crosses via stdin only (never argv/env) — the launcher's contract.
  const result = spawnSync(launcher, ['/bin/sh', '-c', 'id'], {
    input: `${userid}\n`,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Renders a report for the terminal. */
export function formatLocalDoctorReport(report: LocalDoctorReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    const badge = check.status === 'ok' ? 'OK  ' : check.status === 'fail' ? 'FAIL' : 'INFO';
    lines.push(`[${badge}] ${check.name}: ${check.detail}`);
    for (const instruction of check.instructions ?? []) {
      lines.push(`       ${instruction}`);
    }
  }
  if (report.checks.every(check => check.status === 'info')) {
    lines.push('No z/OS checks were run.');
  } else {
    lines.push(
      report.ok
        ? 'Environment looks ready for local zowex execution (system "local").'
        : 'Environment is NOT ready for local zowex execution — follow the instructions above.'
    );
  }
  return lines.join('\n');
}
