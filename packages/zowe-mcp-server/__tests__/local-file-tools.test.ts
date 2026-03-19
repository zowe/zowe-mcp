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
 * Integration tests for local file upload/download tools (mock backend + fallback workspace dir).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, getServer } from '../src/server.js';
import type { ToolResponseEnvelope } from '../src/tools/response.js';
import type { CredentialProvider } from '../src/zos/credentials.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { SystemRegistry } from '../src/zos/system.js';

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
let workspaceDir: string;

interface ToolContent {
  type: string;
  text: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

function parseEnvelope<T>(result: ToolResult): ToolResponseEnvelope<T> {
  return JSON.parse(getResultText(result)) as ToolResponseEnvelope<T>;
}

/** Minimal mock layout: datasets + USS sample file (see FilesystemMockBackend.ussPath). */
async function createMockData(dir: string, systemHost: string, user: string): Promise<void> {
  await fs.writeFile(path.join(dir, 'systems.json'), JSON.stringify(mockConfig));

  const sysDir = path.join(dir, systemHost);
  await fs.mkdir(sysDir, { recursive: true });

  const hlqDir = path.join(sysDir, user);
  await fs.mkdir(hlqDir, { recursive: true });

  const seqPath = path.join(hlqDir, 'DATA.INPUT');
  await fs.writeFile(seqPath, 'HELLO WORLD');
  await fs.writeFile(
    path.join(hlqDir, 'DATA.INPUT_meta.json'),
    JSON.stringify({ dsn: `${user}.DATA.INPUT`, dsorg: 'PS', recfm: 'FB', lrecl: 80 })
  );

  const pdsDir = path.join(hlqDir, 'SRC.COBOL');
  await fs.mkdir(pdsDir, { recursive: true });
  await fs.writeFile(path.join(pdsDir, 'MAIN'), '       IDENTIFICATION DIVISION.\n');
  await fs.writeFile(
    path.join(pdsDir, '_meta.json'),
    JSON.stringify({ dsn: `${user}.SRC.COBOL`, dsorg: 'PO-E', recfm: 'FB', lrecl: 80 })
  );

  const ussRoot = path.join(dir, 'uss', systemHost, 'u', user);
  await fs.mkdir(ussRoot, { recursive: true });
  await fs.writeFile(path.join(ussRoot, 'sample.txt'), 'USS hello');
}

async function createClientWithMock(
  mockDataDir: string,
  workspace: string
): Promise<{ client: Client; server: McpServer }> {
  const backend = new FilesystemMockBackend(mockDataDir);
  const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
  const systemRegistry = new SystemRegistry();
  for (const sys of mockConfig.systems) {
    systemRegistry.register({ host: sys.host, port: sys.port, description: sys.description });
  }

  const server = getServer(
    createServer({
      backend,
      systemRegistry,
      credentialProvider,
      logToolCalls: false,
      localFilesFallbackDirectories: [workspace],
    })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'local-file-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  await new Promise(r => setTimeout(r, 50));
  return { client, server };
}

beforeAll(async () => {
  mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-localfile-mock-'));
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-localfile-ws-'));
  await createMockData(mockDir, SYSTEM_HOST, DEFAULT_USER);
});

afterAll(async () => {
  await fs.rm(mockDir, { recursive: true, force: true });
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe('Local file tools (mock backend)', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    ({ client, server } = await createClientWithMock(mockDir, workspaceDir));
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    for (const f of await fs.readdir(workspaceDir)) {
      await fs.rm(path.join(workspaceDir, f), { recursive: true, force: true });
    }
  });

  it('downloadDatasetToFile writes a PDS member to workspace file', async () => {
    const result = await client.callTool({
      name: 'downloadDatasetToFile',
      arguments: {
        dsn: `${DEFAULT_USER}.SRC.COBOL`,
        member: 'MAIN',
        localPath: 'out/main.cbl',
        system: SYSTEM_HOST,
      },
    });
    expect(result.isError).not.toBe(true);
    const outPath = path.join(workspaceDir, 'out', 'main.cbl');
    const disk = await fs.readFile(outPath, 'utf-8');
    expect(disk).toContain('IDENTIFICATION DIVISION');
  });

  it('downloadDatasetToFile writes sequential data set content to workspace file', async () => {
    const result = await client.callTool({
      name: 'downloadDatasetToFile',
      arguments: {
        dsn: `${DEFAULT_USER}.DATA.INPUT`,
        localPath: 'out/seq.txt',
        system: SYSTEM_HOST,
      },
    });
    expect(result.isError).not.toBe(true);
    const outPath = path.join(workspaceDir, 'out', 'seq.txt');
    const disk = await fs.readFile(outPath, 'utf-8');
    expect(disk).toBe('HELLO WORLD');

    const env = parseEnvelope<{ bytesWritten: number; dsn: string }>(result);
    expect(env.data.bytesWritten).toBeGreaterThan(0);
    expect(env.data.dsn).toContain('DATA.INPUT');
    expect(env._context.rootsSource).toBe('fallback');
  });

  it('downloadDatasetToFile refuses overwrite when file exists', async () => {
    const rel = 'protected.txt';
    const abs = path.join(workspaceDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, 'existing', 'utf-8');

    const result = await client.callTool({
      name: 'downloadDatasetToFile',
      arguments: {
        dsn: `${DEFAULT_USER}.DATA.INPUT`,
        localPath: rel,
        system: SYSTEM_HOST,
      },
    });
    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toContain('already exists');
  });

  it('uploadFileToDataset replaces data set content from workspace file', async () => {
    const src = path.join(workspaceDir, 'source.txt');
    await fs.writeFile(src, 'UPLOADED LINE 1\nLINE 2', 'utf-8');

    const up = await client.callTool({
      name: 'uploadFileToDataset',
      arguments: {
        localPath: 'source.txt',
        dsn: `${DEFAULT_USER}.DATA.INPUT`,
        system: SYSTEM_HOST,
      },
    });
    expect(up.isError).not.toBe(true);

    const readBack = await client.callTool({
      name: 'readDataset',
      arguments: { dsn: `${DEFAULT_USER}.DATA.INPUT`, system: SYSTEM_HOST },
    });
    expect(readBack.isError).not.toBe(true);
    const readEnv = parseEnvelope<{ lines: string[] }>(readBack);
    expect(readEnv.data.lines.join('\n')).toContain('UPLOADED LINE 1');

    await client.callTool({
      name: 'writeDataset',
      arguments: {
        dsn: `${DEFAULT_USER}.DATA.INPUT`,
        lines: ['HELLO WORLD'],
        system: SYSTEM_HOST,
      },
    });
  });

  it('downloadUssFileToFile writes USS file to workspace', async () => {
    const result = await client.callTool({
      name: 'downloadUssFileToFile',
      arguments: {
        path: `/u/${DEFAULT_USER}/sample.txt`,
        localPath: 'uss/sample.out',
        system: SYSTEM_HOST,
      },
    });
    expect(result.isError).not.toBe(true);
    const outPath = path.join(workspaceDir, 'uss', 'sample.out');
    expect(await fs.readFile(outPath, 'utf-8')).toBe('USS hello');
  });

  it('uploadFileToUssFile writes workspace file to USS path', async () => {
    await fs.writeFile(path.join(workspaceDir, 'local-uss.txt'), 'from local', 'utf-8');
    const result = await client.callTool({
      name: 'uploadFileToUssFile',
      arguments: {
        localPath: 'local-uss.txt',
        path: `/u/${DEFAULT_USER}/uploaded.txt`,
        system: SYSTEM_HOST,
      },
    });
    expect(result.isError).not.toBe(true);

    const readBack = await client.callTool({
      name: 'readUssFile',
      arguments: {
        path: `/u/${DEFAULT_USER}/uploaded.txt`,
        system: SYSTEM_HOST,
      },
    });
    expect(readBack.isError).not.toBe(true);
    const env = parseEnvelope<{ lines: string[] }>(readBack);
    expect(env.data.lines.join('\n')).toContain('from local');

    await fs.rm(path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER, 'uploaded.txt'), {
      force: true,
    });
  });

  it('downloadJobFileToFile fails on mock backend (jobs not implemented)', async () => {
    const result = await client.callTool({
      name: 'downloadJobFileToFile',
      arguments: {
        jobId: 'JOB00123',
        jobFileId: 2,
        localPath: 'job.out',
        system: SYSTEM_HOST,
      },
    });
    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(JSON.parse(text).error).toContain(
      'Jobs operations are not implemented in the mock backend'
    );
  });
});
