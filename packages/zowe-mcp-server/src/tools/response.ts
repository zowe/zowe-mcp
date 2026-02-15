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
 * - `_context`: how the input was resolved (system, prefix, resolved name/pattern)
 * - `_result`: summary metadata (count, pagination, windowing, MIME type)
 * - `data`: the actual payload
 *
 * Resolved values (`resolvedPattern`, `resolvedDsn`, `resolvedTargetDsn`)
 * are always fully-qualified, absolute, and single-quoted — following the
 * z/OS convention for absolute dataset names.
 */

import { inferMimeType } from '../zos/dsn.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default page size for list operations. */
export const DEFAULT_LIST_LIMIT = 500;

/** Maximum allowed page size for list operations. */
export const MAX_LIST_LIMIT = 1000;

/** Auto-truncation limit for read_dataset when no window is requested. */
export const MAX_READ_LINES = 2000;

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

/** Resolution context — how the input was interpreted. */
export interface ResponseContext {
  /** Resolved system ID. */
  system: string;
  /** Active DSN prefix (present when a relative name was resolved). */
  dsnPrefix?: string;
  /** Resolved pattern for list tools (always absolute, single-quoted). */
  resolvedPattern?: string;
  /** Resolved dataset name for CRUD tools (always absolute, single-quoted). */
  resolvedDsn?: string;
  /** Resolved target dataset name for copy/rename (always absolute, single-quoted). */
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
  data: T;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a fully-qualified value in single quotes (z/OS absolute convention).
 *
 * All resolved values are absolute, so they are always quoted.
 */
export function formatResolved(value: string): string {
  return `'${value}'`;
}

/**
 * Build the `_context` object for a tool response.
 */
export function buildContext(
  systemId: string,
  dsnPrefix: string | undefined,
  resolved: {
    resolvedPattern?: string;
    resolvedDsn?: string;
    resolvedTargetDsn?: string;
  }
): ResponseContext {
  const ctx: ResponseContext = { system: systemId };
  if (dsnPrefix !== undefined) {
    ctx.dsnPrefix = dsnPrefix;
  }
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
 */
export function wrapResponse<T>(
  context: ResponseContext,
  result: ResultMeta | undefined,
  data: T
): { content: { type: 'text'; text: string }[] } {
  const envelope: ToolResponseEnvelope<T> = {
    _context: context,
    data,
  };
  if (result !== undefined) {
    envelope._result = result;
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
  };
}
