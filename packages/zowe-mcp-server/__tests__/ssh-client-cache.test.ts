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
 * Unit tests for SshClientCache: "Server not found" detection, auto-install, and server path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials } from '../src/zos/credentials.js';
import type { ParsedConnectionSpec } from '../src/zos/native/connection-spec.js';
import {
  SshClientCache,
  isZowexServerNotFoundError,
  isZowexTruncatedServerError,
} from '../src/zos/native/ssh-client-cache.js';

const SPEC: ParsedConnectionSpec = { user: 'USER', host: 'host.example.com', port: 22 };
const CREDS: Credentials = { user: 'USER', password: 'secret', authMethod: 'password' };

describe('isZowexServerNotFoundError', () => {
  it('returns true for "Server not found" message', () => {
    expect(isZowexServerNotFoundError(new Error('Server not found'))).toBe(true);
    expect(isZowexServerNotFoundError(new Error('x Server not found y'))).toBe(true);
  });

  it('returns true for FSUM7351 in message', () => {
    expect(isZowexServerNotFoundError(new Error('FSUM7351 not found'))).toBe(true);
    expect(isZowexServerNotFoundError(new Error('stderr: FSUM7351'))).toBe(true);
  });

  it('returns true for "Error starting Zowe server" (SDK generic fallback)', () => {
    expect(
      isZowexServerNotFoundError(
        new Error('Error starting Zowe server: ~/.zowe-server/zowex server')
      )
    ).toBe(true);
    expect(
      isZowexServerNotFoundError(
        new Error('Error starting Zowe server: /opt/zowe/server/zowex server')
      )
    ).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isZowexServerNotFoundError(new Error('ENOTFOUND'))).toBe(false);
    expect(isZowexServerNotFoundError(new Error('Connection refused'))).toBe(false);
    expect(isZowexServerNotFoundError(new Error('Authentication failed'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isZowexServerNotFoundError('Server not found')).toBe(true); // string is coerced
    expect(isZowexServerNotFoundError(null)).toBe(false);
  });
});

describe('isZowexTruncatedServerError', () => {
  it('returns true for the SE06/truncated-module console signature (issue #47)', () => {
    expect(
      isZowexTruncatedServerError(
        new Error(
          'IEW4006I FETCH FOR UNIX SYSTEM SERVICES MODULE FAILED BECAUSE MODULE HAS BEEN TRUNCATED.'
        )
      )
    ).toBe(true);
    expect(isZowexTruncatedServerError(new Error('CSV028I ABENDE06-0040'))).toBe(true);
  });

  it('checks additionalDetails as well as the message', () => {
    const err = Object.assign(new Error('Error starting Zowe server: ~/.zowe-server/zowex'), {
      additionalDetails: 'RETURN CODE 20, REASON CODE 26110035',
    });
    expect(isZowexTruncatedServerError(err)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isZowexTruncatedServerError(new Error('Server not found'))).toBe(false);
    expect(isZowexTruncatedServerError(new Error('Connection refused'))).toBe(false);
  });
});

const createMock = vi.hoisted(() => vi.fn());
const installServerMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const checkIfOutdatedMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const probeDeploySpaceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const verifyZowexBinaryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const detectServerOnPathMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ serverPath: undefined, hasExecutePermission: false })
);

vi.mock('@zowe/zowex-for-zowe-sdk', () => ({
  /** Re-exported from @zowe/zos-uss-for-zowe-sdk; production constructs before ZSshClient.create. */
  SshSession: class MockSshSession {
    constructor(_opts: unknown) {
      void _opts;
    }
  },
  ZSshClient: {
    DEFAULT_SERVER_PATH: '~/.zowe-server',
    create: (...args: unknown[]) =>
      createMock(...args) as Promise<{ ds: unknown; dispose: () => void }>,
  },
  ZSshUtils: {
    installServer: (...args: unknown[]) => installServerMock(...args) as Promise<boolean>,
    checkIfOutdated: (...args: unknown[]) => checkIfOutdatedMock(...args) as Promise<boolean>,
    detectServerOnPath: (...args: unknown[]) =>
      detectServerOnPathMock(...args) as Promise<{
        serverPath?: string;
        hasExecutePermission: boolean;
        version?: string;
      }>,
  },
}));

// Real isZowexTruncatedModuleError logic is exercised (and matched against actual z/OS
// console text) in zowex-deploy-check.test.ts against a mock SSH server; here we only stub
// out the SSH-touching probe/verify so these orchestration tests don't open real connections.
vi.mock('../src/zos/native/zowex-deploy-check.js', async () => {
  const actual = await vi.importActual('../src/zos/native/zowex-deploy-check.js');
  return {
    ...actual,
    probeDeploySpace: (...args: unknown[]) => probeDeploySpaceMock(...args) as Promise<void>,
    verifyZowexBinary: (...args: unknown[]) => verifyZowexBinaryMock(...args) as Promise<void>,
  };
});

describe('SshClientCache', () => {
  beforeEach(() => {
    vi.mocked(createMock).mockClear();
    vi.mocked(installServerMock).mockClear();
    vi.mocked(installServerMock).mockResolvedValue(true);
    vi.mocked(checkIfOutdatedMock).mockClear();
    vi.mocked(checkIfOutdatedMock).mockResolvedValue(false);
    vi.mocked(probeDeploySpaceMock).mockClear();
    vi.mocked(probeDeploySpaceMock).mockResolvedValue(undefined);
    vi.mocked(verifyZowexBinaryMock).mockClear();
    vi.mocked(verifyZowexBinaryMock).mockResolvedValue(undefined);
    vi.mocked(detectServerOnPathMock).mockClear();
    vi.mocked(detectServerOnPathMock).mockResolvedValue({
      serverPath: undefined,
      hasExecutePermission: false,
    });
  });

  describe('getOrCreate with auto-install', () => {
    it('calls installServer and retries create when "Server not found" on first create and autoInstallZowex true', async () => {
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      createMock.mockResolvedValueOnce(fakeClient);

      const cache = new SshClientCache({ autoInstallZowex: true });
      const client = await cache.getOrCreate(SPEC, CREDS);

      expect(client).toBe(fakeClient);
      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(installServerMock).toHaveBeenCalledWith(expect.anything(), '~/.zowe-server');
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('uses custom serverPath for install and create', async () => {
      const customPath = '/opt/zowe/server';
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      createMock.mockResolvedValueOnce(fakeClient);

      const cache = new SshClientCache({
        autoInstallZowex: true,
        serverPath: customPath,
      });
      await cache.getOrCreate(SPEC, CREDS);

      expect(installServerMock).toHaveBeenCalledWith(expect.anything(), customPath);
      expect(createMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ serverPath: customPath })
      );
    });

    it('calls installServer when SDK throws "Error starting Zowe server" (generic fallback)', async () => {
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(
        new Error('Error starting Zowe server: ~/.zowe-server/zowex server')
      );
      createMock.mockResolvedValueOnce(fakeClient);

      const cache = new SshClientCache({ autoInstallZowex: true });
      const client = await cache.getOrCreate(SPEC, CREDS);

      expect(client).toBe(fakeClient);
      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('does not call installServer when autoInstallZowex is false and create throws "Server not found"', async () => {
      createMock.mockRejectedValue(new Error('Server not found'));

      const cache = new SshClientCache({ autoInstallZowex: false });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('Server not found');

      expect(installServerMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-Server-not-found errors without calling installServer', async () => {
      createMock.mockRejectedValue(new Error('Authentication failed'));

      const cache = new SshClientCache({ autoInstallZowex: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('Authentication failed');

      expect(installServerMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('rethrows when installServer fails (no second create)', async () => {
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      installServerMock.mockRejectedValueOnce(new Error('Upload failed'));

      const cache = new SshClientCache({ autoInstallZowex: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('Upload failed');

      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('includes additionalDetails from SDK error when not a server-not-found error', async () => {
      const sdkError = Object.assign(new Error('Connection refused'), {
        additionalDetails: 'TCP connection to host.example.com:22 was refused by the remote host.',
      });
      createMock.mockRejectedValue(sdkError);

      const cache = new SshClientCache({ autoInstallZowex: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow(
        /Connection refused\nDetails:\nTCP connection/
      );
    });

    it('includes additionalDetails from install failure', async () => {
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      const installError = Object.assign(new Error('Install failed'), {
        additionalDetails: 'Received exit code 1 while establishing SFTP session',
      });
      installServerMock.mockRejectedValueOnce(installError);

      const cache = new SshClientCache({ autoInstallZowex: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow(
        /Install failed\nDetails:\nReceived exit code 1/
      );
    });

    it('calls installServer and retries create when a truncated-module (SE06) error is thrown', async () => {
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(
        new Error('IEW4006I ... MODULE HAS BEEN TRUNCATED. CSV028I ABENDE06-0040')
      );
      createMock.mockResolvedValueOnce(fakeClient);

      const cache = new SshClientCache({ autoInstallZowex: true });
      const client = await cache.getOrCreate(SPEC, CREDS);

      expect(client).toBe(fakeClient);
      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('uses zowex found on PATH instead of deploying when execute permission is present', async () => {
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      detectServerOnPathMock.mockResolvedValueOnce({
        serverPath: '/usr/local/bin/zowex',
        hasExecutePermission: true,
        version: 'zowex 1.2.3',
      });
      createMock.mockResolvedValueOnce(fakeClient);

      const cache = new SshClientCache({ autoInstallZowex: true });
      const client = await cache.getOrCreate(SPEC, CREDS);

      expect(client).toBe(fakeClient);
      expect(installServerMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ serverPath: '/usr/local/bin' })
      );
    });

    it('falls back to deploying when zowex is found on PATH but lacks execute permission', async () => {
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      detectServerOnPathMock.mockResolvedValueOnce({
        serverPath: '/usr/local/bin/zowex',
        hasExecutePermission: false,
      });
      createMock.mockResolvedValueOnce(fakeClient);

      const cache = new SshClientCache({ autoInstallZowex: true });
      const client = await cache.getOrCreate(SPEC, CREDS);

      expect(client).toBe(fakeClient);
      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('falls back to deploying when connecting via the PATH-detected zowex fails', async () => {
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      detectServerOnPathMock.mockResolvedValueOnce({
        serverPath: '/usr/local/bin/zowex',
        hasExecutePermission: true,
      });
      createMock.mockRejectedValueOnce(new Error('Server not found')); // retry via PATH path fails
      createMock.mockResolvedValueOnce(fakeClient); // retry after deploy succeeds

      const cache = new SshClientCache({ autoInstallZowex: true });
      const client = await cache.getOrCreate(SPEC, CREDS);

      expect(client).toBe(fakeClient);
      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(3);
    });

    it('aborts the deploy (never calls installServer) when the pre-deploy space probe fails', async () => {
      createMock.mockRejectedValue(new Error('Server not found'));
      probeDeploySpaceMock.mockRejectedValueOnce(
        new Error('Not enough space to deploy the Zowe Remote SSH server to ~/.zowe-server')
      );

      const cache = new SshClientCache({ autoInstallZowex: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('Not enough space to deploy');

      expect(installServerMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('fails the deploy when the post-install binary verification fails (silently truncated install)', async () => {
      createMock.mockRejectedValue(new Error('Server not found'));
      verifyZowexBinaryMock.mockRejectedValueOnce(
        new Error('The Zowe Remote SSH server binary at ~/.zowe-server did not start after deploy')
      );

      const cache = new SshClientCache({ autoInstallZowex: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('did not start after deploy');

      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });
});
