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
 * Integration tests for TSO tools (runSafeTsoCommand) via MCP with mock backend.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, getServer } from '../src/server.js';
import type { CredentialProvider } from '../src/zos/credentials.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { SystemRegistry } from '../src/zos/system.js';

const SYSTEM_HOST = 'tso-test.example.com';
const DEFAULT_USER = 'testuser';

const mockConfig: MockSystemsConfig = {
  systems: [
    {
      host: SYSTEM_HOST,
      port: 443,
      description: 'TSO test system',
      credentials: [{ user: DEFAULT_USER, password: 'pass' }],
    },
  ],
};

function getResultText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[] | undefined;
  const first = content?.[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

describe('TSO tools integration', () => {
  let mockDir: string;
  let client: Client;
  let server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;

  beforeAll(async () => {
    mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-tso-'));
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

    server = getServer(
      createServer({
        backend,
        systemRegistry,
        credentialProvider,
        logToolCalls: true,
        capabilityTier: 'full',
      })
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'tso-test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    if (mockDir) await fs.rm(mockDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('runSafeTsoCommand allowlisted LISTDS returns output', async () => {
    const result = await client.callTool({
      name: 'runSafeTsoCommand',
      arguments: { commandText: 'LISTDS USER.DATA' },
    });
    const text = getResultText(result);
    const envelope = JSON.parse(text) as {
      _context: { system: string };
      _result: { totalLines: number; hasMore: boolean };
      data: { lines: string[] };
    };
    expect(envelope._context.system).toBe(SYSTEM_HOST);
    const output = envelope.data.lines.join('\n');
    expect(output).toContain('LISTDS');
    expect(output).toContain('mock');
  });

  it('runSafeTsoCommand DELETE user dataset returns elicit-denied error', async () => {
    const result = await client.callTool({
      name: 'runSafeTsoCommand',
      arguments: { commandText: 'DELETE USER.DATA' },
    });
    const text = getResultText(result);
    const parsed = JSON.parse(text) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.toLowerCase()).toMatch(/delete|elicitation|approval/);
  });

  it('runSafeTsoCommand DELETE system dataset returns block error', async () => {
    const result = await client.callTool({
      name: 'runSafeTsoCommand',
      arguments: { commandText: 'DELETE SYS1.PARMLIB' },
    });
    const text = getResultText(result);
    const parsed = JSON.parse(text) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.toLowerCase()).toMatch(/system|not allowed/);
  });

  it('runSafeTsoCommand unknown command returns elicit-denied error', async () => {
    const result = await client.callTool({
      name: 'runSafeTsoCommand',
      arguments: { commandText: 'MYCUSTOM TSO CMD' },
    });
    const text = getResultText(result);
    const parsed = JSON.parse(text) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.toLowerCase()).toContain('elicitation');
  });

  it('runSafeTsoCommand OSHELL commands return block error', async () => {
    for (const commandText of ['OSHELL pwd', 'OSHELL ls'] as const) {
      const result = await client.callTool({
        name: 'runSafeTsoCommand',
        arguments: { commandText },
      });
      const text = getResultText(result);
      const parsed = JSON.parse(text) as { error?: string };
      expect(parsed.error).toBeDefined();
      expect(parsed.error?.toLowerCase()).toMatch(/oshell|not allowed/);
    }
  });

  it('runSafeTsoCommand with startLine/lineCount returns windowed output', async () => {
    const first = await client.callTool({
      name: 'runSafeTsoCommand',
      arguments: { commandText: 'LISTALC' },
    });
    const firstText = getResultText(first);
    const firstEnvelope = JSON.parse(firstText) as {
      _result: { totalLines: number; returnedLines: number; hasMore: boolean };
      data: { lines: string[] };
    };
    expect(firstEnvelope._result.totalLines).toBeGreaterThan(0);
    expect(firstEnvelope.data.lines.length).toBeGreaterThan(0);

    const second = await client.callTool({
      name: 'runSafeTsoCommand',
      arguments: { commandText: 'LISTALC', startLine: 1, lineCount: 2 },
    });
    const secondText = getResultText(second);
    const secondEnvelope = JSON.parse(secondText) as {
      _result: { startLine: number; returnedLines: number };
      data: { lines: string[] };
    };
    expect(secondEnvelope._result.startLine).toBe(1);
    expect(secondEnvelope._result.returnedLines).toBeLessThanOrEqual(2);
  });
});
