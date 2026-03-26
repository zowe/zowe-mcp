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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type {
  CeedumpCollectedEventData,
  OpenDatasetInEditorEventData,
  OpenJobInEditorEventData,
  OpenUssFileInEditorEventData,
} from './events.js';
import { connectExtensionClient, type ExtensionClient } from './extension-client.js';
import type { CreateServerOptions, CreateServerResult, ZoweExplorerCallbacks } from './server.js';
import { createServer, getLogger, getServer, SERVER_VERSION } from './server.js';
import {
  createEmptyPluginState,
  loadAndRegisterPluginYaml,
} from './tools/cli-bridge/cli-tool-loader.js';
import type { CliPluginProfilesFile, CliPluginState } from './tools/cli-bridge/types.js';
import { startHttp } from './transports/http.js';
import { startStdio } from './transports/stdio.js';
import {
  DEFAULT_MAINFRAME_MVS_ENCODING,
  DEFAULT_MAINFRAME_USS_ENCODING,
  type EncodingOptions,
} from './zos/encoding.js';
import { createJobCardStore, type JobCardStore } from './zos/job-cards.js';
import type { NativeOptions } from './zos/native/ssh-client-cache.js';

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
  /** Repeatable CLI directories allowed for local upload/download when MCP roots are unavailable. */
  localFilesRoots?: string[];
  /**
   * CLI plugin bridge entries loaded from repeatable --cli-plugin-yaml / --cli-plugin-connection-file flag pairs.
   * Each entry activates one plugin YAML. When connectionFile is present its JSON is read as CliPluginProfilesFile.
   */
  cliPlugins: CliPluginEntry[];
  /** Description variant applied to all CLI plugins (cli | intent | optimized). Sets ZOWE_MCP_CLI_DESC_VARIANT. */
  cliPluginDescVariant?: string;
  /**
   * Directory to scan for plugin YAML files. Defaults to `<server-dist>/tools/cli-bridge/plugins/`.
   * Override via --cli-plugins-dir or ZOWE_MCP_CLI_PLUGINS_DIR env var.
   */
  cliPluginsDir?: string;
  /**
   * Plugin names to enable from the plugins directory. Empty = all plugins in the dir.
   * Populated from repeatable --cli-plugin-enable flags.
   */
  enabledCliPlugins: string[];
  /**
   * Map of plugin name to connection JSON file path for auto-discovered plugins.
   * Populated from repeatable --cli-plugin-connection name=file flags.
   */
  cliPluginConfiguration: Record<string, string>;
}

/** One CLI plugin bridge entry (one --cli-plugin-yaml / --cli-plugin-connection-file pair). */
interface CliPluginEntry {
  /** Absolute path to the plugin YAML file. */
  yamlPath: string;
  /** Absolute path to a CliPluginProfilesFile JSON file. When absent, an empty profile state is used. */
  connectionFile?: string;
}

/** Build unique absolute fallback dirs for local file tools (workspace env, CLI, ZOWE_MCP_LOCAL_FILES_ROOT). */
function buildLocalFilesFallbackDirectories(parsed: ParsedArgs): string[] {
  const dirs: string[] = [];
  if (process.env.ZOWE_MCP_WORKSPACE_DIR?.trim()) {
    dirs.push(resolve(process.env.ZOWE_MCP_WORKSPACE_DIR.trim()));
  }
  for (const r of parsed.localFilesRoots ?? []) {
    dirs.push(resolve(r.trim()));
  }
  for (const part of (process.env.ZOWE_MCP_LOCAL_FILES_ROOT ?? '').split(',')) {
    const t = part.trim();
    if (t) dirs.push(resolve(t));
  }
  return [...new Set(dirs)];
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
  if (!parsed.cliPluginsDir && process.env.ZOWE_MCP_CLI_PLUGINS_DIR?.trim()) {
    parsed.cliPluginsDir = process.env.ZOWE_MCP_CLI_PLUGINS_DIR.trim();
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
      'generate-docs',
      'Generate Markdown documentation of all MCP tools, prompts, and resources',
      y =>
        y.options({
          output: {
            type: 'string',
            describe: 'Output file path (default: docs/mcp-reference.md)',
          },
        }),
      () => {
        const scriptPath = resolve(__dirname, 'scripts', 'generate-docs.js');
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
      'local-files-root': {
        type: 'array',
        string: true,
        describe:
          'Directory allowed for upload/download tools when MCP roots/list is unavailable (repeatable). Also set ZOWE_MCP_LOCAL_FILES_ROOT (comma-separated) or ZOWE_MCP_WORKSPACE_DIR.',
      },
      'cli-plugin-yaml': {
        type: 'array',
        string: true,
        describe:
          'Path to a CLI plugin YAML file (repeatable). Each occurrence activates one plugin. ' +
          'Pair with --cli-plugin-connection-file by index for the connection config.',
      },
      'cli-plugin-connection-file': {
        type: 'array',
        string: true,
        describe:
          'Path to a CliPluginProfilesFile JSON file for the corresponding --cli-plugin-yaml (repeatable, matched by index).',
      },
      'cli-plugin-desc-variant': {
        type: 'string',
        describe:
          'Description variant for CLI plugin tools: cli, intent, or optimized (default: intent). Sets ZOWE_MCP_CLI_DESC_VARIANT.',
      },
      'cli-plugins-dir': {
        type: 'string',
        describe:
          'Directory to scan for plugin YAML files (default: <server-dist>/tools/cli-bridge/plugins). ' +
          'Override with ZOWE_MCP_CLI_PLUGINS_DIR env var.',
      },
      'cli-plugin-enable': {
        type: 'array',
        string: true,
        describe:
          'Plugin name(s) to enable from the plugins directory (repeatable). Default: all plugins in the dir.',
      },
      'cli-plugin-connection': {
        type: 'array',
        string: true,
        describe:
          'Connection file for an auto-discovered plugin: name=connfile (repeatable, e.g. endevor=/path/to/conn.json).',
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

  const localFilesRootArg = argv['local-files-root'];
  const localFilesRoots = Array.isArray(localFilesRootArg)
    ? localFilesRootArg.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];

  // Build CLI plugin entries from repeatable --cli-plugin-yaml / --cli-plugin-connection-file pairs
  const cliPluginYamlArg = argv['cli-plugin-yaml'];
  const cliPluginYamlPaths = Array.isArray(cliPluginYamlArg)
    ? (cliPluginYamlArg as string[]).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0
      )
    : [];
  const cliPluginConnectionFileArg = argv['cli-plugin-connection-file'];
  const cliPluginConnectionFiles = Array.isArray(cliPluginConnectionFileArg)
    ? (cliPluginConnectionFileArg as string[]).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0
      )
    : [];
  const cliPlugins: CliPluginEntry[] = cliPluginYamlPaths.map((yamlPath, i) => ({
    yamlPath,
    connectionFile: cliPluginConnectionFiles[i] ?? undefined,
  }));

  const cliPluginEnableArg = argv['cli-plugin-enable'];
  const enabledCliPlugins = Array.isArray(cliPluginEnableArg)
    ? (cliPluginEnableArg as string[]).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0
      )
    : [];

  const cliPluginConnectionArg = argv['cli-plugin-connection'];
  const cliPluginConfiguration: Record<string, string> = {};
  if (Array.isArray(cliPluginConnectionArg)) {
    for (const entry of cliPluginConnectionArg as string[]) {
      const eqIdx = entry.indexOf('=');
      if (eqIdx > 0) {
        const name = entry.slice(0, eqIdx).trim();
        const file = entry.slice(eqIdx + 1).trim();
        if (name && file) {
          cliPluginConfiguration[name] = file;
        }
      }
    }
  }

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
    localFilesRoots,
    cliPlugins,
    cliPluginDescVariant: argv['cli-plugin-desc-variant'] as string | undefined,
    cliPluginsDir: argv['cli-plugins-dir'] as string | undefined,
    enabledCliPlugins,
    cliPluginConfiguration,
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

/**
 * Build the loadNative callback options that forward events to the VS Code extension pipe.
 * Only called when the extension client is connected.
 */
function buildNativeExtensionCallbacks(
  extensionClient: ExtensionClient,
  nativePasswordLog: ReturnType<typeof getLogger>,
  serverRef: { current: CreateServerResult | null },
  nativeOptionsRef: { current: NativeOptions }
): {
  requestPasswordCallback: (user: string, host: string, port?: number) => void;
  requestPasswordViaElicitation: (
    user: string,
    host: string,
    port?: number
  ) => Promise<string | undefined>;
  onElicitedPasswordUsed: (
    user: string,
    host: string,
    port: number | undefined,
    password: string
  ) => void;
  onPasswordInvalid: (user: string, host: string, port?: number) => void;
  onCeedumpCollected: (data: CeedumpCollectedEventData) => void;
  getNativeOptions: () => NativeOptions;
} {
  return {
    requestPasswordCallback: (user, host, port) => {
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
    },
    requestPasswordViaElicitation: async (user, host, port) => {
      const s = serverRef.current;
      if (!s) return undefined;
      const server = getServer(s);
      const caps = server.server.getClientCapabilities();
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
    },
    onElicitedPasswordUsed: (user, host, port, password) => {
      nativePasswordLog.debug('Sending store-password to extension (elicited password used)');
      extensionClient.sendEvent({
        type: 'store-password',
        data: { user, host, port, password },
        timestamp: Date.now(),
      });
    },
    onPasswordInvalid: (user, host, port) => {
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
    },
    onCeedumpCollected: data => {
      extensionClient.sendEvent({
        type: 'ceedump-collected',
        data: {
          path: data.path,
          reason: data.reason,
          znpOperation: data.znpOperation,
          mcpTool: data.mcpTool,
        },
        timestamp: Date.now(),
      });
    },
    getNativeOptions: () => nativeOptionsRef.current,
  };
}

/** Options for {@link setupExtensionEventHandlers}. Only relevant fields need to be provided. */
interface ExtensionEventHandlerOptions {
  logger: ReturnType<typeof getLogger>;
  transport: 'stdio' | 'http';
  nativePasswordStore?: {
    set: (key: string, password: string) => void;
  };
  cacheKey?: (spec: { user: string; host: string; port: number }) => string;
  passwordHash?: (password: string) => string;
  nativePasswordLog?: ReturnType<typeof getLogger>;
  jobCardStore?: JobCardStore;
  nativeOptionsRef?: { current: NativeOptions };
  encodingOptionsRef?: { current: EncodingOptions };
  updateSystems?: (systems: string[]) => void;
  pendingSystemsUpdate?: string[];
  zoweExplorerCallbacksRef: { current: ZoweExplorerCallbacks | null };
  zoweExplorerToolsRegisteredRef: { current: boolean };
  serverRef?: { current: CreateServerResult | null };
  buildZoweExplorerCallbacks: () => ZoweExplorerCallbacks | null;
}

/**
 * Register all Extension-to-Server event handlers on the extension client.
 * Consolidates the many `extensionClient.onEvent(...)` calls into a single dispatch.
 */
function setupExtensionEventHandlers(
  extensionClient: ExtensionClient,
  opts: ExtensionEventHandlerOptions
): void {
  const { logger } = opts;

  extensionClient.onEvent(event => {
    switch (event.type) {
      case 'log-level': {
        const { level } = event.data;
        logger.info(`Log level changed to "${level}" by VS Code extension`);
        logger.setLevel(level);
        break;
      }

      case 'password': {
        if (opts.nativePasswordStore && opts.cacheKey && opts.passwordHash) {
          const { user, host, port, password } = event.data;
          const portNum = port ?? 22;
          const key = opts.cacheKey({ user, host, port: portNum });
          opts.nativePasswordLog?.debug('Received password from extension', {
            user,
            host,
            port: portNum,
            key,
            passwordHash: opts.passwordHash(password),
          });
          opts.nativePasswordStore.set(key, password);
        }
        break;
      }

      case 'job-cards-update': {
        if (opts.jobCardStore) {
          const { jobCards } = event.data;
          if (jobCards && typeof jobCards === 'object') {
            opts.jobCardStore.mergeFromObject(jobCards);
            logger.info('Applied job-cards-update from VS Code extension', {
              count: Object.keys(jobCards).length,
            });
          }
        }
        break;
      }

      case 'job-card': {
        if (opts.jobCardStore) {
          const { user, host, port, jobCard } = event.data;
          const portNum = port ?? 22;
          const spec = portNum === 22 ? `${user}@${host}` : `${user}@${host}:${portNum}`;
          opts.jobCardStore.set(spec, jobCard);
          logger.info('Stored job card from extension', { connectionSpec: spec });
        }
        break;
      }

      case 'connections-update': {
        if (opts.updateSystems) {
          const { connections } = event.data;
          if (connections.length > 0) {
            logger.info('Applying connections-update from VS Code extension', {
              count: connections.length,
              connections,
            });
            opts.updateSystems(connections);
          }
        }
        break;
      }

      case 'native-options-update': {
        if (opts.nativeOptionsRef) {
          const { installZoweNativeServerAutomatically, zoweNativeServerPath, responseTimeout } =
            event.data;
          opts.nativeOptionsRef.current = {
            autoInstallZnp: installZoweNativeServerAutomatically,
            serverPath: zoweNativeServerPath ?? opts.nativeOptionsRef.current.serverPath,
            responseTimeout: responseTimeout ?? opts.nativeOptionsRef.current.responseTimeout,
          };
          logger.info('Applied native-options-update from VS Code extension', {
            installZoweNativeServerAutomatically,
            zoweNativeServerPath: zoweNativeServerPath ?? '(unchanged)',
            responseTimeout: responseTimeout ?? '(unchanged)',
          });
        }
        break;
      }

      case 'encoding-options-update': {
        if (opts.encodingOptionsRef) {
          const d = event.data;
          if (d.defaultMainframeMvsEncoding !== undefined) {
            opts.encodingOptionsRef.current.defaultMainframeMvsEncoding =
              d.defaultMainframeMvsEncoding;
          }
          if (d.defaultMainframeUssEncoding !== undefined) {
            opts.encodingOptionsRef.current.defaultMainframeUssEncoding =
              d.defaultMainframeUssEncoding;
          }
          logger.info('Applied encoding-options-update from VS Code extension', {
            defaultMainframeMvsEncoding: d.defaultMainframeMvsEncoding ?? '(unchanged)',
            defaultMainframeUssEncoding: d.defaultMainframeUssEncoding ?? '(unchanged)',
          });
        }
        break;
      }

      case 'zowe-explorer-update': {
        const { available } = event.data;
        const callbacks = available ? opts.buildZoweExplorerCallbacks() : null;
        opts.zoweExplorerCallbacksRef.current = callbacks;
        if (available && callbacks) {
          if (opts.serverRef?.current && 'registerZoweExplorerTools' in opts.serverRef.current) {
            if (!opts.zoweExplorerToolsRegisteredRef.current) {
              opts.serverRef.current.registerZoweExplorerTools(callbacks);
              opts.zoweExplorerToolsRegisteredRef.current = true;
              logger.info('Registered Zowe Explorer open-in-editor tools (dynamic update)');
            }
            return;
          }
          if (opts.transport === 'http') {
            logger.info(
              'Zowe Explorer available; new HTTP sessions will have open-in-editor tools'
            );
          }
        } else if (!available) {
          logger.info('Zowe Explorer no longer reported available by extension');
        }
        break;
      }

      default:
        break;
    }
  });

  // Apply pending systems list sent on connect (before native setup completed)
  if (opts.updateSystems && opts.pendingSystemsUpdate && opts.pendingSystemsUpdate.length > 0) {
    logger.info('Applying initial systems list from extension pipe', {
      count: opts.pendingSystemsUpdate.length,
      systems: opts.pendingSystemsUpdate,
    });
    opts.updateSystems(opts.pendingSystemsUpdate);
  }
}

async function main(): Promise<void> {
  // Run subcommand scripts directly so they work even if yargs doesn't dispatch (e.g. in bundled extension)
  const subcommand = process.argv[2];
  if (subcommand === 'init-mock' || subcommand === 'call-tool' || subcommand === 'generate-docs') {
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
    // Capture connections-update sent on connect (extension sends current list when we connect).
    // This temporary handler runs before setupExtensionEventHandlers so we don't miss the initial event.
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
  /** Native-specific options for setupExtensionEventHandlers; populated in the native branch. */
  let nativeEventHandlerOpts:
    | {
        nativePasswordStore?: { set: (key: string, password: string) => void };
        cacheKey: (spec: { user: string; host: string; port: number }) => string;
        passwordHash: (password: string) => string;
        nativePasswordLog: ReturnType<typeof getLogger>;
        jobCardStore: JobCardStore;
        nativeOptionsRef: { current: NativeOptions };
        updateSystems?: (systems: string[]) => void;
      }
    | undefined;
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
    const nativePasswordStore = extensionConnected ? new WaitablePasswordStore() : undefined;
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
    const extensionCallbacks =
      extensionConnected && extensionClient
        ? buildNativeExtensionCallbacks(
            extensionClient,
            nativePasswordLog,
            serverRef,
            nativeOptionsRef
          )
        : {};
    const nativeSetup = loadNative({
      systems,
      useEnvForPassword: !extensionConnected,
      passwordStore: nativePasswordStore,
      ...extensionCallbacks,
      autoInstallZnp: parsed.nativeServerAutoInstall ?? true,
      nativeServerPath: parsed.nativeServerPath,
      responseTimeout: parsed.nativeResponseTimeout ?? defaultResponseTimeout,
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
    nativeEventHandlerOpts = {
      nativePasswordStore,
      cacheKey,
      passwordHash,
      nativePasswordLog,
      jobCardStore,
      nativeOptionsRef,
      updateSystems: nativeSetup.updateSystems,
    };
    logger.info('Native (SSH) mode enabled', {
      systems: nativeSetup.systemRegistry.list(),
    });
  }

  if (serverOptions && responseCacheConfig !== undefined) {
    serverOptions.responseCache = responseCacheConfig;
  }

  if (serverOptions) {
    serverOptions.localFilesFallbackDirectories = buildLocalFilesFallbackDirectories(parsed);
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

  // Register all extension event handlers in one consolidated dispatch
  if (extensionClient?.connected) {
    setupExtensionEventHandlers(extensionClient, {
      logger,
      transport,
      ...nativeEventHandlerOpts,
      encodingOptionsRef,
      pendingSystemsUpdate,
      zoweExplorerCallbacksRef,
      zoweExplorerToolsRegisteredRef,
      serverRef,
      buildZoweExplorerCallbacks,
    });
  }

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

  if (extensionClient?.connected === true) {
    serverOptions ??= {};
    serverOptions.onActiveConnectionChanged = (activeConnection: string | null) => {
      extensionClient.sendEvent({
        type: 'active-connection-changed',
        data: { activeConnection },
        timestamp: Date.now(),
      });
    };
  }

  // Apply description variant env var before registering CLI plugin tools
  if (parsed.cliPluginDescVariant) {
    process.env.ZOWE_MCP_CLI_DESC_VARIANT = parsed.cliPluginDescVariant;
  }

  /**
   * Builds a CliPluginState from a CliPluginProfilesFile.
   * Populates profilesByType and activeProfileId from the file.
   * A standalone password resolver (env vars) is always created;
   * in VS Code mode the shared WaitablePasswordStore is used when available.
   */
  function buildPluginState(
    profilesFile: CliPluginProfilesFile,
    vsCodePasswordStore?: {
      get(key: string): string | undefined;
      waitFor(key: string, timeoutMs: number): Promise<string | undefined>;
    }
  ): CliPluginState {
    const state = createEmptyPluginState();
    for (const [typeKey, typeData] of Object.entries(profilesFile)) {
      state.profilesByType.set(typeKey, typeData.profiles ?? []);
      if (typeData.default) {
        state.activeProfileId.set(typeKey, typeData.default);
      }
    }

    // Wire password resolver
    state.passwordResolver = {
      async getPassword(user: string, host: string): Promise<string> {
        // VS Code mode: use waitable password store (request-password events)
        if (vsCodePasswordStore) {
          const key = `${user}@${host}`;
          const cached = vsCodePasswordStore.get(key);
          if (cached !== undefined) return cached;
          const pw = await vsCodePasswordStore.waitFor(key, 120_000);
          if (pw !== undefined) return pw;
        }
        // Standalone mode (or VS Code fallback): read from env var
        // Format: ZOWE_MCP_PASSWORD_<USER>_<HOST> (uppercase, dots/special chars → _)
        const userPart = user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const hostPart = host.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const envVar = `ZOWE_MCP_PASSWORD_${userPart}_${hostPart}`;
        const envPw = process.env[envVar];
        if (envPw !== undefined && envPw !== '') return envPw;
        throw new Error(
          `No password available for ${user}@${host}. Set ${envVar} environment variable.`
        );
      },
    };
    return state;
  }

  /** Register all CLI plugin bridge tools on an already-created server. */
  function registerCliPlugins(
    server: ReturnType<typeof getServer>,
    vsCodePasswordStore?: {
      get(key: string): string | undefined;
      waitFor(key: string, timeoutMs: number): Promise<string | undefined>;
    }
  ): void {
    // Explicit entries (--cli-plugin-yaml / --cli-plugin-connection-file pairs)
    for (const entry of parsed.cliPlugins) {
      let profilesFile: CliPluginProfilesFile = {};
      if (entry.connectionFile) {
        const raw = readFileSync(entry.connectionFile, 'utf-8');
        profilesFile = JSON.parse(raw) as CliPluginProfilesFile;
      }
      const state = buildPluginState(profilesFile, vsCodePasswordStore);
      loadAndRegisterPluginYaml(server, entry.yamlPath, state, logger);
      logger.info('CLI plugin bridge tools registered (explicit)', {
        yamlPath: entry.yamlPath,
        connectionFile: entry.connectionFile,
        descVariant: process.env.ZOWE_MCP_CLI_DESC_VARIANT ?? 'intent',
      });
    }

    // Auto-discovery: scan plugins directory for YAML files
    const pluginsDir =
      parsed.cliPluginsDir ?? resolve(__dirname, 'tools', 'cli-bridge', 'plugins');
    if (!existsSync(pluginsDir)) {
      if (parsed.cliPluginsDir) {
        logger.warning('CLI plugins directory not found', { pluginsDir });
      }
      return;
    }
    const yamlFiles = readdirSync(pluginsDir).filter((f: string) => f.endsWith('.yaml'));
    if (yamlFiles.length === 0) return;
    for (const fileName of yamlFiles) {
      const yamlPath = resolve(pluginsDir, fileName);
      // Filter by enabled plugin names (based on the plugin: field in the YAML)
      // We do a quick name check by stripping -tools.yaml suffix as a heuristic,
      // but we validate against the actual plugin name after loading.
      const heuristicName = fileName.replace(/-tools\.yaml$/, '').replace(/\.yaml$/, '');
      if (
        parsed.enabledCliPlugins.length > 0 &&
        !parsed.enabledCliPlugins.includes(heuristicName)
      ) {
        logger.info('CLI plugin skipped (not in --cli-plugin-enable list)', {
          plugin: heuristicName,
          yamlPath,
        });
        continue;
      }
      // Build state from profiles file (--cli-plugin-connection map)
      let profilesFile: CliPluginProfilesFile = {};
      const connFile = parsed.cliPluginConfiguration[heuristicName];
      if (connFile) {
        const raw = readFileSync(connFile, 'utf-8');
        profilesFile = JSON.parse(raw) as CliPluginProfilesFile;
      }
      const state = buildPluginState(profilesFile, vsCodePasswordStore);
      const pluginConfig = loadAndRegisterPluginYaml(server, yamlPath, state, logger);
      logger.info('CLI plugin bridge tools registered (auto-discovered)', {
        plugin: pluginConfig.plugin,
        yamlPath,
        connectionFile: connFile,
        descVariant: process.env.ZOWE_MCP_CLI_DESC_VARIANT ?? 'intent',
      });
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
    registerCliPlugins(server);
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
        const server = getServer(result);
        registerCliPlugins(server);
        return server;
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
