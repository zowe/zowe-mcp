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

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { LanguageModel } from 'ai';
import { generateText, jsonSchema, stepCountIs, tool } from 'ai';
import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalsConfig } from './config.js';
import { log } from './log.js';
import type {
  CliPluginConnection,
  MockServerDef,
  SetConfig,
  TokenUsage,
  ToolCallRecord,
} from './types.js';

const DEBUG_MAX_TEXT = 500;

function truncate(s: string, max: number = DEBUG_MAX_TEXT): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function prepareStepPayload(options: {
  stepNumber: number;
  steps: unknown[];
  messages: unknown[];
}): Record<string, unknown> {
  const userContent: string[] = [];
  for (const m of options.messages) {
    const msg = m as { role?: string; content?: string | unknown[] };
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') userContent.push(msg.content);
    else if (Array.isArray(msg.content))
      for (const part of msg.content) {
        const p = part as { type?: string; text?: string };
        if (p.type === 'text' && typeof p.text === 'string') userContent.push(p.text);
      }
  }
  return {
    stepNumber: options.stepNumber,
    previousSteps: options.steps.length,
    userMessagePreview: truncate(userContent.join('\n')),
  };
}

function stepFinishPayload(result: {
  finishReason?: string;
  usage?: unknown;
  totalUsage?: unknown;
  text?: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  isContinued?: boolean;
}): Record<string, unknown> {
  const toolCallsSummary =
    result.toolCalls?.map((tc: unknown) => {
      const t = tc as { toolName?: string; input?: unknown };
      return {
        tool: t.toolName,
        args: t.input != null ? Object.keys(t.input as object) : [],
      };
    }) ?? [];
  return {
    finishReason: result.finishReason,
    usage: result.usage,
    totalUsage: result.totalUsage,
    textPreview: result.text != null ? truncate(result.text) : undefined,
    toolCalls: toolCallsSummary,
    toolResultCount: result.toolResults?.length ?? 0,
    isContinued: result.isContinued,
  };
}

const DEFAULT_SYSTEM_PROMPT =
  'You are an assistant with access to z/OS data set tools. Use the provided tools to answer the user. ';

const MAX_STEPS = 10;

export interface HarnessOptions {
  serverPath: string;
  evalsConfig: EvalsConfig;
  setConfig: SetConfig;
  /** Temp dir for mock data (already initialized). If not set and set uses native, mockDir is unused. */
  mockDir?: string;
  /** For native: server args as one string (e.g. "--native --config native-config.json"). */
  nativeServerArgs?: string;
  /**
   * Workspace directory for local upload/download MCP tools (`ZOWE_MCP_WORKSPACE_DIR`).
   * Use {@link prepareEvalWorkspace} to create a temp dir with a seed file for upload questions.
   */
  workspaceDir?: string;
}

export interface AgentRunResult {
  finalText: string;
  toolCalls: ToolCallRecord[];
  /** Wall-clock duration of the agent run in milliseconds. */
  durationMs: number;
  /** Token usage from the Vercel AI SDK (undefined when provider does not report usage). */
  tokenUsage?: TokenUsage;
  /** Number of agent steps taken. */
  stepCount: number;
}

function buildModel(evalsConfig: EvalsConfig): LanguageModel {
  if (evalsConfig.provider === 'vllm') {
    const provider = createOpenAICompatible({
      name: 'vllm',
      baseURL: evalsConfig.baseUrl ?? 'http://localhost:8000/v1',
      apiKey: evalsConfig.apiKey ?? 'no key needed',
    });
    return provider(evalsConfig.serverModel) as unknown as LanguageModel;
  }
  if (evalsConfig.provider === 'lmstudio') {
    const provider = createOpenAICompatible({
      name: 'lmstudio',
      baseURL: evalsConfig.baseUrl ?? 'http://localhost:1234/v1',
      apiKey: evalsConfig.apiKey ?? 'no key needed',
    });
    return provider(evalsConfig.serverModel) as unknown as LanguageModel;
  }
  const google = createGoogleGenerativeAI({ apiKey: evalsConfig.apiKey! });
  return google(evalsConfig.serverModel) as unknown as LanguageModel;
}

export function getSystemPrompt(setConfig: SetConfig, serverInstructions?: string): string {
  if (setConfig.systemPrompt) return setConfig.systemPrompt;
  let base = DEFAULT_SYSTEM_PROMPT;
  if (serverInstructions) base += '\n\n' + serverInstructions;
  if (setConfig.systemPromptAddition) base += '\n\n' + setConfig.systemPromptAddition;
  return base;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Applies plugin-specific defaults to a CliPluginConnection and returns
 * a CliPluginProfilesFile JSON object for writing to the connection temp file.
 *
 * Currently knows defaults for the `endevor` plugin (localhost/USER/http/etc.).
 * The password is NOT written to the file; instead the env var
 * `ZOWE_MCP_PASSWORD_<USER>_<HOST>` is set on the server process.
 */
function resolveCliPluginConnection(
  pluginName: string,
  conn: CliPluginConnection
): { profilesFile: Record<string, unknown>; passwordEnvVars: Record<string, string> } {
  const endevorDefaults: CliPluginConnection = {
    host: 'localhost',
    user: 'USER',
    password: 'PASSWORD',
    protocol: 'http',
    basePath: 'EndevorService/api/v2',
    instance: 'ENDEVOR',
  };
  const defaults = pluginName === 'endevor' ? endevorDefaults : {};
  const merged: CliPluginConnection = { ...defaults, ...conn };

  // Collect password env vars (not stored in profiles file)
  const passwordEnvVars: Record<string, string> = {};
  if (merged.password && merged.user && merged.host) {
    const userPart = merged.user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const hostPart = merged.host.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    passwordEnvVars[`ZOWE_MCP_PASSWORD_${userPart}_${hostPart}`] = merged.password;
  }

  // Build CliPluginProfilesFile format
  const connectionProfile: Record<string, unknown> = { id: 'default' };
  if (merged.host !== undefined) connectionProfile.host = merged.host;
  if (merged.port !== undefined) connectionProfile.port = Number(merged.port);
  if (merged.user !== undefined) connectionProfile.user = merged.user;
  if (merged.protocol !== undefined) connectionProfile.protocol = merged.protocol;
  if (merged.basePath !== undefined) connectionProfile.basePath = merged.basePath;
  if (merged.database !== undefined) connectionProfile.database = merged.database;
  if ((merged as { rejectUnauthorized?: boolean }).rejectUnauthorized !== undefined) {
    connectionProfile.rejectUnauthorized = (
      merged as { rejectUnauthorized?: boolean }
    ).rejectUnauthorized;
  }
  // instance from pluginParams (legacy) or top-level instance field
  const instance = merged.instance ?? merged.pluginParams?.instance;
  if (instance !== undefined) connectionProfile.instance = instance;
  // All pluginParams entries are copied to the profile (generic extension point)
  if (merged.pluginParams) {
    for (const [k, v] of Object.entries(merged.pluginParams)) {
      if (k !== 'instance') connectionProfile[k] = v;
    }
  }

  const profilesFile: Record<string, unknown> = {
    connection: { profiles: [connectionProfile], default: 'default' },
  };

  return { profilesFile, passwordEnvVars };
}

export class McpEvalHarness {
  private client: Client | null = null;
  /** All running external mock server processes (EWS + generic). Killed in stop(). */
  private mockServerProcesses: ChildProcess[] = [];
  /** Temp directories created for mock server data/config. Removed in stop(). */
  private mockServerDirs: string[] = [];
  /** Resolved port per mock server name (set in startGenericMockServer, read in start()). */
  private mockServerPorts = new Map<string, number>();

  constructor(private options: HarnessOptions) {}

  async start(): Promise<Client> {
    const { setConfig } = this.options;

    for (const def of setConfig.mockServers ?? []) {
      await this.startGenericMockServer(def);
    }

    const mcpScript = setConfig.mcpServerScript ?? this.options.serverPath;
    const args: string[] = [];
    const passwordEnvVarsForServer: Record<string, string> = {};

    if (setConfig.mcpServerScript) {
      if (setConfig.mcpServerArgs) {
        args.push(...splitArgs(substitutePortRefs(setConfig.mcpServerArgs, this.mockServerPorts)));
      }
    } else {
      args.push('--stdio');
      if (setConfig.native && this.options.nativeServerArgs) {
        args.push(...splitArgs(this.options.nativeServerArgs));
      } else if (this.options.mockDir) {
        args.push('--mock', this.options.mockDir);
      }
      // CLI bridge plugin connections (can coexist with any backend).
      // Auto-derive from mockServers[].pluginName; explicit cliPluginConfiguration take precedence.
      const autoConnections: Record<string, CliPluginConnection> = {};
      for (const def of setConfig.mockServers ?? []) {
        if (def.pluginName) {
          autoConnections[def.pluginName] = {
            port: this.mockServerPorts.get(def.name) ?? def.port ?? 8080,
          };
        }
      }
      const effectiveConnections = {
        ...autoConnections,
        ...(setConfig.cliPluginConfiguration ?? {}),
      };
      if (Object.keys(effectiveConnections).length > 0) {
        const pluginsDir =
          setConfig.cliPluginsDir ?? resolve(dirname(mcpScript), 'tools', 'cli-bridge', 'plugins');
        args.push('--cli-plugins-dir', pluginsDir);
        for (const [pluginName, conn] of Object.entries(effectiveConnections)) {
          const { profilesFile, passwordEnvVars: pluginPasswordEnvVars } =
            resolveCliPluginConnection(pluginName, conn);
          const connFile = join(tmpdir(), `cli-plugin-conn-${pluginName}-${Date.now()}.json`);
          writeFileSync(connFile, JSON.stringify(profilesFile));
          args.push('--cli-plugin-configuration', `${pluginName}=${connFile}`);
          // Merge plugin password env vars into the process env for the server
          Object.assign(passwordEnvVarsForServer, pluginPasswordEnvVars);
        }
        if (setConfig.cliPluginDescVariant) {
          args.push('--cli-plugin-desc-variant', setConfig.cliPluginDescVariant);
        }
      }
    }

    const env = { ...process.env, ...passwordEnvVarsForServer } as Record<string, string>;
    if (this.options.workspaceDir) {
      env.ZOWE_MCP_WORKSPACE_DIR = this.options.workspaceDir;
    }

    const transport = new StdioClientTransport({
      command: 'node',
      args: [mcpScript, ...args],
      env,
    });
    const client = new Client({ name: 'zowe-mcp-evals', version: '0.1.0' });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  /**
   * Starts a generic mock server, optionally running an init command first in a
   * harness-managed temp directory. The temp dir and any generated config file
   * are cleaned up when stop() is called.
   */
  private async startGenericMockServer(def: MockServerDef): Promise<void> {
    let configFilePath: string | undefined;
    let dataDir = '';

    if (def.initArgs ?? def.configTemplate) {
      const tempDir = mkdtempSync(join(tmpdir(), `mock-server-${def.name}-`));
      this.mockServerDirs.push(tempDir);
      dataDir = join(tempDir, 'data');

      if (def.initArgs) {
        const resolvedInitArgs = def.initArgs.replace(/\{dataDir\}/g, dataDir);
        log.info('Running mock server init', { name: def.name, initArgs: resolvedInitArgs });
        const result = spawnSync('node', [def.cliScript, ...splitArgs(resolvedInitArgs)], {
          cwd: tempDir,
          stdio: 'pipe',
        });
        if (result.status !== 0) {
          throw new Error(
            `Mock server init failed (${def.name}): ${result.stderr?.toString().trim()}`
          );
        }
      }

      if (def.configTemplate) {
        // Content written below after port is resolved
        configFilePath = join(tempDir, def.configOutputName ?? 'config.json');
      } else if (def.initArgs) {
        configFilePath = join(tempDir, def.configOutputName ?? 'mock-ews-config.json');
      }
    }

    // Determine port: dynamic allocation when serveArgs contains ${availablePort}, else fixed.
    const port = def.serveArgs?.includes('${availablePort}')
      ? await findAvailablePort()
      : (def.port ?? 8080);
    this.mockServerPorts.set(def.name, port);

    // Write configTemplate content now that port is known
    if (def.configTemplate && configFilePath) {
      const filled = JSON.stringify(def.configTemplate)
        .replace(/\{dataDir\}/g, dataDir)
        .replace(/\{port\}/g, String(port));
      writeFileSync(configFilePath, filled);
    }

    // Build the server start args
    let serverArgs: string[];
    if (def.serveArgs) {
      const resolved = def.serveArgs
        .replace(/\$\{availablePort\}/g, String(port))
        .replace(/\{port\}/g, String(port))
        .replace(/\{dataDir\}/g, dataDir);
      const baseArgs = splitArgs(resolved);
      if (configFilePath) {
        // Inject --config <path> after the subcommand (first word)
        const [subcommand, ...rest] = baseArgs;
        serverArgs = [subcommand, def.configFlag ?? '--config', configFilePath, ...rest];
      } else {
        serverArgs = baseArgs;
      }
    } else {
      // Legacy: build from fixed port + optional startArgs
      const legacyDataDir = dataDir || join(this.mockServerDirs.at(-1) ?? tmpdir(), 'data');
      const startArgsList = def.startArgs
        ? splitArgs(
            def.startArgs.replace(/\{dataDir\}/g, legacyDataDir).replace(/\{port\}/g, String(port))
          )
        : [];
      serverArgs = ['serve'];
      if (configFilePath) serverArgs.push(def.configFlag ?? '--config', configFilePath);
      serverArgs.push('--port', String(port), ...startArgsList);
    }

    log.info('Starting mock server', { name: def.name, cliScript: def.cliScript, port });
    const proc = spawn('node', [def.cliScript, ...serverArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr?.on('data', (data: Buffer) => {
      log.debug(`mock-server(${def.name}) stderr`, { text: data.toString().trim() });
    });
    proc.stdout?.on('data', (data: Buffer) => {
      log.debug(`mock-server(${def.name}) stdout`, { text: data.toString().trim() });
    });
    this.mockServerProcesses.push(proc);
    await waitForPort(port, 15000);
    log.info('Mock server ready', { name: def.name, port });
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    for (const proc of this.mockServerProcesses) {
      proc.kill('SIGTERM');
    }
    if (this.mockServerProcesses.length > 0) {
      log.info('Mock server(s) stopped', { count: this.mockServerProcesses.length });
      this.mockServerProcesses = [];
    }
    for (const dir of this.mockServerDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    this.mockServerDirs = [];
  }

  /**
   * Returns the MCP server instructions received during initialization.
   * Call after start().
   */
  getServerInstructions(): string | undefined {
    return this.client?.getInstructions();
  }

  /**
   * Returns tool definitions from the MCP server for cache key building.
   * Call after start().
   */
  async getToolDefinitions(): Promise<ToolDefinition[]> {
    if (!this.client) throw new Error('Harness not started');
    const { tools: mcpTools } = await this.client.listTools();
    return mcpTools.map(t => ({
      name: t.name,
      description: t.description ?? undefined,
      inputSchema: t.inputSchema,
    }));
  }

  /**
   * Run the agent for one question and return final text and all tool calls.
   * Tool call names are normalized using toolAliases (if configured) so assertions
   * can use canonical names regardless of which MCP server was used.
   */
  async runOne(prompt: string): Promise<AgentRunResult> {
    if (!this.client) throw new Error('Harness not started');
    const { tools: mcpTools } = await this.client.listTools();
    const toolCallRecords: ToolCallRecord[] = [];
    const toolAliases = this.options.setConfig.toolAliases ?? {};

    const tools: Record<string, ReturnType<typeof tool>> = {};
    for (const t of mcpTools) {
      const name = t.name;
      const description = t.description ?? `Tool: ${name}`;
      const schema = t.inputSchema as Parameters<typeof jsonSchema>[0];
      tools[name] = tool({
        description,
        inputSchema: jsonSchema(schema),
        execute: async (args: unknown) => {
          const a = args as Record<string, unknown>;
          const result = await this.client!.callTool({ name, arguments: a });
          const content = result.content as { type: string; text?: string }[];
          const text = content?.find(c => c.type === 'text')?.text ?? JSON.stringify(result);
          const resultForReport =
            text.length > 16000 ? text.slice(0, 16000) + '\n… [truncated]' : text;
          const canonicalName = toolAliases[name] ?? name;
          toolCallRecords.push({ name: canonicalName, arguments: a, result: resultForReport });
          return text;
        },
      }) as unknown as ReturnType<typeof tool>;
    }

    const model = buildModel(this.options.evalsConfig);
    const serverInstructions = this.client.getInstructions();
    log.info('Server instructions', {
      hasInstructions: serverInstructions != null,
      length: serverInstructions?.length ?? 0,
      preview: serverInstructions?.slice(0, 100),
    });
    const systemPrompt = getSystemPrompt(this.options.setConfig, serverInstructions);

    const t0 = Date.now();
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      prepareStep(options) {
        log.debug('AI SDK prepareStep (before request)', prepareStepPayload(options));
        return {};
      },
      onStepFinish(stepResult: {
        finishReason?: string;
        usage?: unknown;
        totalUsage?: unknown;
        text?: string;
        toolCalls?: unknown[];
        toolResults?: unknown[];
        isContinued?: boolean;
      }) {
        log.debug('AI SDK onStepFinish', stepFinishPayload(stepResult));
      },
    });
    const durationMs = Date.now() - t0;

    log.debug('AI SDK generateText result', {
      finishReason: result.finishReason,
      usage: result.usage,
      totalUsage: result.totalUsage,
      textPreview: result.text != null ? truncate(result.text) : undefined,
      stepCount: result.steps?.length ?? 0,
      reasoningPreview: result.reasoningText != null ? truncate(result.reasoningText) : undefined,
    });

    const u = result.usage;
    const tokenUsage: TokenUsage | undefined = u
      ? { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, total: u.totalTokens ?? 0 }
      : undefined;
    const stepCount = result.steps?.length ?? 0;
    const finalText = result.text ?? '';
    return { finalText, toolCalls: toolCallRecords, durationMs, tokenUsage, stepCount };
  }
}

/**
 * Initialize mock data directory using the server's init-mock command.
 */
/**
 * Build init-mock args from a single string (split on whitespace).
 */
function splitArgs(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/**
 * Module-level set of ports allocated in this process.
 * Prevents two harness instances in the same process from picking the same port.
 */
const allocatedPorts = new Set<number>();

/**
 * Find the first available TCP port starting from `startFrom` (default 10000).
 * Records the chosen port so subsequent calls in the same process don't reuse it.
 */
async function findAvailablePort(startFrom = 10000): Promise<number> {
  const { createServer } = await import('node:net');
  let port = startFrom;
  while (true) {
    if (allocatedPorts.has(port)) {
      port++;
      continue;
    }
    const available = await new Promise<boolean>(resolve => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, () => srv.close(() => resolve(true)));
    });
    if (available) {
      allocatedPorts.add(port);
      return port;
    }
    port++;
  }
}

/**
 * Replace `${port:<serverName>}` placeholders in a string using the resolved port map.
 * Used to inject dynamic mock server ports into `mcpServerArgs`.
 */
function substitutePortRefs(s: string, ports: Map<string, number>): string {
  return s.replace(/\$\{port:([^}]+)\}/g, (match, name: string) => {
    const p = ports.get(name);
    if (p === undefined) throw new Error(`${match}: no resolved port for mock server '${name}'`);
    return String(p);
  });
}

/**
 * Poll a TCP port until it accepts connections or the timeout expires.
 * Used to wait for the mock EWS server to become ready.
 */
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const { createConnection } = await import('node:net');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(res => setTimeout(res, 200));
    const ok = await new Promise<boolean>(resolve => {
      const s = createConnection({ port, host: '127.0.0.1' }, () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
  }
  throw new Error(`Timed out waiting for port ${port.toString()} to be ready`);
}

export function initMockData(serverPath: string, initArgs: string): string {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-evals-mock-'));
  const extra = splitArgs(initArgs);
  const args = [serverPath, 'init-mock', '--output', tmpDir, ...extra];

  const packageRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'zowe-mcp-server'
  );
  const r = spawnSync('node', args, { cwd: packageRoot, encoding: 'utf-8' });
  if (r.status !== 0) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`init-mock failed: ${r.stderr ?? r.stdout}`);
  }
  return tmpDir;
}

/** Seed file written by {@link prepareEvalWorkspace} for upload eval questions. */
export const EVAL_UPLOAD_SEED_FILENAME = 'eval-upload-source.txt';

const EVAL_UPLOAD_SEED_CONTENT = 'Zowe MCP local eval upload seed.\n';

/**
 * Creates a temp workspace directory and a UTF-8 seed file for `uploadFileToDataset` / `uploadFileToUssFile` evals.
 * Pass the returned path as {@link HarnessOptions.workspaceDir}.
 */
export function prepareEvalWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zowe-mcp-evals-ws-'));
  writeFileSync(join(dir, EVAL_UPLOAD_SEED_FILENAME), EVAL_UPLOAD_SEED_CONTENT, 'utf-8');
  return dir;
}
