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
  /** When set, the entire question set is skipped with this reason. */
  skip?: string;
}

/**
 * Unified tool-call assertion. Absorbs the former toolCall, singleToolCall, toolOnly,
 * minToolCalls, and toolCallOneOf assertion types.
 *
 * Modes (mutually exclusive tool specifiers):
 * - `tool`  — single tool name; checks the last matching call + optional args.
 * - `tools` — any of these tool names matches (no per-tool args).
 * - `oneOf` — any of these {tool, args?} specs matches (per-tool args).
 *
 * Optional count constraints:
 * - `count`    — exact number of total tool calls expected.
 * - `minCount` — minimum number of calls expected.
 */
export interface AssertToolCall {
  type: 'toolCall';
  name?: string;
  tool?: string;
  tools?: string[];
  oneOf?: { tool: string; args?: Record<string, unknown> }[];
  args?: Record<string, unknown>;
  count?: number;
  minCount?: number;
}

/**
 * Ordered tool-call sequence. Absorbs the former toolCallOrder and toolCallSequence types.
 * Each step: `tool` (single) or `tools` (any of), plus optional `args` (partial match).
 * Steps are matched in order against actual tool calls; other calls may appear in between.
 */
export interface AssertToolCallOrder {
  type: 'toolCallOrder';
  name?: string;
  sequence: {
    tool?: string;
    tools?: string[];
    /** Partial match. If array, step matches when actual args match any element. */
    args?: Record<string, unknown> | Record<string, unknown>[];
  }[];
}

/**
 * Assert that the final answer text contains a literal substring or matches a regex.
 * Use `substring` for exact phrase or `pattern` for regex; if both are set, `pattern` is used.
 */
export interface AssertAnswerContains {
  type: 'answerContains';
  name?: string;
  substring?: string;
  pattern?: string;
}

/** Leaf assertion (no nested allOf/anyOf). */
export type Assertion = AssertToolCall | AssertToolCallOrder | AssertAnswerContains;

/**
 * Composite: all nested items must pass (logical AND).
 */
export interface AssertAllOf {
  allOf: AssertionItem[];
}

/**
 * Composite: at least one nested item must pass (logical OR).
 */
export interface AssertAnyOf {
  anyOf: AssertionItem[];
}

/**
 * One assertion: either a leaf assertion or a composite (allOf/anyOf).
 * Composites can be nested (e.g. allOf containing an anyOf).
 */
export type AssertionItem = Assertion | AssertAllOf | AssertAnyOf;

/**
 * Normalized assertion block for a question. Default is allOf (all items must pass).
 * Backward compat: a YAML array of assertions is treated as allOf.
 */
export interface AssertionBlock {
  mode: 'all' | 'any';
  items: AssertionItem[];
}

/**
 * One question in a set.
 */
export interface Question {
  id: string;
  prompt: string;
  /** Mock preset when using mock backend (default | inventory). Overridden by set-level mock.preset when set. */
  preset?: 'default' | 'inventory';
  /** Normalized assertion block (all items must pass when mode is 'all'; any item must pass when mode is 'any'). */
  assertionBlock: AssertionBlock;
  /** When set, this question is skipped with this reason. */
  skip?: string;
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
