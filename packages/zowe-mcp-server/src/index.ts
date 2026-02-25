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
 *   --port N  Port for HTTP transport (default: 7542, Zowe MCP)
 *   --mock <dir>  Start in mock mode with the given data directory
 *   --native  Start with Zowe Native (SSH) backend
 *   --config <path>  JSON file with { "systems": ["user@host", ...] } (used with --native)
 *   --system <spec>  Connection spec user@host or user@host:port (repeatable, used with --native)
 *
 * Subcommands:
 *   init-mock   Generate a mock data directory (delegates to init-mock script)
 *   call-tool  Call MCP tools via in-memory transport (optional --mock <dir>)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type {
  OpenDatasetInEditorEventData,
  OpenJobInEditorEventData,
  OpenUssFileInEditorEventData,
} from './events.js';
import { connectExtensionClient } from './extension-client.js';
import type { CreateServerOptions, CreateServerResult, ZoweExplorerCallbacks } from './server.js';
import { createServer, getLogger, getServer, SERVER_VERSION } from './server.js';
import { startHttp } from './transports/http.js';
import { startStdio } from './transports/stdio.js';
import {
  DEFAULT_MAINFRAME_MVS_ENCODING,
  DEFAULT_MAINFRAME_USS_ENCODING,
  type EncodingOptions,
} from './zos/encoding.js';
import { createJobCardStore } from './zos/job-cards.js';

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
  /** When false, do not auto-install ZNP on "Server not found" (native mode). Default true = auto-install enabled. */
  nativeServerAutoInstall?: boolean;
  /** Override remote path for ZNP server install/run (native mode). Default ~/.zowe-server. */
  nativeServerPath?: string;
  /** Response timeout in seconds for ZNP requests (native mode). Default 60. */
  nativeResponseTimeout?: number;
  /** Default mainframe encoding for MVS data sets (e.g. IBM-037). */
  defaultMvsEncoding?: string;
  /** Default mainframe encoding for USS files (e.g. IBM-1047). */
  defaultUssEncoding?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function applyEnvOverrides(parsed: ParsedArgs): void {
  if (!parsed.mockDir && process.env.ZOWE_MCP_MOCK_DIR) {
    parsed.mockDir = process.env.ZOWE_MCP_MOCK_DIR;
  }
  if (parsed.responseCache !== false) {
    const envTtlMinutes = process.env.ZOWE_MCP_RESPONSE_CACHE_TTL_MINUTES;
    const envTtlMsLegacy = process.env.ZOWE_MCP_RESPONSE_CACHE_TTL_MS;
    const envMax = process.env.ZOWE_MCP_RESPONSE_CACHE_MAX_BYTES;
    if (envTtlMinutes !== undefined) {
      const minutes = parseInt(envTtlMinutes, 10);
      if (!isNaN(minutes) && minutes > 0) {
        parsed.responseCache = parsed.responseCache ?? {};
        parsed.responseCache.ttlMs = minutes * 60 * 1000;
      }
    } else if (envTtlMsLegacy !== undefined) {
      const ttl = parseInt(envTtlMsLegacy, 10);
      if (!isNaN(ttl) && ttl > 0) {
        parsed.responseCache = parsed.responseCache ?? {};
        parsed.responseCache.ttlMs = ttl;
      }
    }
    if (envMax !== undefined) {
      const max = parseInt(envMax, 10);
      if (!isNaN(max) && max > 0) {
        parsed.responseCache = parsed.responseCache ?? {};
        parsed.responseCache.maxSizeBytes = max;
      }
    }
  }
  if (
    process.env.ZOWE_MCP_RESPONSE_CACHE_DISABLE === '1' ||
    process.env.ZOWE_MCP_RESPONSE_CACHE_DISABLE === 'true'
  ) {
    parsed.responseCache = false;
  }
  const envAutoInstall = process.env.ZOWE_MCP_NATIVE_SERVER_AUTO_INSTALL?.toLowerCase();
  if (envAutoInstall === 'false' || envAutoInstall === '0') {
    parsed.nativeServerAutoInstall = false;
  }
  if (process.env.ZOWE_MCP_NATIVE_SERVER_PATH?.trim()) {
    parsed.nativeServerPath = process.env.ZOWE_MCP_NATIVE_SERVER_PATH.trim();
  }
  const envResponseTimeout = process.env.ZOWE_MCP_NATIVE_RESPONSE_TIMEOUT;
  if (envResponseTimeout !== undefined) {
    const sec = parseInt(envResponseTimeout, 10);
    if (!isNaN(sec) && sec > 0) {
      parsed.nativeResponseTimeout = sec;
    }
  }
  if (process.env.ZOWE_MCP_DEFAULT_MVS_ENCODING?.trim()) {
    parsed.defaultMvsEncoding = process.env.ZOWE_MCP_DEFAULT_MVS_ENCODING.trim();
  }
  if (process.env.ZOWE_MCP_DEFAULT_USS_ENCODING?.trim()) {
    parsed.defaultUssEncoding = process.env.ZOWE_MCP_DEFAULT_USS_ENCODING.trim();
  }
}

function parseArgs(): ParsedArgs {
  const parser = yargs(hideBin(process.argv))
    .scriptName('zowe-mcp-server')
    .version(SERVER_VERSION)
    .usage(
      'Model Context Protocol server for z/OS (data sets, jobs, USS).\n\n' +
        'Usage:\n  $0 [options]                    Start the MCP server (default: stdio)\n' +
        '  $0 init-mock [options]                 Generate a mock data directory\n' +
        '  $0 call-tool [options] [tool-name ...]  Call MCP tools via CLI'
    )
    .command(
      'init-mock [args..]',
      'Generate a mock data directory',
      y =>
        y.options({
          output: { type: 'string', describe: 'Output directory for mock data' },
          preset: {
            type: 'string',
            describe: 'Preset: minimal, default, large, inventory, or pagination',
          },
        }),
      () => {
        const scriptPath = resolve(__dirname, 'scripts', 'init-mock.js');
        const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(3)], {
          stdio: 'inherit',
        });
        process.exit(result.status ?? 0);
      }
    )
    .command(
      'call-tool [args..]',
      'Call MCP tools via CLI (optional --mock=<dir>, args as key=value)',
      y =>
        y.options({
          mock: { type: 'string', describe: 'Mock data directory (or --mock=<dir>)' },
          native: { type: 'boolean', describe: 'Use native (SSH) backend' },
          config: {
            type: 'string',
            describe:
              'JSON config path with "systems" (or "connections") array of connection specs (user@host)',
          },
          system: {
            type: 'array',
            string: true,
            describe: 'Connection spec user@host (repeatable)',
          },
        }),
      () => {
        const scriptPath = resolve(__dirname, 'scripts', 'call-tool.js');
        const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(3)], {
          stdio: 'inherit',
        });
        process.exit(result.status ?? 0);
      }
    )
    .options({
      stdio: {
        type: 'boolean',
        default: true,
        describe: 'Use stdio transport (default)',
      },
      http: {
        type: 'boolean',
        default: false,
        describe: 'Use HTTP Streamable transport',
      },
      port: {
        type: 'number',
        default: 7542,
        describe:
          'Port for HTTP transport (default 7542, in Zowe 75xx range; Zowe API ML uses 7552-7558)',
      },
      mock: {
        type: 'string',
        describe:
          'Mock backend: use filesystem data from this directory (or set ZOWE_MCP_MOCK_DIR)',
      },
      native: {
        type: 'boolean',
        default: false,
        describe: 'Zowe Native (SSH) backend',
      },
      config: {
        type: 'string',
        describe:
          'JSON file with { "systems": ["user@host", ...] } — connection specs (used with --native)',
      },
      system: {
        type: 'array',
        string: true,
        describe: 'Connection spec user@host or user@host:port (repeatable, used with --native)',
      },
      'native-server-auto-install': {
        type: 'boolean',
        default: true,
        describe: 'Auto-install ZNP when "Server not found" (default: true)',
      },
      'native-server-path': {
        type: 'string',
        describe:
          'Remote path for ZNP server (default: ~/.zowe-server; or ZOWE_MCP_NATIVE_SERVER_PATH)',
      },
      'native-response-timeout': {
        type: 'number',
        default: 60,
        describe:
          'Response timeout in seconds for ZNP requests (default 60; or ZOWE_MCP_NATIVE_RESPONSE_TIMEOUT)',
      },
      'response-cache-disable': {
        type: 'boolean',
        default: false,
        describe: 'Disable response cache (default: enabled, 10 min TTL, 1 GB max)',
      },
      'response-cache-ttl-minutes': {
        type: 'number',
        describe:
          'Cache entry TTL in minutes (default 10; or ZOWE_MCP_RESPONSE_CACHE_TTL_MINUTES)',
      },
      'response-cache-max-mb': {
        type: 'number',
        describe: 'Max cache size in MB (or ZOWE_MCP_RESPONSE_CACHE_MAX_BYTES)',
      },
      'default-mvs-encoding': {
        type: 'string',
        describe: `Default mainframe encoding for data sets (e.g. IBM-037; or ZOWE_MCP_DEFAULT_MVS_ENCODING)`,
      },
      'default-uss-encoding': {
        type: 'string',
        describe: `Default mainframe encoding for USS files (e.g. IBM-1047; or ZOWE_MCP_DEFAULT_USS_ENCODING)`,
      },
    })
    .alias('h', 'help')
    .help();

  const argv = parser.parseSync() as Record<string, unknown>;

  let responseCache: ResponseCacheConfig | false | undefined = argv['response-cache-disable']
    ? false
    : undefined;
  if (responseCache !== false) {
    const ttl = argv['response-cache-ttl-minutes'] as number | undefined;
    const maxMb = argv['response-cache-max-mb'] as number | undefined;
    if ((ttl !== undefined && ttl > 0) || (maxMb !== undefined && maxMb > 0)) {
      responseCache = responseCache ?? {};
      if (ttl !== undefined && ttl > 0) {
        responseCache.ttlMs = ttl * 60 * 1000;
      }
      if (maxMb !== undefined && maxMb > 0) {
        responseCache.maxSizeBytes = maxMb * 1024 * 1024;
      }
    }
  }

  const systemArg = argv.system;
  const systemSpecs = Array.isArray(systemArg)
    ? (systemArg as string[]).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0
      )
    : [];

  const parsed: ParsedArgs = {
    transport: argv.http ? 'http' : 'stdio',
    port: (argv.port as number) ?? 7542,
    mockDir: argv.mock as string | undefined,
    native: (argv.native as boolean) ?? false,
    configPath: argv.config as string | undefined,
    systemSpecs,
    responseCache,
    nativeServerAutoInstall: (argv['native-server-auto-install'] as boolean) ?? true,
    nativeServerPath: argv['native-server-path'] as string | undefined,
    nativeResponseTimeout: (argv['native-response-timeout'] as number) ?? 60,
    defaultMvsEncoding: argv['default-mvs-encoding'] as string | undefined,
    defaultUssEncoding: argv['default-uss-encoding'] as string | undefined,
  };
  applyEnvOverrides(parsed);
  return parsed;
}

/** Native config file: systems (required when using --config) and optional jobCards. Job card value: string or array of lines. */
interface NativeConfig {
  systems?: string[];
  jobCards?: Record<string, string | string[]>;
}

function loadNativeConfig(configPath: string): NativeConfig {
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as NativeConfig;
  if (!Array.isArray(config.systems)) {
    throw new Error(`Config file ${configPath} must have a "systems" array`);
  }
  return config;
}

async function main(): Promise<void> {
  // Run subcommand scripts directly so they work even if yargs doesn't dispatch (e.g. in bundled extension)
  const subcommand = process.argv[2];
  if (subcommand === 'init-mock' || subcommand === 'call-tool') {
    const scriptPath = resolve(__dirname, 'scripts', `${subcommand}.js`);
    const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(3)], {
      stdio: 'inherit',
    });
    process.exit(result.status ?? 0);
  }

  const parsed = parseArgs();

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
  /** Captured from connections-update sent on connect (before native setup); applied when native is ready. */
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
    // Capture connections-update sent on connect (extension sends current list when we connect)
    extensionClient.onEvent(event => {
      if (event.type === 'connections-update') {
        pendingSystemsUpdate = event.data.connections;
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
  let encodingOptionsRef: { current: EncodingOptions } | undefined;
  /** Set in native mode; used to pass server to elicitation callback after createServer (stdio only). */
  let serverRef: { current: CreateServerResult | null } | undefined;
  /** Current Zowe Explorer callbacks; set at startup or on zowe-explorer-update. Used by HTTP factory and late registration. */
  const zoweExplorerCallbacksRef: { current: ZoweExplorerCallbacks | null } = {
    current: null,
  };
  /** True after we've registered Zowe Explorer tools on the stdio server (avoids double registration). */
  const zoweExplorerToolsRegisteredRef = { current: false };
  if (mockDir) {
    const { loadMock } = await import('./zos/mock/load-mock.js');
    const mock = await loadMock(mockDir);
    encodingOptionsRef = {
      current: {
        defaultMainframeMvsEncoding: parsed.defaultMvsEncoding ?? DEFAULT_MAINFRAME_MVS_ENCODING,
        defaultMainframeUssEncoding: parsed.defaultUssEncoding ?? DEFAULT_MAINFRAME_USS_ENCODING,
      },
    };
    serverOptions = {
      backend: mock.backend,
      systemRegistry: mock.systemRegistry,
      credentialProvider: mock.credentialProvider,
      encodingOptions: encodingOptionsRef,
      jobCardStore: createJobCardStore(),
    };
    logger.info('Mock mode enabled', {
      mockDir,
      systems: mock.systemRegistry.list(),
    });
  } else if (native) {
    let systems: string[] = [...systemSpecs];
    const jobCardStore = createJobCardStore();
    if (configPath) {
      try {
        const fromConfig = loadNativeConfig(configPath);
        systems = [...(fromConfig.systems ?? []), ...systemSpecs];
        if (fromConfig.jobCards) {
          jobCardStore.mergeFromObject(fromConfig.jobCards);
          logger.info('Loaded job cards from config', {
            path: configPath,
            count: Object.keys(fromConfig.jobCards).length,
          });
        }
      } catch (err) {
        logger.error('Failed to load native config', err);
        process.exit(1);
      }
    }
    const extensionConnected = extensionClient?.connected === true;
    if (systems.length === 0 && !extensionConnected) {
      logger.error(
        'Native mode requires at least one system when run standalone. Use --config <path> (JSON with "systems" array) or --system user@host (repeatable).'
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
    /** Set after createServer() for stdio so elicitation callback can use the server. Not set for HTTP (multi-session). */
    serverRef = { current: null };
    const defaultNativeServerPath = '~/.zowe-server';
    const defaultResponseTimeout = 60;
    const nativeOptionsRef = {
      current: {
        autoInstallZnp: parsed.nativeServerAutoInstall ?? true,
        serverPath: parsed.nativeServerPath ?? defaultNativeServerPath,
        responseTimeout: parsed.nativeResponseTimeout ?? defaultResponseTimeout,
      },
    };
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
      requestPasswordViaElicitation: extensionClient?.connected
        ? async (user, host, port) => {
            if (!serverRef) return undefined;
            const s = serverRef.current;
            if (!s) return undefined;
            const server = getServer(s);
            const caps = server.server.getClientCapabilities();
            // Per MCP spec, empty elicitation object defaults to form mode
            if (!caps?.elicitation) return undefined;
            const portNum = port ?? 22;
            const message =
              portNum === 22
                ? `Enter SSH password for ${user}@${host}`
                : `Enter SSH password for ${user}@${host}:${portNum}`;
            try {
              const result = await server.server.elicitInput({
                mode: 'form',
                message,
                requestedSchema: {
                  type: 'object',
                  properties: {
                    password: {
                      type: 'string',
                      title: 'Password',
                      description: `SSH password for ${user}@${host})`,
                    },
                  },
                  required: ['password'],
                },
              });
              if (result.action === 'accept' && result.content?.password) {
                return result.content.password as string;
              }
            } catch (err) {
              nativePasswordLog.debug('Elicitation failed', {
                user,
                host,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            return undefined;
          }
        : undefined,
      onElicitedPasswordUsed: extensionClient?.connected
        ? (user, host, port, password) => {
            nativePasswordLog.debug(
              'Sending store-password to extension (elicited password used)'
            );
            extensionClient.sendEvent({
              type: 'store-password',
              data: { user, host, port, password },
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
      autoInstallZnp: parsed.nativeServerAutoInstall ?? true,
      nativeServerPath: parsed.nativeServerPath,
      responseTimeout: parsed.nativeResponseTimeout ?? defaultResponseTimeout,
      getNativeOptions: extensionClient?.connected ? () => nativeOptionsRef.current : undefined,
    });
    encodingOptionsRef = {
      current: {
        defaultMainframeMvsEncoding: parsed.defaultMvsEncoding ?? DEFAULT_MAINFRAME_MVS_ENCODING,
        defaultMainframeUssEncoding: parsed.defaultUssEncoding ?? DEFAULT_MAINFRAME_USS_ENCODING,
      },
    };
    serverOptions = {
      backend: nativeSetup.backend,
      systemRegistry: nativeSetup.systemRegistry,
      credentialProvider: nativeSetup.credentialProvider,
      encodingOptions: encodingOptionsRef,
      jobCardStore,
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
    if (extensionClient?.connected) {
      extensionClient.onEvent(event => {
        if (event.type === 'job-cards-update') {
          const { jobCards } = event.data;
          if (jobCards && typeof jobCards === 'object') {
            jobCardStore.mergeFromObject(jobCards);
            logger.info('Applied job-cards-update from VS Code extension', {
              count: Object.keys(jobCards).length,
            });
          }
        }
        if (event.type === 'job-card') {
          const { user, host, port, jobCard } = event.data;
          const portNum = port ?? 22;
          const spec = portNum === 22 ? `${user}@${host}` : `${user}@${host}:${portNum}`;
          jobCardStore.set(spec, jobCard);
          logger.info('Stored job card from extension', { connectionSpec: spec });
        }
      });
    }
    const updateSystems = nativeSetup.updateSystems;
    if (extensionClient?.connected && updateSystems) {
      extensionClient.onEvent(event => {
        if (event.type === 'connections-update') {
          const { connections } = event.data;
          if (connections.length > 0) {
            logger.info('Applying connections-update from VS Code extension', {
              count: connections.length,
              connections,
            });
            updateSystems(connections);
          }
        }
        if (event.type === 'native-options-update') {
          const { installZoweNativeServerAutomatically, zoweNativeServerPath, responseTimeout } =
            event.data;
          nativeOptionsRef.current = {
            autoInstallZnp: installZoweNativeServerAutomatically,
            serverPath: zoweNativeServerPath ?? nativeOptionsRef.current.serverPath,
            responseTimeout: responseTimeout ?? nativeOptionsRef.current.responseTimeout,
          };
          logger.info('Applied native-options-update from VS Code extension', {
            installZoweNativeServerAutomatically,
            zoweNativeServerPath: zoweNativeServerPath ?? '(unchanged)',
            responseTimeout: responseTimeout ?? '(unchanged)',
          });
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

  // When extension is connected and we have encoding options, handle runtime updates (mock or native)
  if (encodingOptionsRef && extensionClient?.connected) {
    extensionClient.onEvent(event => {
      if (event.type === 'encoding-options-update') {
        const d = event.data;
        if (d.defaultMainframeMvsEncoding !== undefined) {
          encodingOptionsRef.current.defaultMainframeMvsEncoding = d.defaultMainframeMvsEncoding;
        }
        if (d.defaultMainframeUssEncoding !== undefined) {
          encodingOptionsRef.current.defaultMainframeUssEncoding = d.defaultMainframeUssEncoding;
        }
        logger.info('Applied encoding-options-update from VS Code extension', {
          defaultMainframeMvsEncoding: d.defaultMainframeMvsEncoding ?? '(unchanged)',
          defaultMainframeUssEncoding: d.defaultMainframeUssEncoding ?? '(unchanged)',
        });
      }
    });
  }

  if (extensionClient?.connected) {
    extensionClient.onEvent(event => {
      if (event.type === 'zowe-explorer-update') {
        const { available } = event.data;
        const callbacks = available ? buildZoweExplorerCallbacks() : null;
        zoweExplorerCallbacksRef.current = callbacks;
        if (available && callbacks) {
          if (serverRef?.current && 'registerZoweExplorerTools' in serverRef.current) {
            if (!zoweExplorerToolsRegisteredRef.current) {
              serverRef.current.registerZoweExplorerTools(callbacks);
              zoweExplorerToolsRegisteredRef.current = true;
              logger.info('Registered Zowe Explorer open-in-editor tools (dynamic update)');
            }
            return;
          }
          if (transport === 'http') {
            logger.info(
              'Zowe Explorer available; new HTTP sessions will have open-in-editor tools'
            );
          }
        } else if (!available) {
          logger.info('Zowe Explorer no longer reported available by extension');
        }
      }
    });
  }

  if (serverOptions && responseCacheConfig !== undefined) {
    serverOptions.responseCache = responseCacheConfig;
  }

  const buildZoweExplorerCallbacks = (): ZoweExplorerCallbacks | null => {
    if (!extensionClient?.connected) return null;
    return {
      openInZoweEditor: (payload: OpenDatasetInEditorEventData) => {
        extensionClient.sendEvent({
          type: 'open-dataset-in-editor',
          data: payload,
          timestamp: Date.now(),
        });
      },
      openUssFileInZoweEditor: (payload: OpenUssFileInEditorEventData) => {
        extensionClient.sendEvent({
          type: 'open-uss-file-in-editor',
          data: payload,
          timestamp: Date.now(),
        });
      },
      openJobInZoweEditor: (payload: OpenJobInEditorEventData) => {
        extensionClient.sendEvent({
          type: 'open-job-in-editor',
          data: payload,
          timestamp: Date.now(),
        });
      },
    };
  };

  if (process.env.ZOWE_EXPLORER_AVAILABLE === '1' && extensionClient?.connected === true) {
    const callbacks = buildZoweExplorerCallbacks();
    if (callbacks) {
      serverOptions ??= {};
      serverOptions.openInZoweEditor = callbacks.openInZoweEditor;
      serverOptions.openUssFileInZoweEditor = callbacks.openUssFileInZoweEditor;
      serverOptions.openJobInZoweEditor = callbacks.openJobInZoweEditor;
      zoweExplorerCallbacksRef.current = callbacks;
    }
  }

  if (transport === 'stdio') {
    const created = createServer(serverOptions);
    const server = getServer(created);
    if (serverRef) {
      serverRef.current = created;
    }
    if (zoweExplorerCallbacksRef.current && 'registerZoweExplorerTools' in created) {
      zoweExplorerToolsRegisteredRef.current = true;
    }
    await startStdio(server, logger);
  } else {
    await startHttp(
      () => {
        const opts: CreateServerOptions | undefined = serverOptions
          ? { ...serverOptions }
          : undefined;
        if (opts && zoweExplorerCallbacksRef.current) {
          opts.openInZoweEditor = zoweExplorerCallbacksRef.current.openInZoweEditor;
          opts.openUssFileInZoweEditor = zoweExplorerCallbacksRef.current.openUssFileInZoweEditor;
          opts.openJobInZoweEditor = zoweExplorerCallbacksRef.current.openJobInZoweEditor;
        }
        const result = createServer(opts);
        return getServer(result);
      },
      port,
      logger
    );
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
          'or set "zoweMCP.mockDataDirectory" in Settings to an existing mock data directory.',
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
