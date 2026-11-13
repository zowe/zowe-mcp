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
 * Unit tests for the doctor-local checks (same-system zowex execution).
 * Everything platform-specific is injected — no fs, ls, or launcher runs.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  extattrHasProgramControl,
  formatLocalDoctorReport,
  runLocalDoctor,
} from '../src/zos/native/local-doctor.js';
import {
  LOCAL_LAUNCHER_ENV,
  LOCAL_SUB_IS_USERID_ENV,
  LOCAL_ZOWEX_ENV,
} from '../src/zos/native/local-system.js';

const LAUNCHER = '/u/server/zowex-launcher';
const ZOWEX = '/u/server/zowe-server/zowex';

const readyEnv = {
  ZOWE_MCP_JWT_ISSUER: 'http://idp.example.com:8045',
  [LOCAL_SUB_IS_USERID_ENV]: '1',
  [LOCAL_LAUNCHER_ENV]: LAUNCHER,
  [LOCAL_ZOWEX_ENV]: ZOWEX,
};

/** statFile hook: launcher mode 700; zowex present with the given mode (absent when undefined). */
function statFor(zowexMode?: number) {
  return (path: string): { isFile: boolean; mode: number } | undefined =>
    path === LAUNCHER
      ? { isFile: true, mode: 0o100700 }
      : path === ZOWEX && zowexMode !== undefined
        ? { isFile: true, mode: zowexMode }
        : undefined;
}

const readyHooks = {
  platform: 'os390',
  env: readyEnv,
  statFile: statFor(0o100755),
  listExtattr: () => `-rwx------  -ps-  1 ZMCPSRV  GRPOMVS  86016 Sep 12 10:00 ${LAUNCHER}`,
};

describe('extattrHasProgramControl', () => {
  it('detects the p flag in ls -E output', () => {
    expect(extattrHasProgramControl('-rwx------  -ps-  1 U G 1 Jan 1 00:00 /f')).toBe(true);
    expect(extattrHasProgramControl('-rwx------  ----  1 U G 1 Jan 1 00:00 /f')).toBe(false);
  });

  it('returns undefined for unrecognized output (e.g. non-z/OS ls)', () => {
    expect(extattrHasProgramControl('-rwx------ 1 user group 1 Jan 1 00:00 /f')).toBeUndefined();
  });
});

describe('runLocalDoctor', () => {
  it('reports info-only and ok on a non-z/OS platform', () => {
    const report = runLocalDoctor({ platform: 'darwin', env: {} });
    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ name: 'platform', status: 'info' });
    expect(formatLocalDoctorReport(report)).toContain('No z/OS checks were run.');
  });

  it('passes all static checks in a ready environment (probe not run without --probe-user)', () => {
    const report = runLocalDoctor(readyHooks);
    expect(report.ok).toBe(true);
    const byName = Object.fromEntries(report.checks.map(c => [c.name, c.status]));
    expect(byName).toMatchObject({
      platform: 'ok',
      gating: 'ok',
      'launcher permissions': 'ok',
      'launcher program control': 'ok',
      'zowex binary': 'ok',
      'SURROGAT probe': 'info',
    });
  });

  it('fails on a missing zowex binary and flags an owner-execute-only one as info', () => {
    const missing = runLocalDoctor({ ...readyHooks, statFile: statFor(undefined) });
    const missingCheck = missing.checks.find(c => c.name === 'zowex binary');
    expect(missingCheck?.status).toBe('fail');
    expect(missingCheck?.detail).toContain('does not exist');

    const ownerOnly = runLocalDoctor({ ...readyHooks, statFile: statFor(0o100700) });
    const ownerOnlyCheck = ownerOnly.checks.find(c => c.name === 'zowex binary');
    expect(ownerOnlyCheck?.status).toBe('info');
    expect(ownerOnlyCheck?.detail).toMatch(/owner-execute only.*exit 127/s);
  });

  it('fails gating with the actionable list when env vars are missing', () => {
    const report = runLocalDoctor({ ...readyHooks, env: {} });
    const gating = report.checks.find(c => c.name === 'gating');
    expect(gating?.status).toBe('fail');
    expect(gating?.instructions?.join('\n')).toMatch(/ZOWE_MCP_LOCAL_SUB_IS_USERID=1/);
    expect(report.ok).toBe(false);
  });

  it('fails on group/other-accessible launcher permissions and a missing +p', () => {
    const report = runLocalDoctor({
      ...readyHooks,
      statFile: () => ({ isFile: true, mode: 0o100755 }),
      listExtattr: () => `-rwxr-xr-x  ----  1 ZMCPSRV GRPOMVS 86016 Sep 12 10:00 ${LAUNCHER}`,
    });
    const byName = Object.fromEntries(report.checks.map(c => [c.name, c]));
    expect(byName['launcher permissions'].status).toBe('fail');
    expect(byName['launcher program control'].status).toBe('fail');
    expect(byName['launcher program control'].instructions?.join('\n')).toContain(
      `extattr +p ${LAUNCHER}`
    );
  });

  it('runs the probe only when asked, and reports success with the id output', () => {
    const runLauncherProbe = vi
      .fn()
      .mockReturnValue({ status: 0, stdout: 'uid=1234(USERB) gid=1(GRPOMVS)\n', stderr: '' });
    const report = runLocalDoctor({ ...readyHooks, probeUser: 'userb', runLauncherProbe });
    expect(runLauncherProbe).toHaveBeenCalledWith(LAUNCHER, 'USERB');
    const probe = report.checks.find(c => c.name === 'SURROGAT probe');
    expect(probe?.status).toBe('ok');
    expect(probe?.detail).toContain('uid=1234(USERB)');
  });

  it('prints the SURROGAT runbook when the switch is denied (exit 5), never executing it', () => {
    const report = runLocalDoctor({
      ...readyHooks,
      probeUser: 'USERB',
      runLauncherProbe: () => ({
        status: 5,
        stdout: '',
        stderr: 'setuid failed: EPERM',
      }),
    });
    const probe = report.checks.find(c => c.name === 'SURROGAT probe');
    expect(probe?.status).toBe('fail');
    expect(probe?.instructions?.join('\n')).toContain('RDEFINE SURROGAT BPX.SRV.USERB');
    expect(report.ok).toBe(false);
  });

  it('maps the unknown-user and UID-0 launcher exits to distinct messages', () => {
    const unknown = runLocalDoctor({
      ...readyHooks,
      probeUser: 'NOBODY',
      runLauncherProbe: () => ({ status: 4, stdout: '', stderr: '' }),
    }).checks.find(c => c.name === 'SURROGAT probe');
    expect(unknown?.detail).toMatch(/unknown or has no OMVS segment/);

    const uid0 = runLocalDoctor({
      ...readyHooks,
      probeUser: 'OMVSKERN',
      runLauncherProbe: () => ({ status: 6, stdout: '', stderr: '' }),
    }).checks.find(c => c.name === 'SURROGAT probe');
    expect(uid0?.detail).toMatch(/UID 0/);
  });

  it('rejects an invalid probe userid before touching the launcher', () => {
    const runLauncherProbe = vi.fn();
    const report = runLocalDoctor({
      ...readyHooks,
      probeUser: 'not-a-userid',
      runLauncherProbe,
    });
    expect(runLauncherProbe).not.toHaveBeenCalled();
    expect(report.checks.find(c => c.name === 'SURROGAT probe')?.status).toBe('fail');
  });

  it('stdio arm: passes with the invoking user and the per-user default zowex, no launcher checks', () => {
    const report = runLocalDoctor({
      platform: 'os390',
      stdio: true,
      env: {},
      processUsername: 'userb',
      home: '/u/userb',
      statFile: p =>
        p === '/u/userb/.zowe-server/zowex' ? { isFile: true, mode: 0o100755 } : undefined,
    });
    expect(report.ok).toBe(true);
    expect(report.checks.map(c => c.name)).toEqual(['platform', 'invoking user', 'zowex binary']);
    expect(report.checks.find(c => c.name === 'invoking user')?.detail).toMatch(/USERB/);
    expect(report.checks.find(c => c.name === 'zowex binary')?.detail).toMatch(/per-user default/);
  });

  it('stdio arm: fails with actionable errors when the user or zowex cannot be resolved', () => {
    const report = runLocalDoctor({
      platform: 'os390',
      stdio: true,
      env: {},
      processUsername: 'not-a-userid',
      home: '/u/nobody',
      statFile: () => undefined,
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find(c => c.name === 'invoking user')?.status).toBe('fail');
    const zowex = report.checks.find(c => c.name === 'zowex binary');
    expect(zowex?.status).toBe('fail');
    expect(zowex?.instructions?.join('\n')).toMatch(/ZOWE_MCP_LOCAL_ZOWEX/);
  });
});
