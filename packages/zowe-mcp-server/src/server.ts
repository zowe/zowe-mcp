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
 * Zowe MCP Server factory.
 *
 * Creates a transport-agnostic McpServer instance with all tools registered.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import { registerCoreTools } from './tools/core/zowe-info.js';

const require = createRequire(import.meta.url);
const packageJson: { version: string } = require('../package.json') as {
  version: string;
};

/**
 * Creates and returns a fully configured McpServer with all tools registered.
 * The server is transport-agnostic — connect it to any transport after creation.
 */
export function createServer(): McpServer {
  const version = packageJson.version;

  const server = new McpServer({
    name: 'zowe-mcp-server',
    version,
  });

  registerCoreTools(server, version);

  return server;
}
