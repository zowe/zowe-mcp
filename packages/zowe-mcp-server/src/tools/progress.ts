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
 * MCP progress support for tool handlers.
 *
 * When the client sends a progressToken in tools/call request _meta, the server
 * can send notifications/progress with progress, optional total, and message.
 * This module provides a small reporter so tools report start, optional subaction
 * steps, and completion without knowing internal step counts.
 *
 * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress
 */

/** Minimal request-handler extra for progress: token and sendNotification. */
export interface ToolProgressExtra {
  _meta?: { progressToken?: string | number } | undefined;
  sendNotification: (notification: {
    method: 'notifications/progress';
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

/** Reporter for a single tool invocation. No-op when no progressToken. */
export interface ToolProgressReporter {
  /** Send progress 0 (start). */
  start(): Promise<void>;
  /** Send progress update with subaction message (progress increases, cap 0.99). */
  step(subactionMessage: string): Promise<void>;
  /** Send progress 1, total 1, and final message. */
  complete(finalMessage: string): Promise<void>;
}

const STEP_INCREMENT = 0.2;
const MAX_BEFORE_COMPLETE = 0.99;

/**
 * Creates a progress reporter for this tool call when the client sent a progressToken.
 * Otherwise returns a no-op reporter so callers can always call start/step/complete.
 */
export function createToolProgress(
  extra: ToolProgressExtra,
  title: string,
  _options?: { stepIncrement?: number }
): ToolProgressReporter {
  const token = extra._meta?.progressToken;
  const send = extra.sendNotification;

  if (token === undefined || token === null) {
    return {
      async start() {},
      async step() {},
      async complete() {},
    };
  }

  let current = 0;

  function message(msg: string): string {
    return msg ? `${title} – ${msg}` : title;
  }

  return {
    async start() {
      await send({
        method: 'notifications/progress',
        params: { progressToken: token, progress: 0, message: message('Starting') },
      });
    },

    async step(subactionMessage: string) {
      current = Math.min(current + STEP_INCREMENT, MAX_BEFORE_COMPLETE);
      await send({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress: current,
          message: message(subactionMessage),
        },
      });
    },

    async complete(finalMessage: string) {
      await send({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress: 1,
          total: 1,
          message: message(finalMessage),
        },
      });
    },
  };
}

const DEFAULT_LIST_LIMIT_FOR_RANGE = 500;

/**
 * Formats an offset/limit range for list-style progress titles (e.g. listDatasets, listMembers, searchInDataset).
 * Returns a range like "(1001-1500)" (1-based inclusive). Returns empty string only when both displayed
 * numbers are the defaults (start 1, end defaultLimit), i.e. the first page with default page size.
 */
export function formatListProgressRange(
  offset: number | undefined,
  limit: number | undefined,
  defaultLimit: number = DEFAULT_LIST_LIMIT_FOR_RANGE
): string {
  const off = offset ?? 0;
  const lim = limit ?? defaultLimit;
  const start = off + 1;
  const end = off + lim;
  const isDefaultRange = start === 1 && end === defaultLimit;
  return isDefaultRange ? '' : `(${start}-${end})`;
}

/**
 * Formats a startLine/lineCount range for read-dataset progress titles.
 * Returns empty string when neither is set (full read). When both are set returns "(1-100)" (same style as list).
 * When only startLine is set returns "(from record N)".
 */
export function formatReadProgressRange(
  startLine: number | undefined,
  lineCount: number | undefined
): string {
  if (startLine !== undefined && lineCount !== undefined) {
    return `(${startLine}-${startLine + lineCount - 1})`;
  }
  if (startLine !== undefined) {
    return `(${startLine}-)`;
  }
  return '';
}
