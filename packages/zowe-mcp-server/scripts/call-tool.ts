#!/usr/bin/env npx tsx

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
 * CLI helper to call MCP tools on the Zowe MCP Server.
 *
 * Usage:
 *   npx tsx scripts/call-tool.ts <tool-name> [json-args]
 *
 * Examples:
 *   npx tsx scripts/call-tool.ts info
 *   npx tsx scripts/call-tool.ts info '{}'
 *
 * Without arguments, lists all available tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

async function main(): Promise<void> {
  const [toolName, argsJson] = process.argv.slice(2);

  // Create in-memory client-server pair
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'call-tool-cli', version: '1.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    if (!toolName) {
      // List all available tools
      const { tools } = await client.listTools();
      console.log('Available tools:\n');
      for (const tool of tools) {
        console.log(`  ${tool.name}`);
        if (tool.description) {
          console.log(`    ${tool.description}`);
        }
        console.log();
      }
      return;
    }

    // Parse arguments if provided
    const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};

    // Call the tool
    console.log(`Calling tool: ${toolName}`);
    if (Object.keys(args).length > 0) {
      console.log(`Arguments: ${JSON.stringify(args, null, 2)}`);
    }
    console.log('---');

    const result = await client.callTool({ name: toolName, arguments: args });

    for (const item of result.content as {
      type: string;
      text?: string;
    }[]) {
      if (item.type === 'text' && item.text) {
        console.log(item.text);
      } else {
        console.log(JSON.stringify(item, null, 2));
      }
    }
  } finally {
    await client.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error('Error:', error);
  process.exit(1);
});
