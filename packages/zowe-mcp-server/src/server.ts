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
import { Logger } from './log.js';
import { registerCoreTools } from './tools/core/zowe-info.js';

const require = createRequire(import.meta.url);
const packageJson: { version: string } = require('../package.json') as {
  version: string;
};

/** Shared root logger for the MCP server process. */
let rootLogger: Logger | undefined;

/**
 * Returns the root {@link Logger} instance, creating it on first call.
 *
 * The logger is a singleton so that all modules (server, transports, tools)
 * share the same configuration and MCP server attachment.
 */
export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = new Logger({ name: 'server' });
  }
  return rootLogger;
}

/**
 * Creates and returns a fully configured McpServer with all tools registered.
 * The server is transport-agnostic — connect it to any transport after creation.
 *
 * The logging capability is declared so that `sendLoggingMessage()` can
 * forward structured log messages to the connected MCP client.
 */
export function createServer(): McpServer {
  const version = packageJson.version;

  const server = new McpServer(
    {
      name: 'zowe-mcp-server',
      version,
    },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  const logger = getLogger();
  logger.attach(server);

  registerCoreTools(server, version, logger);

  return server;
}
