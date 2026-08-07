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

function epochSeconds(clock: () => number): number {
  return Math.floor(clock() / 1000);
}

let completionCounter = 0;

function nextCompletionId(): string {
  completionCounter += 1;
  return `chatcmpl-fake-${completionCounter}`;
}

/** GET /v1/models response body. */
export function buildOpenAiModelsResponse(modelId: string, clock: () => number) {
  return {
    object: 'list',
    data: [
      {
        id: modelId,
        object: 'model',
        created: epochSeconds(clock),
        owned_by: 'fake-e2e',
      },
    ],
  };
}

/** Non-streaming POST /v1/chat/completions response body. */
export function buildOpenAiChatCompletion(
  decision: ScriptDecision,
  modelId: string,
  clock: () => number
) {
  const message =
    decision.kind === 'tool_call'
      ? {
          role: 'assistant' as const,
          content: null,
          tool_calls: [
            {
              id: decision.toolCallId,
              type: 'function' as const,
              function: {
                name: decision.toolName,
                arguments: JSON.stringify(decision.arguments),
              },
            },
          ],
        }
      : {
          role: 'assistant' as const,
          content: decision.content,
        };

  return {
    id: nextCompletionId(),
    object: 'chat.completion' as const,
    created: epochSeconds(clock),
    model: modelId,
    choices: [
      {
        index: 0,
        message,
        finish_reason: decision.kind === 'tool_call' ? 'tool_calls' : 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/**
 * Streaming POST /v1/chat/completions chunk sequence
 * (`chat.completion.chunk` objects; caller wraps each as an SSE `data:` line
 * and appends the terminal `data: [DONE]`).
 */
export function buildOpenAiStreamChunks(
  decision: ScriptDecision,
  modelId: string,
  clock: () => number
): Record<string, unknown>[] {
  const id = nextCompletionId();
  const created = epochSeconds(clock);
  const base = { id, object: 'chat.completion.chunk' as const, created, model: modelId };
  const chunks: Record<string, unknown>[] = [];

  if (decision.kind === 'tool_call') {
    const argsJson = JSON.stringify(decision.arguments);
    const argChunks = splitIntoChunks(argsJson, 3);

    // First chunk: role + tool call scaffold (id/type/function.name), empty arguments fragment.
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                index: 0,
                id: decision.toolCallId,
                type: 'function',
                function: { name: decision.toolName, arguments: '' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    // Subsequent chunks: only the arguments fragment + index (no id/type/name repeated).
    for (const fragment of argChunks) {
      chunks.push({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: fragment } }],
            },
            finish_reason: null,
          },
        ],
      });
    }

    chunks.push({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    });
    return chunks;
  }

  // Text reply: role-only first chunk, then content fragments, then a finish chunk.
  chunks.push({
    ...base,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  });
  for (const fragment of splitIntoChunks(decision.content, 3)) {
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: { content: fragment }, finish_reason: null }],
    });
  }
  chunks.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });
  return chunks;
}
