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
 * Response cache stdio E2E tests.
 *
 * Spawns the real server process with --stdio --mock and exercises listDatasets
 * pagination with cache enabled (default) and with --response-cache-disable.
 * Each run starts with an empty cache (new process). These tests verify that
 * the server behaves correctly in both modes; the unit test (response-cache.test.ts)
 * with CountingBackend proves the cache actually reduces backend calls.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');
const packageRoot = resolve(__dirname, '..');
const FIRST_SYSTEM = 'mainframe-dev.example.com';

interface ToolContent {
  type: string;
  text: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

describe('Response cache (stdio E2E)', () => {
  let tmpdirPath: string;
  let client: Client;

  beforeAll(() => {
    tmpdirPath = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-response-cache-e2e-'));
    const init = spawnSync(
      'node',
      [serverPath, 'init-mock', '--output', tmpdirPath, '--preset', 'default'],
      {
        cwd: packageRoot,
        encoding: 'utf-8',
      }
    );
    if (init.status !== 0) {
      throw new Error(`init-mock failed: ${init.stderr ?? init.stdout}`);
    }
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    rmSync(tmpdirPath, { recursive: true, force: true });
  });

  it('paginates listDatasets with cache enabled (default) — second page from cache', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--stdio', '--mock', tmpdirPath],
    });
    client = new Client({ name: 'e2e-response-cache', version: '1.0.0' });
    await client.connect(transport);

    try {
      await client.callTool({
        name: 'setSystem',
        arguments: { system: FIRST_SYSTEM },
      });

      const result1 = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: 'USER.*', offset: 0, limit: 2 },
      });
      expect(result1.isError).toBeFalsy();
      const page1 = JSON.parse(getResultText(result1)) as {
        _result: { totalAvailable: number; count: number; offset: number; hasMore: boolean };
        data: { dsn: string }[];
      };
      expect(page1._result.totalAvailable).toBeGreaterThanOrEqual(2);
      expect(page1._result.count).toBe(2);
      expect(page1._result.offset).toBe(0);
      expect(page1._result.hasMore).toBe(true);
      expect(page1.data).toHaveLength(2);

      const result2 = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: 'USER.*', offset: 2, limit: 2 },
      });
      expect(result2.isError).toBeFalsy();
      const page2 = JSON.parse(getResultText(result2)) as {
        _result: { totalAvailable: number; count: number; offset: number; hasMore: boolean };
        data: { dsn: string }[];
      };
      expect(page2._result.totalAvailable).toBe(page1._result.totalAvailable);
      expect(page2._result.offset).toBe(2);
      expect(page2.data).toHaveLength(Math.min(2, page1._result.totalAvailable - 2));
    } finally {
      await client.close();
    }
  });

  it('paginates listDatasets with --response-cache-disable — each request hits backend', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--stdio', '--mock', tmpdirPath, '--response-cache-disable'],
    });
    client = new Client({ name: 'e2e-no-cache', version: '1.0.0' });
    await client.connect(transport);

    try {
      await client.callTool({
        name: 'setSystem',
        arguments: { system: FIRST_SYSTEM },
      });

      const result1 = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: 'USER.*', offset: 0, limit: 2 },
      });
      expect(result1.isError).toBeFalsy();
      const page1 = JSON.parse(getResultText(result1)) as {
        _result: { totalAvailable: number; count: number; hasMore: boolean };
        data: { dsn: string }[];
      };
      expect(page1._result.count).toBe(2);
      expect(page1.data).toHaveLength(2);

      const result2 = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: 'USER.*', offset: 2, limit: 2 },
      });
      expect(result2.isError).toBeFalsy();
      const page2 = JSON.parse(getResultText(result2)) as {
        _result: { totalAvailable: number; count: number; offset: number };
        data: { dsn: string }[];
      };
      expect(page2._result.totalAvailable).toBe(page1._result.totalAvailable);
      expect(page2._result.offset).toBe(2);
    } finally {
      await client.close();
    }
  });
});
