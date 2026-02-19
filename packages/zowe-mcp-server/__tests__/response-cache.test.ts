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
 * Tests for the response cache: repeated listDatasets/listMembers with same params
 * but different offset/limit should only invoke the backend once per logical list.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import type {
  DatasetAttributes,
  DatasetEntry,
  MemberEntry,
  ReadDatasetResult,
  ZosBackend,
} from '../src/zos/backend.js';
import type { CredentialProvider } from '../src/zos/credentials.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { createResponseCache } from '../src/zos/response-cache.js';
import type { SystemId } from '../src/zos/system.js';
import { SystemRegistry } from '../src/zos/system.js';

const SYSTEM_HOST = 'cache-test.example.com';
const DEFAULT_USER = 'TESTUSER'; // max 8 chars per qualifier

const mockConfig: MockSystemsConfig = {
  systems: [
    {
      host: SYSTEM_HOST,
      port: 443,
      description: 'Cache test system',
      credentials: [{ user: DEFAULT_USER, password: 'pass' }],
    },
  ],
};

/** Backend wrapper that counts listDatasets, listMembers, and readDataset calls. */
class CountingBackend implements ZosBackend {
  listDatasetsCallCount = 0;
  listMembersCallCount = 0;
  readDatasetCallCount = 0;

  constructor(private readonly inner: ZosBackend) {}

  async listDatasets(
    systemId: SystemId,
    pattern: string,
    volser?: string,
    userId?: string
  ): Promise<DatasetEntry[]> {
    this.listDatasetsCallCount++;
    return this.inner.listDatasets(systemId, pattern, volser, userId);
  }

  async listMembers(systemId: SystemId, dsn: string, pattern?: string): Promise<MemberEntry[]> {
    this.listMembersCallCount++;
    return this.inner.listMembers(systemId, dsn, pattern);
  }

  async readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    codepage?: string
  ): Promise<ReadDatasetResult> {
    this.readDatasetCallCount++;
    return this.inner.readDataset(systemId, dsn, member, codepage);
  }

  writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    codepage?: string
  ) {
    return this.inner.writeDataset(systemId, dsn, content, member, etag, codepage);
  }

  createDataset(
    systemId: SystemId,
    dsn: string,
    options: Parameters<ZosBackend['createDataset']>[2]
  ) {
    return this.inner.createDataset(systemId, dsn, options);
  }

  deleteDataset(systemId: SystemId, dsn: string, member?: string): Promise<void> {
    return this.inner.deleteDataset(systemId, dsn, member);
  }

  getAttributes(systemId: SystemId, dsn: string): Promise<DatasetAttributes> {
    return this.inner.getAttributes(systemId, dsn);
  }

  copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string
  ): Promise<void> {
    return this.inner.copyDataset(systemId, sourceDsn, targetDsn, sourceMember, targetMember);
  }

  renameDataset(
    systemId: SystemId,
    dsn: string,
    newDsn: string,
    member?: string,
    newMember?: string
  ): Promise<void> {
    return this.inner.renameDataset(systemId, dsn, newDsn, member, newMember);
  }
}

async function createMockData(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, 'systems.json'), JSON.stringify(mockConfig));
  const sysDir = path.join(dir, SYSTEM_HOST);
  // PDS: HLQ/rest → CACHEUSER.SRC.COBOL → CACHEUSER/SRC.COBOL (one dir named "SRC.COBOL")
  const pdsDir = path.join(sysDir, DEFAULT_USER, 'SRC.COBOL');
  await fs.mkdir(pdsDir, { recursive: true });
  await fs.writeFile(
    path.join(pdsDir, '_meta.json'),
    JSON.stringify({ dsorg: 'PO', recfm: 'FB', lrecl: 80 })
  );
  await fs.writeFile(path.join(pdsDir, 'MEM1'), 'content');
  await fs.writeFile(path.join(pdsDir, 'MEM2'), 'content');
  await fs.writeFile(path.join(pdsDir, 'MEM3'), 'content');
  await fs.mkdir(path.join(sysDir, DEFAULT_USER, 'DATA'), { recursive: true });
  await fs.writeFile(
    path.join(sysDir, DEFAULT_USER, 'DATA', '_meta.json'),
    JSON.stringify({ dsorg: 'PS', recfm: 'FB', lrecl: 80 })
  );
  await fs.writeFile(path.join(sysDir, DEFAULT_USER, 'DATA', 'INPUT'), 'line1\nline2');
  const largeLines = Array.from(
    { length: 50 },
    (_, i) => `LINE ${String(i + 1).padStart(3, '0')}`
  );
  await fs.writeFile(path.join(sysDir, DEFAULT_USER, 'LARGE.DATA'), largeLines.join('\n'));
  await fs.writeFile(
    path.join(sysDir, DEFAULT_USER, 'LARGE.DATA_meta.json'),
    JSON.stringify({ dsn: `${DEFAULT_USER}.LARGE.DATA`, dsorg: 'PS', recfm: 'FB', lrecl: 80 })
  );
}

let mockDir: string;

beforeAll(async () => {
  mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-response-cache-'));
  await createMockData(mockDir);
});

afterAll(async () => {
  await fs.rm(mockDir, { recursive: true, force: true });
});

describe('Response cache', () => {
  it('calls backend listDatasets once when paginating (same params, different offset)', async () => {
    const innerBackend = new FilesystemMockBackend(mockDir);
    const countingBackend = new CountingBackend(innerBackend);
    const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
    const systemRegistry = new SystemRegistry();
    for (const sys of mockConfig.systems) {
      systemRegistry.register({
        host: sys.host,
        port: sys.port,
        description: sys.description,
      });
    }

    const server = createServer({
      backend: countingBackend,
      systemRegistry,
      credentialProvider,
      responseCache: createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const result1 = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: `${DEFAULT_USER}.*`, offset: 0, limit: 2 },
      });
      expect(result1.content).toBeDefined();

      const result2 = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: `${DEFAULT_USER}.*`, offset: 2, limit: 2 },
      });
      expect(result2.content).toBeDefined();

      expect(countingBackend.listDatasetsCallCount).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('calls backend listMembers once when paginating (same params, different offset)', async () => {
    const innerBackend = new FilesystemMockBackend(mockDir);
    const countingBackend = new CountingBackend(innerBackend);
    const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
    const systemRegistry = new SystemRegistry();
    for (const sys of mockConfig.systems) {
      systemRegistry.register({
        host: sys.host,
        port: sys.port,
        description: sys.description,
      });
    }

    const server = createServer({
      backend: countingBackend,
      systemRegistry,
      credentialProvider,
      responseCache: createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const result1 = await client.callTool({
        name: 'listMembers',
        arguments: { dsn: `${DEFAULT_USER}.SRC.COBOL`, offset: 0, limit: 2 },
      });
      expect(result1.content).toBeDefined();

      const result2 = await client.callTool({
        name: 'listMembers',
        arguments: { dsn: `${DEFAULT_USER}.SRC.COBOL`, offset: 2, limit: 2 },
      });
      expect(result2.content).toBeDefined();

      expect(countingBackend.listMembersCallCount).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('calls backend readDataset once when paging (same dsn, different startLine)', async () => {
    const innerBackend = new FilesystemMockBackend(mockDir);
    const countingBackend = new CountingBackend(innerBackend);
    const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
    const systemRegistry = new SystemRegistry();
    for (const sys of mockConfig.systems) {
      systemRegistry.register({
        host: sys.host,
        port: sys.port,
        description: sys.description,
      });
    }

    const server = createServer({
      backend: countingBackend,
      systemRegistry,
      credentialProvider,
      responseCache: createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const result1 = await client.callTool({
        name: 'readDataset',
        arguments: { dsn: `${DEFAULT_USER}.LARGE.DATA`, startLine: 1, lineCount: 10 },
      });
      expect(result1.content).toBeDefined();

      const result2 = await client.callTool({
        name: 'readDataset',
        arguments: { dsn: `${DEFAULT_USER}.LARGE.DATA`, startLine: 11, lineCount: 10 },
      });
      expect(result2.content).toBeDefined();

      expect(countingBackend.readDatasetCallCount).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('calls backend on every request when responseCache is false', async () => {
    const innerBackend = new FilesystemMockBackend(mockDir);
    const countingBackend = new CountingBackend(innerBackend);
    const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
    const systemRegistry = new SystemRegistry();
    for (const sys of mockConfig.systems) {
      systemRegistry.register({
        host: sys.host,
        port: sys.port,
        description: sys.description,
      });
    }

    const server = createServer({
      backend: countingBackend,
      systemRegistry,
      credentialProvider,
      responseCache: false,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: `${DEFAULT_USER}.*`, offset: 0, limit: 2 },
      });
      await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: `${DEFAULT_USER}.*`, offset: 2, limit: 2 },
      });

      expect(countingBackend.listDatasetsCallCount).toBe(2);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
