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
 * Structured logging for the Zowe MCP Server.
 *
 * Provides a {@link Logger} class that writes human-readable messages to
 * stderr (always available, even before a transport connects) and forwards
 * them to the MCP client via `sendLoggingMessage()` when a server is
 * attached and connected.
 *
 * Log levels follow RFC 5424 (syslog) as required by the MCP specification.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * RFC 5424 syslog severity levels used by the MCP logging specification,
 * ordered from most verbose (debug) to most severe (emergency).
 */
export type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

/** Numeric severity for each level (higher = more severe). */
const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
};

/** All valid level strings for input validation. */
const VALID_LEVELS = new Set<string>(Object.keys(LOG_LEVEL_SEVERITY));

/**
 * Returns the log level from the `ZOWE_MCP_LOG_LEVEL` environment variable,
 * falling back to the provided default if the variable is unset or invalid.
 */
function levelFromEnv(fallback: LogLevel): LogLevel {
  const envValue = process.env.ZOWE_MCP_LOG_LEVEL?.toLowerCase();
  if (envValue && VALID_LEVELS.has(envValue)) {
    return envValue as LogLevel;
  }
  return fallback;
}

export interface LoggerOptions {
  /** Minimum severity level to emit. Defaults to `"info"` (overridden by `ZOWE_MCP_LOG_LEVEL`). */
  level?: LogLevel;
  /** Logger name included in every message (e.g. `"http"`, `"core"`). */
  name?: string;
}

/**
 * Lightweight, dual-destination logger for the MCP server.
 *
 * - **stderr**: Always writes a human-readable line so that operators can
 *   observe the server regardless of transport.
 * - **MCP protocol**: When an {@link McpServer} is attached (via {@link attach})
 *   and connected, each message is also forwarded to the client as a
 *   `notifications/message` notification.
 */
export class Logger {
  private _level: LogLevel;
  private _name: string | undefined;
  private _server: McpServer | undefined;

  constructor(options?: LoggerOptions) {
    const defaultLevel = options?.level ?? 'info';
    this._level = levelFromEnv(defaultLevel);
    this._name = options?.name;
  }

  // -- Public API: attach / child ------------------------------------------

  /**
   * Attaches an {@link McpServer} so that log messages are also forwarded
   * to the connected MCP client via `sendLoggingMessage()`.
   */
  attach(server: McpServer): void {
    this._server = server;
  }

  /**
   * Creates a child logger that shares the same server reference and level
   * but uses a different logger name.
   */
  child(name: string): Logger {
    const child = new Logger({ level: this._level, name });
    child._server = this._server;
    return child;
  }

  // -- Public API: level methods -------------------------------------------

  debug(message: string, data?: unknown): void {
    this._log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this._log('info', message, data);
  }

  notice(message: string, data?: unknown): void {
    this._log('notice', message, data);
  }

  warning(message: string, data?: unknown): void {
    this._log('warning', message, data);
  }

  error(message: string, data?: unknown): void {
    this._log('error', message, data);
  }

  critical(message: string, data?: unknown): void {
    this._log('critical', message, data);
  }

  alert(message: string, data?: unknown): void {
    this._log('alert', message, data);
  }

  emergency(message: string, data?: unknown): void {
    this._log('emergency', message, data);
  }

  // -- Internals -----------------------------------------------------------

  private _log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[this._level]) {
      return;
    }

    // 1. Always write to stderr
    const timestamp = new Date().toISOString();
    const tag = level.toUpperCase();
    const nameTag = this._name ? ` [${this._name}]` : '';
    const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    process.stderr.write(`${timestamp} [${tag}]${nameTag} ${message}${suffix}\n`);

    // 2. Forward to MCP client when attached and connected
    if (this._server?.isConnected()) {
      void this._server.sendLoggingMessage({
        level,
        logger: this._name,
        data: data !== undefined ? data : message,
      });
    }
  }
}
