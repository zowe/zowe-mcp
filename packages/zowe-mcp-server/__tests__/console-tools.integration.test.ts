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
 * Integration tests for runConsoleCommand via MCP with the mock backend:
 * safe commands run, dangerous commands are blocked, elicit-class commands
 * are denied when the client lacks elicitation support.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decorateConsoleError } from '../src/tools/console/console-tools.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { createMockIntegrationClient, getResultText } from './helpers/integration-test-utils.js';

const SYSTEM_HOST = 'console-test.example.com';
const DEFAULT_USER = 'testuser';

const mockConfig: MockSystemsConfig = {
  systems: [
    {
      host: SYSTEM_HOST,
      port: 443,
      description: 'Console test system',
      credentials: [{ user: DEFAULT_USER, password: 'pass' }],
    },
  ],
};

describe('console tools integration', () => {
  let mockDir: string;
  let client: Client;
  let server: Awaited<ReturnType<typeof createMockIntegrationClient>>['server'];

  beforeAll(async () => {
    mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-console-'));
    await fs.writeFile(path.join(mockDir, 'systems.json'), JSON.stringify(mockConfig));
    await fs.mkdir(path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER), {
      recursive: true,
    });

    ({ client, server } = await createMockIntegrationClient(mockDir, mockConfig, 'console-test'));
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    if (mockDir) await fs.rm(mockDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('runConsoleCommand is registered and runs a safe DISPLAY command', async () => {
    const result = await client.callTool({
      name: 'runConsoleCommand',
      arguments: { commandText: 'D T' },
    });
    expect(result.isError ?? false).toBe(false);
    const envelope = JSON.parse(getResultText(result)) as {
      _context: { system: string };
      data: { lines: string[] };
    };
    expect(envelope._context.system).toBe(SYSTEM_HOST);
    expect(envelope.data.lines.join('\n')).toContain('IEE136I');
  });

  it('blocks dangerous commands without running them', async () => {
    const result = await client.callTool({
      name: 'runConsoleCommand',
      arguments: { commandText: 'Z EOD' },
    });
    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toContain('BLOCKED');
    expect(text).toContain('NOT run');
  });

  it('denies elicit-class commands when the client has no elicitation support', async () => {
    const result = await client.callTool({
      name: 'runConsoleCommand',
      arguments: { commandText: 'V 0A80,OFFLINE' },
    });
    expect(result.isError).toBe(true);
    expect(getResultText(result)).toContain('elicitation is not available');
  });
});

describe('decorateConsoleError', () => {
  it('maps method-not-found to a server-version hint', () => {
    const out = decorateConsoleError('Unrecognized command consoleCommand');
    expect(out).toContain('zowex 0.9.0 or later');
    expect(out).toContain('Unrecognized command consoleCommand');
  });

  it('maps missing zoweax to an install pointer', () => {
    const out = decorateConsoleError(
      "Error: console command failed via 'zoweax', rc: '255'\n  Details: zut_private_run_program: zoweax: command not found"
    );
    expect(out).toContain('zoweax-security.md');
    expect(out).toContain('system programmer');
  });

  it('maps authorization failures to APF/ESM guidance', () => {
    const out = decorateConsoleError(
      "Error: could not activate console: 'TESTUSR0' rc: '-1' Not authorized - 4"
    );
    expect(out).toContain('APF-authorized');
    expect(out).toContain('OPERCMDS');
  });

  it('passes unknown errors through unchanged', () => {
    expect(decorateConsoleError('some other failure')).toBe('some other failure');
  });
});
