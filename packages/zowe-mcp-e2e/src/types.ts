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
 * Minimal JSON Schema subset needed to synthesize plausible tool-call arguments.
 * Only the parts the script engine actually reads are typed.
 */
export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  items?: JsonSchemaObject;
  description?: string;
}

/**
 * Chat message shape shared (loosely) by both the OpenAI and Ollama surfaces.
 * Both APIs use "role"/"content"/"tool_calls"/"tool_call_id" - fields not
 * relevant to a given surface are simply left undefined.
 */
export interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

/** A tool definition in OpenAI's `{type:"function", function:{...}}` shape. */
export interface OpenAiToolDefinition {
  type?: string;
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchemaObject;
  };
}

/** A tool definition in Ollama's flatter shape (also function-wrapped). */
export interface OllamaToolDefinition {
  type?: string;
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchemaObject;
  };
}

export type ToolDefinition = OpenAiToolDefinition | OllamaToolDefinition;

/** The scripted brain's decision for how to respond to a given request. */
export type ScriptDecision =
  | {
      kind: 'tool_call';
      toolName: string;
      toolCallId: string;
      arguments: Record<string, unknown>;
    }
  | {
      kind: 'text';
      content: string;
    };

export interface ScriptEngineOptions {
  /** Regex used to pick which tool to call; matched against the tool name (substring match). */
  toolPattern: RegExp;
  /** Explicit overrides for specific argument property names. */
  toolArgs?: Record<string, unknown>;
  /** Default value used for arguments that look like a data set pattern/name. */
  datasetPattern: string;
  /** Clock used to generate deterministic-ish ids; defaults to Date.now. */
  clock: () => number;
}

export interface RequestLogEntry {
  timestamp: number;
  direction: 'request' | 'response';
  surface: 'openai' | 'ollama';
  route: string;
  streaming: boolean;
  body: unknown;
}
