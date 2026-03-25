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
import type { SetConfig, SetEndevorMockEwsConfig, TokenUsage, ToolCallRecord } from './types.js';

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
  /**
   * When set, the harness starts a mock Endevor Web Services server before starting the MCP server,
   * and optionally uses an alternative MCP server (e.g. code4z-gen-ai) instead of zowe-mcp-server.
   */
  endevorMockEws?: SetEndevorMockEwsConfig;
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

export class McpEvalHarness {
  private client: Client | null = null;
  private mockEwsProcess: ChildProcess | null = null;

  constructor(private options: HarnessOptions) {}

  async start(): Promise<Client> {
    const { setConfig } = this.options;
    const ewsCfg = this.options.endevorMockEws;

    if (ewsCfg) {
      await this.startMockEws(ewsCfg);
    }

    const mcpScript = ewsCfg?.mcpServerScript ?? this.options.serverPath;
    const args: string[] = [];

    if (ewsCfg?.mcpServerScript) {
      if (ewsCfg.mcpServerArgs) {
        args.push(...splitArgs(ewsCfg.mcpServerArgs));
      }
    } else {
      args.push('--stdio');
      if (setConfig.native && this.options.nativeServerArgs) {
        args.push(...splitArgs(this.options.nativeServerArgs));
      } else if (this.options.mockDir) {
        args.push('--mock', this.options.mockDir);
      } else if (ewsCfg) {
        const port = ewsCfg.port ?? 8080;
        args.push(
          '--endevor-host',
          'localhost',
          '--endevor-port',
          String(port),
          '--endevor-user',
          'USER',
          '--endevor-password',
          'PASSWORD',
          '--endevor-instance',
          'ENDEVOR',
          '--endevor-protocol',
          'http',
          '--endevor-base-path',
          'EndevorService/api/v2'
        );
      }
    }

    const env = { ...process.env } as Record<string, string>;
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
   * Start the mock Endevor Web Services server and wait for it to be ready.
   */
  private async startMockEws(cfg: SetEndevorMockEwsConfig): Promise<void> {
    const port = cfg.port ?? 8080;
    const args = ['serve', '--config', cfg.configPath, '--port', String(port)];
    log.info('Starting mock EWS server', { cliScript: cfg.cliScript, port });
    this.mockEwsProcess = spawn('node', [cfg.cliScript, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.mockEwsProcess.stderr?.on('data', (data: Buffer) => {
      log.debug('mock-ews stderr', { text: data.toString().trim() });
    });
    this.mockEwsProcess.stdout?.on('data', (data: Buffer) => {
      log.debug('mock-ews stdout', { text: data.toString().trim() });
    });
    await waitForPort(port, 15000);
    log.info('Mock EWS server ready', { port });
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.mockEwsProcess) {
      this.mockEwsProcess.kill('SIGTERM');
      this.mockEwsProcess = null;
      log.info('Mock EWS server stopped');
    }
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
    const toolAliases = this.options.endevorMockEws?.toolAliases ?? {};

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
