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
 * Integration tests for dataset tools with the mock backend.
 *
 * These tests verify:
 * - Auto-activation of a single system at server creation
 * - Lazy context initialization when the LLM skips `set_system`
 * - Pattern matching for `list_datasets` (trailing `*` → `**`)
 * - Correct DSN prefix resolution from auto-initialized context
 * - Response envelope structure (_context, _result, data)
 * - Pagination for list operations (offset, limit, hasMore)
 * - Line windowing for read operations (startLine, lineCount, auto-truncation)
 * - Single-quote convention on resolvedPattern / resolvedDsn
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import type {
  ListResultMeta,
  ReadResultMeta,
  ToolResponseEnvelope,
} from '../src/tools/response.js';
import type { CredentialProvider } from '../src/zos/credentials.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { SystemRegistry } from '../src/zos/system.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parsed tool result content. */
interface ToolContent {
  type: string;
  text: string;
}

/** The subset of callTool result we use. */
type ToolResult = Awaited<ReturnType<Client['callTool']>>;

/** Extract the text content from a tool call result. */
function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

/** Parse the envelope from a tool call result. */
function parseEnvelope<T>(result: ToolResult): ToolResponseEnvelope<T> {
  return JSON.parse(getResultText(result)) as ToolResponseEnvelope<T>;
}

/** Parse just the data from an envelope result. */
function parseData<T>(result: ToolResult): T {
  return parseEnvelope<T>(result).data;
}

// ---------------------------------------------------------------------------
// Mock data setup
// ---------------------------------------------------------------------------

const SYSTEM_HOST = 'test-system.example.com';
const DEFAULT_USER = 'TESTUSER';

const mockConfig: MockSystemsConfig = {
  systems: [
    {
      host: SYSTEM_HOST,
      port: 443,
      description: 'Test system',
      credentials: [{ user: DEFAULT_USER, password: 'pass' }],
    },
  ],
};

const twoSystemConfig: MockSystemsConfig = {
  systems: [
    {
      host: 'sys1.example.com',
      port: 443,
      description: 'System 1',
      credentials: [{ user: 'USER1', password: 'pass1' }],
    },
    {
      host: 'sys2.example.com',
      port: 443,
      description: 'System 2',
      credentials: [{ user: 'USER2', password: 'pass2' }],
    },
  ],
};

let mockDir: string;

/** Create a minimal mock data directory with known datasets. */
async function createMockData(dir: string, systemHost: string, user: string): Promise<void> {
  // Write systems.json
  await fs.writeFile(path.join(dir, 'systems.json'), JSON.stringify(mockConfig));

  // Create system directory
  const sysDir = path.join(dir, systemHost);
  await fs.mkdir(sysDir, { recursive: true });

  // Create HLQ directory
  const hlqDir = path.join(sysDir, user);
  await fs.mkdir(hlqDir, { recursive: true });

  // Create a sequential dataset (file)
  const seqPath = path.join(hlqDir, 'DATA.INPUT');
  await fs.writeFile(seqPath, 'HELLO WORLD');
  await fs.writeFile(
    path.join(hlqDir, 'DATA.INPUT_meta.json'),
    JSON.stringify({ dsn: `${user}.DATA.INPUT`, dsorg: 'PS', recfm: 'FB', lrecl: 80 })
  );

  // Create a PDS (directory) with members
  const pdsDir = path.join(hlqDir, 'SRC.COBOL');
  await fs.mkdir(pdsDir, { recursive: true });
  await fs.writeFile(path.join(pdsDir, 'MAIN'), '       IDENTIFICATION DIVISION.\n');
  await fs.writeFile(path.join(pdsDir, 'UTIL'), '       IDENTIFICATION DIVISION.\n');
  await fs.writeFile(
    path.join(pdsDir, '_meta.json'),
    JSON.stringify({ dsn: `${user}.SRC.COBOL`, dsorg: 'PO-E', recfm: 'FB', lrecl: 80 })
  );

  // Create another PDS
  const jclDir = path.join(hlqDir, 'JCL.CNTL');
  await fs.mkdir(jclDir, { recursive: true });
  await fs.writeFile(path.join(jclDir, 'RUNJOB'), '//RUNJOB JOB ...\n');
  await fs.writeFile(
    path.join(jclDir, '_meta.json'),
    JSON.stringify({ dsn: `${user}.JCL.CNTL`, dsorg: 'PO-E', recfm: 'FB', lrecl: 80 })
  );

  // Create a 2-qualifier sequential dataset
  const twoQualPath = path.join(hlqDir, 'LOAD');
  await fs.writeFile(twoQualPath, 'binary data');
  await fs.writeFile(
    path.join(hlqDir, 'LOAD_meta.json'),
    JSON.stringify({ dsn: `${user}.LOAD`, dsorg: 'PS', recfm: 'U', lrecl: 0 })
  );

  // Create a multi-line dataset for windowing tests
  const lines = Array.from({ length: 50 }, (_, i) => `LINE ${String(i + 1).padStart(3, '0')}`);
  const multiLinePath = path.join(hlqDir, 'LARGE.DATA');
  await fs.writeFile(multiLinePath, lines.join('\n'));
  await fs.writeFile(
    path.join(hlqDir, 'LARGE.DATA_meta.json'),
    JSON.stringify({ dsn: `${user}.LARGE.DATA`, dsorg: 'PS', recfm: 'FB', lrecl: 80 })
  );
}

/** Create a server with mock backend, connect a client, return both. */
async function createMockServer(
  dir: string,
  config: MockSystemsConfig
): Promise<{
  client: Client;
  server: McpServer;
}> {
  const backend = new FilesystemMockBackend(dir);
  const credentialProvider: CredentialProvider = new MockCredentialProvider(config);
  const systemRegistry = new SystemRegistry();
  for (const sys of config.systems) {
    systemRegistry.register({ host: sys.host, port: sys.port, description: sys.description });
  }

  const server = createServer({ backend, systemRegistry, credentialProvider });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  // Allow the async auto-activation to complete
  await new Promise(resolve => setTimeout(resolve, 50));

  return { client, server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeAll(async () => {
  mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-test-'));
  await createMockData(mockDir, SYSTEM_HOST, DEFAULT_USER);
});

afterAll(async () => {
  await fs.rm(mockDir, { recursive: true, force: true });
});

describe('Dataset tools with mock backend', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    ({ client, server } = await createMockServer(mockDir, mockConfig));
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  // -----------------------------------------------------------------------
  // Auto-activation of single system
  // -----------------------------------------------------------------------
  describe('auto-activation of single system', () => {
    it('should auto-activate the only system so set_system is not required', async () => {
      const result = await client.callTool({ name: 'get_context', arguments: {} });
      const ctx = JSON.parse(getResultText(result)) as {
        activeSystem: { system: string; userId: string; dsnPrefix: string } | null;
      };

      expect(ctx.activeSystem).not.toBeNull();
      expect(ctx.activeSystem!.system).toBe(SYSTEM_HOST);
      expect(ctx.activeSystem!.userId).toBe(DEFAULT_USER);
      expect(ctx.activeSystem!.dsnPrefix).toBe(DEFAULT_USER);
    });

    it('should register all z/OS tools when backend is provided', async () => {
      const { tools } = await client.listTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('info');
      expect(toolNames).toContain('list_datasets');
      expect(toolNames).toContain('list_members');
      expect(toolNames).toContain('read_dataset');
      expect(toolNames).toContain('set_system');
      expect(toolNames).toContain('get_context');
    });

    it('should NOT auto-activate when multiple systems are configured', async () => {
      const twoSysClient = await createMockServer(mockDir, twoSystemConfig);

      try {
        const result = await twoSysClient.client.callTool({
          name: 'get_context',
          arguments: {},
        });
        const ctx = JSON.parse(getResultText(result)) as {
          activeSystem: { system: string } | null;
        };

        expect(ctx.activeSystem).toBeNull();
      } finally {
        await twoSysClient.client.close();
        await twoSysClient.server.close();
      }
    });

    it('should return allSystems from registry and recentlyUsedSystems with context', async () => {
      const result = await client.callTool({ name: 'get_context', arguments: {} });
      const ctx = JSON.parse(getResultText(result)) as {
        activeSystem: { system: string; userId: string; dsnPrefix: string } | null;
        allSystems: { host: string; description?: string; active: boolean }[];
        recentlyUsedSystems: { system: string; userId: string; dsnPrefix: string }[];
      };

      expect(ctx.allSystems).toHaveLength(1);
      expect(ctx.allSystems[0].host).toBe(SYSTEM_HOST);
      expect(ctx.allSystems[0].active).toBe(true);

      expect(ctx.recentlyUsedSystems).toHaveLength(1);
      expect(ctx.recentlyUsedSystems[0].system).toBe(SYSTEM_HOST);
      expect(ctx.recentlyUsedSystems[0].userId).toBe(DEFAULT_USER);
      expect(ctx.recentlyUsedSystems[0].dsnPrefix).toBe(DEFAULT_USER);
    });
  });

  // -----------------------------------------------------------------------
  // set_dsn_prefix and set_system behavior
  // -----------------------------------------------------------------------
  describe('set_dsn_prefix and set_system', () => {
    it('should strip trailing dot from set_dsn_prefix and return message', async () => {
      const result = await client.callTool({
        name: 'set_dsn_prefix',
        arguments: { prefix: 'IBMUSER.' },
      });
      const body = JSON.parse(getResultText(result)) as {
        dsnPrefix: string;
        messages: string[];
      };
      expect(body.dsnPrefix).toBe('IBMUSER');
      expect(body.messages).toEqual([
        'Trailing dot removed from DSN prefix. DSN prefix can be only full DSN segments.',
      ]);
    });

    it('should not add message when set_dsn_prefix has no trailing dot', async () => {
      const result = await client.callTool({
        name: 'set_dsn_prefix',
        arguments: { prefix: 'IBMUSER' },
      });
      const body = JSON.parse(getResultText(result)) as { messages: string[] };
      expect(body.messages).toEqual([]);
    });

    it('should resolve unqualified hostname in set_system when unambiguous', async () => {
      const result = await client.callTool({
        name: 'set_system',
        arguments: { system: 'test-system' },
      });
      const body = JSON.parse(getResultText(result)) as {
        activeSystem: string;
        messages: string[];
      };
      expect(body.activeSystem).toBe(SYSTEM_HOST);
      expect(body.messages).toEqual(["System resolved from unqualified name 'test-system'."]);
    });
  });

  // -----------------------------------------------------------------------
  // Response envelope structure
  // -----------------------------------------------------------------------
  describe('response envelope structure', () => {
    it('should wrap list_datasets response in envelope with _context and _result', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*' },
      });

      const envelope = parseEnvelope<{ dsn: string }[]>(result);

      // _context
      expect(envelope._context).toBeDefined();
      expect(envelope._context.system).toBe(SYSTEM_HOST);
      expect(envelope._context.dsnPrefix).toBe(DEFAULT_USER);
      expect(envelope._context.resolvedPattern).toBe("'TESTUSER.*'");

      // _result (list metadata)
      expect(envelope._result).toBeDefined();
      const meta = envelope._result as ListResultMeta;
      expect(meta.count).toBeGreaterThanOrEqual(3);
      expect(meta.totalAvailable).toBeGreaterThanOrEqual(3);
      expect(meta.offset).toBe(0);
      expect(meta.hasMore).toBe(false);

      // data
      expect(Array.isArray(envelope.data)).toBe(true);
      expect(envelope.data.length).toBe(meta.count);
    });

    it('should use resolvedDsn for list_members envelope', async () => {
      const result = await client.callTool({
        name: 'list_members',
        arguments: { dsn: 'SRC.COBOL' },
      });

      const envelope = parseEnvelope<{ member: string }[]>(result);
      expect(envelope._context.resolvedDsn).toBe("'TESTUSER.SRC.COBOL'");
      expect(envelope._context.dsnPrefix).toBe(DEFAULT_USER);
      expect(envelope._context.resolvedPattern).toBeUndefined();
    });

    it('should use resolvedDsn for read_dataset envelope', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: 'DATA.INPUT' },
      });

      const envelope = parseEnvelope<{ text: string }>(result);
      expect(envelope._context.resolvedDsn).toBe("'TESTUSER.DATA.INPUT'");
      expect(envelope._context.dsnPrefix).toBe(DEFAULT_USER);
    });

    it('should omit dsnPrefix for absolute input', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.*'" },
      });

      const envelope = parseEnvelope<unknown[]>(result);
      expect(envelope._context.dsnPrefix).toBeUndefined();
      expect(envelope._context.resolvedPattern).toBe("'TESTUSER.*'");
    });
  });

  // -----------------------------------------------------------------------
  // Single-quote convention on resolved values
  // -----------------------------------------------------------------------
  describe('single-quote convention', () => {
    it('should single-quote resolvedPattern for relative pattern', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*' },
      });

      const ctx = parseEnvelope<unknown>(result)._context;
      expect(ctx.resolvedPattern).toBe("'TESTUSER.*'");
    });

    it('should single-quote resolvedPattern for absolute pattern', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.SRC.*'" },
      });

      const ctx = parseEnvelope<unknown>(result)._context;
      expect(ctx.resolvedPattern).toBe("'TESTUSER.SRC.*'");
    });

    it('should single-quote resolvedDsn for relative dataset name', async () => {
      const result = await client.callTool({
        name: 'list_members',
        arguments: { dsn: 'SRC.COBOL' },
      });

      const ctx = parseEnvelope<unknown>(result)._context;
      expect(ctx.resolvedDsn).toBe("'TESTUSER.SRC.COBOL'");
    });

    it('should single-quote resolvedDsn for absolute dataset name', async () => {
      const result = await client.callTool({
        name: 'list_members',
        arguments: { dsn: "'TESTUSER.SRC.COBOL'" },
      });

      const ctx = parseEnvelope<unknown>(result)._context;
      expect(ctx.resolvedDsn).toBe("'TESTUSER.SRC.COBOL'");
      expect(ctx.dsnPrefix).toBeUndefined();
    });

    it('should single-quote resolvedDsn with member for read_dataset', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: 'SRC.COBOL', member: 'MAIN' },
      });

      const ctx = parseEnvelope<unknown>(result)._context;
      expect(ctx.resolvedDsn).toBe("'TESTUSER.SRC.COBOL(MAIN)'");
    });
  });

  // -----------------------------------------------------------------------
  // list_datasets with auto-activated system
  // -----------------------------------------------------------------------
  describe('list_datasets with auto-activated system', () => {
    it('should list datasets with relative pattern "*" (resolved to TESTUSER.*)', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*' },
      });

      const data = parseData<{ dsn: string }[]>(result);
      expect(data.length).toBeGreaterThanOrEqual(3);

      const names = data.map(d => d.dsn);
      expect(names).toContain('TESTUSER.DATA.INPUT');
      expect(names).toContain('TESTUSER.SRC.COBOL');
      expect(names).toContain('TESTUSER.JCL.CNTL');
    });

    it('should list datasets with absolute pattern "\'TESTUSER.*\'"', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.*'" },
      });

      const data = parseData<{ dsn: string }[]>(result);
      expect(data.length).toBeGreaterThanOrEqual(3);

      const names = data.map(d => d.dsn);
      expect(names).toContain('TESTUSER.DATA.INPUT');
      expect(names).toContain('TESTUSER.SRC.COBOL');
    });

    it('should include 2-qualifier datasets in trailing * results', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.*'" },
      });

      const data = parseData<{ dsn: string }[]>(result);
      const names = data.map(d => d.dsn);
      expect(names).toContain('TESTUSER.LOAD');
    });

    it('should match specific qualifier patterns', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: 'SRC.*' },
      });

      const data = parseData<{ dsn: string }[]>(result);
      const names = data.map(d => d.dsn);
      expect(names).toContain('TESTUSER.SRC.COBOL');
      expect(names).not.toContain('TESTUSER.JCL.CNTL');
    });

    it('should return empty data array for non-matching pattern', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'NONEXIST.*'" },
      });

      const envelope = parseEnvelope<{ dsn: string }[]>(result);
      expect(envelope.data).toHaveLength(0);
      const meta = envelope._result as ListResultMeta;
      expect(meta.count).toBe(0);
      expect(meta.totalAvailable).toBe(0);
      expect(meta.hasMore).toBe(false);
    });

    it('should include resource_link in results', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*' },
      });

      const data = parseData<{ dsn: string; resourceLink: string }[]>(result);
      for (const ds of data) {
        expect(ds.resourceLink).toContain('zos-ds://');
        expect(ds.resourceLink).toContain(SYSTEM_HOST);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Pagination for list operations
  // -----------------------------------------------------------------------
  describe('pagination', () => {
    it('should respect limit parameter for list_datasets', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*', limit: 2 },
      });

      const envelope = parseEnvelope<{ dsn: string }[]>(result);
      const meta = envelope._result as ListResultMeta;
      expect(envelope.data.length).toBe(2);
      expect(meta.count).toBe(2);
      expect(meta.totalAvailable).toBeGreaterThan(2);
      expect(meta.offset).toBe(0);
      expect(meta.hasMore).toBe(true);
    });

    it('should respect offset parameter for list_datasets', async () => {
      // First get all datasets
      const allResult = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*' },
      });
      const allData = parseData<{ dsn: string }[]>(allResult);

      // Now get with offset=2
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*', offset: 2, limit: 2 },
      });

      const envelope = parseEnvelope<{ dsn: string }[]>(result);
      const meta = envelope._result as ListResultMeta;
      expect(meta.offset).toBe(2);
      expect(meta.totalAvailable).toBe(allData.length);

      // The first item at offset=2 should be the third item from the full list
      if (allData.length > 2) {
        expect(envelope.data[0].dsn).toBe(allData[2].dsn);
      }
    });

    it('should return hasMore=false when all items fit in one page', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*', limit: 1000 },
      });

      const meta = parseEnvelope<unknown>(result)._result as ListResultMeta;
      expect(meta.hasMore).toBe(false);
      expect(meta.count).toBe(meta.totalAvailable);
    });

    it('should paginate list_members', async () => {
      const result = await client.callTool({
        name: 'list_members',
        arguments: { dsn: 'SRC.COBOL', limit: 1 },
      });

      const envelope = parseEnvelope<{ member: string }[]>(result);
      const meta = envelope._result as ListResultMeta;
      expect(envelope.data.length).toBe(1);
      expect(meta.count).toBe(1);
      expect(meta.totalAvailable).toBe(2); // MAIN and UTIL
      expect(meta.hasMore).toBe(true);
    });

    it('should return second page of list_members', async () => {
      const result = await client.callTool({
        name: 'list_members',
        arguments: { dsn: 'SRC.COBOL', offset: 1, limit: 1 },
      });

      const envelope = parseEnvelope<{ member: string }[]>(result);
      const meta = envelope._result as ListResultMeta;
      expect(envelope.data.length).toBe(1);
      expect(meta.offset).toBe(1);
      expect(meta.hasMore).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Line windowing for read_dataset
  // -----------------------------------------------------------------------
  describe('line windowing', () => {
    it('should return full content for small files', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: 'DATA.INPUT' },
      });

      const envelope = parseEnvelope<{ text: string; etag: string; codepage: string }>(result);
      const meta = envelope._result as ReadResultMeta;
      expect(meta.totalLines).toBeGreaterThanOrEqual(1);
      expect(meta.startLine).toBe(1);
      expect(meta.returnedLines).toBe(meta.totalLines);
      expect(meta.contentLength).toBeGreaterThan(0);
      expect(meta.mimeType).toBeDefined();
      expect(envelope.data.text).toContain('HELLO WORLD');
      expect(envelope.data.etag).toBeDefined();
      expect(envelope.data.codepage).toBeDefined();
    });

    it('should support startLine parameter', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: 'LARGE.DATA', startLine: 10, lineCount: 5 },
      });

      const envelope = parseEnvelope<{ text: string }>(result);
      const meta = envelope._result as ReadResultMeta;
      expect(meta.startLine).toBe(10);
      expect(meta.returnedLines).toBe(5);
      expect(meta.totalLines).toBe(50);
      // Verify content starts at line 10
      expect(envelope.data.text).toContain('LINE 010');
      expect(envelope.data.text).not.toContain('LINE 001');
    });

    it('should support lineCount parameter', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: 'LARGE.DATA', lineCount: 3 },
      });

      const envelope = parseEnvelope<{ text: string }>(result);
      const meta = envelope._result as ReadResultMeta;
      expect(meta.startLine).toBe(1);
      expect(meta.returnedLines).toBe(3);
      expect(meta.totalLines).toBe(50);
    });

    it('should include mimeType in read result', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: 'SRC.COBOL', member: 'MAIN' },
      });

      const meta = parseEnvelope<unknown>(result)._result as ReadResultMeta;
      expect(meta.mimeType).toBeDefined();
      expect(typeof meta.mimeType).toBe('string');
    });

    it('should return correct contentLength', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: 'LARGE.DATA', startLine: 1, lineCount: 5 },
      });

      const envelope = parseEnvelope<{ text: string }>(result);
      const meta = envelope._result as ReadResultMeta;
      expect(meta.contentLength).toBe(envelope.data.text.length);
    });
  });

  // -----------------------------------------------------------------------
  // Lazy context initialization with explicit system parameter
  // -----------------------------------------------------------------------
  describe('lazy context initialization', () => {
    it('should work with explicit system parameter without prior set_system', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.*'", system: SYSTEM_HOST },
      });

      const data = parseData<{ dsn: string }[]>(result);
      expect(data.length).toBeGreaterThanOrEqual(3);
    });

    it('should lazily initialize context for read_dataset with explicit system', async () => {
      const result = await client.callTool({
        name: 'read_dataset',
        arguments: { dsn: "'TESTUSER.DATA.INPUT'", system: SYSTEM_HOST },
      });

      const envelope = parseEnvelope<{ text: string }>(result);
      expect(envelope.data.text).toContain('HELLO WORLD');
      expect(envelope._context.system).toBe(SYSTEM_HOST);
    });

    it('should lazily initialize context for list_members with explicit system', async () => {
      const result = await client.callTool({
        name: 'list_members',
        arguments: { dsn: "'TESTUSER.SRC.COBOL'", system: SYSTEM_HOST },
      });

      const data = parseData<{ member: string }[]>(result);
      const members = data.map(m => m.member);
      expect(members).toContain('MAIN');
      expect(members).toContain('UTIL');
    });
  });

  // -----------------------------------------------------------------------
  // Lazy context for multi-system setup (no auto-activation)
  // -----------------------------------------------------------------------
  describe('lazy context with multi-system setup', () => {
    let multiClient: Client;
    let multiServer: McpServer;

    beforeEach(async () => {
      ({ client: multiClient, server: multiServer } = await createMockServer(
        mockDir,
        twoSystemConfig
      ));
    });

    afterEach(async () => {
      await multiClient.close();
      await multiServer.close();
    });

    it('should fail list_datasets without system when no system is active', async () => {
      const multiResult = await multiClient.callTool({
        name: 'list_datasets',
        arguments: { pattern: '*' },
      });

      const text = getResultText(multiResult);
      expect(text).toContain('No active z/OS system');
    });

    it('should lazily initialize context when explicit system is provided in multi-system setup', async () => {
      const result = await multiClient.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'USER1.*'", system: 'sys1.example.com' },
      });

      const data = parseData<{ dsn: string }[]>(result);
      expect(Array.isArray(data)).toBe(true);
    });

    it('should set active system after lazy initialization', async () => {
      await multiClient.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'USER1.*'", system: 'sys1.example.com' },
      });

      const ctxResult = await multiClient.callTool({
        name: 'get_context',
        arguments: {},
      });
      const ctx = JSON.parse(getResultText(ctxResult)) as {
        activeSystem: { system: string; userId: string; dsnPrefix: string } | null;
      };

      expect(ctx.activeSystem).not.toBeNull();
      expect(ctx.activeSystem!.system).toBe('sys1.example.com');
      expect(ctx.activeSystem!.userId).toBe('USER1');
      expect(ctx.activeSystem!.dsnPrefix).toBe('USER1');
    });
  });

  // -----------------------------------------------------------------------
  // Pattern matching edge cases (integration level)
  // -----------------------------------------------------------------------
  describe('pattern matching integration', () => {
    it('should match ** explicitly across qualifiers', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.**'" },
      });

      const data = parseData<{ dsn: string }[]>(result);
      expect(data.length).toBeGreaterThanOrEqual(3);
    });

    it('should match partial qualifier with *', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.SRC.*'" },
      });

      const data = parseData<{ dsn: string }[]>(result);
      const names = data.map(d => d.dsn);
      expect(names).toContain('TESTUSER.SRC.COBOL');
      expect(names).not.toContain('TESTUSER.JCL.CNTL');
    });

    it('should match with wildcard in middle qualifier', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'TESTUSER.*.COBOL'" },
      });

      const data = parseData<{ dsn: string }[]>(result);
      const names = data.map(d => d.dsn);
      expect(names).toContain('TESTUSER.SRC.COBOL');
      expect(names).not.toContain('TESTUSER.JCL.CNTL');
      expect(names).not.toContain('TESTUSER.DATA.INPUT');
    });

    it('should handle case-insensitive pattern matching', async () => {
      const result = await client.callTool({
        name: 'list_datasets',
        arguments: { pattern: "'testuser.*'" },
      });

      const data = parseData<{ dsn: string }[]>(result);
      expect(data.length).toBeGreaterThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // create_dataset allocation and messages
  // -----------------------------------------------------------------------
  describe('create_dataset allocation', () => {
    it('should return applied allocation attributes and messages for defaults', async () => {
      const result = await client.callTool({
        name: 'create_dataset',
        arguments: { dsn: 'NEW.PS.DATA', type: 'PS' },
      });

      const envelope = parseEnvelope<{
        dsn: string;
        type: string;
        allocation: { applied: Record<string, unknown>; messages: string[] };
      }>(result);
      expect(envelope._context.resolvedDsn).toBe("'TESTUSER.NEW.PS.DATA'");
      expect(envelope.data.dsn).toBe("'TESTUSER.NEW.PS.DATA'");
      expect(envelope.data.type).toBe('PS');
      expect(envelope.data.allocation).toBeDefined();
      expect(envelope.data.allocation.applied).toBeDefined();
      expect(envelope.data.allocation.applied.dsorg).toBe('PS');
      expect(envelope.data.allocation.applied.recfm).toBe('FB');
      expect(envelope.data.allocation.applied.lrecl).toBe(80);
      expect(envelope.data.allocation.applied.blksz).toBe(27920);
      expect(envelope.data.allocation.applied.volser).toBe('VOL001');
      expect(envelope.data.allocation.messages).toContain('recfm defaulted to FB.');
      expect(envelope.data.allocation.messages).toContain('lrecl defaulted to 80.');
      expect(envelope.data.allocation.messages).toContain('blksz defaulted to 27920.');
      expect(envelope.data.allocation.messages).toContain('Volume VOL001 assigned by storage.');
      expect(envelope.messages).toEqual(envelope.data.allocation.messages);
    });

    it('should describe dirblk default for PDS and include allocation in response', async () => {
      const result = await client.callTool({
        name: 'create_dataset',
        arguments: { dsn: 'NEW.PDS.LIB', type: 'PO' },
      });

      const envelope = parseEnvelope<{
        dsn: string;
        type: string;
        allocation: { applied: Record<string, unknown>; messages: string[] };
      }>(result);
      expect(envelope.data.allocation.applied.dsorg).toBe('PO');
      expect(envelope.data.allocation.applied.dirblk).toBe(5);
      expect(envelope.data.allocation.messages).toContain(
        'dirblk defaulted to 5 for partitioned dataset.'
      );
    });
  });

  // -----------------------------------------------------------------------
  // get_dataset_attributes envelope
  // -----------------------------------------------------------------------
  describe('get_dataset_attributes envelope', () => {
    it('should wrap attributes in envelope with _context and no _result', async () => {
      const result = await client.callTool({
        name: 'get_dataset_attributes',
        arguments: { dsn: 'SRC.COBOL' },
      });

      const envelope = parseEnvelope<{ dsn: string; type: string }>(result);
      expect(envelope._context.system).toBe(SYSTEM_HOST);
      expect(envelope._context.resolvedDsn).toBe("'TESTUSER.SRC.COBOL'");
      expect(envelope._context.dsnPrefix).toBe(DEFAULT_USER);
      expect(envelope._result).toBeUndefined();
      expect(envelope.data.dsn).toBe("'TESTUSER.SRC.COBOL'");
      expect(envelope.data.type).toBe('PO-E');
    });
  });
});
