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
 * Stdio transport-specific E2E tests.
 *
 * Tests that exercise behaviour unique to the stdio transport
 * (process spawning, stdin/stdout communication).
 *
 * Common tool tests shared across all transports live in common.test.ts.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

describe('Zowe MCP Server (stdio-specific)', () => {
  let client: Client;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  it('should start the server process via --stdio flag', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--stdio'],
    });

    client = new Client({ name: 'e2e-test', version: '1.0.0' });
    await client.connect(transport);

    // Verify the process started and is responsive
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should default to stdio when no transport flag is given', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
    });

    client = new Client({ name: 'e2e-test', version: '1.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
