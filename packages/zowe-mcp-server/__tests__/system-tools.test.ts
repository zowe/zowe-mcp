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
 * Integration tests for the z/OS system information tools (listApf, listProclib,
 * listLinklist, viewSyslog) against the filesystem mock backend (which returns
 * canned data).
 *
 * Verifies: tool registration + outputSchema, envelope shape, list pagination
 * (listApf/listProclib/listLinklist), syslog line-windowing (viewSyslog), and
 * the date/secondsAgo mutual-exclusivity guard.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, getServer } from '../src/server.js';
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

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function parseEnvelope<T>(result: ToolResult): ToolResponseEnvelope<T> {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text) as ToolResponseEnvelope<T>;
}

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

let mockDir: string;

async function createMockServer(): Promise<{ client: Client; server: McpServer }> {
  const backend = new FilesystemMockBackend(mockDir);
  const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
  const systemRegistry = new SystemRegistry();
  for (const sys of mockConfig.systems) {
    systemRegistry.register({ host: sys.host, port: sys.port, description: sys.description });
  }
  const server = getServer(
    createServer({ backend, systemRegistry, credentialProvider, capabilityTier: 'full' })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  // Allow async auto-activation of the single system to complete.
  await new Promise(resolve => setTimeout(resolve, 50));
  return { client, server };
}

beforeAll(async () => {
  mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-system-test-'));
  await fs.writeFile(path.join(mockDir, 'systems.json'), JSON.stringify(mockConfig));
  await fs.mkdir(path.join(mockDir, SYSTEM_HOST), { recursive: true });
});

afterAll(async () => {
  await fs.rm(mockDir, { recursive: true, force: true });
});

describe('System information tools with mock backend', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    ({ client, server } = await createMockServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('registers listApf, listProclib, listLinklist, and viewSyslog with output schemas', async () => {
    const { tools } = await client.listTools();
    for (const name of ['listApf', 'listProclib', 'listLinklist', 'viewSyslog']) {
      const tool = tools.find(t => t.name === name);
      expect(tool, `tool ${name} should be registered`).toBeDefined();
      expect(tool!.outputSchema).toBeDefined();
      expect(tool!.outputSchema).toHaveProperty('type', 'object');
    }
  });

  it('lists system as a component in getContext', async () => {
    const result = await client.callTool({ name: 'getContext', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const ctx = JSON.parse(content[0].text) as { server: { components: string[] } };
    expect(ctx.server.components).toContain('system');
  });

  // -----------------------------------------------------------------------
  // listApf
  // -----------------------------------------------------------------------
  describe('listApf', () => {
    it('returns APF data sets with dsname and volume', async () => {
      const result = await client.callTool({ name: 'listApf', arguments: {} });
      const env = parseEnvelope<{ items: { dsname: string; volume: string }[] }>(result);
      expect(env._context.system).toBe(SYSTEM_HOST);
      expect(env.data.items.length).toBeGreaterThan(0);
      expect(env.data.items[0]).toHaveProperty('dsname');
      expect(env.data.items[0]).toHaveProperty('volume');
      expect(env.data.items.some(i => i.dsname === 'SYS1.LINKLIB')).toBe(true);
      const meta = env._result as ListResultMeta;
      expect(meta.totalAvailable).toBe(env.data.items.length);
      expect(meta.hasMore).toBe(false);
    });

    it('paginates with offset and limit', async () => {
      const result = await client.callTool({ name: 'listApf', arguments: { limit: 2 } });
      const env = parseEnvelope<{ items: unknown[] }>(result);
      const meta = env._result as ListResultMeta;
      expect(env.data.items).toHaveLength(2);
      expect(meta.count).toBe(2);
      expect(meta.hasMore).toBe(true);
      expect(env.messages?.[0]).toMatch(/offset=2/);
    });
  });

  // -----------------------------------------------------------------------
  // listProclib
  // -----------------------------------------------------------------------
  describe('listProclib', () => {
    it('returns proclib data set names', async () => {
      const result = await client.callTool({ name: 'listProclib', arguments: {} });
      const env = parseEnvelope<{ items: string[] }>(result);
      expect(env.data.items).toContain('SYS1.PROCLIB');
      const meta = env._result as ListResultMeta;
      expect(meta.totalAvailable).toBe(env.data.items.length);
    });
  });

  // -----------------------------------------------------------------------
  // listLinklist
  // -----------------------------------------------------------------------
  describe('listLinklist', () => {
    it('returns link list data sets with dsname, volume, and apf', async () => {
      const result = await client.callTool({ name: 'listLinklist', arguments: {} });
      const env = parseEnvelope<{ items: { dsname: string; volume: string; apf: boolean }[] }>(
        result
      );
      expect(env._context.system).toBe(SYSTEM_HOST);
      expect(env.data.items.length).toBeGreaterThan(0);
      expect(env.data.items[0]).toHaveProperty('dsname');
      expect(env.data.items[0]).toHaveProperty('volume');
      expect(env.data.items[0]).toHaveProperty('apf');
      expect(env.data.items.some(i => i.dsname === 'SYS1.LINKLIB')).toBe(true);
      const meta = env._result as ListResultMeta;
      expect(meta.totalAvailable).toBe(env.data.items.length);
    });

    it('paginates with offset and limit', async () => {
      const result = await client.callTool({ name: 'listLinklist', arguments: { limit: 2 } });
      const env = parseEnvelope<{ items: unknown[] }>(result);
      const meta = env._result as ListResultMeta;
      expect(env.data.items).toHaveLength(2);
      expect(meta.count).toBe(2);
      expect(meta.hasMore).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // viewSyslog
  // -----------------------------------------------------------------------
  describe('viewSyslog', () => {
    it('returns syslog lines with mimeType and a line window', async () => {
      const result = await client.callTool({ name: 'viewSyslog', arguments: {} });
      const env = parseEnvelope<{ lines: string[]; mimeType: string }>(result);
      expect(env.data.lines.length).toBeGreaterThan(0);
      expect(env.data.mimeType).toBeTruthy();
      const meta = env._result as ReadResultMeta;
      expect(meta.startLine).toBe(1);
      expect(meta.returnedLines).toBe(env.data.lines.length);
    });

    it('honors maxLines (host-side read limit)', async () => {
      const result = await client.callTool({ name: 'viewSyslog', arguments: { maxLines: 3 } });
      const env = parseEnvelope<{ lines: string[] }>(result);
      expect(env.data.lines).toHaveLength(3);
    });

    it('windows output with startLine and lineCount', async () => {
      const result = await client.callTool({
        name: 'viewSyslog',
        arguments: { startLine: 2, lineCount: 2 },
      });
      const env = parseEnvelope<{ lines: string[] }>(result);
      const meta = env._result as ReadResultMeta;
      expect(meta.startLine).toBe(2);
      expect(env.data.lines).toHaveLength(2);
    });

    it('rejects date and secondsAgo together', async () => {
      const result = await client.callTool({
        name: 'viewSyslog',
        arguments: { date: '2026-06-29', secondsAgo: 300 },
      });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toMatch(/not both/i);
    });
  });
});
