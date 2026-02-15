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

export function activate(context: vscode.ExtensionContext): void {
  const serverModule = resolveServerPath(context);

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('zoweMcpServer', {
      provideMcpServerDefinitions: () => [
        new vscode.McpStdioServerDefinition('Zowe MCP Server', 'node', [serverModule, '--stdio']),
      ],
    })
  );
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
