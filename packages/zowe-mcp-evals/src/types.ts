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
 * Set-level mock init options: one string passed as-is to init-mock (after --output <dir>).
 * In YAML each line can be one option, e.g. "initArgs: --preset default" or multiline.
 */
export interface SetMockConfig {
  /** Extra arguments for init-mock, one string (split on whitespace when passing). */
  initArgs: string;
}

/**
 * Set-level native backend config: one string for server args (e.g. "--native --config path").
 */
export interface SetNativeConfig {
  /** Server arguments after --stdio, one string (split on whitespace when passing). */
  serverArgs: string;
}

/**
 * Set-level backend: mock (with init params) or native.
 */
export type SetBackendConfig = { mock: SetMockConfig } | { native: SetNativeConfig };

/**
 * Set-level eval config (repetitions, success rate, backend, system prompt).
 */
export interface SetConfig {
  name?: string;
  description?: string;
  repetitions?: number;
  minSuccessRate?: number;
  mock?: SetMockConfig;
  native?: SetNativeConfig;
  systemPrompt?: string;
  systemPromptAddition?: string;
}

/**
 * Assertion: expect a specific tool call (optionally with argument matchers).
 * In args, a value can be a single value or an array of alternatives (pass if actual matches any).
 */
export interface AssertToolCall {
  type: 'toolCall';
  tool: string;
  /** Optional: args must match (partial match). Values can be single or array of alternatives. */
  args?: Record<string, unknown>;
}

/**
 * Assertion: final answer text must contain a substring or match a regex.
 * Use either `substring` (literal) or `pattern` (regex string); if both are set, `pattern` is used.
 */
export interface AssertAnswerContains {
  type: 'answerContains';
  /** Literal substring to look for. */
  substring?: string;
  /** Regex pattern (string) to match; e.g. "2,?000" matches "2000" or "2,000". */
  pattern?: string;
}

/**
 * Assertion: exactly one tool call in the first turn, matching tool/args.
 */
export interface AssertSingleToolCall {
  type: 'singleToolCall';
  tool: string;
  args?: Record<string, unknown>;
}

/**
 * Assertion: only check the (last) tool call, not the answer content.
 */
export interface AssertToolOnly {
  type: 'toolOnly';
  tool: string;
  args?: Record<string, unknown>;
}

/**
 * Assertion: the tool must have been called at least minCount times (e.g. for pagination).
 */
export interface AssertMinToolCalls {
  type: 'minToolCalls';
  tool: string;
  minCount: number;
}

/**
 * Assertion: the tool must have been called in order with args matching each element of sequence
 * (partial match per call). Used to assert pagination parameters (e.g. offset/limit) on every call.
 */
export interface AssertToolCallSequence {
  type: 'toolCallSequence';
  tool: string;
  /** Expected args for each call, in order. Each element is partial-match. */
  sequence: Record<string, unknown>[];
}

/**
 * Assertion: tools must be called in this order (any other tools may appear in between).
 * Each step can have optional args (partial match). Use for mutation flows (e.g. createTempDataset
 * then writeDataset then deleteDatasetsUnderPrefix).
 */
export interface AssertToolCallOrder {
  type: 'toolCallOrder';
  /** Expected tool calls in order. Each step: tool name and optional args. */
  sequence: { tool: string; args?: Record<string, unknown> }[];
}

export type Assertion =
  | AssertToolCall
  | AssertAnswerContains
  | AssertSingleToolCall
  | AssertToolOnly
  | AssertMinToolCalls
  | AssertToolCallSequence
  | AssertToolCallOrder;

/**
 * One question in a set.
 */
export interface Question {
  id: string;
  prompt: string;
  /** Mock preset when using mock backend (default | inventory). Overridden by set-level mock.preset when set. */
  preset?: 'default' | 'inventory';
  assertions: Assertion[];
}

/**
 * Loaded question set (from YAML).
 */
export interface QuestionSet {
  config: SetConfig;
  questions: Question[];
}

/**
 * One tool call made by the agent (for assertions and report).
 */
export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  /** Tool result (server response text), when captured for reporting. */
  result?: string;
}

/**
 * Result of one run (one question, one repetition).
 */
export interface RunResult {
  questionId: string;
  prompt?: string;
  runIndex: number;
  passed: boolean;
  toolCalls: ToolCallRecord[];
  finalText: string;
  error?: string;
  assertionFailed?: string;
}
