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

/**
 * State lives on `globalThis` rather than module-scoped `let`s.
 *
 * The packaged extension runs the esbuild-bundled `dist/extension.js`,
 * which inlines its own copy of this module's code — a separate JS module
 * instance from `out/log.js` (the plain tsc output), which the VS Code
 * integration test suite (`out/test/*.js`) imports directly to call
 * {@link getLog}. Module-scoped state would make each instance keep its
 * own independent `outputChannel`/`displayName`, so `initLog()` running
 * inside the bundle would never be visible to the test file's separate
 * `out/log.js` instance. Both run in the same extension host process
 * during `vscode-test`, though, so `globalThis` is genuinely shared even
 * when the module instance isn't.
 */
interface ZoweMcpLogGlobalState {
  outputChannel?: vscode.LogOutputChannel;
  displayName?: string;
}

const GLOBAL_STATE_KEY = '__zoweMcpLogState__';

function getGlobalState(): ZoweMcpLogGlobalState {
  const globalRecord = globalThis as unknown as Record<string, ZoweMcpLogGlobalState | undefined>;
  return (globalRecord[GLOBAL_STATE_KEY] ??= {});
}

/**
 * Initializes the log output channel and registers it for disposal
 * with the extension context. The channel name is read from the
 * `displayName` field in the extension's `package.json`.
 */
export function initLog(context: vscode.ExtensionContext): vscode.LogOutputChannel {
  const state = getGlobalState();
  state.displayName = (context.extension.packageJSON as { displayName: string }).displayName;
  state.outputChannel = vscode.window.createOutputChannel(state.displayName, { log: true });
  context.subscriptions.push(state.outputChannel);
  return state.outputChannel;
}

/**
 * Returns the shared LogOutputChannel instance.
 * Must be called after {@link initLog}.
 */
export function getLog(): vscode.LogOutputChannel {
  const state = getGlobalState();
  if (!state.outputChannel) {
    throw new Error('Log output channel has not been initialized. Call initLog() first.');
  }
  return state.outputChannel;
}

/**
 * Returns the extension's display name as defined in `package.json`.
 * Must be called after {@link initLog}.
 */
export function getDisplayName(): string {
  const state = getGlobalState();
  if (!state.displayName) {
    throw new Error('Display name has not been initialized. Call initLog() first.');
  }
  return state.displayName;
}

/**
 * Maps VS Code {@link vscode.LogLevel} (Output panel filter for this channel) to
 * `zoweMCP.logLevel` strings accepted by the MCP server.
 */
export function mapVscodeLogLevelToZoweMcpLogLevel(level: vscode.LogLevel): string {
  switch (level) {
    case vscode.LogLevel.Off:
      return 'error';
    case vscode.LogLevel.Trace:
    case vscode.LogLevel.Debug:
      return 'debug';
    case vscode.LogLevel.Info:
      return 'info';
    case vscode.LogLevel.Warning:
      return 'warning';
    case vscode.LogLevel.Error:
      return 'error';
    default:
      return 'info';
  }
}

/**
 * Appends a line that is still shown when the channel filter is **Off** or strict
 * (unlike {@link vscode.LogOutputChannel.info} which is hidden by the filter).
 * Use only for short operational notes (e.g. log level sync).
 */
export function appendLineVisibleWithLogFilter(log: vscode.LogOutputChannel, line: string): void {
  log.appendLine(line);
}

/**
 * Writes the Output channel's current log level into `zoweMCP.logLevel` so it
 * matches the panel dropdown. Uses the same configuration target as an
 * existing override (workspace folder → workspace → user) when possible.
 *
 * When the mapped value already matches settings (e.g. **Off** → `error` and
 * `zoweMCP.logLevel` is already `error`), no `update` runs; callers should still
 * still call `sendLogLevelEvent` from `onDidChangeLogLevel` so the MCP server
 * receives the level.
 */
export function syncOutputChannelLogLevelToMcpSetting(log: vscode.LogOutputChannel): void {
  const mapped = mapVscodeLogLevelToZoweMcpLogLevel(log.logLevel);
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const current = config.get<string>('logLevel', 'info');
  if (mapped === current) {
    return;
  }
  const ins = config.inspect('logLevel');
  const target =
    ins?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : ins?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
  void config.update('logLevel', mapped, target);
}
