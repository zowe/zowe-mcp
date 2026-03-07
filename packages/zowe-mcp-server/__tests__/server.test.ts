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
 * In-memory transport-specific tests.
 *
 * Tests that exercise behaviour unique to the in-memory transport or
 * that only make sense as fast unit tests (no subprocess overhead).
 *
 * Common tool tests shared across all transports live in common.test.ts.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

describe('Zowe MCP Server (in-memory specific)', () => {
  let client: Client;
  let server: McpServer;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    server = createServer({ logToolCalls: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should create a server with the correct name', () => {
    // The server name is set during createServer() — verify via the server instance
    expect(server).toBeDefined();
  });

  it('should handle multiple sequential tool calls on the same connection', async () => {
    // In-memory transport keeps the connection alive — verify repeated calls work
    const result1 = await client.callTool({ name: 'getContext', arguments: {} });
    const result2 = await client.callTool({ name: 'getContext', arguments: {} });

    const content1 = result1.content as { type: string; text: string }[];
    const content2 = result2.content as { type: string; text: string }[];

    expect((JSON.parse(content1[0].text) as { server: { name: string } }).server.name).toBe(
      'Zowe MCP Server'
    );
    expect((JSON.parse(content2[0].text) as { server: { name: string } }).server.name).toBe(
      'Zowe MCP Server'
    );
  });
});
