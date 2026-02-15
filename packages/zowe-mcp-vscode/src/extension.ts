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
 * Zowe MCP VS Code Extension
 *
 * Registers the Zowe MCP Server as an MCP server provider in VS Code,
 * enabling AI agents to use z/OS tools through the Model Context Protocol.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { getDisplayName, getLog, initLog } from './log';
import { sendLogLevelEvent, startPipeServer } from './pipe-server';
import { logLanguageModels, logStartupInfo } from './startup-log';

export function activate(context: vscode.ExtensionContext): void {
  const log = initLog(context);

  // Fire-and-forget: startup logging is non-critical and includes async model queries
  void logStartupInfo(context);

  // Start the named-pipe server for bidirectional communication with MCP servers
  const { workspaceId, discoveryDir } = startPipeServer(context);
  log.info(`Pipe server started`, { workspaceId, discoveryDir });

  const serverModule = resolveServerPath(context);

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('zowe', {
      provideMcpServerDefinitions: () => [
        new vscode.McpStdioServerDefinition('Zowe', 'node', [serverModule, '--stdio'], {
          MCP_DISCOVERY_DIR: discoveryDir,
          WORKSPACE_ID: workspaceId,
        }),
      ],
    })
  );

  // Watch for log-level setting changes and forward to connected MCP servers
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('zowe-mcp.logLevel')) {
        const config = vscode.workspace.getConfiguration('zowe-mcp');
        const level = config.get<string>('logLevel', 'info');
        log.info(`Log level setting changed to "${level}", forwarding to MCP servers`);
        sendLogLevelEvent(level);
      }
    })
  );

  // Log when the set of available language models changes (e.g. Copilot signs in/out)
  context.subscriptions.push(
    vscode.lm.onDidChangeChatModels(() => {
      void refreshLanguageModels();
    })
  );

  log.info(`${getDisplayName()} extension activated`);
}

/**
 * Re-queries and logs the available language models.
 * Called when the set of models changes at runtime.
 */
async function refreshLanguageModels(): Promise<void> {
  const log = getLog();
  log.info('Language models changed, refreshing...');
  try {
    const models = await vscode.lm.selectChatModels();
    logLanguageModels(models);
  } catch (err) {
    log.warn(`Failed to query language models after change: ${String(err)}`);
  }
}

/**
 * Resolves the path to the Zowe MCP Server entry point.
 * The server dist is bundled into the extension's `server/` directory
 * during the vscode:prepublish build step.
 */
function resolveServerPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, 'server', 'index.js');
}

export function deactivate(): void {
  // Cleanup is handled by VS Code disposing subscriptions
}
