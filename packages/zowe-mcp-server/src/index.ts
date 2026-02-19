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
 *   --native  Start with Zowe Native (SSH) backend
 *   --config <path>  JSON file with { "systems": ["user@host", ...] } (used with --native)
 *   --system <spec>  Connection spec user@host or user@host:port (repeatable, used with --native)
 *
 * Subcommands:
 *   init-mock   Generate a mock data directory (delegates to init-mock script)
 *   call-tool  Call MCP tools via in-memory transport (optional --mock <dir>)
 */

import { readFileSync } from 'node:fs';
import { connectExtensionClient } from './extension-client.js';
import type { CreateServerOptions } from './server.js';
import { createServer, getLogger, SERVER_VERSION } from './server.js';
import { startHttp } from './transports/http.js';
import { startStdio } from './transports/stdio.js';

/** Response cache config from CLI or env (undefined = use server defaults). */
interface ResponseCacheConfig {
  ttlMs?: number;
  maxSizeBytes?: number;
}

interface ParsedArgs {
  transport: 'stdio' | 'http';
  port: number;
  mockDir?: string;
  native?: boolean;
  configPath?: string;
  systemSpecs: string[];
  subcommand?: string;
  /** Response cache: false = disabled, object = custom options, undefined = server defaults. */
  responseCache?: ResponseCacheConfig | false;
  /** When true, do not auto-install ZNP on "Server not found" (native mode). Default false = auto-install enabled. */
  nativeNoAutoInstallZnp?: boolean;
  /** Override remote path for ZNP server install/run (native mode). Default ~/.zowe-server. */
  nativeServerPath?: string;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let transport: 'stdio' | 'http' = 'stdio';
  let port = 3000;
  let mockDir: string | undefined;
  let native = false;
  let configPath: string | undefined;
  const systemSpecs: string[] = [];
  let subcommand: string | undefined;
  let responseCache: ResponseCacheConfig | false | undefined;

  let nativeNoAutoInstallZnp = false;
  let nativeServerPath: string | undefined;

  // Check for subcommand (first non-flag argument)
  if (args.length > 0 && !args[0].startsWith('-')) {
    subcommand = args[0];
    return {
      transport,
      port,
      mockDir,
      native,
      configPath,
      systemSpecs,
      subcommand,
      responseCache,
      nativeNoAutoInstallZnp,
      nativeServerPath,
    };
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
    } else if (args[i].startsWith('--mock=')) {
      mockDir = args[i].slice(7);
      if (!mockDir) {
        getLogger().error('--mock= requires a non-empty path');
        process.exit(1);
      }
    } else if (args[i] === '--native') {
      native = true;
    } else if (args[i] === '--config' && i + 1 < args.length) {
      configPath = args[++i];
    } else if (args[i] === '--system' && i + 1 < args.length) {
      systemSpecs.push(args[++i]);
    } else if (args[i] === '--native-no-auto-install-znp') {
      nativeNoAutoInstallZnp = true;
    } else if (args[i] === '--native-server-path' && i + 1 < args.length) {
      nativeServerPath = args[++i];
      if (!nativeServerPath.trim()) {
        getLogger().error('--native-server-path requires a non-empty path');
        process.exit(1);
      }
    } else if (args[i] === '--response-cache-disable') {
      responseCache = false;
    } else if (args[i] === '--response-cache-ttl-minutes' && i + 1 < args.length) {
      const minutes = parseInt(args[++i], 10);
      if (isNaN(minutes) || minutes < 1) {
        getLogger().error('--response-cache-ttl-minutes must be a positive number');
        process.exit(1);
      }
      if (responseCache !== false) {
        responseCache = responseCache ?? {};
        responseCache.ttlMs = minutes * 60 * 1000;
      }
    } else if (args[i] === '--response-cache-max-mb' && i + 1 < args.length) {
      const mb = parseInt(args[++i], 10);
      if (isNaN(mb) || mb < 1) {
        getLogger().error('--response-cache-max-mb must be a positive number');
        process.exit(1);
      }
      if (responseCache !== false) {
        responseCache = responseCache ?? {};
        responseCache.maxSizeBytes = mb * 1024 * 1024;
      }
    }
  }

  // Also check environment variable
  if (!mockDir && process.env.ZOWE_MCP_MOCK_DIR) {
    mockDir = process.env.ZOWE_MCP_MOCK_DIR;
  }

  // Response cache from env (CLI takes precedence)
  if (responseCache !== false) {
    const envTtl = process.env.ZOWE_MCP_RESPONSE_CACHE_TTL_MS;
    const envMax = process.env.ZOWE_MCP_RESPONSE_CACHE_MAX_BYTES;
    if (envTtl !== undefined) {
      const ttl = parseInt(envTtl, 10);
      if (!isNaN(ttl) && ttl > 0) {
        responseCache = responseCache ?? {};
        responseCache.ttlMs = ttl;
      }
    }
    if (envMax !== undefined) {
      const max = parseInt(envMax, 10);
      if (!isNaN(max) && max > 0) {
        responseCache = responseCache ?? {};
        responseCache.maxSizeBytes = max;
      }
    }
  }
  if (
    process.env.ZOWE_MCP_RESPONSE_CACHE_DISABLE === '1' ||
    process.env.ZOWE_MCP_RESPONSE_CACHE_DISABLE === 'true'
  ) {
    responseCache = false;
  }

  if (
    process.env.ZOWE_MCP_NATIVE_NO_AUTO_INSTALL_ZNP === '1' ||
    process.env.ZOWE_MCP_NATIVE_NO_AUTO_INSTALL_ZNP === 'true'
  ) {
    nativeNoAutoInstallZnp = true;
  }
  if (process.env.ZOWE_MCP_NATIVE_SERVER_PATH?.trim()) {
    nativeServerPath = process.env.ZOWE_MCP_NATIVE_SERVER_PATH.trim();
  }

  return {
    transport,
    port,
    mockDir,
    native,
    configPath,
    systemSpecs,
    subcommand,
    responseCache,
    nativeNoAutoInstallZnp,
    nativeServerPath,
  };
}

function loadSystemsFromConfig(configPath: string): string[] {
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as { systems?: string[] };
  if (!Array.isArray(config.systems)) {
    throw new Error(`Config file ${configPath} must have a "systems" array`);
  }
  return config.systems;
}

function printHelp(): void {
  const bin = 'zowe-mcp-server';
  console.log(`Zowe MCP Server v${SERVER_VERSION}
Model Context Protocol server for z/OS (datasets, jobs, USS).

Usage:
  npx ${bin} [options]              Start the MCP server (default: stdio)
  npx ${bin} init-mock [options]    Generate a mock data directory
  npx ${bin} call-tool [options]    Call MCP tools via CLI (optional --mock=<dir>)

Transport (server mode):
  --stdio              Use stdio transport (default)
  --http               Use HTTP Streamable transport
  --port <number>      Port for HTTP transport (default: 3000)

Backend (server mode):
  --mock <dir>         Mock backend: use filesystem data from <dir> (or --mock=<dir>, or ZOWE_MCP_MOCK_DIR)
  --native             Zowe Native (SSH) backend
  --config <path>      JSON file with { "systems": ["user@host", ...] } (used with --native)
  --system <spec>      Connection spec user@host or user@host:port (repeatable, used with --native)
  --native-no-auto-install-znp   Do not auto-install ZNP when "Server not found" (default: auto-install)
  --native-server-path <path>    Remote path for ZNP server (default: ~/.zowe-server; or ZOWE_MCP_NATIVE_SERVER_PATH)

Response cache (when backend is used; reduces repeated backend calls):
  --response-cache-disable       Disable response cache (default: enabled, 10 min TTL, 1 GB max)
  --response-cache-ttl-minutes N  Cache entry TTL in minutes (or ZOWE_MCP_RESPONSE_CACHE_TTL_MS)
  --response-cache-max-mb N       Max cache size in MB (or ZOWE_MCP_RESPONSE_CACHE_MAX_BYTES)

Help:
  -h, --help           Show this help and exit.

Subcommands:
  init-mock   Generate a mock data directory. Example:
              npx ${bin} init-mock --output ./zowe-mcp-mock-data [--preset minimal|default|large|inventory|pagination]
  call-tool   List or call MCP tools. Example:
              npx ${bin} call-tool [--mock=<dir> | --native [--config=<path>] [--system <spec> ...]] [<tool-name> [args]]
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const parsed = parseArgs();

  // Handle subcommands
  if (parsed.subcommand === 'init-mock' || parsed.subcommand === 'call-tool') {
    const childProcess = await import('node:child_process');
    const nodePath = await import('node:path');
    const nodeUrl = await import('node:url');
    const __dirname = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
    const scriptPath = nodePath.resolve(__dirname, 'scripts', `${parsed.subcommand}.js`);

    const childArgs = process.argv.slice(3);
    const child = childProcess.fork(scriptPath, childArgs, { stdio: 'inherit' });
    child.on('exit', code => process.exit(code ?? 0));
    return;
  }

  const {
    transport,
    port,
    mockDir,
    native,
    configPath,
    systemSpecs,
    responseCache: responseCacheConfig,
  } = parsed;
  const logger = getLogger();

  if (mockDir && native) {
    logger.error('Cannot use both --mock and --native. Choose one.');
    process.exit(1);
  }

  // Connect to VS Code extension pipe (if env vars are set)
  const extensionClient = await connectExtensionClient(logger);
  /** Captured from systems-update sent on connect (before native setup); applied when native is ready. */
  let pendingSystemsUpdate: string[] | undefined;
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
    // Capture systems-update sent on connect (extension sends current list when we connect)
    extensionClient.onEvent(event => {
      if (event.type === 'systems-update') {
        pendingSystemsUpdate = event.data.systems;
      }
    });
  }

  logger.info(`Starting Zowe MCP Server v${SERVER_VERSION}`, {
    transport,
    ...(transport === 'http' ? { port } : {}),
    ...(mockDir ? { mockDir } : {}),
    ...(native ? { native: true } : {}),
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
  } else if (native) {
    let systems: string[] = [...systemSpecs];
    if (configPath) {
      try {
        const fromConfig = loadSystemsFromConfig(configPath);
        systems = [...fromConfig, ...systemSpecs];
      } catch (err) {
        logger.error('Failed to load native config', err);
        process.exit(1);
      }
    }
    if (systems.length === 0) {
      logger.error(
        'Native mode requires at least one system. Use --config <path> (JSON with "systems" array) or --system user@host (repeatable).'
      );
      process.exit(1);
    }
    const { WaitablePasswordStore } = await import('./zos/native/password-store.js');
    const { loadNative } = await import('./zos/native/load-native.js');
    const { cacheKey } = await import('./zos/native/ssh-client-cache.js');
    const { passwordHash } = await import('./zos/native/password-hash.js');
    const nativePasswordLog = logger.child('native.password');
    const nativePasswordStore = extensionClient?.connected
      ? new WaitablePasswordStore()
      : undefined;
    const nativeSetup = loadNative({
      systems,
      useEnvForPassword: !extensionClient?.connected,
      passwordStore: nativePasswordStore,
      requestPasswordCallback: extensionClient?.connected
        ? (user, host, port) => {
            nativePasswordLog.debug('Sending request-password to extension', {
              user,
              host,
              port: port ?? 22,
            });
            extensionClient.sendEvent({
              type: 'request-password',
              data: { user, host, port },
              timestamp: Date.now(),
            });
          }
        : undefined,
      onPasswordInvalid: extensionClient?.connected
        ? (user, host, port) => {
            nativePasswordLog.info('Sending password-invalid to extension (auth failed)', {
              user,
              host,
              port: port ?? 22,
            });
            extensionClient.sendEvent({
              type: 'password-invalid',
              data: { user, host, port },
              timestamp: Date.now(),
            });
          }
        : undefined,
      autoInstallZnp: !parsed.nativeNoAutoInstallZnp,
      nativeServerPath: parsed.nativeServerPath,
    });
    serverOptions = {
      backend: nativeSetup.backend,
      systemRegistry: nativeSetup.systemRegistry,
      credentialProvider: nativeSetup.credentialProvider,
    };
    if (extensionClient?.connected && nativePasswordStore) {
      extensionClient.onEvent(event => {
        if (event.type === 'password') {
          const { user, host, port, password } = event.data;
          const portNum = port ?? 22;
          const key = cacheKey({ user, host, port: portNum });
          nativePasswordLog.debug('Received password from extension', {
            user,
            host,
            port: portNum,
            key,
            passwordHash: passwordHash(password),
          });
          nativePasswordStore.set(key, password);
          // Any getCredentials() waiting on waitFor(key) will now resolve.
        }
      });
    }
    const updateSystems = nativeSetup.updateSystems;
    if (extensionClient?.connected && updateSystems) {
      extensionClient.onEvent(event => {
        if (event.type === 'systems-update') {
          const { systems } = event.data;
          if (systems.length > 0) {
            logger.info('Applying systems-update from VS Code extension', {
              count: systems.length,
              systems,
            });
            updateSystems(systems);
          }
        }
      });
      // Apply list sent on connect (in case process args were stale, e.g. VS Code cached definition)
      if (pendingSystemsUpdate && pendingSystemsUpdate.length > 0) {
        logger.info('Applying initial systems list from extension pipe', {
          count: pendingSystemsUpdate.length,
          systems: pendingSystemsUpdate,
        });
        updateSystems(pendingSystemsUpdate);
      }
    }
    logger.info('Native (SSH) mode enabled', {
      systems: nativeSetup.systemRegistry.list(),
    });
  }

  if (serverOptions && responseCacheConfig !== undefined) {
    serverOptions.responseCache = responseCacheConfig;
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
  const err = error instanceof Error ? error : new Error(String(error));
  getLogger().emergency('Fatal error', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
