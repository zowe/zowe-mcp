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
 * Shared event type definitions for bidirectional communication
 * between the MCP server and the VS Code extension over a named pipe.
 *
 * Events are serialized as newline-delimited JSON (NDJSON) and flow
 * in both directions:
 *   - Server → Extension: {@link ServerToExtensionEvent}
 *   - Extension → Server: {@link ExtensionToServerEvent}
 */

import type { LogLevel } from './log.js';

// ---------------------------------------------------------------------------
// Base event envelope
// ---------------------------------------------------------------------------

/** Base event envelope sent over the pipe. */
export interface McpEvent<T extends string = string, D = unknown> {
  type: T;
  data: D;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Server → Extension events
// ---------------------------------------------------------------------------

/** Payload for a `log` event (server → extension). */
export interface LogEventData {
  level: LogLevel;
  logger?: string;
  message: string;
  data?: unknown;
}

/** Forwards a server log message to the VS Code Output panel. */
export type LogEvent = McpEvent<'log', LogEventData>;

// ---------------------------------------------------------------------------
// Extension → Server events
// ---------------------------------------------------------------------------

/** Payload for a `log-level` event (extension → server). */
export interface LogLevelEventData {
  level: LogLevel;
}

/** Dynamically changes the server's log verbosity at runtime. */
export type LogLevelEvent = McpEvent<'log-level', LogLevelEventData>;

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

/** Events that flow from the MCP server to the VS Code extension. */
export type ServerToExtensionEvent = LogEvent;

/** Events that flow from the VS Code extension to the MCP server. */
export type ExtensionToServerEvent = LogLevelEvent;

/** Union of all event types exchanged over the pipe. */
export type AnyMcpEvent = ServerToExtensionEvent | ExtensionToServerEvent;
