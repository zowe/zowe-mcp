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
 * Dispatches incoming MCP server events to the appropriate VS Code APIs.
 *
 * Currently handles:
 * - `log` events → VS Code LogOutputChannel
 */

import type * as vscode from 'vscode';
import type { ServerToExtensionEvent } from 'zowe-mcp-server/dist/events.js';

/**
 * Maps RFC 5424 syslog levels to VS Code LogOutputChannel methods.
 *
 * VS Code provides: trace, debug, info, warn, error.
 * RFC 5424 provides: debug, info, notice, warning, error, critical, alert, emergency.
 */
function logToOutputChannel(log: vscode.LogOutputChannel, event: ServerToExtensionEvent): void {
  if (event.type !== 'log') return;

  const { level, logger, message, data } = event.data;
  const prefix = logger ? `[${logger}] ` : '';
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  const formatted = `${prefix}${message}${suffix}`;

  switch (level) {
    case 'debug':
      log.debug(formatted);
      break;
    case 'info':
    case 'notice':
      log.info(formatted);
      break;
    case 'warning':
      log.warn(formatted);
      break;
    case 'error':
    case 'critical':
    case 'alert':
    case 'emergency':
      log.error(formatted);
      break;
    default:
      log.info(formatted);
  }
}

/**
 * Handles a single event received from the MCP server over the named pipe.
 */
export function handleServerEvent(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent
): void {
  switch (event.type) {
    case 'log':
      logToOutputChannel(log, event);
      break;
    default:
      log.warn(`Unknown event type from MCP server: ${(event as { type: string }).type}`);
  }
}
