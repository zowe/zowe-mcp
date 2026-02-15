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
 * Logs environment information at extension startup, including:
 * - Zowe MCP extension version
 * - VS Code version
 * - GitHub Copilot Chat extension version and status
 * - Zowe Explorer extension version and status
 */

import * as vscode from 'vscode';
import { getDisplayName, getLog } from './log';

const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';
const ZOWE_EXPLORER_EXTENSION_ID = 'Zowe.vscode-extension-for-zowe';

interface ExtensionStatus {
  version: string;
  status: 'active' | 'installed' | 'not installed';
}

/**
 * Queries the status of a VS Code extension by its identifier.
 */
function getExtensionStatus(extensionId: string): ExtensionStatus {
  const ext = vscode.extensions.getExtension(extensionId);
  if (!ext) {
    return { version: 'N/A', status: 'not installed' };
  }
  return {
    version: (ext.packageJSON as { version: string }).version,
    status: ext.isActive ? 'active' : 'installed',
  };
}

/**
 * Logs startup environment information to the "Zowe MCP" output channel.
 */
export function logStartupInfo(context: vscode.ExtensionContext): void {
  const log = getLog();
  const extVersion = (context.extension.packageJSON as { version: string }).version;

  log.info(`${getDisplayName()} v${extVersion}`);
  log.info(`VS Code v${vscode.version}`);

  const copilot = getExtensionStatus(COPILOT_CHAT_EXTENSION_ID);
  log.info(`GitHub Copilot Chat: v${copilot.version} (${copilot.status})`);

  const zoweExplorer = getExtensionStatus(ZOWE_EXPLORER_EXTENSION_ID);
  log.info(`Zowe Explorer: v${zoweExplorer.version} (${zoweExplorer.status})`);
}
