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
 * stdio transport for the Zowe MCP Server.
 *
 * Connects the server to stdin/stdout for use as a local subprocess
 * (e.g., spawned by VS Code or Claude Desktop).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Starts the MCP server using the stdio transport.
 * The server will read JSON-RPC messages from stdin and write responses to stdout.
 */
export async function startStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
