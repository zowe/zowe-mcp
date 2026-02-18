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
const EXPECTED_TOOL_COUNT = 14;

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
      args: [serverPath, '--stdio', '--mock', tmpdirPath],
    });
    client = new Client({ name: 'e2e-mock-test', version: '1.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);

    const toolCases: ToolTestCase[] = [
      {
        name: 'info',
        arguments: {},
        assertResult(parsed) {
          const o = parsed as { name: string; backend: string | null; components: string[] };
          expect(o.name).toBe('Zowe MCP Server');
          expect(o.backend).toBe('mock');
          expect(o.components).toContain('core');
          expect(o.components).toContain('context');
          expect(o.components).toContain('datasets');
        },
      },
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
          const o = parsed as { activeSystem: string; userId: string; dsnPrefix: string };
          expect(o.activeSystem).toBe(FIRST_SYSTEM);
          expect(o.userId).toBe('USER');
          expect(o.dsnPrefix).toBe('USER');
        },
      },
      {
        name: 'getContext',
        arguments: {},
        assertResult(parsed) {
          const o = parsed as {
            activeSystem: { system: string; userId: string; dsnPrefix: string } | null;
          };
          expect(o.activeSystem).not.toBeNull();
          expect(o.activeSystem!.system).toBe(FIRST_SYSTEM);
          expect(o.activeSystem!.userId).toBe('USER');
          expect(o.activeSystem!.dsnPrefix).toBe('USER');
        },
      },
      {
        name: 'setDsnPrefix',
        arguments: { prefix: 'USER' },
        assertResult(parsed) {
          const o = parsed as { dsnPrefix: string };
          expect(o.dsnPrefix).toBe('USER');
        },
      },
      {
        name: 'listDatasets',
        arguments: { dsnPattern: "'USER.*'" },
        assertResult(parsed) {
          const o = parsed as { _context: { resolvedPattern?: string }; data: { dsn: string }[] };
          expect(o._context).toBeDefined();
          expect(o._context.resolvedPattern).toBeDefined();
          expect(Array.isArray(o.data)).toBe(true);
          const dsns = o.data.map(d => d.dsn);
          expect(dsns.some(d => d.includes('USER.SRC.COBOL'))).toBe(true);
        },
      },
      {
        name: 'listMembers',
        arguments: { dsn: 'SRC.COBOL' },
        assertResult(parsed) {
          const o = parsed as { _context: unknown; data: { member: string }[] };
          expect(o._context).toBeDefined();
          expect(Array.isArray(o.data)).toBe(true);
          const names = o.data.map(m => m.member);
          expect(names).toContain('CUSTFILE');
          expect(names).toContain('ACCTPROC');
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
