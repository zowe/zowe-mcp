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
 * Centralized logging for the Zowe MCP VS Code extension.
 *
 * Provides a LogOutputChannel named "Zowe MCP" that appears in the
 * VS Code Output panel. All extension components should use this
 * module for logging instead of console.log.
 */

import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;
let displayName: string | undefined;

/**
 * Initializes the log output channel and registers it for disposal
 * with the extension context. The channel name is read from the
 * `displayName` field in the extension's `package.json`.
 */
export function initLog(context: vscode.ExtensionContext): vscode.LogOutputChannel {
  displayName = (context.extension.packageJSON as { displayName: string }).displayName;
  outputChannel = vscode.window.createOutputChannel(displayName, { log: true });
  context.subscriptions.push(outputChannel);
  return outputChannel;
}

/**
 * Returns the shared LogOutputChannel instance.
 * Must be called after {@link initLog}.
 */
export function getLog(): vscode.LogOutputChannel {
  if (!outputChannel) {
    throw new Error('Log output channel has not been initialized. Call initLog() first.');
  }
  return outputChannel;
}

/**
 * Returns the extension's display name as defined in `package.json`.
 * Must be called after {@link initLog}.
 */
export function getDisplayName(): string {
  if (!displayName) {
    throw new Error('Display name has not been initialized. Call initLog() first.');
  }
  return displayName;
}
