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
 * - Available language models (name, vendor, family, version, maxInputTokens)
 * - Registered language model tools
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
 * Logs the list of available language models to the output channel.
 */
export function logLanguageModels(models: vscode.LanguageModelChat[]): void {
  const log = getLog();
  if (models.length === 0) {
    log.info('Language models: none available');
    return;
  }
  log.info(`Language models: ${String(models.length)} available`);
  for (const model of models) {
    log.info(
      `  ${model.name} (${model.id}) — vendor: ${model.vendor}, family: ${model.family}, version: ${model.version}, maxInputTokens: ${String(model.maxInputTokens)}`
    );
  }
}

/**
 * Logs the list of registered language model tools to the output channel.
 */
function logLanguageModelTools(): void {
  const log = getLog();
  const tools = vscode.lm.tools;
  if (tools.length === 0) {
    log.info('Language model tools: none registered');
    return;
  }
  log.info(`Language model tools: ${String(tools.length)} registered`);
  for (const tool of tools) {
    const tags = tool.tags.length > 0 ? ` [${tool.tags.join(', ')}]` : '';
    const firstLine = tool.description.split('\n')[0];
    const level = tool.name.startsWith('mcp_zowe_') ? 'info' : 'debug';
    log[level](`  ${tool.name}${tags} — ${firstLine}`);
  }
}

/**
 * Logs startup environment information to the output channel.
 *
 * This function is async because querying available language models
 * requires an async call to `vscode.lm.selectChatModels()`.
 */
export async function logStartupInfo(context: vscode.ExtensionContext): Promise<void> {
  const log = getLog();
  const extVersion = (context.extension.packageJSON as { version: string }).version;

  log.info(`${getDisplayName()} v${extVersion}`);
  log.info(`VS Code v${vscode.version}`);

  const copilot = getExtensionStatus(COPILOT_CHAT_EXTENSION_ID);
  log.info(`GitHub Copilot Chat: v${copilot.version} (${copilot.status})`);

  const zoweExplorer = getExtensionStatus(ZOWE_EXPLORER_EXTENSION_ID);
  log.info(`Zowe Explorer: v${zoweExplorer.version} (${zoweExplorer.status})`);

  try {
    const models = await vscode.lm.selectChatModels();
    logLanguageModels(models);
  } catch (err) {
    log.warn(`Failed to query language models: ${String(err)}`);
  }

  logLanguageModelTools();
}
