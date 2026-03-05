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
export const MAX_READ_LINES = 1000;

/**
 * Short pagination note appended to tool descriptions for list-paginated tools.
 * The full pagination protocol is documented in the MCP server instructions;
 * tool descriptions only carry a brief reference.
 */
export const PAGINATION_NOTE_LIST = `Results are paginated (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT} per page); follow the pagination instructions in the server instructions.`;

/**
 * Short pagination note appended to tool descriptions for line-windowed tools.
 */
export const PAGINATION_NOTE_LINES =
  'Results may be line-windowed; follow the pagination instructions in the server instructions.';

/**
 * Prepend a pagination note to a tool description so the LLM sees pagination
 * requirements before the functional description. The note is separated from
 * the description by a single space.
 */
export function withPaginationNote(description: string, note: string): string {
  const trimmedNote = note.trimEnd();
  const noteWithPeriod = trimmedNote.endsWith('.') ? trimmedNote : trimmedNote + '.';
  return noteWithPeriod + ' ' + description;
}

/**
 * Split text into lines (handles \\n and \\r\\n). Empty string returns [].
 */
export function textToLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r?\n/);
}

/**
 * Join lines into a single string with \\n. Empty array returns ''.
 */
export function linesToText(lines: string[]): string {
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

/** Resolution context — how the input was interpreted. */
export interface ResponseContext {
  /** Resolved z/OS system (host). */
  system: string;
  /** Resolved pattern for list tools (fully qualified). */
  resolvedPattern?: string;
  /** Resolved dataset name for CRUD tools (fully qualified). */
  resolvedDsn?: string;
  /** Resolved target dataset name for copy/rename (fully qualified). */
  resolvedTargetDsn?: string;
  /** Resolved USS path (when path normalization changed the input). */
  resolvedPath?: string;
  /** USS current working directory (display form: relative or absolute). */
  currentDirectory?: string;
  /** USS directory that was listed (listUssFiles; display form). */
  listedDirectory?: string;
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
  /** True if more lines exist beyond the returned window. */
  hasMore: boolean;
}

/** Result summary for mutation operations. */
export interface MutationResultMeta {
  success: boolean;
}

/** Result summary for search operations (pagination over members + summary fields). */
export interface SearchResultMeta {
  /** Number of members returned in this page. */
  count: number;
  /** Total members with matches (before pagination). */
  totalAvailable: number;
  /** 0-based offset of the first returned member. */
  offset: number;
  /** True if more members exist beyond this page. */
  hasMore: boolean;
  /** Total lines that matched the search string. */
  linesFound: number;
  /** Total lines processed across all members. */
  linesProcessed: number;
  /** Number of members that had at least one match. */
  membersWithLines: number;
  /** Number of members with no matches (PDS only). */
  membersWithoutLines: number;
  /** Search string used. */
  searchPattern: string;
  /** SuperC process options string. */
  processOptions: string;
}

/** Union of all result metadata types. */
export type ResultMeta = ListResultMeta | ReadResultMeta | MutationResultMeta | SearchResultMeta;

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
    resolvedPath?: string;
    currentDirectory?: string;
    listedDirectory?: string;
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
  if (resolved.resolvedPath !== undefined) {
    ctx.resolvedPath = resolved.resolvedPath;
  }
  if (resolved.currentDirectory !== undefined) {
    ctx.currentDirectory = resolved.currentDirectory;
  }
  if (resolved.listedDirectory !== undefined) {
    ctx.listedDirectory = resolved.listedDirectory;
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
  const hasMore = effectiveOffset + effectiveLimit < items.length;
  const meta: ListResultMeta = {
    count: page.length,
    totalAvailable: items.length,
    offset: effectiveOffset,
    hasMore,
  };
  return {
    data: page,
    meta,
  };
}

/**
 * Return messages to include in the response envelope when the list has more pages.
 * Directs the agent to call the tool again with the next offset/limit; used in the envelope "messages" array.
 */
export function getListMessages(meta: ListResultMeta): string[] {
  if (!meta.hasMore) return [];
  const nextOffset = meta.offset + meta.count;
  const limit = meta.count;
  return [
    `More results are available (showing ${meta.offset + 1}–${meta.offset + meta.count} of ${meta.totalAvailable}). ` +
      `You must call this tool again with offset=${nextOffset} and limit=${limit} to fetch the next page. ` +
      `Do not answer with only partial data—keep calling until _result.hasMore is false.`,
  ];
}

/**
 * Apply pagination to search result members and build SearchResultMeta.
 * Used by searchInDataset tool: full result is cached; this slices the members for the requested page.
 */
export function paginateSearchResult(
  fullResult: {
    dataset: string;
    members: {
      name: string;
      matches: {
        lineNumber: number;
        content: string;
        beforeContext?: string[];
        afterContext?: string[];
      }[];
    }[];
    summary: {
      linesFound: number;
      linesProcessed: number;
      membersWithLines: number;
      membersWithoutLines: number;
      searchPattern: string;
      processOptions: string;
    };
  },
  offset: number,
  limit: number
): { members: typeof fullResult.members; meta: SearchResultMeta } {
  const { data, meta: listMeta } = paginateList(fullResult.members, offset, limit);
  const meta: SearchResultMeta = {
    ...listMeta,
    linesFound: fullResult.summary.linesFound,
    linesProcessed: fullResult.summary.linesProcessed,
    membersWithLines: fullResult.summary.membersWithLines,
    membersWithoutLines: fullResult.summary.membersWithoutLines,
    searchPattern: fullResult.summary.searchPattern,
    processOptions: fullResult.summary.processOptions,
  };
  return { members: data, meta };
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
  const hasMore = startIdx + windowedLines.length < totalLines;

  return {
    text: windowedText,
    mimeType,
    meta: {
      totalLines,
      startLine: effectiveStart,
      returnedLines: windowedLines.length,
      contentLength: windowedText.length,
      mimeType,
      hasMore,
    },
  };
}

/**
 * Return messages to include in the response envelope when the read has more lines.
 * Directs the agent to call the tool again with the next startLine/lineCount; used in the envelope "messages" array.
 */
export function getReadMessages(meta: ReadResultMeta): string[] {
  if (!meta.hasMore) return [];
  const nextStartLine = meta.startLine + meta.returnedLines;
  return [
    `More lines are available (showing lines ${meta.startLine}–${meta.startLine + meta.returnedLines - 1} of ${meta.totalLines}). ` +
      `You must call this tool again with startLine=${nextStartLine} and the same lineCount to fetch the next page. ` +
      `Do not answer with only partial data—keep calling until _result.hasMore is false.`,
  ];
}

/**
 * Replace unprintable characters in text with '.' for safe JSON and display.
 * Keeps \t, \n, \r. Replaces control chars (0x00–0x1F except \t/\n/\r), DEL (0x7F), and C1 controls (0x80–0x9F).
 */
export function sanitizeTextForDisplay(text: string): string {
  let result = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      result += char;
    } else if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      result += '.';
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Assemble the final envelope and return it as MCP content and structuredContent.
 *
 * When a tool declares an outputSchema, returning structuredContent allows
 * clients to consume typed, validated output without parsing content[0].text.
 *
 * @param messages - Optional list of operational messages (default empty array).
 */
export function wrapResponse<T>(
  context: ResponseContext,
  result: ResultMeta | undefined,
  data: T,
  messages: string[] = []
): { content: { type: 'text'; text: string }[]; structuredContent: Record<string, unknown> } {
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
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}
