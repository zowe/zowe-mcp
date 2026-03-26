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
 * Mock EWS stdio E2E tests.
 *
 * Starts a mock Endevor Web Services server (using `init ENDEVOR` to generate data
 * in a temp directory, then `serve`) and connects the Zowe MCP Server via the
 * Endevor CLI bridge. Exercises all basic Endevor tools end-to-end.
 *
 * Skipped when ZOWE_MCP_MOCK_EWS_DIR is not set in the environment (or .env file)
 * or when the mock EWS CLI script does not exist at the expected location.
 *
 * Set ZOWE_MCP_MOCK_EWS_DIR to the `mock_ews_server` directory, e.g.:
 *   ZOWE_MCP_MOCK_EWS_DIR=/path/to/code4z-gen-ai/mock_ews_server
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

/** Load .env from the given path; set process.env for each KEY=value line (existing env not overwritten). */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    const value = trimmed.slice(eq + 1).trim();
    const unquoted = /^['"](.*)['"]$/.exec(value);
    process.env[key] = unquoted ? unquoted[1] : value;
  }
}

// Load .env from cwd or repo root
loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(__dirname, '..', '..', '..', '.env'));

/** Poll a TCP port until it accepts connections or the timeout expires. */
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(res => setTimeout(res, 200));
    const ok = await new Promise<boolean>(resolve => {
      const s = createConnection({ port, host: '127.0.0.1' }, () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
  }
  throw new Error(`Timed out waiting for port ${port.toString()} to be ready`);
}

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

// ---------------------------------------------------------------------------
// Skip conditions
// ---------------------------------------------------------------------------

const ewsDir = process.env.ZOWE_MCP_MOCK_EWS_DIR;
const cliScript = ewsDir ? join(ewsDir, 'dist', 'cli', 'index.js') : '';
const canRunEwsE2E = Boolean(ewsDir && cliScript && existsSync(cliScript));

const skipReason = !canRunEwsE2E
  ? !ewsDir
    ? 'ZOWE_MCP_MOCK_EWS_DIR is not set (add it to .env)'
    : `Mock EWS CLI not found at ${cliScript}`
  : '';

const EWS_PORT = 8081;

describe.skipIf(!canRunEwsE2E)(
  `Zowe MCP Server — Endevor CLI bridge (mock EWS stdio E2E)${skipReason ? ` [skipped: ${skipReason}]` : ''}`,
  () => {
    let client: Client;
    let ewsProcess: ChildProcess;
    let tempDir: string;
    let connFile: string;

    beforeAll(async () => {
      // 1. Create a temp directory; run init to generate EWS data + config.
      tempDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-mock-ews-e2e-'));
      const dataDir = join(tempDir, 'data');

      const initResult = spawnSync(
        'node',
        [cliScript, 'init', 'ENDEVOR', '--output', dataDir, '--force'],
        { cwd: tempDir, encoding: 'utf-8' }
      );
      if (initResult.status !== 0) {
        throw new Error(`mock EWS init failed: ${initResult.stderr ?? initResult.stdout}`);
      }

      // 2. Start the mock EWS serve process (config file created in tempDir by init).
      const configFilePath = join(tempDir, 'mock-ews-config.json');
      ewsProcess = spawn(
        'node',
        [cliScript, 'serve', '--config', configFilePath, '--port', String(EWS_PORT)],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      await waitForPort(EWS_PORT, 15_000);

      // 3. Write a temp connection JSON for the Endevor CLI bridge.
      connFile = join(tmpdir(), `endevor-e2e-conn-${Date.now()}.json`);
      writeFileSync(
        connFile,
        JSON.stringify({
          host: 'localhost',
          port: EWS_PORT,
          user: 'USER',
          password: 'PASSWORD',
          protocol: 'http',
          basePath: 'EndevorService/api/v2',
          pluginParams: { instance: 'ENDEVOR' },
        })
      );

      // 4. Start the MCP server with the Endevor CLI bridge.
      const pluginsDir = resolve(dirname(serverPath), 'tools', 'cli-bridge', 'plugins');
      const transport = new StdioClientTransport({
        command: 'node',
        args: [
          serverPath,
          '--stdio',
          '--cli-plugins-dir',
          pluginsDir,
          '--cli-plugin-connection',
          `endevor=${connFile}`,
        ],
        env: { ...process.env } as Record<string, string>,
      });
      client = new Client({ name: 'e2e-mock-ews-test', version: '1.0.0' });
      await client.connect(transport);
    }, 30_000);

    afterAll(async () => {
      if (client) {
        await client.close();
      }
      if (ewsProcess) {
        ewsProcess.kill('SIGTERM');
      }
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      if (connFile && existsSync(connFile)) {
        rmSync(connFile);
      }
    });

    it('registers at least 9 endevor* tools', async () => {
      const { tools } = await client.listTools();
      const endevorTools = tools.filter(t => t.name.startsWith('endevor'));
      expect(endevorTools.length).toBeGreaterThanOrEqual(9);
    });

    it('endevorSetContext sets DEV/1/SYS1/SUB1 and returns success', async () => {
      const result = await client.callTool({
        name: 'endevorSetContext',
        arguments: { environment: 'DEV', stageNumber: '1', system: 'SYS1', subsystem: 'SUB1' },
      });
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(getResultText(result)) as { success: boolean };
      expect(parsed.success).toBe(true);
    });

    it('endevorListEnvironments returns at least one environment including DEV', async () => {
      const result = await client.callTool({
        name: 'endevorListEnvironments',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      const text = getResultText(result);
      expect(text).toMatch(/DEV/);
    });

    it('endevorListSystems returns SYS1 for DEV environment', async () => {
      const result = await client.callTool({
        name: 'endevorListSystems',
        arguments: { environment: 'DEV' },
      });
      expect(result.isError).not.toBe(true);
      const text = getResultText(result);
      expect(text).toMatch(/SYS1/);
    });

    it('endevorListSubsystems returns SUB1 for DEV/SYS1', async () => {
      const result = await client.callTool({
        name: 'endevorListSubsystems',
        arguments: { environment: 'DEV', system: 'SYS1' },
      });
      expect(result.isError).not.toBe(true);
      const text = getResultText(result);
      expect(text).toMatch(/SUB1/);
    });

    it('endevorListTypes returns COBPGM for DEV/SYS1', async () => {
      const result = await client.callTool({
        name: 'endevorListTypes',
        arguments: { environment: 'DEV', system: 'SYS1' },
      });
      expect(result.isError).not.toBe(true);
      const text = getResultText(result);
      expect(text).toMatch(/COBPGM/);
    });

    it('endevorListElements returns PROG01 for COBPGM', async () => {
      const result = await client.callTool({
        name: 'endevorListElements',
        arguments: {
          environment: 'DEV',
          stageNumber: '1',
          system: 'SYS1',
          subsystem: 'SUB1',
          type: 'COBPGM',
        },
      });
      expect(result.isError).not.toBe(true);
      const text = getResultText(result);
      expect(text).toMatch(/PROG0[1-5]/);
    });

    it('endevorPrintElement returns content for PROG01', async () => {
      const result = await client.callTool({
        name: 'endevorPrintElement',
        arguments: {
          element: 'PROG01',
          type: 'COBPGM',
          environment: 'DEV',
          stageNumber: '1',
          system: 'SYS1',
          subsystem: 'SUB1',
        },
      });
      expect(result.isError).not.toBe(true);
      const text = getResultText(result);
      expect(text).toMatch(/PROG01|PROGRAM-ID|IDENTIFICATION DIVISION/i);
    });
  }
);
