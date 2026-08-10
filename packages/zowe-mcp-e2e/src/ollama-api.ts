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

import { splitIntoChunks } from './chunk-utils.js';
import type { ScriptDecision } from './types.js';

function isoNow(clock: () => number): string {
  return new Date(clock()).toISOString();
}

/** GET /api/tags response body. */
export function buildOllamaTagsResponse(modelId: string, clock: () => number) {
  const name = `${modelId}:latest`;
  return {
    models: [
      {
        name,
        model: name,
        modified_at: isoNow(clock),
        size: 1_000_000_000,
        digest: 'sha256:fakee2e0000000000000000000000000000000000000000000000000000000',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'fake',
          families: ['fake'],
          parameter_size: '1B',
          quantization_level: 'Q4_0',
        },
      },
    ],
  };
}

/**
 * GET /api/version response body. VS Code's Ollama BYOK provider rejects
 * servers below a minimum version (observed: refuses anything < 0.6.4 with
 * "Ollama server version ... is not supported"), so this must report a
 * plain, comparable-as-newer version — no suffix (a suffix like
 * "-fake-e2e" defeats the extension's semver-ish parsing and gets treated
 * as older than 0.6.4 regardless of the numeric part).
 */
export function buildOllamaVersionResponse() {
  return { version: '0.9.9' };
}

/**
 * POST /api/show response body. VS Code's Ollama BYOK provider reads
 * `capabilities` (must include "tools" for tool calling to be offered),
 * plus `details`/`model_info` for display metadata (family, parameter
 * size, context length) - included as a generous superset since the
 * exact fields read can change between VS Code versions.
 */
export function buildOllamaShowResponse(modelId: string, clock: () => number) {
  return {
    modelfile: `# Fake E2E model\nFROM ${modelId}`,
    parameters: 'num_ctx 32768',
    template: '{{ .Prompt }}',
    modified_at: isoNow(clock),
    details: {
      parent_model: '',
      format: 'gguf',
      family: 'fake',
      families: ['fake'],
      parameter_size: '1B',
      quantization_level: 'Q4_0',
    },
    model_info: {
      'general.architecture': 'fake',
      'general.parameter_count': 1_000_000_000,
      'general.basename': modelId,
      // Copilot Chat 0.60.0 (VS Code 1.132) computes the BYOK Ollama
      // prompt budget as `context_length - maxOutputTokens` where
      // maxOutputTokens is min(4096, context_length/2). A context_length
      // of exactly 4096 therefore yields maxInputTokens = 0, the prompt
      // renderer prunes every message to fit the zero budget, and every
      // turn dies instantly with "Invalid request: no messages." — keep
      // this comfortably above 4096.
      'fake.context_length': 32768,
      'fake.embedding_length': 4096,
      'fake.attention.head_count': 32,
    },
    capabilities: ['completion', 'tools'],
  };
}

function toolCallsForDecision(decision: ScriptDecision) {
  if (decision.kind !== 'tool_call') {
    return undefined;
  }
  // Ollama tool_calls: function.arguments is a JSON OBJECT, not a string.
  return [
    {
      function: {
        name: decision.toolName,
        arguments: decision.arguments,
      },
    },
  ];
}

/** Non-streaming POST /api/chat response body. */
export function buildOllamaChatResponse(
  decision: ScriptDecision,
  modelId: string,
  clock: () => number
) {
  const toolCalls = toolCallsForDecision(decision);
  return {
    model: `${modelId}:latest`,
    created_at: isoNow(clock),
    message: {
      role: 'assistant',
      content: decision.kind === 'text' ? decision.content : '',
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    },
    done: true,
    done_reason: decision.kind === 'tool_call' ? 'tool_calls' : 'stop',
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    eval_count: 0,
  };
}

/**
 * Streaming POST /api/chat NDJSON line sequence (one JSON object per line;
 * caller appends `\n` to each and writes them back-to-back). Ollama does
 * not stream tool call arguments incrementally - the whole tool_calls
 * array is emitted in a single message chunk once ready, matching real
 * Ollama server behaviour.
 */
export function buildOllamaChatStreamLines(
  decision: ScriptDecision,
  modelId: string,
  clock: () => number
): Record<string, unknown>[] {
  const model = `${modelId}:latest`;
  const lines: Record<string, unknown>[] = [];

  if (decision.kind === 'tool_call') {
    lines.push({
      model,
      created_at: isoNow(clock),
      message: { role: 'assistant', content: '', tool_calls: toolCallsForDecision(decision) },
      done: false,
    });
    lines.push({
      model,
      created_at: isoNow(clock),
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'tool_calls',
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: 0,
      eval_count: 0,
    });
    return lines;
  }

  for (const fragment of splitIntoChunks(decision.content, 3)) {
    lines.push({
      model,
      created_at: isoNow(clock),
      message: { role: 'assistant', content: fragment },
      done: false,
    });
  }
  lines.push({
    model,
    created_at: isoNow(clock),
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    eval_count: 0,
  });
  return lines;
}
