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
 * Environment doctor for the native SAF backend (`zowe-mcp-zos-saf-idp doctor`).
 *
 * Checks are separated from setup, because setup needs different authority:
 * - Checks are read-only and always safe.
 * - `--fix` performs only what the invoking user may be able to do alone:
 *   `extattr +p` on USS files (needs READ on BPX.FILEATTR.PROGCTL, and file
 *   ownership).
 * - RACF changes (PROGRAM class members, FACILITY permits) are NEVER executed —
 *   they are system-wide security policy, so the doctor prints the exact
 *   commands for a RACF administrator / sysprog instead.
 */

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  ATTLS_BUILD_HINT,
  probeAtTlsAddon,
  type AtTlsMode,
  type AtTlsProbeResult,
} from 'zos-attls';
import { loadRacfModule, probeNativeEnvironment, type RacfModule } from './saf-check-native.js';

export type DoctorStatus = 'ok' | 'fail' | 'info';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  /** Setup steps for the user / their RACF admin. Present only on failures. */
  instructions?: string[];
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** extattr +p commands the doctor ran itself (with --fix). */
  fixesApplied: string[];
  ok: boolean;
}

export interface DoctorOptions {
  /** Attempt `extattr +p` on the files this user may own (USS-side setup only). */
  fix?: boolean;
  /** Test hooks. */
  racfModule?: RacfModule;
  platform?: string;
  env?: Record<string, string | undefined>;
  runExtattr?: (files: string[]) => { ok: boolean; message: string };
}

/**
 * The USS files that must be program-controlled for `__passwd` to work inside
 * this process: the node binary, its shared libraries, and EVERY native addon
 * the process loads — including zos-attls: its query ioctl needs no authority
 * by itself, but z/OS daemon-environment integrity applies to the whole
 * address space, so an uncontrolled DLL either dirties it before `__passwd`
 * (probe degrades to unavailable) or, loaded after a successful `__passwd`,
 * gets the process killed outright (observed on Host-A: silent rc=137).
 */
export function programControlledFileCandidates(execPath: string): string[] {
  const files = [execPath];
  const libDir = join(dirname(execPath), '..', 'lib');
  try {
    for (const entry of readdirSync(libDir)) {
      if (entry.endsWith('.so')) files.push(join(libDir, entry));
    }
  } catch {
    // No lib dir next to the binary (unusual layout) — the binary alone, then.
  }
  const racfNode = addonPath(process.env.ZOWE_MCP_IDP_RACF_MODULE ?? 'racf', 'racf.node');
  if (racfNode) files.push(racfNode);
  const attlsNode = process.env.ZOWE_MCP_ATTLS_MODULE
    ? addonPath(process.env.ZOWE_MCP_ATTLS_MODULE, 'attls.node')
    : undefined;
  if (attlsNode) files.push(attlsNode);
  return files;
}

/** Best-effort path of a compiled addon's .node file (for extattr instructions). */
function addonPath(entry: string, nodeFile: string): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const moduleDir = dirname(require.resolve(entry));
    const candidate = join(moduleDir, 'build', 'Release', nodeFile);
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Datasets named in STEPLIB — each must be in the RACF PROGRAM class. */
export function steplibDatasets(env: Record<string, string | undefined>): string[] {
  return (env.STEPLIB ?? '')
    .split(':')
    .map(entry => entry.trim())
    .filter(entry => entry && entry.toUpperCase() !== 'NONE' && entry.toUpperCase() !== 'CURRENT');
}

/**
 * The setup a dirty (JRENVDIRTY) environment needs, split by who can do it.
 * Everything here is printed, never executed (except extattr under --fix).
 */
export function buildProgramControlInstructions(
  execPath: string,
  env: Record<string, string | undefined>
): string[] {
  const instructions: string[] = [];
  const files = programControlledFileCandidates(execPath);
  instructions.push(
    'USS setup (you, if you own the files and have READ on BPX.FILEATTR.PROGCTL in FACILITY):',
    `  extattr +p ${files.join(' \\\n    ')}`,
    '  (re-run after any reinstall/update of node or the racf addon — modifying a file drops +p)'
  );
  const steplib = steplibDatasets(env);
  if (steplib.length > 0) {
    instructions.push(
      'RACF setup (RACF administrator — needs SPECIAL; system-wide policy change):',
      ...steplib.map(dsn => `  RALTER PROGRAM * ADDMEM('${dsn}'//NOPADCHK)`),
      '  SETROPTS WHEN(PROGRAM) REFRESH',
      `  (modules loaded from a STEPLIB dataset dirty the address space unless the dataset is in the PROGRAM class; this process's STEPLIB: ${steplib.join(':')})`
    );
  }
  instructions.push(
    'If extattr fails with an authorization error, ask your RACF administrator for:',
    '  PERMIT BPX.FILEATTR.PROGCTL CLASS(FACILITY) ID(<your-userid>) ACCESS(READ)',
    '  SETROPTS RACLIST(FACILITY) REFRESH'
  );
  return instructions;
}

/**
 * Environment variables the z/OS runtime RELIES ON (must be set to an expected
 * state by whoever starts the process — the inherited environment differs by
 * launch path: JCL/BPXBATCH vs login shell vs non-interactive ssh), plus the
 * user-owned ones worth seeing for context (TZ, LANG — never overridden).
 * Logged at startup, by the doctor, and by the z/OS integration tests, so the
 * actual state a process ran with is always in its log.
 */
export const RUNTIME_ENV_VARS = [
  '_BPXK_AUTOCVT',
  '_CEE_RUNOPTS',
  '_TAG_REDIR_IN',
  '_TAG_REDIR_OUT',
  '_TAG_REDIR_ERR',
  'STEPLIB',
  'ZOWE_MCP_IDP_RACF_MODULE',
  'ZOWE_MCP_ATTLS_MODULE',
  'ZOWE_MCP_ATTLS_LOOPBACK_CLEAR',
  'TZ',
  'LANG',
] as const;

/** One-line snapshot of the relied-on environment, e.g. for a startup log. */
export function describeRuntimeEnvironment(
  env: Record<string, string | undefined> = process.env
): string {
  return RUNTIME_ENV_VARS.map(name => `${name}=${env[name] ?? '(unset)'}`).join(' ');
}

const BUILD_INSTRUCTIONS = [
  "The native backend needs IBM's node-racf addon (https://github.com/ibmruntimes/node-racf),",
  'built on z/OS with IBM Open XL C/C++ against node-addon-api 8.x (its declared 1.x does not',
  'compile under C++20) — see the build recipe in docs/zos-saf-idp.md.',
  "Install it next to this package, or point ZOWE_MCP_IDP_RACF_MODULE at the module's directory.",
];

export function runSafDoctor(options: DoctorOptions = {}): DoctorReport {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const fixesApplied: string[] = [];

  if (platform !== 'os390') {
    checks.push({
      name: 'platform',
      status: 'info',
      detail: `not z/OS (${platform}) — the native backend is unavailable here; --saf-check auto uses the SSH probe.`,
    });
    return { checks, fixesApplied, ok: true };
  }
  checks.push({ name: 'platform', status: 'ok', detail: 'z/OS (os390)' });
  checks.push({ name: 'environment', status: 'info', detail: describeRuntimeEnvironment(env) });

  let racf: RacfModule;
  try {
    racf = options.racfModule ?? loadRacfModule();
    checks.push({ name: 'racf module', status: 'ok', detail: 'node-racf loaded' });
  } catch (err) {
    checks.push({
      name: 'racf module',
      status: 'fail',
      detail: `cannot load: ${err instanceof Error ? err.message : String(err)}`,
      instructions: BUILD_INSTRUCTIONS,
    });
    return { checks, fixesApplied, ok: false };
  }

  const runProbe = (): DoctorCheck => {
    const probe = probeNativeEnvironment(racf);
    if (probe.outcome === 'unavailable') {
      return {
        name: 'environment probe',
        status: 'fail',
        detail: probe.detail,
        instructions: buildProgramControlInstructions(process.execPath, env),
      };
    }
    return {
      name: 'environment probe',
      status: 'ok',
      detail:
        '__passwd reached RACF from a clean, program-controlled address space ' +
        '(no-credential probe: unknown-user verdict as expected)',
    };
  };

  let probeCheck = runProbe();
  if (probeCheck.status === 'fail' && options.fix) {
    const files = programControlledFileCandidates(process.execPath).filter(existsSync);
    const runExtattr =
      options.runExtattr ??
      ((targets: string[]): { ok: boolean; message: string } => {
        const { spawnSync } = require_child_process();
        const result = spawnSync('extattr', ['+p', ...targets], { encoding: 'utf8' });
        return result.status === 0
          ? { ok: true, message: `extattr +p applied to ${targets.length} file(s)` }
          : { ok: false, message: (result.stderr || result.stdout || 'extattr failed').trim() };
      });
    const fix = runExtattr(files);
    checks.push({
      name: 'fix: extattr +p',
      status: fix.ok ? 'ok' : 'fail',
      detail: fix.message,
      ...(fix.ok ? {} : { instructions: buildProgramControlInstructions(process.execPath, env) }),
    });
    if (fix.ok) {
      fixesApplied.push(`extattr +p ${files.join(' ')}`);
      probeCheck = runProbe(); // re-verify after the fix
    }
  }
  checks.push(probeCheck);

  return { checks, fixesApplied, ok: checks.every(check => check.status !== 'fail') };
}

const ATTLS_BUILD_INSTRUCTIONS = [
  `AT-TLS aware mode needs the zos-attls query addon: ${ATTLS_BUILD_HINT}.`,
  'The query-only SIOCTTLSCTL ioctl itself is unprivileged, but in THIS process (which also',
  'uses __passwd) the addon must be program-controlled or the process is killed on load:',
  '  extattr +p <module>/build/Release/attls.node   (re-run after every rebuild)',
];

export interface AtTlsDoctorOptions {
  /** Effective --attls mode; the section also runs when ZOWE_MCP_ATTLS_MODULE is set. */
  mode?: AtTlsMode;
  /** Test hooks. */
  platform?: string;
  env?: Record<string, string | undefined>;
  probe?: (modulePath?: string) => Promise<AtTlsProbeResult>;
}

/**
 * AT-TLS aware-mode checks (docs/zos-attls-aware-mode.md § 6), appended to the
 * doctor report. Active when the mode is not `off` OR when
 * `ZOWE_MCP_ATTLS_MODULE` is set (a declared addon means this deployment
 * intends aware mode — the doctor step runs without the service's start flags,
 * so the module variable is its activation signal). The check loads the addon
 * and queries a scratch loopback self-connection; ANY decodable status passes —
 * this validates the addon, not the policy (the live port's policy is checked
 * by the gate's startup self-probe; other ports' answers are meaningless).
 */
export async function runAtTlsDoctorChecks(
  options: AtTlsDoctorOptions = {}
): Promise<DoctorCheck[]> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const mode = options.mode ?? 'off';
  const rawModulePath = env.ZOWE_MCP_ATTLS_MODULE?.trim();
  const modulePath =
    rawModulePath === undefined || rawModulePath === '' ? undefined : rawModulePath;
  if (mode === 'off' && modulePath === undefined) return [];

  if (platform !== 'os390') {
    return [
      {
        name: 'attls',
        status: mode === 'required' ? 'fail' : 'info',
        detail:
          `not z/OS (${platform}) — AT-TLS aware mode is unavailable here ` +
          (mode === 'required'
            ? 'and --attls required refuses to start'
            : '(monitor mode degrades to off at startup)'),
      },
    ];
  }

  try {
    const probe = options.probe ?? ((path?: string) => probeAtTlsAddon({ modulePath: path }));
    const result = await probe(modulePath);
    return [
      {
        name: 'attls addon',
        status: 'ok',
        detail:
          `query decoded on a scratch loopback socket (policyStatus=${result.policyStatus}, ` +
          `connStatus=${result.connStatus}) from ${modulePath ?? 'the in-package build'} — ` +
          'addon functional; the live port’s policy is verified by the startup self-probe',
      },
    ];
  } catch (err) {
    return [
      {
        name: 'attls addon',
        status: 'fail',
        detail: `addon check failed: ${err instanceof Error ? err.message : String(err)}`,
        instructions: ATTLS_BUILD_INSTRUCTIONS,
      },
    ];
  }
}

// Late-bound so unit tests never touch child_process.
function require_child_process(): typeof import('node:child_process') {
  const require = createRequire(import.meta.url);
  return require('node:child_process') as typeof import('node:child_process');
}

/** Renders a report for the terminal. */
export function formatDoctorReport(report: DoctorReport): string {
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
        ? 'Environment looks good for --saf-check native.'
        : 'Environment is NOT ready for --saf-check native — follow the instructions above ' +
            '(re-run with --fix to apply the extattr part if you have the authority).'
    );
  }
  return lines.join('\n');
}
