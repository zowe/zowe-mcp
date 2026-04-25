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
 * Mock stdio E2E tests.
 *
 * Initializes default mock data in a temp dir, starts the stdio server with
 * the mock backend, and runs a subset of tools (info, context, list-only
 * dataset tools) in one session. Tool cases are data-driven with expected
 * values where it makes sense.
 *
 * Mutation tools (createDataset, writeDataset, copyDataset, renameDataset,
 * deleteDataset) and getDatasetAttributes/readDataset are not exercised here.
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
const EXPECTED_TOOL_COUNT = 62; // core Zowe MCP tools + 7 vendor CLI plugin tools (db2 + profile add/remove)

/** Parsed tool result content. */
interface ToolContent {
  type: string;
  text: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

interface ToolTestCase {
  name: string;
  arguments?: Record<string, unknown>;
  /** When set, called with the parsed JSON result to assert expected values. */
  assertResult?: (parsed: unknown) => void;
}

const FIRST_SYSTEM = 'mainframe-dev.example.com';

describe('Zowe MCP Server (mock stdio E2E)', () => {
  let tmpdirPath: string;
  let client: Client;

  beforeAll(() => {
    tmpdirPath = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-mock-e2e-'));
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

  it('should run supported tools against default mock in one session', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--stdio', '--mock', tmpdirPath, '--capability-tier', 'full'],
    });
    client = new Client({ name: 'e2e-mock-test', version: '1.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);

    const toolCases: ToolTestCase[] = [
      {
        name: 'listSystems',
        arguments: {},
        assertResult(parsed) {
          const o = parsed as { systems: { host: string }[] };
          expect(o.systems).toHaveLength(2);
          const hosts = o.systems.map(s => s.host);
          expect(hosts).toContain('mainframe-dev.example.com');
          expect(hosts).toContain('mainframe-test.example.com');
        },
      },
      {
        name: 'setSystem',
        arguments: { system: FIRST_SYSTEM },
        assertResult(parsed) {
          const o = parsed as { activeSystem: string; userId: string };
          expect(o.activeSystem).toBe(FIRST_SYSTEM);
          expect(o.userId).toBe('USER');
        },
      },
      {
        name: 'getContext',
        arguments: {},
        assertResult(parsed) {
          const o = parsed as {
            server: {
              name: string;
              backend: string | null;
              components: string[];
              maxEffectLevel?: string;
            };
            activeSystem: { system: string; userId: string } | null;
          };
          expect(o.server.name).toBe('Zowe MCP Server');
          expect(o.server.backend).toBe('mock');
          expect(o.server.components).toContain('context');
          expect(o.server.components).toContain('datasets');
          expect(o.server.maxEffectLevel).toBe('execute');
          expect(o.activeSystem).not.toBeNull();
          expect(o.activeSystem!.system).toBe(FIRST_SYSTEM);
          expect(o.activeSystem!.userId).toBe('USER');
        },
      },
      {
        name: 'listDatasets',
        arguments: { dsnPattern: 'USER.*' },
        assertResult(parsed) {
          const o = parsed as { _context: { resolvedPattern?: string }; data: { dsn: string }[] };
          expect(o._context).toBeDefined();
          expect(Array.isArray(o.data)).toBe(true);
          const dsns = o.data.map(d => d.dsn);
          expect(dsns.some(d => d.includes('USER.SRC.COBOL'))).toBe(true);
        },
      },
      {
        name: 'listMembers',
        arguments: { dsn: 'USER.SRC.COBOL' },
        assertResult(parsed) {
          const o = parsed as { _context: unknown; data: { member: string }[] };
          expect(o._context).toBeDefined();
          expect(Array.isArray(o.data)).toBe(true);
          const names = o.data.map(m => m.member);
          expect(names).toContain('CUSTFILE');
          expect(names).toContain('ACCTPROC');
        },
      },
      {
        name: 'searchInDataset',
        arguments: { dsn: 'USER.SRC.COBOL', string: 'DIVISION' },
        assertResult(parsed) {
          const o = parsed as {
            _context: { system: string };
            _result: { count: number; totalAvailable: number; linesFound: number };
            data: { dataset: string; members: unknown[]; summary: { searchPattern: string } };
          };
          expect(o._context).toBeDefined();
          expect(o._result).toBeDefined();
          expect(o._result.count).toBeGreaterThanOrEqual(0);
          expect(o._result.totalAvailable).toBeGreaterThanOrEqual(0);
          expect(o.data.dataset).toBe('USER.SRC.COBOL');
          expect(Array.isArray(o.data.members)).toBe(true);
          expect(o.data.summary).toBeDefined();
          expect(o.data.summary.searchPattern).toBe('DIVISION');
        },
      },
    ];

    for (const tc of toolCases) {
      const result = await client.callTool({
        name: tc.name,
        arguments: tc.arguments ?? {},
      });
      expect(result.isError).toBeFalsy();
      const text = getResultText(result);
      const parsed = JSON.parse(text) as unknown;
      tc.assertResult?.(parsed);
    }
  });
});

describe('listMembers pagination (inventory 2000)', () => {
  let tmpdirPath: string;
  let client: Client;

  beforeAll(() => {
    tmpdirPath = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-mock-inv-e2e-'));
    const init = spawnSync(
      'node',
      [serverPath, 'init-mock', '--output', tmpdirPath, '--preset', 'inventory'],
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

  it('should page through 2000 inventory members', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--stdio', '--mock', tmpdirPath, '--capability-tier', 'full'],
    });
    client = new Client({ name: 'e2e-mock-inv-test', version: '1.0.0' });
    await client.connect(transport);

    await client.callTool({
      name: 'setSystem',
      arguments: { system: FIRST_SYSTEM },
    });

    // Page 1: offset 0, limit 500
    let result = await client.callTool({
      name: 'listMembers',
      arguments: { dsn: 'USER.INVNTORY', offset: 0, limit: 500 },
    });
    expect(result.isError).toBeFalsy();
    const page1 = JSON.parse(getResultText(result)) as {
      _result: { totalAvailable: number; count: number; offset: number; hasMore: boolean };
      data: { member: string }[];
    };
    expect(page1._result.totalAvailable).toBe(2000);
    expect(page1._result.count).toBe(500);
    expect(page1._result.offset).toBe(0);
    expect(page1._result.hasMore).toBe(true);
    expect(page1.data).toHaveLength(500);
    expect(page1.data[0].member).toBe('ITEM0001');
    expect(page1.data[499].member).toBe('ITEM0500');

    // Page 2: offset 500, limit 500
    result = await client.callTool({
      name: 'listMembers',
      arguments: { dsn: 'USER.INVNTORY', offset: 500, limit: 500 },
    });
    expect(result.isError).toBeFalsy();
    const page2 = JSON.parse(getResultText(result)) as {
      _result: { totalAvailable: number; count: number; offset: number; hasMore: boolean };
      data: { member: string }[];
    };
    expect(page2._result.totalAvailable).toBe(2000);
    expect(page2._result.count).toBe(500);
    expect(page2._result.offset).toBe(500);
    expect(page2._result.hasMore).toBe(true);
    expect(page2.data[0].member).toBe('ITEM0501');
    expect(page2.data[499].member).toBe('ITEM1000');

    // Last page: offset 1999, limit 10
    result = await client.callTool({
      name: 'listMembers',
      arguments: { dsn: 'USER.INVNTORY', offset: 1999, limit: 10 },
    });
    expect(result.isError).toBeFalsy();
    const lastPage = JSON.parse(getResultText(result)) as {
      _result: { count: number; hasMore: boolean };
      data: { member: string }[];
    };
    expect(lastPage._result.count).toBe(1);
    expect(lastPage._result.hasMore).toBe(false);
    expect(lastPage.data).toHaveLength(1);
    expect(lastPage.data[0].member).toBe('ITEM2000');
  });
});

describe('readDataset pagination (pagination preset)', () => {
  let tmpdirPath: string;
  let client: Client;

  beforeAll(() => {
    tmpdirPath = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-read-e2e-'));
    const init = spawnSync(
      'node',
      [serverPath, 'init-mock', '--output', tmpdirPath, '--preset', 'pagination'],
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

  it('should page through USER.LARGE.SEQ with hasMore and messages', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--stdio', '--mock', tmpdirPath, '--capability-tier', 'full'],
    });
    client = new Client({ name: 'e2e-read-pagination-test', version: '1.0.0' });
    await client.connect(transport);

    await client.callTool({
      name: 'setSystem',
      arguments: { system: FIRST_SYSTEM },
    });

    // Page 1: startLine 1, lineCount 500
    let result = await client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER.LARGE.SEQ', startLine: 1, lineCount: 500 },
    });
    expect(result.isError).toBeFalsy();
    const page1 = JSON.parse(getResultText(result)) as {
      _result: { totalLines: number; startLine: number; returnedLines: number; hasMore: boolean };
      data: { lines: string[]; encoding?: string };
      messages: string[];
    };
    expect(page1._result.totalLines).toBe(2200);
    expect(page1._result.startLine).toBe(1);
    expect(page1._result.returnedLines).toBe(500);
    expect(page1._result.hasMore).toBe(true);
    expect(page1.messages).toHaveLength(1);
    expect(page1.messages[0]).toContain('startLine=501');
    expect(page1.data.lines.join('\n')).toContain('LINE 0001');
    expect(page1.data.lines.join('\n')).toContain('LINE 0500');
    expect(page1.data.encoding).toBe('IBM-037');

    // Page 2: startLine 501, lineCount 500
    result = await client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER.LARGE.SEQ', startLine: 501, lineCount: 500 },
    });
    expect(result.isError).toBeFalsy();
    const page2 = JSON.parse(getResultText(result)) as {
      _result: { startLine: number; returnedLines: number; hasMore: boolean };
      data: { lines: string[] };
    };
    expect(page2._result.startLine).toBe(501);
    expect(page2._result.returnedLines).toBe(500);
    expect(page2._result.hasMore).toBe(true);
    expect(page2.data.lines.join('\n')).toContain('LINE 0501');
    expect(page2.data.lines.join('\n')).toContain('LINE 1000');

    // Last page: startLine 2001, lineCount 500 → lines 2001–2200 (200 lines), hasMore false
    result = await client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER.LARGE.SEQ', startLine: 2001, lineCount: 500 },
    });
    expect(result.isError).toBeFalsy();
    const lastPage = JSON.parse(getResultText(result)) as {
      _result: { startLine: number; returnedLines: number; hasMore: boolean };
      data: { lines: string[] };
      messages: string[];
    };
    expect(lastPage._result.startLine).toBe(2001);
    expect(lastPage._result.returnedLines).toBe(200);
    expect(lastPage._result.hasMore).toBe(false);
    expect(lastPage.messages).toBeUndefined();
    expect(lastPage.data.lines.join('\n')).toContain('LINE 2001');
    expect(lastPage.data.lines.join('\n')).toContain('LINE 2200');
  });

  it('should page through USER.INVNTORY(LARGE) member', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--stdio', '--mock', tmpdirPath, '--capability-tier', 'full'],
    });
    client = new Client({ name: 'e2e-read-member-test', version: '1.0.0' });
    await client.connect(transport);

    await client.callTool({
      name: 'setSystem',
      arguments: { system: FIRST_SYSTEM },
    });

    const result = await client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER.INVNTORY', member: 'LARGE', startLine: 1, lineCount: 500 },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getResultText(result)) as {
      _result: { totalLines: number; hasMore: boolean };
      data: { lines: string[] };
      messages: string[];
    };
    expect(parsed._result.totalLines).toBe(2500);
    expect(parsed._result.hasMore).toBe(true);
    expect(parsed.messages.length).toBeGreaterThanOrEqual(1);
    expect(parsed.data.lines.join('\n')).toContain('LINE 0001');
  });
});
