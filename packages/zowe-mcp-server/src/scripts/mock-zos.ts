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
 * Entry script for the `zowe-mcp-server mock-zos` subcommand.
 *
 * The MCP server's top-level CLI (src/index.ts) spawns this script when the user
 * invokes `zowe-mcp-server mock-zos ...`. The actual yargs sub-CLI lives in
 * src/mock-host/cli.ts.
 */

import { runMockZosCli } from '../mock-host/cli.js';

runMockZosCli(process.argv.slice(2)).catch(err => {
  console.error('mock-zos failed:', err);
  process.exit(1);
});
