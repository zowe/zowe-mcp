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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalsConfig } from './config.js';
import { log } from './log.js';
import type { SetConfig, ToolCallRecord } from './types.js';

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
  'You are an assistant with access to z/OS dataset tools. Use the provided tools to answer the user. ';

const MAX_STEPS = 10;

export interface HarnessOptions {
  serverPath: string;
  evalsConfig: EvalsConfig;
  setConfig: SetConfig;
  /** Temp dir for mock data (already initialized). If not set and set uses native, mockDir is unused. */
  mockDir?: string;
  /** For native: server args as one string (e.g. "--native --config native-config.json"). */
  nativeServerArgs?: string;
}

export interface AgentRunResult {
  finalText: string;
  toolCalls: ToolCallRecord[];
}

function buildModel(evalsConfig: EvalsConfig): LanguageModel {
  if (evalsConfig.provider === 'vllm') {
    const provider = createOpenAICompatible({
      name: 'vllm',
      baseURL: evalsConfig.base_url ?? 'http://localhost:8000/v1',
      apiKey: evalsConfig.api_key ?? 'no key needed',
    });
    return provider(evalsConfig.server_model) as unknown as LanguageModel;
  }
  const google = createGoogleGenerativeAI({ apiKey: evalsConfig.api_key! });
  return google(evalsConfig.server_model) as unknown as LanguageModel;
}

export function getSystemPrompt(setConfig: SetConfig): string {
  if (setConfig.systemPrompt) return setConfig.systemPrompt;
  const base = DEFAULT_SYSTEM_PROMPT;
  if (setConfig.systemPromptAddition) return base + '\n\n' + setConfig.systemPromptAddition;
  return base;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class McpEvalHarness {
  private client: Client | null = null;
  constructor(private options: HarnessOptions) {}

  async start(): Promise<Client> {
    const { serverPath, setConfig } = this.options;
    const args: string[] = ['--stdio'];

    if (setConfig.native && this.options.nativeServerArgs) {
      args.push(...splitArgs(this.options.nativeServerArgs));
    } else if (this.options.mockDir) {
      args.push('--mock', this.options.mockDir);
    }

    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, ...args],
    });
    const client = new Client({ name: 'zowe-mcp-evals', version: '0.1.0' });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
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
   */
  async runOne(prompt: string): Promise<AgentRunResult> {
    if (!this.client) throw new Error('Harness not started');
    const { tools: mcpTools } = await this.client.listTools();
    const toolCallRecords: ToolCallRecord[] = [];

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
          toolCallRecords.push({ name, arguments: a, result: resultForReport });
          return text;
        },
      }) as unknown as ReturnType<typeof tool>;
    }

    const model = buildModel(this.options.evalsConfig);
    const systemPrompt = getSystemPrompt(this.options.setConfig);

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

    log.debug('AI SDK generateText result', {
      finishReason: result.finishReason,
      usage: result.usage,
      totalUsage: result.totalUsage,
      textPreview: result.text != null ? truncate(result.text) : undefined,
      stepCount: result.steps?.length ?? 0,
      reasoningPreview: result.reasoningText != null ? truncate(result.reasoningText) : undefined,
    });

    const finalText = result.text ?? '';
    return { finalText, toolCalls: toolCallRecords };
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
