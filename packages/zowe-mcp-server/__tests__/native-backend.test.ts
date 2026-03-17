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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedConnectionSpec } from '../src/zos/native/connection-spec.js';
import type { NativeBackendOptions } from '../src/zos/native/native-backend.js';
import { NativeBackend } from '../src/zos/native/native-backend.js';

/**
 * Minimal parseSearchOutput for tests (SDK 0.2.x lacks UtilsApi).
 * Parses the subset of SuperC output used in test fixtures.
 */
function fakeParseSearchOutput(output: string) {
  const lines = output.split('\n');
  const members: {
    name: string;
    matches: {
      lineNumber: number;
      content: string;
      beforeContext: string[];
      afterContext: string[];
    }[];
  }[] = [];
  let currentMember: (typeof members)[0] | undefined;
  let linesFound = 0;
  const linesProcessed = 0;
  let membersWithLines = 0;
  let membersWithoutLines = 0;
  let searchPattern = '';
  let processOptions = '';
  const contextBuf: string[] = [];
  let prevMatch: (typeof members)[0]['matches'][0] | undefined;

  for (const line of lines) {
    const srchFor = /^\s*SRCHFOR\s+'(.+)'/.exec(line);
    if (srchFor) {
      searchPattern = srchFor[1];
      continue;
    }
    const procOpts = /^\s*PROCESS OPTIONS USED:\s*(.+)/.exec(line);
    if (procOpts) {
      processOptions = procOpts[1].trim();
      continue;
    }
    const memberHeader = /^\s{2}(\S+)\s+--------- STRING\(S\) FOUND/.exec(line);
    if (memberHeader) {
      currentMember = { name: memberHeader[1], matches: [] };
      members.push(currentMember);
      contextBuf.length = 0;
      prevMatch = undefined;
      continue;
    }
    const contextLine = /^\s+\*\s{2}(.*)$/.exec(line);
    if (contextLine && currentMember) {
      if (prevMatch) {
        prevMatch.afterContext.push(contextLine[1]);
      } else {
        contextBuf.push(contextLine[1]);
      }
      continue;
    }
    const summary = /^\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+:\d+\s+\d+/.exec(line);
    if (summary && currentMember) {
      linesFound += parseInt(summary[1], 10);
      membersWithLines += parseInt(summary[3], 10);
      membersWithoutLines += parseInt(summary[4], 10);
      currentMember = undefined;
      prevMatch = undefined;
      continue;
    }
    const matchLine = /^\s+(\d+)\s{2}(.*)$/.exec(line);
    if (matchLine && currentMember) {
      if (prevMatch && contextBuf.length > 0) {
        prevMatch.afterContext.push(...contextBuf.splice(0));
      }
      const m = {
        lineNumber: parseInt(matchLine[1], 10),
        content: matchLine[2],
        beforeContext: [...contextBuf],
        afterContext: [] as string[],
      };
      contextBuf.length = 0;
      currentMember.matches.push(m);
      prevMatch = m;
      continue;
    }
  }

  return {
    dataset: '',
    header: '',
    members,
    summary: {
      linesFound,
      linesProcessed,
      membersWithLines,
      membersWithoutLines,
      compareColumns: '',
      longestLine: 0,
      processOptions,
      searchPattern,
    },
  };
}

vi.mock('zowe-native-proto-sdk', async importOriginal => {
  const actual = await importOriginal();
  if (!actual.UtilsApi) {
    return {
      ...actual,
      UtilsApi: {
        tools: {
          parseSearchOutput: fakeParseSearchOutput,
        },
      },
    };
  }
  return actual;
});

const SYSTEM_ID = 'host.example.com';
const SPEC: ParsedConnectionSpec = { user: 'USER', host: 'host.example.com', port: 22 };

/** Fake SDK client shape used by listDatasets / listDsMembers / readDataset / tool.search. */
function createFakeClient(overrides?: {
  listDatasets?: (req: { pattern: string; attributes?: boolean }) => Promise<{
    items?: {
      name: string;
      dsorg?: string;
      recfm?: string;
      lrecl?: number;
      blksize?: number;
      cdate?: string;
      volser?: string;
    }[];
  }>;
  listDsMembers?: (req: { dsname: string }) => Promise<{ items?: { name: string }[] }>;
  readDataset?: (req: { dsname: string; localEncoding?: string; encoding?: string }) => Promise<{
    etag?: string;
    data?: string;
  }>;
  toolSearch?: (req: {
    dsname: string;
    string: string;
    parms?: string;
  }) => Promise<{ data?: string }>;
}) {
  const defaultReadDataset = (req: { dsname: string }) => {
    void req;
    return Promise.resolve({
      etag: 'mock-etag',
      data: Buffer.from('line1\nline2\nline3', 'utf-8').toString('base64'),
    });
  };

  const defaultListDatasetsItems = [
    {
      name: 'USER.DATA',
      dsorg: 'PO',
      recfm: 'FB',
      lrecl: 80,
      blksize: 27920,
      cdate: '2024-01-01',
      volser: 'VOL1',
    },
  ];

  const client: Record<string, unknown> = {
    ds: {
      listDatasets:
        overrides?.listDatasets ?? (() => Promise.resolve({ items: defaultListDatasetsItems })),
      listDsMembers:
        overrides?.listDsMembers ??
        (() => Promise.resolve({ items: [{ name: 'MEMBER1' }, { name: 'MEMBER2' }] })),
      readDataset: overrides?.readDataset ?? defaultReadDataset,
    },
  };

  if (overrides?.toolSearch) {
    client.tool = { search: overrides.toolSearch };
  }

  return client;
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
  const hasKey = vi.fn().mockReturnValue(true);
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
      hasKey,
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
      expect(options.clientCache.getOrCreate).toHaveBeenCalledWith(
        SPEC,
        {
          user: SPEC.user,
          password: 'secret',
        },
        undefined
      );
    });

    it('calls SDK listDatasets with attributes: true by default', async () => {
      const listDatasetsSpy = vi.fn().mockResolvedValue({
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
      });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi
            .fn()
            .mockResolvedValue(createFakeClient({ listDatasets: listDatasetsSpy })),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await backend.listDatasets(SYSTEM_ID, 'USER.*');

      expect(listDatasetsSpy).toHaveBeenCalledWith({ pattern: 'USER.*', attributes: true });
    });

    it('calls SDK listDatasets with attributes: false when requested', async () => {
      const listDatasetsSpy = vi.fn().mockResolvedValue({
        items: [{ name: 'USER.DATA' }],
      });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi
            .fn()
            .mockResolvedValue(createFakeClient({ listDatasets: listDatasetsSpy })),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.listDatasets(SYSTEM_ID, 'USER.*', undefined, undefined, false);

      expect(listDatasetsSpy).toHaveBeenCalledWith({ pattern: 'USER.*', attributes: false });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ dsn: 'USER.DATA' });
    });

    it('on auth-style error calls evict, markInvalid, onPasswordInvalid and rethrows', async () => {
      const authError = new Error('Authentication failed');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(authError),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
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

    it('classifies "All configured authentication methods failed" as invalid password', async () => {
      const authError = new Error('All configured authentication methods failed');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(authError),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow(
        'All configured authentication methods failed'
      );

      expect(options.credentialProvider.markInvalid).toHaveBeenCalledWith(SPEC);
      expect(options.clientCache.evict).toHaveBeenCalledWith(SPEC);
      expect(options.onPasswordInvalid).toHaveBeenCalledWith(SPEC.user, SPEC.host, SPEC.port);
    });

    it('on expired password calls markInvalid, evict, onPasswordInvalid and throws user-facing message', async () => {
      const expiredError = Object.assign(
        new Error('Password expired on the remote z/OS system. Change your password and retry.'),
        { code: 'EPASSWD_EXPIRED' }
      );
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(expiredError),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow(
        'Password for USER@host.example.com has expired'
      );

      expect(options.credentialProvider.markInvalid).toHaveBeenCalledWith(SPEC);
      expect(options.clientCache.evict).toHaveBeenCalledWith(SPEC);
      expect(options.onPasswordInvalid).toHaveBeenCalledWith(SPEC.user, SPEC.host, SPEC.port);
    });

    it('classifies FOTS1668 as expired password', async () => {
      const expiredError = new Error('FOTS1668 Your password has expired');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(expiredError),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow(
        'Password for USER@host.example.com has expired'
      );

      expect(options.credentialProvider.markInvalid).toHaveBeenCalledWith(SPEC);
    });

    it('on non-auth error does not call evict or markInvalid', async () => {
      // Use an error that is not classified as connection or auth (e.g. "timeout" triggers evict)
      const otherError = new Error('Disk full');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(otherError),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow('Disk full');

      expect(options.credentialProvider.markInvalid).not.toHaveBeenCalled();
      expect(options.clientCache.evict).not.toHaveBeenCalled();
      expect(options.onPasswordInvalid).not.toHaveBeenCalled();
    });

    it('includes additionalDetails from SDK ImperativeError in thrown error', async () => {
      const sdkError = Object.assign(
        new Error('Error starting Zowe server: ~/.zowe-server/zowex server'),
        {
          additionalDetails:
            'CEE3561S External function _ZNSt5__1_e13__hash_memoryEPKvm was not found in DLL CRTEQCXE.',
        }
      );
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(sdkError),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow(
        /Error starting Zowe server.*\nDetails:\nCEE3561S/
      );
    });

    it('does not alter error when additionalDetails is absent', async () => {
      const plainError = new Error('Some SDK error');
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockRejectedValue(plainError),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await expect(backend.listDatasets(SYSTEM_ID, 'USER.*')).rejects.toThrow('Some SDK error');
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
          hasKey: vi.fn().mockReturnValue(true),
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
          hasKey: vi.fn().mockReturnValue(true),
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
          hasKey: vi.fn().mockReturnValue(true),
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
          hasKey: vi.fn().mockReturnValue(true),
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
          hasKey: vi.fn().mockReturnValue(true),
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
    it('returns text, etag, encoding from SDK readDataset response', async () => {
      const options = createOptions();
      const backend = new NativeBackend(options);

      const result = await backend.readDataset(SYSTEM_ID, 'USER.SEQ.DATA');

      expect(result).toEqual({
        text: 'line1\nline2\nline3',
        etag: 'mock-etag',
        encoding: 'IBM-1047',
      });
      expect(options.clientCache.getOrCreate).toHaveBeenCalledWith(
        SPEC,
        {
          user: SPEC.user,
          password: 'secret',
        },
        undefined
      );
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
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await backend.readDataset(SYSTEM_ID, 'USER.PS.DATA');

      expect(readDatasetMock).toHaveBeenCalledTimes(1);
      expect(readDatasetMock).toHaveBeenCalledWith({
        dsname: 'USER.PS.DATA',
        localEncoding: 'utf-8',
        encoding: 'IBM-1047',
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
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await backend.readDataset(SYSTEM_ID, 'USER.SRC.COBOL', 'MAIN');

      expect(readDatasetMock).toHaveBeenCalledTimes(1);
      expect(readDatasetMock).toHaveBeenCalledWith({
        dsname: 'USER.SRC.COBOL(MAIN)',
        localEncoding: 'utf-8',
        encoding: 'IBM-1047',
      });
    });

    it('passes encoding to SDK when provided', async () => {
      const readDatasetMock = vi.fn().mockResolvedValue({ etag: '', data: '' });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi
            .fn()
            .mockResolvedValue(createFakeClient({ readDataset: readDatasetMock })),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      await backend.readDataset(SYSTEM_ID, 'USER.DATA', undefined, 'IBM-037');

      expect(readDatasetMock).toHaveBeenCalledWith({
        dsname: 'USER.DATA',
        localEncoding: 'utf-8',
        encoding: 'IBM-037',
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
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.readDataset(SYSTEM_ID, 'USER.EMPTY');

      expect(result.text).toBe('');
      expect(result.etag).toBe('e');
      expect(result.encoding).toBe('IBM-1047');
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

  describe('searchInDataset', () => {
    const SUPERC_OUTPUT = [
      ' ASMFSUPC - MVS FILE/LINE/WORD/BYTE/SFOR COMPARE UTILITY- V1R6M0 (2021/11/01) 2026/02/20 9.05',
      ' SRCH DSN: USER.SRC.COBOL',
      " SRCHFOR 'HELLO'",
      ' PROCESS OPTIONS USED: ANYC SEQ',
      '  MEMBER1                    --------- STRING(S) FOUND -------------------',
      '      5  HELLO WORLD LINE FIVE',
      '     10  SAY HELLO AGAIN',
      '      3      0      1      0      1:80      80',
    ].join('\n');

    const SUPERC_OUTPUT_WITH_CONTEXT = [
      ' ASMFSUPC - MVS FILE/LINE/WORD/BYTE/SFOR COMPARE UTILITY- V1R6M0 (2021/11/01) 2026/02/20 9.05',
      ' SRCH DSN: USER.SRC.COBOL',
      " SRCHFOR 'HELLO'",
      ' PROCESS OPTIONS USED: ANYC SEQ LPSF',
      '  MEMBER1                    --------- STRING(S) FOUND -------------------',
      '      *  LINE BEFORE MATCH',
      '      5  HELLO WORLD LINE FIVE',
      '      *  LINE AFTER MATCH',
      '      3      0      1      0      1:80      80',
    ].join('\n');

    afterEach(() => {
      delete process.env.ZOWE_MCP_SEARCH_FORCE_FALLBACK;
    });

    it('uses tool.search and returns mapped SearchInDatasetResult', async () => {
      const toolSearchMock = vi.fn().mockResolvedValue({ data: SUPERC_OUTPUT });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(createFakeClient({ toolSearch: toolSearchMock })),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.searchInDataset(SYSTEM_ID, 'USER.SRC.COBOL', {
        string: 'HELLO',
        parms: 'ANYC SEQ',
      });

      expect(toolSearchMock).toHaveBeenCalledWith({
        dsname: 'USER.SRC.COBOL',
        string: 'HELLO',
        parms: 'ANYC SEQ',
      });
      expect(result.dataset).toBe('USER.SRC.COBOL');
      expect(result.members).toHaveLength(1);
      expect(result.members[0].name).toBe('MEMBER1');
      expect(result.members[0].matches).toHaveLength(2);
      expect(result.members[0].matches[0]).toEqual({
        lineNumber: 5,
        content: 'HELLO WORLD LINE FIVE',
      });
      expect(result.members[0].matches[1]).toEqual({
        lineNumber: 10,
        content: 'SAY HELLO AGAIN',
      });
      expect(result.summary.linesFound).toBe(3);
      expect(result.summary.membersWithLines).toBe(1);
    });

    it('uses fallback when ZOWE_MCP_SEARCH_FORCE_FALLBACK=1', async () => {
      process.env.ZOWE_MCP_SEARCH_FORCE_FALLBACK = '1';

      const toolSearchMock = vi.fn().mockResolvedValue({ data: SUPERC_OUTPUT });
      const listDsMembersMock = vi.fn().mockResolvedValue({
        items: [{ name: 'MEMBER1' }],
      });
      const readDatasetMock = vi.fn().mockResolvedValue({
        etag: 'e',
        data: Buffer.from('line1\nHELLO WORLD\nline3', 'utf-8').toString('base64'),
      });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(
            createFakeClient({
              toolSearch: toolSearchMock,
              listDsMembers: listDsMembersMock,
              readDataset: readDatasetMock,
            })
          ),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.searchInDataset(SYSTEM_ID, 'USER.SRC.COBOL', {
        string: 'HELLO',
        parms: 'ANYC SEQ',
      });

      expect(toolSearchMock).not.toHaveBeenCalled();
      expect(listDsMembersMock).toHaveBeenCalled();
      expect(readDatasetMock).toHaveBeenCalled();
      expect(result.members).toHaveLength(1);
      expect(result.members[0].matches[0].content).toBe('HELLO WORLD');
    });

    it('maps beforeContext/afterContext when LPSF is in parms', async () => {
      const toolSearchMock = vi.fn().mockResolvedValue({ data: SUPERC_OUTPUT_WITH_CONTEXT });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(createFakeClient({ toolSearch: toolSearchMock })),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.searchInDataset(SYSTEM_ID, 'USER.SRC.COBOL', {
        string: 'HELLO',
        parms: 'ANYC SEQ LPSF',
      });

      expect(result.members[0].matches[0].beforeContext).toEqual(['LINE BEFORE MATCH']);
      expect(result.members[0].matches[0].afterContext).toEqual(['LINE AFTER MATCH']);
    });

    it('returns empty result when tool.search returns empty data', async () => {
      const toolSearchMock = vi.fn().mockResolvedValue({ data: '' });
      const options = createOptions({
        clientCache: {
          getOrCreate: vi.fn().mockResolvedValue(createFakeClient({ toolSearch: toolSearchMock })),
          evict: vi.fn(),
          hasKey: vi.fn().mockReturnValue(true),
        },
      });
      const backend = new NativeBackend(options);

      const result = await backend.searchInDataset(SYSTEM_ID, 'USER.SRC.COBOL', {
        string: 'NOTFOUND',
        parms: 'ANYC SEQ',
      });

      expect(result.members).toHaveLength(0);
      expect(result.summary.linesFound).toBe(0);
    });
  });
});
