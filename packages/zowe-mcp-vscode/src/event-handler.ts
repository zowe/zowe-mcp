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
 * - `notification` events → VS Code information/warning/error message dialogs
 */

import * as vscode from 'vscode';
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
 * Shows a VS Code notification message dialog based on the event severity.
 *
 * Offers "Generate Mock Data" and "Open Settings" buttons so the user
 * can quickly resolve the missing backend configuration.
 */
function showNotification(event: ServerToExtensionEvent): void {
  if (event.type !== 'notification') return;

  const { severity, message } = event.data;
  const generateMock = 'Generate Mock Data';
  const openSettings = 'Open Settings';

  const showFn =
    severity === 'error'
      ? vscode.window.showErrorMessage
      : severity === 'warning'
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;

  void showFn(message, generateMock, openSettings).then(choice => {
    if (choice === generateMock) {
      void vscode.commands.executeCommand('zowe-mcp.initMockData');
    } else if (choice === openSettings) {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'zowe-mcp.mockDataDir');
    }
  });
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
    case 'notification':
      showNotification(event);
      break;
    default:
      log.warn(`Unknown event type from MCP server: ${(event as { type: string }).type}`);
  }
}
