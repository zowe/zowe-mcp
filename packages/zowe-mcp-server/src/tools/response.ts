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
 * Response envelope types and helpers for MCP tool responses.
 *
 * Every dataset tool wraps its response in a {@link ToolResponseEnvelope}
 * that provides:
 * - `_context`: how the input was resolved (system, resolved name/pattern)
 * - `_result`: summary metadata (count, pagination, windowing, MIME type)
 * - `data`: the actual payload
 *
 * Resolved values (`resolvedPattern`, `resolvedDsn`, `resolvedTargetDsn`)
 * are only included when resolution changed the input; they are fully qualified (no quotes).
 */

import { createRequire } from 'node:module';
import { inferMimeType } from '../zos/dsn.js';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default page size for list operations. */
export const DEFAULT_LIST_LIMIT = 500;

/** Maximum allowed page size for list operations. */
export const MAX_LIST_LIMIT = 1000;

/** Auto-truncation limit for readDataset when no window is requested. */
export const MAX_READ_LINES = 2000;

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

/** Resolution context — how the input was interpreted. */
export interface ResponseContext {
  /** Resolved system ID. */
  system: string;
  /** Resolved pattern for list tools (fully qualified). */
  resolvedPattern?: string;
  /** Resolved dataset name for CRUD tools (fully qualified). */
  resolvedDsn?: string;
  /** Resolved target dataset name for copy/rename (fully qualified). */
  resolvedTargetDsn?: string;
}

/** Result summary for list operations. */
export interface ListResultMeta {
  /** Number of items returned in this page. */
  count: number;
  /** Total matching items (before pagination). */
  totalAvailable: number;
  /** 0-based offset of the first returned item. */
  offset: number;
  /** True if more items exist beyond this page. */
  hasMore: boolean;
}

/** Result summary for read operations. */
export interface ReadResultMeta {
  /** Total lines in the full content. */
  totalLines: number;
  /** 1-based first line returned. */
  startLine: number;
  /** Number of lines in the returned window. */
  returnedLines: number;
  /** Character count of returned text. */
  contentLength: number;
  /** Inferred content type. */
  mimeType: string;
}

/** Result summary for mutation operations. */
export interface MutationResultMeta {
  success: boolean;
}

/** Union of all result metadata types. */
export type ResultMeta = ListResultMeta | ReadResultMeta | MutationResultMeta;

/** The standard response envelope for all dataset tools. */
export interface ToolResponseEnvelope<T> {
  _context: ResponseContext;
  _result?: ResultMeta;
  /** Operational messages (e.g. normalization, resolution notes). */
  messages: string[];
  data: T;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a fully-qualified value for display in tool output.
 *
 * Strips optional single quotes so resolved values are always returned
 * as plain fully-qualified names (no quotes). If the value was already
 * quoted, a debug message is logged.
 */
export function formatResolved(value: string): string {
  const alreadyQuoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  const unquoted = alreadyQuoted ? value.slice(1, -1) : value;
  if (alreadyQuoted) {
    try {
      const { getLogger } = require('../server.js') as {
        getLogger: () => {
          child: (name: string) => { debug: (msg: string, data?: unknown) => void };
        };
      };
      getLogger().child('response').debug('formatResolved: DSN was already quoted, normalized', {
        value,
      });
    } catch {
      // Avoid circular dependency or missing server at load time; skip log
    }
  }
  return unquoted;
}

/**
 * Return the resolved value for context only when resolution actually changed
 * the input (e.g. normalized case, stripped quotes). Omits the key when
 * trimmed raw input equals the resolved value.
 *
 * @param resolved - Normalized value (e.g. from resolvePattern / resolveDsn).
 * @param rawInput - Raw input string from the user (will be trimmed for comparison).
 * @returns Formatted resolved value to include in context, or undefined to omit.
 */
export function resolvedOnlyIfDifferent(resolved: string, rawInput: string): string | undefined {
  if (resolved === rawInput.trim()) return undefined;
  return formatResolved(resolved);
}

/**
 * Build the `_context` object for a tool response.
 */
export function buildContext(
  systemId: string,
  resolved: {
    resolvedPattern?: string;
    resolvedDsn?: string;
    resolvedTargetDsn?: string;
  }
): ResponseContext {
  const ctx: ResponseContext = { system: systemId };
  if (resolved.resolvedPattern !== undefined) {
    ctx.resolvedPattern = resolved.resolvedPattern;
  }
  if (resolved.resolvedDsn !== undefined) {
    ctx.resolvedDsn = resolved.resolvedDsn;
  }
  if (resolved.resolvedTargetDsn !== undefined) {
    ctx.resolvedTargetDsn = resolved.resolvedTargetDsn;
  }
  return ctx;
}

/**
 * Apply pagination to a list of items.
 *
 * @returns The sliced page and list metadata.
 */
export function paginateList<T>(
  items: T[],
  offset: number,
  limit: number
): { data: T[]; meta: ListResultMeta } {
  const effectiveOffset = Math.max(0, offset);
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIST_LIMIT);
  const page = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);
  return {
    data: page,
    meta: {
      count: page.length,
      totalAvailable: items.length,
      offset: effectiveOffset,
      hasMore: effectiveOffset + effectiveLimit < items.length,
    },
  };
}

/**
 * Apply line windowing to text content.
 *
 * @param text - The full text content.
 * @param startLine - 1-based starting line (default 1).
 * @param lineCount - Number of lines to return (default: all remaining, auto-capped).
 * @returns The windowed text and read metadata.
 */
export function windowContent(
  text: string,
  startLine?: number,
  lineCount?: number
): { text: string; meta: ReadResultMeta; mimeType: string } {
  const allLines = text.split('\n');
  // Remove trailing empty line from split if text ends with \n
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
    allLines.pop();
  }
  const totalLines = allLines.length;
  const mimeType = inferMimeType(text);

  const effectiveStart = Math.max(1, startLine ?? 1);
  const startIdx = effectiveStart - 1; // convert to 0-based

  let endIdx: number;
  if (lineCount !== undefined) {
    endIdx = Math.min(startIdx + lineCount, totalLines);
  } else {
    // Auto-truncate if no explicit window and content is large
    endIdx = Math.min(startIdx + MAX_READ_LINES, totalLines);
  }

  const windowedLines = allLines.slice(startIdx, endIdx);
  const windowedText = windowedLines.join('\n');

  return {
    text: windowedText,
    mimeType,
    meta: {
      totalLines,
      startLine: effectiveStart,
      returnedLines: windowedLines.length,
      contentLength: windowedText.length,
      mimeType,
    },
  };
}

/**
 * Assemble the final envelope and return it as MCP `content` array.
 *
 * @param messages - Optional list of operational messages (default empty array).
 */
export function wrapResponse<T>(
  context: ResponseContext,
  result: ResultMeta | undefined,
  data: T,
  messages: string[] = []
): { content: { type: 'text'; text: string }[] } {
  const envelope: ToolResponseEnvelope<T> = {
    _context: context,
    messages,
    data,
  };
  if (result !== undefined) {
    envelope._result = result;
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
  };
}
