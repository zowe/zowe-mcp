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
 * Status bar item showing the current (or last) active Zowe MCP connection.
 * Read-only; updated when the MCP server sends active-connection-changed events.
 */

import * as vscode from 'vscode';

const STATUS_BAR_PRIORITY = 50;
const GLOBAL_STATE_KEY_LAST_CONNECTION = 'zoweMcpLastActiveConnection';

const TOOLTIP =
  'Zowe MCP active connection. Connections are added in Settings (zoweMCP.nativeConnections or mock data directory). ' +
  'The active system is set via Chat (e.g. “set active system to SYS1” or “switch to USER@SYS1).';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Initializes the Zowe MCP status bar item. Call once from extension activation.
 * Restores the last active connection from global state if present (e.g. when MCP server is not started yet).
 */
export function initZoweMcpStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY
  );
  context.subscriptions.push(statusBarItem);

  const lastConnection = context.globalState.get<string>(GLOBAL_STATE_KEY_LAST_CONNECTION);
  if (lastConnection) {
    statusBarItem.text = `$(server-environment) ${lastConnection}`;
    statusBarItem.tooltip = TOOLTIP;
    statusBarItem.show();
  }
}

/**
 * Updates the status bar with the current active connection from the MCP server.
 * Call when receiving an active-connection-changed event.
 * When connection is null or empty, the status bar is hidden and last connection is cleared.
 */
export function updateZoweMcpStatusBar(
  connection: string | null,
  context: vscode.ExtensionContext
): void {
  if (!statusBarItem) return;

  const trimmed = connection?.trim();
  const value = trimmed === '' || trimmed === undefined ? null : trimmed;
  if (!value) {
    statusBarItem.hide();
    void context.globalState.update(GLOBAL_STATE_KEY_LAST_CONNECTION, undefined);
    return;
  }

  statusBarItem.text = `$(server-environment) ${value}`;
  statusBarItem.tooltip = TOOLTIP;
  statusBarItem.show();
  void context.globalState.update(GLOBAL_STATE_KEY_LAST_CONNECTION, value);
}
