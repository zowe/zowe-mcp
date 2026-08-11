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

import type {
  ChatMessage,
  JsonSchemaObject,
  ScriptDecision,
  ScriptEngineOptions,
  ToolDefinition,
} from './types.js';

export const DEFAULT_TOOL_PATTERN = /listDatasets/i;
export const DEFAULT_DATASET_PATTERN = 'USER1.*';
export const SENTINEL_PONG = 'E2E-SENTINEL-PONG';
export const SENTINEL_OK_PREFIX = 'E2E-SENTINEL-OK';
export const DIGEST_MAX_LENGTH = 200;

/** Property-name substrings that indicate "this argument wants a data set pattern/name". */
const DATASET_LIKE_KEYS = ['pattern', 'dsname', 'dsn', 'dataset'];

function looksLikeDatasetProperty(key: string): boolean {
  const lower = key.toLowerCase();
  return DATASET_LIKE_KEYS.some(needle => lower.includes(needle));
}

function valueForProperty(
  key: string,
  propSchema: JsonSchemaObject | undefined,
  options: ScriptEngineOptions
): unknown {
  if (options.toolArgs && Object.prototype.hasOwnProperty.call(options.toolArgs, key)) {
    return options.toolArgs[key];
  }
  if (looksLikeDatasetProperty(key)) {
    return options.datasetPattern;
  }
  if (propSchema?.default !== undefined) {
    return propSchema.default;
  }
  if (propSchema?.enum && propSchema.enum.length > 0) {
    return propSchema.enum[0];
  }
  switch (propSchema?.type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '';
  }
}

/**
 * Build the minimal set of arguments that satisfy a tool's JSON Schema:
 * every required property gets a value, preferring explicit overrides,
 * then "this looks like a data set name/pattern" heuristics, then
 * schema defaults/enums, then a type-appropriate zero value.
 */
export function buildArguments(
  schema: JsonSchemaObject | undefined,
  options: ScriptEngineOptions
): Record<string, unknown> {
  if (!schema?.properties) {
    return {};
  }
  const required = schema.required ?? [];
  // Built via entries + Object.fromEntries (never a direct `obj[key] = ...`
  // write with a schema-supplied key), with prototype-polluting names dropped.
  const entries: [string, unknown][] = required
    .filter(key => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
    .map(key => [key, valueForProperty(key, schema.properties?.[key], options)]);
  return Object.fromEntries(entries);
}

/** Find the first tool whose name contains/matches `pattern`. */
export function findMatchingTool(
  tools: ToolDefinition[] | undefined,
  pattern: RegExp
): ToolDefinition | undefined {
  if (!tools) {
    return undefined;
  }
  return tools.find(tool => pattern.test(tool.function.name));
}

function lastToolResultContent(messages: ChatMessage[]): string {
  const toolMessages = messages.filter(m => m.role === 'tool');
  const last = toolMessages[toolMessages.length - 1];
  if (!last) {
    return '';
  }
  if (typeof last.content === 'string') {
    return last.content;
  }
  try {
    return JSON.stringify(last.content);
  } catch {
    return String(last.content);
  }
}

function digest(content: string): string {
  return content.length > DIGEST_MAX_LENGTH ? content.slice(0, DIGEST_MAX_LENGTH) : content;
}

/**
 * Renders the scripted final answer like a human-sounding model reply while
 * staying machine-assertable: dataset names (any `"dsn": "..."` values found
 * in the tool result) become an English sentence, followed by the sentinel
 * and a truncated raw echo of the tool result on its own line, which is what
 * the e2e assertions match against (`E2E-SENTINEL-OK` + dataset names).
 */
function renderOkReply(resultContent: string): string {
  const dsns = [...resultContent.matchAll(/"dsn"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  const summary =
    dsns.length > 0
      ? `I found ${String(dsns.length)} data sets: ${dsns.join(', ')}.`
      : 'Here is the tool result.';
  return `${summary}\n\n${SENTINEL_OK_PREFIX} ${digest(resultContent)}`;
}

let toolCallCounter = 0;

function nextToolCallId(clock: () => number): string {
  toolCallCounter += 1;
  return `call_${clock()}_${toolCallCounter}`;
}

/**
 * The scripted "brain" shared by both the OpenAI-compatible and
 * Ollama-compatible surfaces. Given the incoming messages and tool
 * definitions, deterministically decide what the fake model does next:
 *
 *   1. No tools offered              -> plain pong text reply.
 *   2. Tools offered, no tool result -> call the matching tool.
 *   3. Tools offered, tool result present -> final sentinel text reply
 *      that echoes a digest of the tool result, proving data flowed
 *      from the mock backend through the tool call into the chat reply.
 */
export function decideResponse(
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  options: ScriptEngineOptions
): ScriptDecision {
  const hasTools = !!tools && tools.length > 0;
  const hasToolResult = messages.some(m => m.role === 'tool');

  if (hasTools && !hasToolResult) {
    const tool = findMatchingTool(tools, options.toolPattern);
    if (tool) {
      return {
        kind: 'tool_call',
        toolName: tool.function.name,
        toolCallId: nextToolCallId(options.clock),
        arguments: buildArguments(tool.function.parameters, options),
      };
    }
    // No tool matched the configured pattern: nothing scripted to do,
    // but still respond deterministically instead of erroring out.
    return { kind: 'text', content: 'E2E-SENTINEL-NO-MATCHING-TOOL' };
  }

  if (hasToolResult) {
    const resultContent = lastToolResultContent(messages);
    return { kind: 'text', content: renderOkReply(resultContent) };
  }

  return { kind: 'text', content: SENTINEL_PONG };
}
