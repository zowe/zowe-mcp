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
 * Unit tests for the local zowex transport (stage 4 of
 * docs/zos-local-zowex-identity.md). The "launcher" is Node itself running a
 * scripted fake (fixtures/fake-local-zowex.mjs), so the full spawn → userid
 * over stdin → ready banner → JSON-RPC round trip runs on any platform.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildLauncherChildEnv, LocalClient } from '../src/zos/native/local-client.js';
import { LOCAL_LAUNCHER_ENV, LOCAL_ZOWEX_ENV } from '../src/zos/native/local-system.js';
import { SshClientCache } from '../src/zos/native/ssh-client-cache.js';

const FAKE_ZOWEX = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/fake-local-zowex.mjs'
);
const FAKE_SAMEUSER_ZOWEX = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/fake-sameuser-zowex.mjs'
);

function createOptions(userid: string) {
  return {
    launcherPath: process.execPath,
    zowexPath: FAKE_ZOWEX,
    userid,
    responseTimeout: 5,
    startupTimeout: 5,
  };
}

describe('buildLauncherChildEnv', () => {
  it('passes only the allowlist through and forces _BPX_SHAREAS=NO', () => {
    const env = buildLauncherChildEnv({
      PATH: '/bin:/usr/bin',
      STEPLIB: 'CEE.SCEERUN',
      __IPC_CLEANUP: '1',
      _BPX_SHAREAS: 'YES',
      // Secrets and server-only config must NOT cross the identity switch —
      // the target user owns the child process and can read its environment.
      ZOWE_MCP_PASSWORD_USERA: 'hunter2',
      ZOWE_MCP_JWT_ISSUER: 'https://idp.example',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      HOME: '/u/server',
    });
    expect(env).toEqual({
      PATH: '/bin:/usr/bin',
      STEPLIB: 'CEE.SCEERUN',
      __IPC_CLEANUP: '1',
      _BPX_SHAREAS: 'NO',
    });
  });

  it('never leaks a ZOWE_MCP_* variable from the real process.env shape', () => {
    const env = buildLauncherChildEnv({ ...process.env, ZOWE_MCP_PASSWORD_X: 'secret' });
    expect(Object.keys(env).some(k => k.startsWith('ZOWE_MCP_'))).toBe(false);
  });
});

describe('LocalClient', () => {
  it('starts zowex through the launcher and answers an RPC via the SDK namespace', async () => {
    const client = await LocalClient.create(createOptions('USERB'));
    try {
      expect(client.serverVersion).toBe('0.0.0-test');
      // The fake echoes the userid it read from the FIRST stdin line back in
      // the result — proving the launcher contract (userid via stdin, then the
      // JSON-RPC stream on the same pipe).
      const response = await client.ds.listDatasets({ pattern: 'USERB.*' });
      expect(response.items?.[0]?.name).toBe('USERB.TEST.PDS');
    } finally {
      client.dispose();
    }
  });

  it('maps a JSON-RPC error response to a rejection carrying code and details', async () => {
    const client = await LocalClient.create(createOptions('USERB'));
    try {
      const err = await client.ds
        .listDatasets({ pattern: 'FAIL' })
        .then(() => undefined)
        .catch((e: Error & { code?: string; causeErrors?: unknown }) => e);
      expect(err?.message).toBe('scripted failure');
      expect(err?.code).toBe('-32603');
      expect(err?.causeErrors).toBe('RC=8');
    } finally {
      client.dispose();
    }
  });

  it('rejects the create when the launcher denies the switch, with SURROGAT guidance', async () => {
    await expect(LocalClient.create(createOptions('EXIT5'))).rejects.toThrow(
      /Local zowex startup as EXIT5 failed:.*BPX\.SRV\.EXIT5/s
    );
  });

  it('rejects the create for an unknown user (launcher exit 4)', async () => {
    await expect(LocalClient.create(createOptions('EXIT4'))).rejects.toThrow(
      /unknown or has no OMVS segment/
    );
  });

  it('tolerates launcher stderr diagnostics before the banner (missing target home)', async () => {
    const client = await LocalClient.create(createOptions('WARNHOME'));
    try {
      expect(client.serverVersion).toBe('0.0.0-test');
      const response = await client.ds.listDatasets({ pattern: 'WARNHOME.*' });
      expect(response.items?.[0]?.name).toBe('WARNHOME.TEST.PDS');
    } finally {
      client.dispose();
    }
  });

  it('rejects the create when the first output line is not the ready banner', async () => {
    await expect(LocalClient.create(createOptions('NOBANNER'))).rejects.toThrow(
      /did not print a ready banner.*CEE3501S/s
    );
  });

  it('times out the create when no banner ever arrives', async () => {
    await expect(
      LocalClient.create({ ...createOptions('SILENT'), startupTimeout: 0.5 })
    ).rejects.toThrow(/Timed out waiting for the local zowex server to start/);
  });

  it('refuses a userid that is not a canonical SAF userid before spawning anything', async () => {
    await expect(LocalClient.create(createOptions('not-a-userid'))).rejects.toThrow(
      /not a canonical SAF userid/
    );
  });

  it('times out an unanswered request without killing the client', async () => {
    const client = await LocalClient.create({ ...createOptions('USERB'), responseTimeout: 0.5 });
    try {
      await expect(client.ds.listDatasets({ pattern: 'HANG' })).rejects.toThrow(/timed out/);
      // The transport is still alive for the next request.
      const response = await client.ds.listDatasets({ pattern: 'USERB.*' });
      expect(response.items?.[0]?.name).toBe('USERB.TEST.PDS');
    } finally {
      client.dispose();
    }
  });

  it('rejects pending requests and fires onClose once when the child dies', async () => {
    const onClose = vi.fn();
    const client = await LocalClient.create({ ...createOptions('USERB'), onClose });
    await expect(client.ds.listDatasets({ pattern: 'DIE' })).rejects.toThrow(
      /local zowex server process ended/
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Requests after the close fail fast.
    await expect(client.ds.listDatasets({ pattern: 'USERB.*' })).rejects.toThrow(
      /connection is closed/
    );
  });

  it('refuses stream-transfer requests up front', async () => {
    const client = await LocalClient.create(createOptions('USERB'));
    try {
      await expect(
        client.request({ command: 'readFile', stream: () => ({}) } as never)
      ).rejects.toThrow(/Stream transfers are not supported/);
    } finally {
      client.dispose();
    }
  });
});

describe('LocalClient same-user (no launcher — stdio deployment shape)', () => {
  // The fixture is spawned directly via its shebang, which needs a POSIX exec.
  it.skipIf(process.platform === 'win32')(
    'spawns zowex directly and never writes a userid preamble on stdin',
    async () => {
      const client = await LocalClient.create({
        zowexPath: FAKE_SAMEUSER_ZOWEX,
        userid: 'USERB',
        responseTimeout: 5,
        startupTimeout: 5,
      });
      try {
        expect(client.serverVersion).toBe('0.0.0-sameuser');
        // The fixture exits 99 on any non-JSON stdin line, so this round trip
        // succeeding proves no launcher-style userid preamble was sent.
        const response = await client.ds.listDatasets({ pattern: 'ANY' });
        expect(response.items?.[0]?.name).toBe('SAMEUSER.TEST.PDS');
      } finally {
        client.dispose();
      }
    }
  );

  it('reports a direct-spawn failure plainly, without launcher exit-code mapping', async () => {
    await expect(
      LocalClient.create({
        zowexPath: '/nonexistent/zowex',
        userid: 'USERB',
        responseTimeout: 5,
        startupTimeout: 5,
      })
    ).rejects.toThrow(/Could not spawn zowex at \/nonexistent\/zowex/);
  });
});

describe('SshClientCache with a local spec', () => {
  const localSpec = { user: 'USERB', host: 'local', port: 22, local: true as const };

  it('creates the local client from the env contract, caches it, and evicts on close', async () => {
    vi.stubEnv(LOCAL_LAUNCHER_ENV, '/u/server/zowex-launcher');
    vi.stubEnv(LOCAL_ZOWEX_ENV, '/u/server/zowe-server/zowex');
    try {
      let capturedOnClose: (() => void) | undefined;
      const dispose = vi.fn();
      const createLocalClient = vi.fn((opts: { onClose: () => void }) => {
        capturedOnClose = opts.onClose;
        return Promise.resolve({ dispose } as never);
      });
      const cache = new SshClientCache({ responseTimeout: 42, createLocalClient });

      const first = await cache.getOrCreate(localSpec, undefined);
      const second = await cache.getOrCreate(localSpec, undefined);
      expect(second).toBe(first);
      expect(createLocalClient).toHaveBeenCalledTimes(1);
      expect(createLocalClient).toHaveBeenCalledWith({
        launcherPath: '/u/server/zowex-launcher',
        zowexPath: '/u/server/zowe-server/zowex',
        userid: 'USERB',
        responseTimeout: 42,
        onClose: expect.any(Function) as unknown,
      });
      expect(cache.hasKey('USERB@local')).toBe(true);

      // Child exit → onClose → the cache entry is gone and the client disposed.
      capturedOnClose?.();
      expect(cache.hasKey('USERB@local')).toBe(false);
      expect(dispose).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('single-flights concurrent creations: parallel first calls share one client', async () => {
    vi.stubEnv(LOCAL_LAUNCHER_ENV, '/u/server/zowex-launcher');
    vi.stubEnv(LOCAL_ZOWEX_ENV, '/u/server/zowe-server/zowex');
    try {
      let release: (() => void) | undefined;
      const createLocalClient = vi.fn(
        () =>
          new Promise<never>(resolve => {
            release = () => resolve({ dispose: vi.fn() } as never);
          })
      );
      const cache = new SshClientCache({ createLocalClient });

      // Both calls start while creation is still pending — the race from
      // parallel first tool calls on a cold server.
      const firstPromise = cache.getOrCreate(localSpec, undefined);
      const secondPromise = cache.getOrCreate(localSpec, undefined);
      expect(createLocalClient).toHaveBeenCalledTimes(1);
      release?.();
      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(second).toBe(first);
      expect(createLocalClient).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a failed creation rejects all concurrent waiters and caches nothing, so a retry starts fresh', async () => {
    vi.stubEnv(LOCAL_LAUNCHER_ENV, '/u/server/zowex-launcher');
    vi.stubEnv(LOCAL_ZOWEX_ENV, '/u/server/zowe-server/zowex');
    try {
      let reject: ((err: Error) => void) | undefined;
      const createLocalClient = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<never>((_resolve, rej) => {
              reject = rej;
            })
        )
        .mockResolvedValueOnce({ dispose: vi.fn() });
      const cache = new SshClientCache({ createLocalClient });

      const firstPromise = cache.getOrCreate(localSpec, undefined);
      const secondPromise = cache.getOrCreate(localSpec, undefined);
      reject?.(new Error('launcher exploded'));
      await expect(firstPromise).rejects.toThrow('launcher exploded');
      await expect(secondPromise).rejects.toThrow('launcher exploded');
      expect(cache.hasKey('USERB@local')).toBe(false);

      // The failure is not sticky: the next call runs a fresh creation.
      await cache.getOrCreate(localSpec, undefined);
      expect(createLocalClient).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('creates a same-user client with no launcher, resolving zowex from env or default', async () => {
    const sameUserSpec = { ...localSpec, sameUser: true as const };
    const makeCreateLocalClient = () =>
      vi.fn((_opts: { launcherPath?: string; zowexPath: string }) =>
        Promise.resolve({ dispose: vi.fn() } as never)
      );
    vi.stubEnv(LOCAL_ZOWEX_ENV, '/u/shared/zowex');
    try {
      const createLocalClient = makeCreateLocalClient();
      const cache = new SshClientCache({ responseTimeout: 42, createLocalClient });
      await cache.getOrCreate(sameUserSpec, undefined);
      expect(createLocalClient).toHaveBeenCalledWith(
        expect.objectContaining({ launcherPath: undefined, zowexPath: '/u/shared/zowex' })
      );
    } finally {
      vi.unstubAllEnvs();
    }

    // Without the env override, the per-user SSH-deploy default applies —
    // no "env vars missing" contract error, unlike the launcher path.
    vi.stubEnv(LOCAL_ZOWEX_ENV, '');
    vi.stubEnv(LOCAL_LAUNCHER_ENV, '');
    try {
      const createLocalClient = makeCreateLocalClient();
      const cache = new SshClientCache({ createLocalClient });
      await cache.getOrCreate(sameUserSpec, undefined);
      expect(createLocalClient.mock.calls[0][0].zowexPath.endsWith('/.zowe-server/zowex')).toBe(
        true
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fails with the contract error when the local env vars are missing', async () => {
    vi.stubEnv(LOCAL_LAUNCHER_ENV, '');
    vi.stubEnv(LOCAL_ZOWEX_ENV, '');
    try {
      const cache = new SshClientCache({ createLocalClient: vi.fn() });
      await expect(cache.getOrCreate(localSpec, undefined)).rejects.toThrow(
        /ZOWE_MCP_LOCAL_LAUNCHER and ZOWE_MCP_LOCAL_ZOWEX/
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses a non-local spec without credentials (contract error)', async () => {
    const cache = new SshClientCache({});
    await expect(
      cache.getOrCreate({ user: 'user1', host: 'host1', port: 22 }, undefined)
    ).rejects.toThrow(/No credentials provided/);
  });
});
