#!/usr/bin/env node

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
 * Zowe MCP Server entry point.
 *
 * Parses CLI arguments to determine which transport to use:
 *   --stdio   (default) Start with stdio transport
 *   --http    Start with HTTP Streamable transport
 *   --port N  Port for HTTP transport (default: 3000)
 *   --mock <dir>  Start in mock mode with the given data directory
 *
 * Subcommands:
 *   init-mock  Generate a mock data directory (delegates to init-mock script)
 */

import { connectExtensionClient } from './extension-client.js';
import type { CreateServerOptions } from './server.js';
import { createServer, getLogger, SERVER_VERSION } from './server.js';
import { startHttp } from './transports/http.js';
import { startStdio } from './transports/stdio.js';

interface ParsedArgs {
  transport: 'stdio' | 'http';
  port: number;
  mockDir?: string;
  subcommand?: string;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let transport: 'stdio' | 'http' = 'stdio';
  let port = 3000;
  let mockDir: string | undefined;
  let subcommand: string | undefined;

  // Check for subcommand (first non-flag argument)
  if (args.length > 0 && !args[0].startsWith('-')) {
    subcommand = args[0];
    return { transport, port, mockDir, subcommand };
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--http') {
      transport = 'http';
    } else if (args[i] === '--stdio') {
      transport = 'stdio';
    } else if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) {
        getLogger().error('Invalid port number');
        process.exit(1);
      }
    } else if (args[i] === '--mock' && i + 1 < args.length) {
      mockDir = args[++i];
    }
  }

  // Also check environment variable
  if (!mockDir && process.env.ZOWE_MCP_MOCK_DIR) {
    mockDir = process.env.ZOWE_MCP_MOCK_DIR;
  }

  return { transport, port, mockDir, subcommand };
}

async function main(): Promise<void> {
  const parsed = parseArgs();

  // Handle subcommands
  if (parsed.subcommand === 'init-mock') {
    // Delegate to the init-mock script by re-running with the script path
    const childProcess = await import('node:child_process');
    const nodePath = await import('node:path');
    const nodeUrl = await import('node:url');
    const __dirname = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
    const scriptPath = nodePath.resolve(__dirname, 'scripts', 'init-mock.js');

    // Pass remaining args to the init-mock script
    const childArgs = process.argv.slice(3);
    const child = childProcess.fork(scriptPath, childArgs, { stdio: 'inherit' });
    child.on('exit', code => process.exit(code ?? 0));
    return;
  }

  const { transport, port, mockDir } = parsed;
  const logger = getLogger();

  // Connect to VS Code extension pipe (if env vars are set)
  const extensionClient = await connectExtensionClient(logger);
  if (extensionClient) {
    logger.attachExtension(extensionClient);

    // Handle log-level events from the extension
    extensionClient.onEvent(event => {
      if (event.type === 'log-level') {
        const { level } = event.data;
        logger.info(`Log level changed to "${level}" by VS Code extension`);
        logger.setLevel(level);
      }
    });
  }

  logger.info(`Starting Zowe MCP Server v${SERVER_VERSION}`, {
    transport,
    ...(transport === 'http' ? { port } : {}),
    ...(mockDir ? { mockDir } : {}),
    cwd: process.cwd(),
    argv: process.argv,
  });

  // Load mock backend if --mock is specified
  let serverOptions: CreateServerOptions | undefined;
  if (mockDir) {
    const { loadMock } = await import('./zos/mock/load-mock.js');
    const mock = await loadMock(mockDir);
    serverOptions = {
      backend: mock.backend,
      systemRegistry: mock.systemRegistry,
      credentialProvider: mock.credentialProvider,
    };
    logger.info('Mock mode enabled', {
      mockDir,
      systems: mock.systemRegistry.list(),
    });
  }

  if (transport === 'stdio') {
    const server = createServer(serverOptions);
    await startStdio(server, logger);
  } else {
    await startHttp(() => createServer(serverOptions), port, logger);
  }

  // Notify the VS Code extension if no backend is configured
  if (!serverOptions?.backend && extensionClient?.connected) {
    extensionClient.sendEvent({
      type: 'notification',
      data: {
        severity: 'warning',
        message:
          'Zowe MCP Server started without a z/OS backend — only the "info" tool is available. ' +
          'To enable all z/OS tools, run "Zowe MCP: Generate Mock Data" from the Command Palette ' +
          'or set "zowe-mcp.mockDataDir" in Settings to an existing mock data directory.',
      },
      timestamp: Date.now(),
    });
  }

  logger.info(`Zowe MCP Server started successfully`, { transport });
}

main().catch((error: unknown) => {
  getLogger().emergency('Fatal error', error);
  process.exit(1);
});
