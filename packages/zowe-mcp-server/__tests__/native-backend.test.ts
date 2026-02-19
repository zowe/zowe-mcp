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
 * Unit tests for NativeBackend (Zowe Native Proto SDK).
 *
 * Uses mocked options and a fake SDK client; no real SSH or SDK.
 */
/* eslint-disable @typescript-eslint/unbound-method -- expect(mock.method).toHaveBeenCalledWith is safe in tests */

import { describe, expect, it, vi } from 'vitest';
import type { ParsedConnectionSpec } from '../src/zos/native/connection-spec.js';
import type { NativeBackendOptions } from '../src/zos/native/native-backend.js';
import { NativeBackend } from '../src/zos/native/native-backend.js';

const SYSTEM_ID = 'host.example.com';
const SPEC: ParsedConnectionSpec = { user: 'USER', host: 'host.example.com', port: 22 };

/** Fake SDK client shape used by listDatasets / listDsMembers / readDataset. */
function createFakeClient(overrides?: {
  listDatasets?: (req: { pattern: string }) => Promise<{ items?: { name: string }[] }>;
  listDsMembers?: (req: { dsname: string }) => Promise<{ items?: { name: string }[] }>;
  readDataset?: (req: { dsname: string; localEncoding?: string }) => Promise<{
    etag?: string;
    data?: string;
  }>;
}) {
  const defaultReadDataset = (req: { dsname: string }) =>
    Promise.resolve({
      etag: 'mock-etag',
      data: Buffer.from('line1\nline2\nline3', 'utf-8').toString('base64'),
    });

  return {
    ds: {
      listDatasets:
        overrides?.listDatasets ??
        (() =>
          Promise.resolve({
            items: [
              {
                name: 'USER.DATA',
                dsorg: 'PO',
                recfm: 'FB',
                lrecl: 80,
                blksize: 27920,
                cdate: '2024-01-01',
                volser: 'VOL1',
              },
            ],
          })),
      listDsMembers:
        overrides?.listDsMembers ??
        (() => Promise.resolve({ items: [{ name: 'MEMBER1' }, { name: 'MEMBER2' }] })),
      readDataset: overrides?.readDataset ?? defaultReadDataset,
    },
  };
}

function createOptions(
  overrides?: Partial<{
    getSpec: NativeBackendOptions['getSpec'];
    credentialProvider: NativeBackendOptions['credentialProvider'];
    clientCache: NativeBackendOptions['clientCache'];
    onPasswordInvalid: NonNullable<NativeBackendOptions['onPasswordInvalid']>;
  }>
): NativeBackendOptions {
  const fakeClient = createFakeClient();
  const getSpec = overrides?.getSpec ?? vi.fn(() => SPEC);
  const getCredentials = vi.fn().mockResolvedValue({ user: SPEC.user, password: 'secret' });
  const markInvalid = vi.fn();
  const getOrCreate = vi.fn().mockResolvedValue(fakeClient);
  const evict = vi.fn();
  const onPasswordInvalid = overrides?.onPasswordInvalid ?? vi.fn();

  return {
    getSpec,
    credentialProvider: overrides?.credentialProvider ?? {
      getCredentials,
      markInvalid,
    },
    clientCache: overrides?.clientCache ?? {
      getOrCreate,
      evict,
    },
    onPasswordInvalid,
  };
}

describe('NativeBackend', () => {
  describe('listDatasets', () => {
    it('throws when getSpec returns undefined', async () => {
      const options = createOptions({ getSpec: () => undefined });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow(
        `No connection spec for system "${SYSTEM_ID}"`
      );

      expect(options.credentialProvider.getCredentials).not.toHaveBeenCalled();
      expect(options.clientCache.getOrCreate).not.toHaveBeenCalled();
    });

    it('returns mapped DatasetEntry[] when fake client returns items', async () => {
      const options = createOptions();
      const backend = new NativeBackend(options);

      const result = await backend.listDatasets(SYSTEM_ID, 'USER.*');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        dsn: 'USER.DATA',
        dsorg: 'PO',
        recfm: 'FB',
        lrecl: 80,
        blksz: 27920,
        volser: 'VOL1',
        creationDate: '2024-01-01',
      });
      expect(options.clientCache.getOrCreate).toHaveBeenCalledWith(SPEC, {
        user: SPEC.user,
        password: 'secret',
      });
    });

    it('on auth-style error calls evict, markInvalid, onPasswordInvalid and rethrows', async () => {
      const authError = new Error('Authentication failed');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(authError),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow(
        'Authentication failed'
      );

      expect(options.credentialProvider.markInvalid).toHaveBeenCalledWith(SPEC);
      expect(options.clientCache.evict).toHaveBeenCalledWith(SPEC);
      expect(options.onPasswordInvalid).toHaveBeenCalledWith(SPEC.user, SPEC.host, SPEC.port);
    });

    it('on non-auth error does not call evict or markInvalid', async () => {
      const otherError = new Error('Network timeout');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(otherError),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow('Network timeout');

      expect(options.credentialProvider.markInvalid).not.toHaveBeenCalled();
      expect(options.clientCache.evict).not.toHaveBeenCalled();
      expect(options.onPasswordInvalid).not.toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    it('returns MemberEntry[] with uppercase names from listDsMembers response', async () => {
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(
            createFakeClient({
              listDsMembers: () =>
                Promise.resolve({
                  items: [{ name: 'a' }, { name: 'B' }, { name: 'cobol' }],
                }),
            })
          ),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.listMembers(SYSTEM_ID, 'USER.PDS');

      expect(result).toEqual([{ name: 'A' }, { name: 'B' }, { name: 'COBOL' }]);
    });

    it('filters by pattern client-side when pattern is provided', async () => {
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(
            createFakeClient({
              listDsMembers: () =>
                Promise.resolve({
                  items: [{ name: 'ALPHA' }, { name: 'BETA' }, { name: 'ALICE' }, { name: 'BOB' }],
                }),
            })
          ),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.listMembers(SYSTEM_ID, 'USER.PDS', 'A*');

      expect(result.map(m => m.name)).toEqual(['ALICE', 'ALPHA']);
    });

    it('filters by % (one character) wildcard in pattern', async () => {
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(
            createFakeClient({
              listDsMembers: () =>
                Promise.resolve({
                  items: [
                    { name: 'ALPHA' },
                    { name: 'AB' },
                    { name: 'A' },
                    { name: 'BETA' },
                    { name: 'AX' },
                  ],
                }),
            })
          ),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.listMembers(SYSTEM_ID, 'USER.PDS', 'A%');

      expect(result.map(m => m.name)).toEqual(['AB', 'AX']);
    });

    it('returns list sorted by name', async () => {
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(
            createFakeClient({
              listDsMembers: () =>
                Promise.resolve({
                  items: [{ name: 'ZEE' }, { name: 'ALPHA' }, { name: 'MID' }],
                }),
            })
          ),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.listMembers(SYSTEM_ID, 'USER.PDS');

      expect(result.map(m => m.name)).toEqual(['ALPHA', 'MID', 'ZEE']);
    });

    it('throws when getSpec returns undefined', async () => {
      const options = createOptions({ getSpec: () => undefined });
      const backend = new NativeBackend(options);

      await expect(backend.listMembers(SYSTEM_ID, 'USER.PDS')).rejects.toThrow(
        `No connection spec for system "${SYSTEM_ID}"`
      );

      expect(options.clientCache.getOrCreate).not.toHaveBeenCalled();
    });

    it('on auth-style error calls evict, markInvalid, onPasswordInvalid and rethrows', async () => {
      const authError = new Error('password invalid');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(authError),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listMembers(SYSTEM_ID, 'USER.PDS')).rejects.toThrow('password invalid');

      expect(options.credentialProvider.markInvalid).toHaveBeenCalledWith(SPEC);
      expect(options.clientCache.evict).toHaveBeenCalledWith(SPEC);
      expect(options.onPasswordInvalid).toHaveBeenCalledWith(SPEC.user, SPEC.host, SPEC.port);
    });
  });

  describe('readDataset', () => {
    it('returns text, etag, codepage from SDK readDataset response', async () => {
      const options = createOptions();
      const backend = new NativeBackend(options);

      const result = await backend.readDataset(SYSTEM_ID, 'USER.SEQ.DATA');

      expect(result).toEqual({
        text: 'line1\nline2\nline3',
        etag: 'mock-etag',
        codepage: 'IBM-1047',
      });
      expect(options.clientCache.getOrCreate).toHaveBeenCalledWith(SPEC, {
        user: SPEC.user,
        password: 'secret',
      });
    });

    it('calls SDK readDataset with dsname for sequential dataset', async () => {
      const readDatasetMock = vi.fn().mockResolvedValue({
        etag: 'e1',
        data: Buffer.from('content', 'utf-8').toString('base64'),
      });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi
            .fn()
            .mockResolvedValue(createFakeClient({ readDataset: readDatasetMock })),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      await backend.readDataset(SYSTEM_ID, 'USER.PS.DATA');

      expect(readDatasetMock).toHaveBeenCalledTimes(1);
      expect(readDatasetMock).toHaveBeenCalledWith({
        dsname: 'USER.PS.DATA',
        localEncoding: 'IBM-1047',
      });
    });

    it('calls SDK readDataset with dsname(member) for PDS member', async () => {
      const readDatasetMock = vi.fn().mockResolvedValue({
        etag: 'e2',
        data: Buffer.from('member content', 'utf-8').toString('base64'),
      });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi
            .fn()
            .mockResolvedValue(createFakeClient({ readDataset: readDatasetMock })),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      await backend.readDataset(SYSTEM_ID, 'USER.SRC.COBOL', 'MAIN');

      expect(readDatasetMock).toHaveBeenCalledTimes(1);
      expect(readDatasetMock).toHaveBeenCalledWith({
        dsname: 'USER.SRC.COBOL(MAIN)',
        localEncoding: 'IBM-1047',
      });
    });

    it('passes codepage as localEncoding when provided', async () => {
      const readDatasetMock = vi.fn().mockResolvedValue({ etag: '', data: '' });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi
            .fn()
            .mockResolvedValue(createFakeClient({ readDataset: readDatasetMock })),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      await backend.readDataset(SYSTEM_ID, 'USER.DATA', undefined, 'IBM-037');

      expect(readDatasetMock).toHaveBeenCalledWith({
        dsname: 'USER.DATA',
        localEncoding: 'IBM-037',
      });
    });

    it('returns empty text when SDK returns empty data', async () => {
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(
            createFakeClient({
              readDataset: () => Promise.resolve({ etag: 'e', data: '' }),
            })
          ),
          evict: vi.fn(),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.readDataset(SYSTEM_ID, 'USER.EMPTY');

      expect(result.text).toBe('');
      expect(result.etag).toBe('e');
      expect(result.codepage).toBe('IBM-1047');
    });

    it('throws when getSpec returns undefined', async () => {
      const options = createOptions({ getSpec: () => undefined });
      const backend = new NativeBackend(options);

      await expect(backend.readDataset(SYSTEM_ID, 'USER.DATA')).rejects.toThrow(
        `No connection spec for system "${SYSTEM_ID}"`
      );

      expect(options.clientCache.getOrCreate).not.toHaveBeenCalled();
    });
  });
});
