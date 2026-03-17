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
 * Unit tests for SshClientCache: "Server not found" detection, auto-install ZNP, and server path.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Credentials } from '../src/zos/credentials.js';
import type { ParsedConnectionSpec } from '../src/zos/native/connection-spec.js';
import { SshClientCache, isZnpServerNotFoundError } from '../src/zos/native/ssh-client-cache.js';

const SPEC: ParsedConnectionSpec = { user: 'USER', host: 'host.example.com', port: 22 };
const CREDS: Credentials = { user: 'USER', password: 'secret' };

describe('isZnpServerNotFoundError', () => {
  it('returns true for "Server not found" message', () => {
    expect(isZnpServerNotFoundError(new Error('Server not found'))).toBe(true);
    expect(isZnpServerNotFoundError(new Error('x Server not found y'))).toBe(true);
  });

  it('returns true for FSUM7351 in message', () => {
    expect(isZnpServerNotFoundError(new Error('FSUM7351 not found'))).toBe(true);
    expect(isZnpServerNotFoundError(new Error('stderr: FSUM7351'))).toBe(true);
  });

  it('returns true for "Error starting Zowe server" (SDK generic fallback)', () => {
    expect(
      isZnpServerNotFoundError(
        new Error('Error starting Zowe server: ~/.zowe-server/zowex server')
      )
    ).toBe(true);
    expect(
      isZnpServerNotFoundError(
        new Error('Error starting Zowe server: /opt/zowe/server/zowex server')
      )
    ).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isZnpServerNotFoundError(new Error('ENOTFOUND'))).toBe(false);
    expect(isZnpServerNotFoundError(new Error('Connection refused'))).toBe(false);
    expect(isZnpServerNotFoundError(new Error('Authentication failed'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isZnpServerNotFoundError('Server not found')).toBe(true); // string is coerced
    expect(isZnpServerNotFoundError(null)).toBe(false);
  });
});

const createMock = vi.hoisted(() => vi.fn());
const installServerMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const checkIfOutdatedMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock('zowe-native-proto-sdk', () => ({
  ZSshClient: {
    DEFAULT_SERVER_PATH: '~/.zowe-server',
    create: (...args: unknown[]) =>
      createMock(...args) as Promise<{ ds: unknown; dispose: () => void }>,
  },
  ZSshUtils: {
    installServer: (...args: unknown[]) => installServerMock(...args) as Promise<boolean>,
    checkIfOutdated: (...args: unknown[]) => checkIfOutdatedMock(...args) as Promise<boolean>,
  },
}));

describe('SshClientCache', () => {
  beforeEach(() => {
    vi.mocked(createMock).mockClear();
    vi.mocked(installServerMock).mockClear();
    vi.mocked(installServerMock).mockResolvedValue(true);
    vi.mocked(checkIfOutdatedMock).mockClear();
    vi.mocked(checkIfOutdatedMock).mockResolvedValue(false);
  });

  describe('getOrCreate with auto-install', () => {
    it('calls installServer and retries create when "Server not found" on first create and autoInstallZnp true', async () => {
      const fakeClient = { ds: {}, dispose: vi.fn(), serverChecksums: {} };
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      createMock.mockResolvedValueOnce(fakeClient);

      const cache = new SshClientCache({ autoInstallZnp: true });
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
        autoInstallZnp: true,
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

      const cache = new SshClientCache({ autoInstallZnp: true });
      const client = await cache.getOrCreate(SPEC, CREDS);

      expect(client).toBe(fakeClient);
      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('does not call installServer when autoInstallZnp is false and create throws "Server not found"', async () => {
      createMock.mockRejectedValue(new Error('Server not found'));

      const cache = new SshClientCache({ autoInstallZnp: false });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('Server not found');

      expect(installServerMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-Server-not-found errors without calling installServer', async () => {
      createMock.mockRejectedValue(new Error('Authentication failed'));

      const cache = new SshClientCache({ autoInstallZnp: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('Authentication failed');

      expect(installServerMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('rethrows when installServer fails (no second create)', async () => {
      createMock.mockRejectedValueOnce(new Error('Server not found'));
      installServerMock.mockRejectedValueOnce(new Error('Upload failed'));

      const cache = new SshClientCache({ autoInstallZnp: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow('Upload failed');

      expect(installServerMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('includes additionalDetails from SDK error when not a server-not-found error', async () => {
      const sdkError = Object.assign(new Error('Connection refused'), {
        additionalDetails: 'TCP connection to host.example.com:22 was refused by the remote host.',
      });
      createMock.mockRejectedValue(sdkError);

      const cache = new SshClientCache({ autoInstallZnp: true });
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

      const cache = new SshClientCache({ autoInstallZnp: true });
      await expect(cache.getOrCreate(SPEC, CREDS)).rejects.toThrow(
        /Install failed\nDetails:\nReceived exit code 1/
      );
    });
  });
});
