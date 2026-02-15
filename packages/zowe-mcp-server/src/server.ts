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

/** The server version from package.json. */
export const SERVER_VERSION: string = packageJson.version;

/** Shared root logger for the MCP server process. */
let rootLogger: Logger | undefined;

/**
 * Returns the root {@link Logger} instance, creating it on first call.
 *
 * The logger is a singleton so that all modules (server, transports, tools)
 * share the same configuration and MCP server attachment.
 */
export function getLogger(): Logger {
  rootLogger ??= new Logger({ name: 'server' });
  return rootLogger;
}

/**
 * Prefixes of environment variable names that are relevant to the MCP server.
 * Variables matching these prefixes are included in the startup log.
 * Anything containing "SECRET", "TOKEN", "PASSWORD", or "KEY" is redacted.
 */
const ENV_PREFIXES = ['ZOWE_', 'MCP_', 'NODE_', 'VSCODE_'];

/** Substrings that indicate a variable contains sensitive data. */
const SENSITIVE_SUBSTRINGS = ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'CREDENTIAL'];

/**
 * Returns a filtered snapshot of environment variables relevant to the server.
 * Sensitive values are redacted to avoid leaking credentials into logs.
 */
function getRelevantEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (!ENV_PREFIXES.some(prefix => upper.startsWith(prefix))) continue;
    const isSensitive = SENSITIVE_SUBSTRINGS.some(s => upper.includes(s));
    result[name] = isSensitive ? '***' : value;
  }
  return result;
}

/**
 * Creates and returns a fully configured McpServer with all tools registered.
 * The server is transport-agnostic — connect it to any transport after creation.
 *
 * The logging capability is declared so that `sendLoggingMessage()` can
 * forward structured log messages to the connected MCP client.
 */
export function createServer(): McpServer {
  const logger = getLogger();

  logger.info('Creating Zowe MCP Server', {
    version: SERVER_VERSION,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    env: getRelevantEnv(),
  });

  const server = new McpServer(
    {
      name: 'zowe-mcp-server',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  logger.attach(server);

  // Log when a client completes initialization
  server.server.oninitialized = () => {
    const clientInfo = server.server.getClientVersion();
    const clientCaps = server.server.getClientCapabilities();
    logger.info('Client connected', {
      clientName: clientInfo?.name,
      clientVersion: clientInfo?.version,
      capabilities: clientCaps ? Object.keys(clientCaps) : [],
    });
  };

  registerCoreTools(server, SERVER_VERSION, logger);

  logger.info('Server created, tools registered');

  return server;
}
