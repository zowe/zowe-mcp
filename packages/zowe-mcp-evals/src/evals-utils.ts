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

import { isAbsolute, resolve } from 'node:path';
import type { JudgeFn } from './assertions.js';
import { runAssertions } from './assertions.js';
import { getConfigDir } from './config.js';
import type { AgentRunResult, ToolDefinition } from './harness.js';
import type { Question, QuestionTurn, RunResult, TokenUsage } from './types.js';

export const PASS = '\u2713';
export const FAIL = '\u2717';

export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const apiErr = err as unknown as Record<string, unknown>;
  if (typeof apiErr.statusCode === 'number')
    parts.push(`statusCode: ${apiErr.statusCode.toString()}`);
  if (typeof apiErr.url === 'string') parts.push(`url: ${apiErr.url}`);
  if (typeof apiErr.responseBody === 'string' && apiErr.responseBody.length > 0) {
    parts.push(`responseBody: ${apiErr.responseBody.slice(0, 2000)}`);
  }
  if (apiErr.cause instanceof Error) parts.push(`cause: ${apiErr.cause.message}`);
  return parts.join('\n  ');
}

/**
 * Resolve relative --config paths in native serverArgs against the config directory (repo root).
 */
export function resolveNativeServerArgs(serverArgs: string): string {
  const tokens = serverArgs.trim().split(/\s+/).filter(Boolean);
  const idx = tokens.indexOf('--config');
  if (idx !== -1 && idx + 1 < tokens.length) {
    const configPath = tokens[idx + 1];
    if (!isAbsolute(configPath)) {
      tokens[idx + 1] = resolve(getConfigDir(), configPath);
    }
  }
  return tokens.join(' ');
}

/**
 * Build a subset of tool definitions keyed by name, for cache-key computation.
 */
export function buildToolDefsSubset(
  toolDefinitions: ToolDefinition[] | undefined,
  toolNames: string[]
): Record<string, { description?: string; inputSchema?: unknown }> {
  const toolDefs: Record<string, { description?: string; inputSchema?: unknown }> = {};
  if (toolDefinitions) {
    for (const name of toolNames) {
      const t = toolDefinitions.find(td => td.name === name);
      if (t) toolDefs[name] = { description: t.description, inputSchema: t.inputSchema };
    }
  }
  return toolDefs;
}

interface AssertAndRecordInput {
  questionId: string;
  prompt: string;
  runIndex: number;
  finalText: string;
  toolCalls: RunResult['toolCalls'];
  assertionBlock: Question['assertionBlock'];
  durationMs?: number;
  tokenUsage?: TokenUsage;
  stepCount?: number;
}

/**
 * Run assertions against a completed eval run and return a RunResult.
 */
export async function assertAndRecord(
  input: AssertAndRecordInput,
  judge?: JudgeFn
): Promise<RunResult> {
  const { passed, failedAssertion } = await runAssertions(
    input.assertionBlock,
    input.toolCalls,
    input.finalText,
    input.prompt,
    judge
  );
  return {
    questionId: input.questionId,
    prompt: input.prompt,
    runIndex: input.runIndex,
    passed,
    toolCalls: input.toolCalls,
    finalText: input.finalText,
    assertionFailed: failedAssertion,
    durationMs: input.durationMs,
    tokenUsage: input.tokenUsage,
    stepCount: input.stepCount,
  };
}

/**
 * Assert a multi-turn conversation: each question turn's assertions are checked
 * against that turn's own tool calls and final answer. The run passes only if every
 * turn passes; the first failing turn's message is prefixed with its turn number.
 * The returned RunResult carries cumulative tool calls and the last turn's final text.
 */
export async function assertConversation(
  input: {
    questionId: string;
    displayPrompt: string;
    runIndex: number;
    questionTurns: QuestionTurn[];
    conversation: { turns: AgentRunResult[] } & AgentRunResult;
  },
  judge?: JudgeFn
): Promise<RunResult> {
  const base: RunResult = {
    questionId: input.questionId,
    prompt: input.displayPrompt,
    runIndex: input.runIndex,
    passed: true,
    toolCalls: input.conversation.toolCalls,
    finalText: input.conversation.finalText,
    durationMs: input.conversation.durationMs,
    tokenUsage: input.conversation.tokenUsage,
    stepCount: input.conversation.stepCount,
  };
  for (let i = 0; i < input.questionTurns.length; i++) {
    const turnRun = input.conversation.turns[i];
    if (!turnRun) {
      return { ...base, passed: false, assertionFailed: `turn ${i + 1}: no agent response` };
    }
    const { passed, failedAssertion } = await runAssertions(
      input.questionTurns[i].assertionBlock,
      turnRun.toolCalls,
      turnRun.finalText,
      input.questionTurns[i].prompt,
      judge
    );
    if (!passed) {
      return {
        ...base,
        passed: false,
        assertionFailed: `turn ${i + 1}: ${failedAssertion ?? ''}`,
      };
    }
  }
  return base;
}

/**
 * Build a failed RunResult for the catch block of an eval run.
 */
export function makeFailedRunResult(
  questionId: string,
  prompt: string,
  runIndex: number,
  errorMsg: string
): RunResult {
  return {
    questionId,
    prompt,
    runIndex,
    passed: false,
    toolCalls: [],
    finalText: '',
    error: errorMsg,
  };
}
