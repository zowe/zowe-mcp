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
 *   npx @zowe/mcp-server call-tool [--mock=<dir> | --native [--config=<path>] [--system <spec> ...]] [<tool-name> [args]]
 *
 * Options:
 *   --mock=<dir>  Use the mock backend with the given data directory (or set ZOWE_MCP_MOCK_DIR).
 *                 Also accepted: --mock <dir> (space-separated).
 *   --native      Use the Zowe Native (SSH) backend.
 *   --config=<path>  JSON file with { "systems": ["user@host", ...] } — connection specs (used with --native).
 *   --system <spec>  Connection spec user@host or user@host:port (repeatable, used with --native).
 *
 * Tool arguments are key=value pairs. Values are strings unless they look like numbers or booleans (true/false).
 * Passwords for native mode: set ZOWE_MCP_PASSWORD_<USER>_<HOST> (e.g. ZOWE_MCP_PASSWORD_MYUSER_MYHOST).
 *
 * Examples:
 *   # List tools (no backend)
 *   npx @zowe/mcp-server call-tool
 *
 *   # List tools in mock backend
 *   npx @zowe/mcp-server call-tool --mock=./zowe-mcp-mock-data listSystems
 *
 *   # List datasets in mock backend
 *   npx @zowe/mcp-server call-tool --mock=./zowe-mcp-mock-data listDatasets "dsnPattern='USER.*'" system=mainframe-dev.example.com
 *
 *   # List members in mock backend
 *   npx @zowe/mcp-server call-tool --mock=./zowe-mcp-mock-data listMembers dsn=SRC.COBOL  system=mainframe-dev.example.com
 *
 *   # List tools with native backend (systems from config)
 *
 *   ZOWE_MCP_PASSWORD_MYUSER_MYHOST_EXAMPLE_COM=password npx @zowe/mcp-server call-tool --native --config=./native-config.json listSystems
 *
 *   # List datasets with native backend (system on command line)
 *   ZOWE_MCP_PASSWORD_MYUSER_MYHOST_EXAMPLE_COM=password npx @zowe/mcp-server call-tool --native --system myuser@myhost.example.com listDatasets "dsnPattern='SYS1.SAMPLIB'"
 *
 *   # List members with native backend (system on command line)
 *   ZOWE_MCP_PASSWORD_MYUSER_MYHOST_EXAMPLE_COM=password npx @zowe/mcp-server call-tool --native --system myuser@myhost.example.com listMembers "dsn='SYS1.SAMPLIB'"
 *
 * Without arguments, lists all available tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { Logger } from '../log.js';
import { createServer, getServer, type CreateServerOptions } from '../server.js';
import { loadMock } from '../zos/mock/load-mock.js';
import { loadNative } from '../zos/native/load-native.js';

const log = new Logger({ name: 'call-tool' });

function loadSystemsFromConfig(configPath: string): string[] {
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as { systems?: string[] };
  if (!Array.isArray(config.systems)) {
    throw new Error(`Config file ${configPath} must have a "systems" array`);
  }
  return config.systems;
}

function parseArgs(): {
  mockDir: string | undefined;
  native: boolean;
  configPath: string | undefined;
  systemSpecs: string[];
  toolName: string | undefined;
  /** Everything after the tool name (key=value args). */
  argsRest: string[];
} {
  const args = process.argv.slice(2);
  let i = 0;
  let mockDir: string | undefined;
  let native = false;
  let configPath: string | undefined;
  const systemSpecs: string[] = [];

  while (i < args.length) {
    const arg = args[i];
    if (arg === '--mock' && i + 1 < args.length) {
      mockDir = args[i + 1];
      i += 2;
    } else if (arg.startsWith('--mock=')) {
      mockDir = arg.slice(7);
      if (!mockDir) {
        throw new Error('--mock= requires a non-empty path');
      }
      i += 1;
    } else if (arg === '--native') {
      native = true;
      i += 1;
    } else if (arg === '--config' && i + 1 < args.length) {
      configPath = args[i + 1];
      i += 2;
    } else if (arg.startsWith('--config=')) {
      configPath = arg.slice(9);
      if (!configPath) {
        throw new Error('--config= requires a non-empty path');
      }
      i += 1;
    } else if (arg === '--system' && i + 1 < args.length) {
      systemSpecs.push(args[i + 1]);
      i += 2;
    } else {
      break;
    }
  }

  if (!mockDir && process.env.ZOWE_MCP_MOCK_DIR) {
    mockDir = process.env.ZOWE_MCP_MOCK_DIR;
  }
  const toolName = args[i];
  const argsRest = i + 1 < args.length ? args.slice(i + 1) : [];
  return { mockDir, native, configPath, systemSpecs, toolName, argsRest };
}

/**
 * Build tool arguments from key=value pairs.
 * Values are kept as strings unless they look like numbers or booleans.
 */
function buildToolArgs(argsRest: string[]): Record<string, unknown> {
  if (argsRest.length === 0) return {};

  const out: Record<string, unknown> = {};
  for (const arg of argsRest) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      throw new Error(`Invalid argument "${arg}": expected key=value`);
    }
    const key = arg.slice(0, eq).trim();
    const raw = arg.slice(eq + 1);
    if (!key) {
      throw new Error(`Invalid argument "${arg}": missing key before =`);
    }
    out[key] = coerceValue(raw);
  }
  return out;
}

function coerceValue(raw: string): string | number | boolean {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (s !== '' && !Number.isNaN(n)) return n;
  return raw;
}

async function main(): Promise<void> {
  const { mockDir, native, configPath, systemSpecs, toolName, argsRest } = parseArgs();
  log.info('Parsed args', { mockDir, native, configPath, systemSpecs, toolName, argsRest });

  if (mockDir && native) {
    throw new Error('Cannot use both --mock and --native. Choose one.');
  }

  let serverOptions: CreateServerOptions | undefined;

  if (mockDir) {
    serverOptions = await loadMock(mockDir);
    if (serverOptions) {
      log.info('Using mock backend', {
        mockDir,
        systems: serverOptions.systemRegistry?.list() ?? [],
      });
    }
  } else if (native) {
    let systems: string[] = [...systemSpecs];
    if (configPath) {
      const fromConfig = loadSystemsFromConfig(configPath);
      systems = [...fromConfig, ...systemSpecs];
    }
    if (systems.length === 0) {
      throw new Error(
        'Native mode requires at least one system. Use --config <path> (JSON with "systems" array) or --system user@host (repeatable).'
      );
    }
    const nativeSetup = loadNative({
      systems,
      useEnvForPassword: true,
    });
    serverOptions = {
      backend: nativeSetup.backend,
      systemRegistry: nativeSetup.systemRegistry,
      credentialProvider: nativeSetup.credentialProvider,
    };
    log.info('Using native (SSH) backend', {
      systems: nativeSetup.systemRegistry.list(),
    });
  }

  if (!serverOptions) {
    log.info('No backend — only core tools (e.g. info) available');
  }

  const created = serverOptions
    ? createServer({
        backend: serverOptions.backend,
        systemRegistry: serverOptions.systemRegistry,
        credentialProvider: serverOptions.credentialProvider,
      })
    : createServer();
  const server = getServer(created);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'call-tool-cli', version: '1.0.0' });

  log.info('Connecting client and server');
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    if (!toolName) {
      log.info('Listing available tools');
      const { tools } = await client.listTools();
      process.stdout.write('Available tools:\n\n');
      for (const tool of tools) {
        process.stdout.write(`  ${tool.name}\n`);
        if (tool.description) {
          process.stdout.write(`    ${tool.description}\n`);
        }
        process.stdout.write('\n');
      }
      return;
    }

    // Parse arguments: JSON object or key=value pairs
    const args = buildToolArgs(argsRest);
    log.info('Calling tool', { tool: toolName });
    if (Object.keys(args).length > 0) {
      log.info('Tool arguments', args);
    }

    const result = await client.callTool({ name: toolName, arguments: args });
    for (const item of result.content as {
      type: string;
      text?: string;
    }[]) {
      if (item.type === 'text' && item.text) {
        log.info('Tool output (text)', { text: item.text });
        process.stdout.write(item.text + '\n');
      } else {
        log.info('Tool output (other)', { item });
        process.stdout.write(JSON.stringify(item, null, 2) + '\n');
      }
    }
  } finally {
    log.info('Closing client and server');
    await client.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  log.error('Error', error);
  process.exit(1);
});
