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
 */

import { createServer } from './server.js';
import { startHttp } from './transports/http.js';
import { startStdio } from './transports/stdio.js';

function parseArgs(): { transport: 'stdio' | 'http'; port: number } {
  const args = process.argv.slice(2);
  let transport: 'stdio' | 'http' = 'stdio';
  let port = 3000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--http') {
      transport = 'http';
    } else if (args[i] === '--stdio') {
      transport = 'stdio';
    } else if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) {
        console.error('Invalid port number');
        process.exit(1);
      }
    }
  }

  return { transport, port };
}

async function main(): Promise<void> {
  const { transport, port } = parseArgs();

  if (transport === 'stdio') {
    const server = createServer();
    await startStdio(server);
  } else {
    await startHttp(createServer, port);
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
