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
 * Creates a transport-agnostic McpServer instance with all tools,
 * resources, and prompts registered.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import { Logger } from './log.js';
import { registerDatasetPrompts } from './prompts/dataset-prompts.js';
import { registerDatasetResources } from './resources/dataset-resources.js';
import { registerContextTools } from './tools/context/context-tools.js';
import { registerCoreTools } from './tools/core/zowe-info.js';
import { registerDatasetTools } from './tools/datasets/dataset-tools.js';
import type { ZosBackend } from './zos/backend.js';
import type { CredentialProvider } from './zos/credentials.js';
import { SessionState } from './zos/session.js';
import { SystemRegistry } from './zos/system.js';

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

/** Options for creating the MCP server. */
export interface CreateServerOptions {
  /** z/OS backend implementation (mock or real). */
  backend?: ZosBackend;
  /** System registry with known z/OS systems. */
  systemRegistry?: SystemRegistry;
  /** Credential provider for resolving user identities. */
  credentialProvider?: CredentialProvider;
}

/**
 * Creates and returns a fully configured McpServer with all tools,
 * resources, and prompts registered.
 *
 * The server is transport-agnostic — connect it to any transport after creation.
 *
 * The logging capability is declared so that `sendLoggingMessage()` can
 * forward structured log messages to the connected MCP client.
 */
export function createServer(options?: CreateServerOptions): McpServer {
  const logger = getLogger();

  logger.info('Creating Zowe MCP Server', {
    version: SERVER_VERSION,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    env: getRelevantEnv(),
    mockMode: !!options?.backend,
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

  const backendConnected = !!(options?.backend && options.credentialProvider);

  // Register core tools (info) — always available
  registerCoreTools(server, SERVER_VERSION, logger, { backendConnected });

  // Register z/OS tools, resources, and prompts if a backend is provided
  if (backendConnected) {
    const backend = options.backend!;
    const systemRegistry = options.systemRegistry ?? new SystemRegistry();
    const credentialProvider = options.credentialProvider!;
    const sessionState = new SessionState();

    registerContextTools(server, { systemRegistry, sessionState, credentialProvider }, logger);
    registerDatasetTools(
      server,
      { backend, systemRegistry, sessionState, credentialProvider },
      logger
    );
    registerDatasetResources(server, { backend }, logger);
    registerDatasetPrompts(server, { backend, sessionState }, logger);

    // Auto-activate the system when there is exactly one configured
    const systems = systemRegistry.list();
    if (systems.length === 1) {
      const singleSystem = systems[0];
      void credentialProvider.getCredentials(singleSystem).then(credentials => {
        sessionState.setActiveSystem(singleSystem, credentials.user);
        logger.info('Auto-activated single system', {
          system: singleSystem,
          userId: credentials.user,
        });
      });
    }

    logger.info('z/OS dataset tools, resources, and prompts registered', {
      systems,
    });
  } else {
    logger.warning(
      'No z/OS backend configured — only the "info" tool is available. ' +
        'To enable all z/OS tools: in VS Code run "Zowe MCP: Generate Mock Data" from the Command Palette, ' +
        'or use --mock <dir> / ZOWE_MCP_MOCK_DIR for standalone mode.'
    );
  }

  logger.info('Server created, tools registered');

  return server;
}
