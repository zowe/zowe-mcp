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

import { describe, expect, it } from 'vitest';
import type {
  MemberEntry,
  ReadDatasetResult,
  SearchInDatasetOptions,
  ZosBackend,
} from '../src/zos/backend.js';
import { runSearchWithListAndRead } from '../src/zos/search-runner.js';
import type { SystemId } from '../src/zos/system.js';

const SYSTEM_ID: SystemId = 'test.example.com';
const NOT_IMPL = 'Not implemented in test mock';

/** Minimal backend for search runner: only listMembers and readDataset. */
function createMockBackend(behaviors: {
  listMembers: (dsn: string) => Promise<MemberEntry[]>;
  readDataset: (dsn: string, member?: string, encoding?: string) => Promise<ReadDatasetResult>;
}): ZosBackend {
  return {
    listDatasets: () => Promise.reject(new Error(NOT_IMPL)),
    listMembers: (_systemId: SystemId, dsn: string) => behaviors.listMembers(dsn),
    readDataset: (_systemId: SystemId, dsn: string, member?: string, encoding?: string) =>
      behaviors.readDataset(dsn, member, encoding),
    writeDataset: () => Promise.reject(new Error(NOT_IMPL)),
    createDataset: () => Promise.reject(new Error(NOT_IMPL)),
    deleteDataset: () => Promise.reject(new Error(NOT_IMPL)),
    getAttributes: () => Promise.reject(new Error(NOT_IMPL)),
    copyDataset: () => Promise.reject(new Error(NOT_IMPL)),
    renameDataset: () => Promise.reject(new Error(NOT_IMPL)),
    searchInDataset: () => Promise.reject(new Error(NOT_IMPL)),
  };
}

describe('runSearchWithListAndRead', () => {
  it('should search sequential dataset (listMembers throws)', async () => {
    const backend = createMockBackend({
      listMembers: () => Promise.reject(new Error('not a PDS')),
      readDataset: async (dsn: string): Promise<ReadDatasetResult> => {
        expect(dsn).toBe('USER.JCL');
        await Promise.resolve();
        return {
          text: '//STEP1 EXEC PGM=IEFBR14\n//STEP2 EXEC PGM=IEBGENER',
          etag: 'x',
          encoding: 'IBM-1047',
        };
      },
    });

    const options: SearchInDatasetOptions = {
      string: 'IEFBR14',
      parms: 'ANYC SEQ',
    };
    const result = await runSearchWithListAndRead(backend, SYSTEM_ID, 'USER.JCL', options);

    expect(result.dataset).toBe('USER.JCL');
    expect(result.members).toHaveLength(1);
    expect(result.members[0].name).toBe('');
    expect(result.members[0].matches).toHaveLength(1);
    expect(result.members[0].matches[0].lineNumber).toBe(1);
    expect(result.members[0].matches[0].content).toContain('IEFBR14');
    expect(result.summary.linesFound).toBe(1);
    expect(result.summary.linesProcessed).toBe(2);
    expect(result.summary.membersWithLines).toBe(1);
    expect(result.summary.searchPattern).toBe('IEFBR14');
  });

  it('should search PDS and call listMembers once then readDataset per member', async () => {
    let listCalls = 0;
    let readCalls = 0;
    const backend = createMockBackend({
      listMembers: async (dsn: string): Promise<MemberEntry[]> => {
        listCalls++;
        expect(dsn).toBe('USER.SRC.COBOL');
        await Promise.resolve();
        return [{ name: 'MEM1' }, { name: 'MEM2' }];
      },
      readDataset: async (dsn: string, member?: string): Promise<ReadDatasetResult> => {
        readCalls++;
        expect(dsn).toBe('USER.SRC.COBOL');
        await Promise.resolve();
        if (member === 'MEM1') {
          return { text: 'hello world\nfoo bar', etag: 'a', encoding: 'IBM-1047' };
        }
        if (member === 'MEM2') {
          return { text: 'no match here', etag: 'b', encoding: 'IBM-1047' };
        }
        throw new Error('unexpected member');
      },
    });

    const options: SearchInDatasetOptions = {
      string: 'world',
      parms: 'ANYC SEQ',
    };
    const result = await runSearchWithListAndRead(backend, SYSTEM_ID, 'USER.SRC.COBOL', options);

    expect(listCalls).toBe(1);
    expect(readCalls).toBe(2);
    expect(result.members).toHaveLength(1);
    expect(result.members[0].name).toBe('MEM1');
    expect(result.members[0].matches).toHaveLength(1);
    expect(result.members[0].matches[0].content).toContain('world');
    expect(result.summary.membersWithLines).toBe(1);
    expect(result.summary.membersWithoutLines).toBe(1);
  });

  it('should filter to one member when options.member is set', async () => {
    const backend = createMockBackend({
      listMembers: async (): Promise<MemberEntry[]> => {
        await Promise.resolve();
        return [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
      },
      readDataset: async (_dsn: string, member?: string): Promise<ReadDatasetResult> => {
        const content = member === 'B' ? 'needle in here' : 'no';
        await Promise.resolve();
        return { text: content, etag: 'x', encoding: 'IBM-1047' };
      },
    });

    const result = await runSearchWithListAndRead(backend, SYSTEM_ID, 'USER.PDS', {
      string: 'needle',
      member: 'B',
      parms: 'ANYC',
    });

    expect(result.members).toHaveLength(1);
    expect(result.members[0].name).toBe('B');
    expect(result.members[0].matches[0].content).toContain('needle');
  });

  it('should honour case-insensitive search (ANYC in parms)', async () => {
    const backend = createMockBackend({
      listMembers: () => Promise.reject(new Error('seq')),
      readDataset: async (): Promise<ReadDatasetResult> => {
        await Promise.resolve();
        return {
          text: 'MixedCase STRING',
          etag: 'x',
          encoding: 'IBM-1047',
        };
      },
    });

    const result = await runSearchWithListAndRead(backend, SYSTEM_ID, 'USER.SEQ', {
      string: 'string',
      parms: 'ANYC SEQ',
    });

    expect(result.members[0].matches).toHaveLength(1);
    expect(result.members[0].matches[0].content).toContain('STRING');
  });

  it('should pass encoding from options to readDataset', async () => {
    let capturedEncoding: string | undefined;
    const backend = createMockBackend({
      listMembers: () => Promise.reject(new Error('seq')),
      readDataset: async (
        _dsn: string,
        _member?: string,
        encoding?: string
      ): Promise<ReadDatasetResult> => {
        capturedEncoding = encoding;
        await Promise.resolve();
        return { text: 'hit', etag: 'x', encoding: encoding ?? 'IBM-1047' };
      },
    });

    await runSearchWithListAndRead(backend, SYSTEM_ID, 'USER.SEQ', {
      string: 'hit',
      parms: 'ANYC SEQ',
      encoding: 'IBM-37',
    });

    expect(capturedEncoding).toBe('IBM-37');
  });
});
