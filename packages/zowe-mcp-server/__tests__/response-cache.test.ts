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
import { createServer, getServer } from '../src/server.js';
import type {
  BackendProgressCallback,
  CreateUssFileOptions,
  DatasetAttributes,
  DatasetEntry,
  ListUssFilesOptions,
  MemberEntry,
  ReadDatasetResult,
  SearchInDatasetOptions,
  SearchInDatasetResult,
  ZosBackend,
} from '../src/zos/backend.js';
import type { CredentialProvider } from '../src/zos/credentials.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { buildScopeSystem, createResponseCache } from '../src/zos/response-cache.js';
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
    userId?: string,
    attributes?: boolean
  ): Promise<DatasetEntry[]> {
    this.listDatasetsCallCount++;
    return this.inner.listDatasets(systemId, pattern, volser, userId, attributes);
  }

  async listMembers(systemId: SystemId, dsn: string, pattern?: string): Promise<MemberEntry[]> {
    this.listMembersCallCount++;
    return this.inner.listMembers(systemId, dsn, pattern);
  }

  async readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    encoding?: string
  ): Promise<ReadDatasetResult> {
    this.readDatasetCallCount++;
    return this.inner.readDataset(systemId, dsn, member, encoding);
  }

  writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    encoding?: string,
    startLine?: number,
    endLine?: number,
    progress?: BackendProgressCallback
  ) {
    return this.inner.writeDataset(
      systemId,
      dsn,
      content,
      member,
      etag,
      encoding,
      startLine,
      endLine,
      progress
    );
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

  searchInDataset(
    systemId: SystemId,
    dsn: string,
    options: SearchInDatasetOptions,
    progress?: BackendProgressCallback
  ): Promise<SearchInDatasetResult> {
    return this.inner.searchInDataset(systemId, dsn, options, progress);
  }

  listUssFiles(
    systemId: SystemId,
    path: string,
    options?: ListUssFilesOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.listUssFiles(systemId, path, options, userId, progress);
  }

  readUssFile(
    systemId: SystemId,
    path: string,
    encoding?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.readUssFile(systemId, path, encoding, userId, progress);
  }

  writeUssFile(
    systemId: SystemId,
    path: string,
    content: string,
    etag?: string,
    encoding?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.writeUssFile(systemId, path, content, etag, encoding, userId, progress);
  }

  createUssFile(
    systemId: SystemId,
    path: string,
    options: CreateUssFileOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.createUssFile(systemId, path, options, userId, progress);
  }

  deleteUssFile(
    systemId: SystemId,
    path: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.deleteUssFile(systemId, path, recursive, userId, progress);
  }

  chmodUssFile(
    systemId: SystemId,
    path: string,
    mode: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.chmodUssFile(systemId, path, mode, recursive, userId, progress);
  }

  chownUssFile(
    systemId: SystemId,
    path: string,
    owner: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.chownUssFile(systemId, path, owner, recursive, userId, progress);
  }

  chtagUssFile(
    systemId: SystemId,
    path: string,
    tag: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.chtagUssFile(systemId, path, tag, recursive, userId, progress);
  }

  runUnixCommand(
    systemId: SystemId,
    commandText: string,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.runUnixCommand(systemId, commandText, userId, progress);
  }

  getUssHome(systemId: SystemId, userId?: string, progress?: BackendProgressCallback) {
    return this.inner.getUssHome(systemId, userId, progress);
  }

  getUssTempDir(
    systemId: SystemId,
    basePath: string,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.getUssTempDir(systemId, basePath, userId, progress);
  }

  getUssTempPath(
    systemId: SystemId,
    dirPath: string,
    prefix?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.getUssTempPath(systemId, dirPath, prefix, userId, progress);
  }

  deleteUssUnderPath(
    systemId: SystemId,
    path: string,
    userId?: string,
    progress?: BackendProgressCallback
  ) {
    return this.inner.deleteUssUnderPath(systemId, path, userId, progress);
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
  it('invalidateScope removes keys so next getOrFetch hits fetch again', async () => {
    const cache = createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 });
    const scope = buildScopeSystem('cache-test.example.com');
    let fetchCount = 0;
    const key =
      'listDatasets\x01{"attributes":"true","pattern":"TESTUSER.*","systemId":"cache-test.example.com","userId":"TESTUSER","volser":""}';

    const v1 = await cache.getOrFetch(key, () => {
      fetchCount++;
      return Promise.resolve({ items: [1, 2, 3] });
    }, [scope]);
    expect(v1.items).toEqual([1, 2, 3]);
    expect(fetchCount).toBe(1);

    cache.invalidateScope(scope);

    const v2 = await cache.getOrFetch(key, () => {
      fetchCount++;
      return Promise.resolve({ items: [4, 5, 6] });
    }, [scope]);
    expect(v2.items).toEqual([4, 5, 6]);
    expect(fetchCount).toBe(2);
  });

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

    const server = getServer(
      createServer({
        backend: countingBackend,
        systemRegistry,
        credentialProvider,
        responseCache: createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 }),
        logToolCalls: true,
      })
    );
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

    const server = getServer(
      createServer({
        backend: countingBackend,
        systemRegistry,
        credentialProvider,
        responseCache: createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 }),
        logToolCalls: true,
      })
    );
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

    const server = getServer(
      createServer({
        backend: countingBackend,
        systemRegistry,
        credentialProvider,
        responseCache: createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 }),
        logToolCalls: true,
      })
    );
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

    const server = getServer(
      createServer({
        backend: countingBackend,
        systemRegistry,
        credentialProvider,
        responseCache: false,
        logToolCalls: true,
      })
    );
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

  describe('Cache invalidation after mutations', () => {
    function setupServerWithCountingBackend(): {
      server: ReturnType<typeof createServer>;
      client: Client;
      countingBackend: CountingBackend;
    } {
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
      const server = getServer(
        createServer({
          backend: countingBackend,
          systemRegistry,
          credentialProvider,
          responseCache: createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 }),
          logToolCalls: true,
        })
      );
      const [_clientTransport, _serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test', version: '1.0.0' });
      return { server, client, countingBackend };
    }

    it('after writeDataset full replace, next readDataset returns updated content from cache', async () => {
      const { server, client, countingBackend } = setupServerWithCountingBackend();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      await new Promise(resolve => setTimeout(resolve, 50));

      try {
        await client.callTool({
          name: 'readDataset',
          arguments: { dsn: `${DEFAULT_USER}.LARGE.DATA`, startLine: 1, lineCount: 5 },
        });
        expect(countingBackend.readDatasetCallCount).toBe(1);

        const newContent = 'UPDATED_LINE_1\nUPDATED_LINE_2';
        await client.callTool({
          name: 'writeDataset',
          arguments: {
            dsn: `${DEFAULT_USER}.LARGE.DATA`,
            content: newContent,
          },
        });

        const readResult = await client.callTool({
          name: 'readDataset',
          arguments: { dsn: `${DEFAULT_USER}.LARGE.DATA`, startLine: 1, lineCount: 10 },
        });
        expect(countingBackend.readDatasetCallCount).toBe(1);
        const content0 = Array.isArray(readResult.content)
          ? (readResult.content[0] as { text?: string } | undefined)
          : undefined;
        const envelope = JSON.parse(content0?.text ?? '{}') as { data?: { text?: string } };
        expect(envelope.data?.text).toContain('UPDATED_LINE_1');
      } finally {
        await client.close();
        await server.close();
      }
    });

    it('after deleteDataset member, listMembers and read are invalidated', async () => {
      const { server, client, countingBackend } = setupServerWithCountingBackend();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      await new Promise(resolve => setTimeout(resolve, 50));

      try {
        await client.callTool({
          name: 'listMembers',
          arguments: { dsn: `${DEFAULT_USER}.SRC.COBOL`, offset: 0, limit: 10 },
        });
        expect(countingBackend.listMembersCallCount).toBe(1);

        await client.callTool({
          name: 'deleteDataset',
          arguments: { dsn: `${DEFAULT_USER}.SRC.COBOL`, member: 'MEM3' },
        });

        await client.callTool({
          name: 'listMembers',
          arguments: { dsn: `${DEFAULT_USER}.SRC.COBOL`, offset: 0, limit: 10 },
        });
        expect(countingBackend.listMembersCallCount).toBe(2);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it('after renameDataset, old and new dsn scopes are invalidated', async () => {
      const { server, client, countingBackend } = setupServerWithCountingBackend();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      await new Promise(resolve => setTimeout(resolve, 50));

      try {
        await client.callTool({
          name: 'createDataset',
          arguments: {
            dsn: `${DEFAULT_USER}.CACHE.OLD`,
            type: 'PS',
            primary: 1,
          },
        });
        await client.callTool({
          name: 'writeDataset',
          arguments: { dsn: `${DEFAULT_USER}.CACHE.OLD`, content: 'original' },
        });
        await client.callTool({
          name: 'readDataset',
          arguments: { dsn: `${DEFAULT_USER}.CACHE.OLD` },
        });
        expect(countingBackend.readDatasetCallCount).toBe(0);

        await client.callTool({
          name: 'renameDataset',
          arguments: {
            dsn: `${DEFAULT_USER}.CACHE.OLD`,
            newDsn: `${DEFAULT_USER}.CACHE.NEW`,
          },
        });

        await client.callTool({
          name: 'readDataset',
          arguments: { dsn: `${DEFAULT_USER}.CACHE.NEW` },
        });
        expect(countingBackend.readDatasetCallCount).toBe(1);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it('after createDataset, listDatasets for system is invalidated', async () => {
      const cache = createResponseCache({ ttlMs: 60_000, maxSizeBytes: 10 * 1024 * 1024 });
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
      const server = getServer(
        createServer({
          backend: countingBackend,
          systemRegistry,
          credentialProvider,
          responseCache: cache,
          logToolCalls: true,
        })
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test', version: '1.0.0' });
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      await new Promise(resolve => setTimeout(resolve, 50));

      try {
        await client.callTool({
          name: 'setSystem',
          arguments: { system: SYSTEM_HOST },
        });
        await client.callTool({
          name: 'listDatasets',
          arguments: { dsnPattern: `${DEFAULT_USER}.*`, offset: 0, limit: 20 },
        });
        expect(countingBackend.listDatasetsCallCount).toBe(1);

        await client.callTool({
          name: 'createDataset',
          arguments: {
            dsn: `${DEFAULT_USER}.CACHE.CREATED`,
            type: 'PS',
            primary: 1,
          },
        });

        await client.callTool({
          name: 'listDatasets',
          arguments: { dsnPattern: `${DEFAULT_USER}.*`, offset: 0, limit: 20 },
        });
        expect(countingBackend.listDatasetsCallCount).toBe(2);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
