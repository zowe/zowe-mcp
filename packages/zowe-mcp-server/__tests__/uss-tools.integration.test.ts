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
 * Integration tests for USS tools (listUssFiles, readUssFile) via MCP with mock backend.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import type { CredentialProvider } from '../src/zos/credentials.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { SystemRegistry } from '../src/zos/system.js';

const SYSTEM_HOST = 'uss-test.example.com';
const DEFAULT_USER = 'testuser';

const mockConfig: MockSystemsConfig = {
  systems: [
    {
      host: SYSTEM_HOST,
      port: 443,
      description: 'USS test system',
      credentials: [{ user: DEFAULT_USER, password: 'pass' }],
    },
  ],
};

function getResultText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[] | undefined;
  const first = content?.[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

describe('USS tools integration', () => {
  let mockDir: string;
  let client: Client;
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-uss-'));
    await fs.writeFile(path.join(mockDir, 'systems.json'), JSON.stringify(mockConfig));
    await fs.mkdir(path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER, 'file.txt'),
      'hello from USS',
      'utf-8'
    );
    await fs.mkdir(path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER, 'subdir'), {
      recursive: true,
    });

    const backend = new FilesystemMockBackend(mockDir);
    const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
    const systemRegistry = new SystemRegistry();
    for (const sys of mockConfig.systems) {
      systemRegistry.register({
        host: sys.host,
        port: sys.port,
        description: sys.description,
      });
    }

    server = createServer({ backend, systemRegistry, credentialProvider });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'uss-test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    if (mockDir) await fs.rm(mockDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('getUssHome returns path and getContext includes ussHome', async () => {
    const homeResult = await client.callTool({
      name: 'getUssHome',
      arguments: {},
    });
    const homeText = getResultText(homeResult);
    const homeEnvelope = JSON.parse(homeText) as {
      _context: { system: string };
      data: { path: string };
    };
    expect(homeEnvelope._context.system).toBe(SYSTEM_HOST);
    expect(homeEnvelope.data.path).toBe(`/u/${DEFAULT_USER}`);

    const ctxResult = await client.callTool({
      name: 'getContext',
      arguments: {},
    });
    const ctxText = getResultText(ctxResult);
    const ctxParsed = JSON.parse(ctxText) as {
      activeSystem?: { system: string; userId: string; ussHome?: string; ussCwd?: string };
    };
    expect(ctxParsed.activeSystem?.ussHome).toBe(`/u/${DEFAULT_USER}`);
    expect(ctxParsed.activeSystem?.ussCwd).toBe(`/u/${DEFAULT_USER}`);
  });

  it('changeUssDirectory sets cwd and listUssFiles with relative path returns currentDirectory, listedDirectory, and entry.path', async () => {
    await client.callTool({ name: 'getUssHome', arguments: {} });
    const cdResult = await client.callTool({
      name: 'changeUssDirectory',
      arguments: { path: '/u/testuser' },
    });
    const cdText = getResultText(cdResult);
    const cdEnvelope = JSON.parse(cdText) as {
      _context: { system: string; currentDirectory?: string };
      data: { path: string };
    };
    expect(cdEnvelope.data.path).toBe('/u/testuser');

    const listResult = await client.callTool({
      name: 'listUssFiles',
      arguments: { path: '.' },
    });
    const listText = getResultText(listResult);
    const listEnvelope = JSON.parse(listText) as {
      _context: {
        system: string;
        currentDirectory?: string;
        listedDirectory?: string;
      };
      data: { name: string; path: string }[];
    };
    expect(listEnvelope._context.currentDirectory).toBe('.');
    expect(listEnvelope._context.listedDirectory).toBe('.');
    expect(Array.isArray(listEnvelope.data)).toBe(true);
    for (const entry of listEnvelope.data) {
      expect(entry.name).toBeDefined();
      expect(entry.path).toBeDefined();
      expect(typeof entry.path).toBe('string');
    }
    const fileEntry = listEnvelope.data.find((e: { name: string }) => e.name === 'file.txt');
    expect(fileEntry).toBeDefined();
    expect(fileEntry!.path).toBe('file.txt');
  });

  it('listUssFiles returns envelope with data, _result, currentDirectory, listedDirectory, and entry.path', async () => {
    const result = await client.callTool({
      name: 'listUssFiles',
      arguments: { path: '/u/testuser' },
    });
    const text = getResultText(result);
    expect(text).not.toBe('');
    const envelope = JSON.parse(text) as {
      _context: {
        system: string;
        currentDirectory?: string;
        listedDirectory?: string;
      };
      _result: { count: number; totalAvailable: number; hasMore: boolean };
      data: { name: string; path: string }[];
    };
    expect(envelope._context.system).toBe(SYSTEM_HOST);
    expect(envelope._context.listedDirectory).toBeDefined();
    expect(envelope._context.currentDirectory).toBeDefined();
    expect(envelope._result).toBeDefined();
    expect(envelope._result.count).toBeGreaterThanOrEqual(2);
    expect(envelope.data).toBeDefined();
    const names = envelope.data.map((e: { name: string }) => e.name);
    expect(names).toContain('file.txt');
    expect(names).toContain('subdir');
    for (const entry of envelope.data) {
      expect(entry.path).toBeDefined();
      expect(entry.path).toContain(entry.name);
    }
  });

  it('readUssFile returns envelope with text and _result', async () => {
    const result = await client.callTool({
      name: 'readUssFile',
      arguments: { path: '/u/testuser/file.txt' },
    });
    const text = getResultText(result);
    expect(text).not.toBe('');
    const envelope = JSON.parse(text) as {
      _context: { system: string };
      _result: { totalLines: number; hasMore: boolean };
      data: { text: string; etag: string };
    };
    expect(envelope._context.system).toBe(SYSTEM_HOST);
    expect(envelope.data.text).toBe('hello from USS');
    expect(envelope.data.etag).toBeDefined();
  });

  it('readUssFile with dangerous path returns error', async () => {
    const result = await client.callTool({
      name: 'readUssFile',
      arguments: { path: '/home/user/.ssh/id_rsa' },
    });
    const text = getResultText(result);
    const parsed = JSON.parse(text) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.length).toBeGreaterThan(0);
  });

  it('runSafeUssCommand allowlisted command returns output', async () => {
    const result = await client.callTool({
      name: 'runSafeUssCommand',
      arguments: { commandText: 'whoami' },
    });
    const text = getResultText(result);
    const envelope = JSON.parse(text) as { _context: { system: string }; data: { text: string } };
    expect(envelope._context.system).toBe(SYSTEM_HOST);
    expect(envelope.data.text.trim()).toBe(DEFAULT_USER);
  });

  it('runSafeUssCommand dangerous command returns error', async () => {
    const result = await client.callTool({
      name: 'runSafeUssCommand',
      arguments: { commandText: 'rm -rf ~/' },
    });
    const text = getResultText(result);
    const parsed = JSON.parse(text) as { error?: string };
    expect(parsed.error).toBeDefined();
  });

  it('runSafeUssCommand unknown command returns elicit-denied error', async () => {
    const result = await client.callTool({
      name: 'runSafeUssCommand',
      arguments: { commandText: 'mycustomscript.sh --foo' },
    });
    const text = getResultText(result);
    const parsed = JSON.parse(text) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.toLowerCase()).toContain('elicitation');
  });
});

describe('USS mutation and temp tools (mock)', () => {
  let mockDir: string;
  let client: Client;
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-uss-mut-'));
    await fs.writeFile(path.join(mockDir, 'systems.json'), JSON.stringify(mockConfig));
    await fs.mkdir(path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER), {
      recursive: true,
    });

    const backend = new FilesystemMockBackend(mockDir);
    const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
    const systemRegistry = new SystemRegistry();
    for (const sys of mockConfig.systems) {
      systemRegistry.register({
        host: sys.host,
        port: sys.port,
        description: sys.description,
      });
    }

    server = createServer({ backend, systemRegistry, credentialProvider });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'uss-mut-test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    if (mockDir) await fs.rm(mockDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('writeUssFile then readUssFile returns written content', async () => {
    const p = '/u/testuser/written.txt';
    const content = 'written by test';
    const writeResult = await client.callTool({
      name: 'writeUssFile',
      arguments: { path: p, content },
    });
    const writeText = getResultText(writeResult);
    const writeEnvelope = JSON.parse(writeText) as { error?: string; data?: { etag: string } };
    expect(writeEnvelope.error).toBeUndefined();
    expect(writeEnvelope.data?.etag).toBeDefined();

    const readResult = await client.callTool({
      name: 'readUssFile',
      arguments: { path: p },
    });
    const readText = getResultText(readResult);
    const readEnvelope = JSON.parse(readText) as { data?: { text: string } };
    expect(readEnvelope.data?.text).toBe(content);
  });

  it('createUssFile directory then listUssFiles shows it', async () => {
    const dirPath = '/u/testuser/createdir';
    const createResult = await client.callTool({
      name: 'createUssFile',
      arguments: { path: dirPath, isDirectory: true },
    });
    const createText = getResultText(createResult);
    const createEnvelope = JSON.parse(createText) as { error?: string };
    expect(createEnvelope.error).toBeUndefined();

    const listResult = await client.callTool({
      name: 'listUssFiles',
      arguments: { path: '/u/testuser' },
    });
    const listText = getResultText(listResult);
    const listEnvelope = JSON.parse(listText) as { data: { name: string }[] };
    expect(listEnvelope.data.map((e: { name: string }) => e.name)).toContain('createdir');
  });

  it('createUssFile file then readUssFile returns empty', async () => {
    const filePath = '/u/testuser/emptyfile.txt';
    await client.callTool({
      name: 'createUssFile',
      arguments: { path: filePath, isDirectory: false },
    });
    const readResult = await client.callTool({
      name: 'readUssFile',
      arguments: { path: filePath },
    });
    const readText = getResultText(readResult);
    const readEnvelope = JSON.parse(readText) as { data?: { text: string } };
    expect(readEnvelope.data?.text).toBe('');
  });

  it('deleteUssFile removes file', async () => {
    const p = '/u/testuser/to-delete.txt';
    await client.callTool({
      name: 'writeUssFile',
      arguments: { path: p, content: 'x' },
    });
    const delResult = await client.callTool({
      name: 'deleteUssFile',
      arguments: { path: p },
    });
    const delText = getResultText(delResult);
    const delEnvelope = JSON.parse(delText) as { error?: string };
    expect(delEnvelope.error).toBeUndefined();

    const listResult = await client.callTool({
      name: 'listUssFiles',
      arguments: { path: '/u/testuser' },
    });
    const listEnvelope = JSON.parse(getResultText(listResult)) as { data: { name: string }[] };
    expect(listEnvelope.data.map((e: { name: string }) => e.name)).not.toContain('to-delete.txt');
  });

  it('getUssTempDir returns path under base', async () => {
    const result = await client.callTool({
      name: 'getUssTempDir',
      arguments: { basePath: '/u/testuser/tmp' },
    });
    const text = getResultText(result);
    const envelope = JSON.parse(text) as { _context: { system: string }; data: { path: string } };
    expect(envelope._context.system).toBe(SYSTEM_HOST);
    expect(envelope.data.path).toMatch(/^\/u\/testuser\/tmp\/.+/);
  });

  it('getUssTempPath returns path under dir', async () => {
    const dirResult = await client.callTool({
      name: 'getUssTempDir',
      arguments: { basePath: '/u/testuser/tmp' },
    });
    const dirPath = (JSON.parse(getResultText(dirResult)) as { data: { path: string } }).data.path;
    const pathResult = await client.callTool({
      name: 'getUssTempPath',
      arguments: { dirPath, prefix: 'test-' },
    });
    const text = getResultText(pathResult);
    const envelope = JSON.parse(text) as { data: { path: string } };
    expect(envelope.data.path.startsWith(dirPath)).toBe(true);
    expect(envelope.data.path).toContain('test-');
  });

  it('createTempUssDir and createTempUssFile then write, list, and deleteUssTempUnderDir', async () => {
    const dirResult = await client.callTool({
      name: 'getUssTempDir',
      arguments: { basePath: '/u/testuser/tmp' },
    });
    const tempDir = (JSON.parse(getResultText(dirResult)) as { data: { path: string } }).data.path;
    await client.callTool({
      name: 'createTempUssDir',
      arguments: { path: tempDir },
    });
    const fileResult = await client.callTool({
      name: 'getUssTempPath',
      arguments: { dirPath: tempDir, prefix: 'f' },
    });
    const tempFile = (JSON.parse(getResultText(fileResult)) as { data: { path: string } }).data
      .path;
    await client.callTool({
      name: 'createTempUssFile',
      arguments: { path: tempFile },
    });
    const writeResp = await client.callTool({
      name: 'writeUssFile',
      arguments: { path: tempFile, content: 'temp content' },
    });
    const writeParsed = JSON.parse(getResultText(writeResp)) as { error?: string };
    expect(writeParsed.error).toBeUndefined();

    // listUssFiles to verify file exists (readUssFile would require elicitation for paths under tmp)
    const listResult = await client.callTool({
      name: 'listUssFiles',
      arguments: { path: tempDir },
    });
    const listParsed = JSON.parse(getResultText(listResult)) as { data: { name: string }[] };
    expect(listParsed.data.map((e: { name: string }) => e.name)).toContain(
      path.basename(tempFile)
    );

    const delResult = await client.callTool({
      name: 'deleteUssTempUnderDir',
      arguments: { path: tempDir },
    });
    const delText = getResultText(delResult);
    const delEnvelope = JSON.parse(delText) as { error?: string; data?: { deleted: string[] } };
    expect(delEnvelope.error).toBeUndefined();
    expect(delEnvelope.data?.deleted.length).toBeGreaterThan(0);
  });

  it('deleteUssTempUnderDir rejects path without tmp segment', async () => {
    const result = await client.callTool({
      name: 'deleteUssTempUnderDir',
      arguments: { path: '/u/testuser/other/xyz' },
    });
    const text = getResultText(result);
    const envelope = JSON.parse(text) as { error?: string };
    expect(envelope.error).toBeDefined();
    expect(envelope.error).toContain('tmp');
  });

  it('deleteUssTempUnderDir rejects path with too few segments', async () => {
    const result = await client.callTool({
      name: 'deleteUssTempUnderDir',
      arguments: { path: '/u/tmp' },
    });
    const text = getResultText(result);
    const envelope = JSON.parse(text) as { error?: string };
    expect(envelope.error).toBeDefined();
    expect(envelope.error).toMatch(/at least \d+ path segments/);
  });
});
