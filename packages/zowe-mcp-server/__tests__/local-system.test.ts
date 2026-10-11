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
 * Unit tests for same-system ("local") zowex execution plumbing (stages 3-4 of
 * docs/zos-local-zowex-identity.md): spec form, activation gating, loadNative
 * registration/getSpec behavior, and the backend's credential bypass.
 */

import { describe, expect, it, vi } from 'vitest';
import { loadNative } from '../src/zos/native/load-native.js';
import {
  buildSurrogatInstructions,
  checkLocalGating,
  describeLauncherFailure,
  isLocalConnectionSpec,
  isValidSafUserid,
  LOCAL_LAUNCHER_ENV,
  LOCAL_SUB_IS_USERID_ENV,
  LOCAL_SYSTEM_ID,
  LOCAL_ZOWEX_ENV,
  resolveProcessUserid,
  resolveStdioZowexPath,
} from '../src/zos/native/local-system.js';
import type { NativeBackendOptions } from '../src/zos/native/native-backend.js';
import { NativeBackend } from '../src/zos/native/native-backend.js';

describe('isLocalConnectionSpec', () => {
  it('accepts the literal local, trimmed and case-insensitive', () => {
    expect(isLocalConnectionSpec('local')).toBe(true);
    expect(isLocalConnectionSpec('  LOCAL ')).toBe(true);
    expect(isLocalConnectionSpec('Local')).toBe(true);
  });

  it('rejects user@host forms and anything containing local as a substring', () => {
    expect(isLocalConnectionSpec('user@local')).toBe(false);
    expect(isLocalConnectionSpec('user@host')).toBe(false);
    expect(isLocalConnectionSpec('localhost')).toBe(false);
    expect(isLocalConnectionSpec('')).toBe(false);
  });
});

describe('isValidSafUserid', () => {
  it('accepts canonical uppercase SAF userids', () => {
    for (const id of ['USERB', 'A', 'USER#$@', 'ABCDEFGH', 'X1234567']) {
      expect(isValidSafUserid(id)).toBe(true);
    }
  });

  it('rejects lowercase, overlong, empty, and non-SAF characters (no case folding)', () => {
    for (const id of ['userb', 'Userb', 'ABCDEFGHI', '', 'USER-1', 'USER 1', 'usér']) {
      expect(isValidSafUserid(id)).toBe(false);
    }
  });
});

describe('checkLocalGating', () => {
  const okEnv = {
    [LOCAL_SUB_IS_USERID_ENV]: '1',
    [LOCAL_LAUNCHER_ENV]: '/u/server/zowex-launcher',
    [LOCAL_ZOWEX_ENV]: '/u/server/zowe-server/zowex',
  };
  const okInput = {
    platform: 'os390',
    transport: 'http' as const,
    jwtIssuerSet: true,
    env: okEnv,
    launcherExists: () => true,
  };

  it('passes when all activation conditions hold', () => {
    expect(checkLocalGating(okInput)).toEqual([]);
  });

  it('fails on a non-z/OS platform', () => {
    const errors = checkLocalGating({ ...okInput, platform: 'darwin' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/os390/);
  });

  it('checks the HTTP arm when the transport is unknown (the standalone doctor)', () => {
    expect(checkLocalGating({ ...okInput, transport: undefined })).toEqual([]);
  });

  it('fails without JWT auth', () => {
    expect(checkLocalGating({ ...okInput, jwtIssuerSet: false })[0]).toMatch(
      /ZOWE_MCP_JWT_ISSUER/
    );
  });

  it('fails without the operator assertion env var', () => {
    const errors = checkLocalGating({
      ...okInput,
      env: { ...okEnv, [LOCAL_SUB_IS_USERID_ENV]: undefined },
    });
    expect(errors[0]).toMatch(/ZOWE_MCP_LOCAL_SUB_IS_USERID=1/);
  });

  it('fails on a missing, relative, or nonexistent launcher path', () => {
    expect(
      checkLocalGating({ ...okInput, env: { ...okEnv, [LOCAL_LAUNCHER_ENV]: undefined } })[0]
    ).toMatch(/ZOWE_MCP_LOCAL_LAUNCHER/);
    expect(
      checkLocalGating({ ...okInput, env: { ...okEnv, [LOCAL_LAUNCHER_ENV]: 'bin/launcher' } })[0]
    ).toMatch(/absolute path/);
    expect(checkLocalGating({ ...okInput, launcherExists: () => false })[0]).toMatch(
      /does not exist/
    );
  });

  it('fails on a missing, relative, or nonexistent zowex path', () => {
    expect(
      checkLocalGating({ ...okInput, env: { ...okEnv, [LOCAL_ZOWEX_ENV]: undefined } })[0]
    ).toMatch(/ZOWE_MCP_LOCAL_ZOWEX/);
    expect(
      checkLocalGating({ ...okInput, env: { ...okEnv, [LOCAL_ZOWEX_ENV]: 'zowex' } })[0]
    ).toMatch(/absolute path/);
    const existsOnlyLauncher = (p: string): boolean => p === okEnv[LOCAL_LAUNCHER_ENV];
    expect(checkLocalGating({ ...okInput, launcherExists: existsOnlyLauncher })[0]).toMatch(
      /ZOWE_MCP_LOCAL_ZOWEX points to .* which does not exist/
    );
  });

  it('reports all failed conditions at once', () => {
    const errors = checkLocalGating({
      platform: 'linux',
      transport: 'http',
      jwtIssuerSet: false,
      env: {},
    });
    expect(errors).toHaveLength(5);
  });
});

describe('checkLocalGating (stdio same-user arm)', () => {
  const okInput = {
    platform: 'os390',
    transport: 'stdio' as const,
    // Deliberately false: the stdio arm must not demand JWT auth.
    jwtIssuerSet: false,
    env: {},
    processUsername: 'userb',
    home: '/u/userb',
    launcherExists: () => true,
  };

  it('passes with a resolvable user and the per-user default zowex — no HTTP conditions', () => {
    expect(checkLocalGating(okInput)).toEqual([]);
  });

  it('fails on a non-z/OS platform', () => {
    expect(checkLocalGating({ ...okInput, platform: 'darwin' })[0]).toMatch(/os390/);
  });

  it('fails when the invoking user does not fold to a SAF userid', () => {
    expect(checkLocalGating({ ...okInput, processUsername: 'not-a-userid' })[0]).toMatch(
      /does not resolve to a SAF userid/
    );
    expect(checkLocalGating({ ...okInput, processUsername: undefined })[0]).toMatch(
      /does not resolve to a SAF userid/
    );
  });

  it('fails when neither the env override nor the per-user default zowex exists', () => {
    const errors = checkLocalGating({ ...okInput, launcherExists: () => false });
    expect(errors[0]).toMatch(/\/u\/userb\/\.zowe-server\/zowex/);
    expect(errors[0]).toMatch(/ZOWE_MCP_LOCAL_ZOWEX/);
  });

  it('validates the env override: relative refused, nonexistent reported', () => {
    expect(checkLocalGating({ ...okInput, env: { [LOCAL_ZOWEX_ENV]: 'zowex' } })[0]).toMatch(
      /absolute path/
    );
    expect(
      checkLocalGating({
        ...okInput,
        env: { [LOCAL_ZOWEX_ENV]: '/u/shared/zowex' },
        launcherExists: () => false,
      })[0]
    ).toMatch(/points to "\/u\/shared\/zowex", which does not exist/);
  });

  it('ignores the HTTP arm conditions entirely (no launcher, assertion, or JWT errors)', () => {
    const errors = checkLocalGating(okInput);
    expect(errors.join('\n')).not.toMatch(/LAUNCHER|SUB_IS_USERID|JWT/);
  });
});

describe('resolveProcessUserid', () => {
  it('upper-folds a USS username to the canonical SAF form', () => {
    expect(resolveProcessUserid('userb')).toBe('USERB');
    expect(resolveProcessUserid('OMVSKERN')).toBe('OMVSKERN');
  });

  it('returns undefined for names that are not SAF userids', () => {
    expect(resolveProcessUserid('not-a-userid')).toBeUndefined();
    expect(resolveProcessUserid('toolongname')).toBeUndefined();
    expect(resolveProcessUserid('')).toBeUndefined();
    expect(resolveProcessUserid(undefined)).toBeUndefined();
  });
});

describe('resolveStdioZowexPath', () => {
  it('prefers the env override', () => {
    expect(resolveStdioZowexPath({ [LOCAL_ZOWEX_ENV]: '/u/shared/zowex' }, '/u/userb')).toEqual({
      path: '/u/shared/zowex',
      source: 'env',
    });
  });

  it('falls back to the per-user SSH-deploy default', () => {
    expect(resolveStdioZowexPath({}, '/u/userb')).toEqual({
      path: '/u/userb/.zowe-server/zowex',
      source: 'default',
    });
  });
});

describe('describeLauncherFailure', () => {
  it('maps each launcher exit code to distinct operator guidance', () => {
    expect(describeLauncherFailure(4, '', 'NOBODY')).toMatch(/unknown or has no OMVS segment/);
    expect(describeLauncherFailure(5, 'setuid: EPERM', 'USERB')).toMatch(
      /BPX\.SRV\.USERB.*SURROGAT/s
    );
    expect(describeLauncherFailure(5, '', 'USERB')).toMatch(/JRENVDIRTY/);
    expect(describeLauncherFailure(6, '', 'OMVSKERN')).toMatch(/UID 0/);
    expect(describeLauncherFailure(127, 'execv: ENOENT', 'USERB')).toMatch(/ZOWE_MCP_LOCAL_ZOWEX/);
    expect(describeLauncherFailure(3, 'no userid on stdin', 'USERB')).toMatch(
      /rejected its input/
    );
    expect(describeLauncherFailure(null, '', 'USERB')).toMatch(/signal/);
    expect(describeLauncherFailure(1, 'boom', 'USERB')).toMatch(/exited with 1/);
  });
});

describe('buildSurrogatInstructions', () => {
  it('names the exact profile, permit, and refresh for the target and server userids', () => {
    const text = buildSurrogatInstructions('USERB', 'ZMCPSRV').join('\n');
    expect(text).toContain('RDEFINE SURROGAT BPX.SRV.USERB UACC(NONE)');
    expect(text).toContain('PERMIT BPX.SRV.USERB CLASS(SURROGAT) ID(ZMCPSRV) ACCESS(READ)');
    expect(text).toContain('SETROPTS RACLIST(SURROGAT) REFRESH');
  });
});

describe('loadNative with a local systems entry', () => {
  const base = { useEnvForPassword: true };

  it('registers the local system and resolves its spec when localUserid is set', () => {
    const setup = loadNative({
      ...base,
      systems: ['user1@host1.example.com', 'local'],
      localUserid: 'USERB',
    });
    expect(setup.systemRegistry.list()).toContain(LOCAL_SYSTEM_ID);
    expect(setup.systemRegistry.get(LOCAL_SYSTEM_ID)?.connectionSpecs).toEqual(['USERB@local']);

    const backendOptions = (setup.backend as unknown as { options: NativeBackendOptions }).options;
    const spec = backendOptions.getSpec(LOCAL_SYSTEM_ID);
    expect(spec).toMatchObject({ user: 'USERB', host: LOCAL_SYSTEM_ID, local: true });
    // The SSH system is unaffected.
    expect(backendOptions.getSpec('host1.example.com')).toMatchObject({
      user: 'user1',
      host: 'host1.example.com',
    });
  });

  it('resolves the local spec only for the authenticated user, never anyone else', () => {
    const setup = loadNative({ ...base, systems: ['local'], localUserid: 'USERB' });
    const { getSpec } = (setup.backend as unknown as { options: NativeBackendOptions }).options;
    expect(getSpec(LOCAL_SYSTEM_ID, 'userb')).toBeDefined();
    expect(getSpec(LOCAL_SYSTEM_ID, 'OTHER')).toBeUndefined();
  });

  it('ignores local entirely when no localUserid is provided (shared/stdio setups)', () => {
    const setup = loadNative({ ...base, systems: ['user1@host1.example.com', 'local'] });
    expect(setup.systemRegistry.list()).not.toContain(LOCAL_SYSTEM_ID);
    const { getSpec } = (setup.backend as unknown as { options: NativeBackendOptions }).options;
    expect(getSpec(LOCAL_SYSTEM_ID)).toBeUndefined();
  });

  it('throws on a localUserid that is not a canonical SAF userid', () => {
    expect(() => loadNative({ ...base, systems: ['local'], localUserid: 'userb' })).toThrow(
      /not a canonical SAF userid/
    );
  });

  it('keeps the local system registered across updateSystems', () => {
    const setup = loadNative({ ...base, systems: ['local'], localUserid: 'USERB' });
    setup.updateSystems(['user2@host2.example.com', 'local']);
    expect(setup.systemRegistry.list()).toEqual(
      expect.arrayContaining(['host2.example.com', LOCAL_SYSTEM_ID])
    );
  });

  it('resolves the job card connection spec to USERID@local', () => {
    const setup = loadNative({ ...base, systems: ['local'], localUserid: 'USERB' });
    expect(setup.resolveJobCardConnectionSpec(LOCAL_SYSTEM_ID, 'USERB')).toBe('USERB@local');
  });

  it('answers the tool layer with an identity-only stub for local (no secret, sub only)', async () => {
    // The tool layer resolves a (system, user) context via getCredentials before
    // any operation; for `local` that must work without a password ever existing.
    const setup = loadNative({ ...base, systems: ['local'], localUserid: 'USERB' });
    const credentials = await setup.credentialProvider.getCredentials(LOCAL_SYSTEM_ID);
    expect(credentials.user).toBe('USERB');
    expect(credentials.password).toBeUndefined();
    expect(credentials.privateKeyPath).toBeUndefined();
    await expect(
      setup.credentialProvider.getCredentials(LOCAL_SYSTEM_ID, 'OTHER')
    ).rejects.toThrow(/runs only as the authenticated user USERB/);
    await expect(setup.credentialProvider.listUsers(LOCAL_SYSTEM_ID)).resolves.toEqual(['USERB']);
  });

  it('keeps normal credential resolution for SSH systems next to a local entry', async () => {
    const setup = loadNative({
      ...base,
      systems: ['user1@host1.example.com', 'local'],
      localUserid: 'USERB',
    });
    // No password configured for the SSH system: the pass-through must reach the
    // real provider (which fails asking for credentials), not the local stub.
    await expect(setup.credentialProvider.listUsers('host1.example.com')).resolves.toEqual([
      'user1',
    ]);
  });
});

describe('NativeBackend with a local spec', () => {
  const localSpec = { user: 'USERB', host: LOCAL_SYSTEM_ID, port: 22, local: true as const };

  function makeBackend(overrides: {
    getOrCreate: ReturnType<typeof vi.fn>;
    markInvalid?: ReturnType<typeof vi.fn>;
    onPasswordInvalid?: ReturnType<typeof vi.fn>;
    evict?: ReturnType<typeof vi.fn>;
    getCredentials?: ReturnType<typeof vi.fn>;
  }): NativeBackend {
    return new NativeBackend({
      getSpec: () => localSpec,
      credentialProvider: {
        getCredentials: overrides.getCredentials ?? vi.fn(),
        markInvalid: overrides.markInvalid ?? vi.fn(),
        markKeyFailed: vi.fn(),
      } as unknown as NativeBackendOptions['credentialProvider'],
      clientCache: {
        getOrCreate: overrides.getOrCreate,
        evict: overrides.evict ?? vi.fn(),
        hasKey: vi.fn().mockReturnValue(false),
      } as unknown as NativeBackendOptions['clientCache'],
      onPasswordInvalid: overrides.onPasswordInvalid as NativeBackendOptions['onPasswordInvalid'],
    });
  }

  it('runs the operation through the cached local client with no credential lookup', async () => {
    const getCredentials = vi.fn();
    const fakeClient = {
      ds: { listDatasets: vi.fn().mockResolvedValue({ items: [{ name: 'USERB.TEST' }] }) },
    };
    const getOrCreate = vi.fn().mockResolvedValue(fakeClient);
    const backend = makeBackend({ getOrCreate, getCredentials });

    const result = await backend.listDatasets(LOCAL_SYSTEM_ID, 'USERB.*');
    expect(result.map(e => e.dsn)).toEqual(['USERB.TEST']);
    expect(getCredentials).not.toHaveBeenCalled();
    expect(getOrCreate).toHaveBeenCalledWith(localSpec, undefined, undefined);
  });

  it('never treats a local failure as a password problem, even when it reads like one', async () => {
    const markInvalid = vi.fn();
    const onPasswordInvalid = vi.fn();
    // The launcher's EPERM path can surface OS wording that the SSH-error
    // classifier would take for an auth failure.
    const getOrCreate = vi
      .fn()
      .mockRejectedValue(new Error('identity switch failed: permission denied'));
    const backend = makeBackend({ getOrCreate, markInvalid, onPasswordInvalid });

    await expect(backend.listDatasets(LOCAL_SYSTEM_ID, 'USERB.*')).rejects.toThrow(
      /permission denied/
    );
    expect(markInvalid).not.toHaveBeenCalled();
    expect(onPasswordInvalid).not.toHaveBeenCalled();
  });
});
