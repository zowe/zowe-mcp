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
 *   --native      Use the Zowe Remote SSH backend.
 *   --config=<path>  JSON file with { "systems": ["user@host", ...] } — connection specs (used with --native).
 *   --system <spec>  Connection spec user@host or user@host:port (repeatable, used with --native).
 *
 * Tool arguments are key=value pairs. Values are strings unless they look like numbers or booleans (true/false).
 * Passwords for native mode: ZOWE_MCP_PASSWORD_<USER>_<HOST> and/or ZOWE_MCP_CREDENTIALS (JSON map).
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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '../log.js';
import { createServer, getServer, type CreateServerOptions } from '../server.js';
import {
  createEmptyPluginState,
  loadAndRegisterPluginYaml,
} from '../tools/cli-bridge/cli-tool-loader.js';
import type { CliPluginProfilesFile } from '../tools/cli-bridge/types.js';
import { loadMock } from '../zos/mock/load-mock.js';
import {
  isEnvFlagSet,
  parseConnectionSpec,
  resolveStandalonePassword,
  toPasswordEnvVarName,
} from '../zos/native/connection-spec.js';
import { loadNative } from '../zos/native/load-native.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  /** Generic CLI plugin connections: map of plugin name → connection file path. */
  cliPluginConnections: Map<string, string>;
  /** Optional explicit YAML paths per plugin name (--cli-plugin-yaml name=path). */
  cliPluginYamls: Map<string, string>;
  /** Optional description variant override. */
  cliPluginDescVariant?: string;
} {
  const args = process.argv.slice(2);
  let i = 0;
  let mockDir: string | undefined;
  let native = false;
  let configPath: string | undefined;
  const systemSpecs: string[] = [];
  const cliPluginConnections = new Map<string, string>();
  const cliPluginYamls = new Map<string, string>();
  let cliPluginDescVariant: string | undefined;

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
    } else if (arg === '--cli-plugin-configuration' && i + 1 < args.length) {
      // --cli-plugin-configuration name=file
      const val = args[i + 1];
      const eq = val.indexOf('=');
      if (eq === -1)
        throw new Error(`--cli-plugin-configuration requires name=file format, got: ${val}`);
      cliPluginConnections.set(val.slice(0, eq), val.slice(eq + 1));
      i += 2;
    } else if (arg.startsWith('--cli-plugin-configuration=')) {
      // --cli-plugin-configuration=name=file
      const val = arg.slice('--cli-plugin-configuration='.length);
      const eq = val.indexOf('=');
      if (eq === -1)
        throw new Error(`--cli-plugin-configuration requires name=file format, got: ${val}`);
      cliPluginConnections.set(val.slice(0, eq), val.slice(eq + 1));
      i += 1;
    } else if (arg === '--cli-plugin-yaml' && i + 1 < args.length) {
      // --cli-plugin-yaml name=path
      const val = args[i + 1];
      const eq = val.indexOf('=');
      if (eq === -1) throw new Error(`--cli-plugin-yaml requires name=path format, got: ${val}`);
      cliPluginYamls.set(val.slice(0, eq), val.slice(eq + 1));
      i += 2;
    } else if (arg.startsWith('--cli-plugin-yaml=')) {
      const val = arg.slice('--cli-plugin-yaml='.length);
      const eq = val.indexOf('=');
      if (eq === -1) throw new Error(`--cli-plugin-yaml requires name=path format, got: ${val}`);
      cliPluginYamls.set(val.slice(0, eq), val.slice(eq + 1));
      i += 1;
    } else if (arg === '--cli-plugin-desc-variant' && i + 1 < args.length) {
      cliPluginDescVariant = args[i + 1];
      i += 2;
    } else if (arg.startsWith('--cli-plugin-desc-variant=')) {
      cliPluginDescVariant = arg.slice('--cli-plugin-desc-variant='.length);
      i += 1;
    } else {
      break;
    }
  }

  if (!mockDir && process.env.ZOWE_MCP_MOCK_DIR) {
    mockDir = process.env.ZOWE_MCP_MOCK_DIR;
  }

  const toolName = args[i];
  const argsRest = i + 1 < args.length ? args.slice(i + 1) : [];
  return {
    mockDir,
    native,
    configPath,
    systemSpecs,
    toolName,
    argsRest,
    cliPluginConnections,
    cliPluginYamls,
    cliPluginDescVariant,
  };
}

/**
 * Build tool arguments from key=value pairs.
 *
 * Value coercion rules (applied to each `raw`):
 *   - `key:str=value`   → forces string (no number/bool coercion). Use for octal-looking
 *                         args like `chmodUssFile mode:str=644`.
 *   - `key:int=value`   → parseInt.
 *   - `key:bool=value`  → true/false.
 *   - `key:json=value`  → JSON.parse(value); use for nested objects.
 *   - `key=@-`          → read the value from stdin (then JSON-parsed if it looks like
 *                         an array/object, otherwise split into a line array if the key
 *                         is named "lines", else string).
 *   - `key=@FILE`       → read the value from the named file (same parsing as @-).
 *   - `key=[...]` / `key={...}`  → JSON-parsed.
 *   - `key=value` plain → boolean ('true'/'false') if exact match, else number if
 *                         Number(value) is a finite number, else string. (Original behavior.)
 *
 * The `:type` selector is BEFORE the `=`, e.g. `mode:str=644`, `lines:json=["a","b"]`.
 */
function buildToolArgs(argsRest: string[]): Record<string, unknown> {
  if (argsRest.length === 0) return {};

  const out: Record<string, unknown> = {};
  for (const arg of argsRest) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      throw new Error(`Invalid argument "${arg}": expected key=value`);
    }
    const keyAndType = arg.slice(0, eq).trim();
    const raw = arg.slice(eq + 1);
    const colon = keyAndType.indexOf(':');
    const key = colon >= 0 ? keyAndType.slice(0, colon) : keyAndType;
    const typeHint = colon >= 0 ? keyAndType.slice(colon + 1).toLowerCase() : undefined;
    if (!key) {
      throw new Error(`Invalid argument "${arg}": missing key before =`);
    }
    let materialized = raw;
    if (raw === '@-') {
      materialized = readStdinSync();
    } else if (raw.startsWith('@') && raw.length > 1) {
      materialized = readFileSyncUtf8(raw.slice(1));
    }
    out[key] = applyTypeHint(materialized, typeHint, key);
  }
  return out;
}

function applyTypeHint(raw: string, hint: string | undefined, key: string): unknown {
  if (hint === 'str' || hint === 'string') return raw;
  if (hint === 'int') {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) throw new Error(`Invalid int for ${key}: ${raw}`);
    return n;
  }
  if (hint === 'num' || hint === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${key}: ${raw}`);
    return n;
  }
  if (hint === 'bool' || hint === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`Invalid bool for ${key}: ${raw}`);
  }
  if (hint === 'json') {
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON for ${key}: ${(e as Error).message}`);
    }
  }
  if (hint !== undefined) {
    throw new Error(`Unknown type hint :${hint} for ${key}`);
  }
  return coerceValue(raw, key);
}

function readStdinSync(): string {
  // Synchronous stdin read for short CLI inputs. Returns the buffer up to EOF.
  return readFileSyncUtf8('/dev/stdin');
}

function readFileSyncUtf8(p: string): string {
  return readFileSync(p, 'utf-8');
}

function coerceValue(raw: string, key?: string): unknown {
  const s = raw.trim();
  // JSON literal? (array or object)
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      return JSON.parse(s);
    } catch {
      /* fall through */
    }
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (s !== '' && !Number.isNaN(n)) {
    // Heuristic: if the value came from a key named like "mode", "perms", "permissions"
    // and the raw text is a short octal-looking string, keep it as a string so
    // chmod / chmodUssFile schemas (which require string) don't reject.
    if (key && /^(mode|perms|permissions|umask)$/i.test(key) && /^0*[0-7]{3,4}$/.test(s)) {
      return raw;
    }
    return n;
  }
  return raw;
}

async function main(): Promise<void> {
  const {
    mockDir,
    native,
    configPath,
    systemSpecs,
    toolName,
    argsRest,
    cliPluginConnections,
    cliPluginYamls,
    cliPluginDescVariant,
  } = parseArgs();
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
    const disableSshKey = isEnvFlagSet(process.env.ZOWE_MCP_DISABLE_SSH_KEY);
    const nativeSetup = loadNative({
      systems,
      useEnvForPassword: true,
      disableSshKey,
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

  // Register CLI bridge plugins for each --cli-plugin-configuration name=file entry.
  if (cliPluginDescVariant) {
    process.env.ZOWE_MCP_CLI_DESC_VARIANT = cliPluginDescVariant;
  }

  if (cliPluginConnections.size > 0) {
    const { existsSync, readdirSync, readFileSync: rf } = await import('node:fs');

    // Build candidate YAML search paths: built-in plugins dir + vendor dirs
    const vendorDir = resolve(__dirname, '..', '..', '..', '..', 'vendor');
    const builtinPluginsDir = resolve(__dirname, '..', 'tools', 'cli-bridge', 'plugins');

    for (const [pluginName, connFile] of cliPluginConnections.entries()) {
      const raw = rf(connFile, 'utf-8');
      const profilesFile = JSON.parse(raw) as CliPluginProfilesFile;

      const pluginState = createEmptyPluginState();
      for (const [typeKey, typeData] of Object.entries(profilesFile)) {
        pluginState.profilesByType.set(typeKey, typeData.profiles ?? []);
        if (typeData.default) {
          pluginState.activeProfileId.set(typeKey, typeData.default);
        }
      }
      // Standalone password resolver via env vars
      pluginState.passwordResolver = {
        async getPassword(user: string, host: string): Promise<string> {
          const spec = parseConnectionSpec(`${user}@${host}`);
          const pw = await resolveStandalonePassword(spec);
          if (pw !== undefined) return pw;
          const envVar = toPasswordEnvVarName(spec.user, spec.host);
          throw new Error(
            `No password for ${user}@${host}. Set ${envVar}, ZOWE_MCP_CREDENTIALS, or Vault KV (see AGENTS.md).`
          );
        },
      };

      // Resolve YAML path: explicit override → built-in → vendor
      let yamlPath = cliPluginYamls.get(pluginName);
      if (!yamlPath) {
        const builtinCandidate = resolve(builtinPluginsDir, `${pluginName}-tools.yaml`);
        if (existsSync(builtinCandidate)) {
          yamlPath = builtinCandidate;
        } else if (existsSync(vendorDir)) {
          for (const entry of readdirSync(vendorDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const candidate = resolve(
              vendorDir,
              entry.name,
              'cli-bridge-plugins',
              `${pluginName}-tools.yaml`
            );
            if (existsSync(candidate)) {
              yamlPath = candidate;
              break;
            }
          }
        }
      }

      if (!yamlPath) {
        throw new Error(
          `Could not find ${pluginName}-tools.yaml. Provide an explicit path with --cli-plugin-yaml ${pluginName}=<path>.`
        );
      }

      loadAndRegisterPluginYaml(server, yamlPath, pluginState, log);
      log.info('CLI bridge plugin tools registered', { plugin: pluginName, yamlPath });
    }
  }

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

main()
  // Force exit on clean completion. Without this, the SSH keepalive timer in the
  // native backend (ssh2.Client, default 30s) keeps Node's event loop alive long
  // after the work and `server.close()` have finished, causing the CLI to sit idle
  // before terminating. Loop callers don't want that.
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log.error('Error', error);
    process.exit(1);
  });
