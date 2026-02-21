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
import {
  sendEncodingOptionsUpdateEvent,
  sendLogLevelEvent,
  sendNativeOptionsUpdateEvent,
  sendSystemsUpdateEvent,
  startPipeServer,
} from './pipe-server';
import { getNativePasswordKey } from './secrets';
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
      provideMcpServerDefinitions: () => {
        const args = [serverModule, '--stdio'];
        const config = vscode.workspace.getConfiguration('zoweMCP');
        const mockDataDirectory = config.get<string>('mockDataDirectory', '').trim();
        const nativeSystems = config.get<string[]>('nativeSystems', []) ?? [];
        const installZoweNativeServerAutomatically = config.get<boolean>(
          'installZoweNativeServerAutomatically',
          true
        );
        const zoweNativeServerPath = config.get<string>('zoweNativeServerPath', '~/.zowe-server');
        const nativeResponseTimeout = config.get<number>('nativeResponseTimeout', 60);
        const defaultMainframeMvsEncoding = config.get<string>(
          'defaultMainframeMvsEncoding',
          'IBM-037'
        );
        const defaultMainframeUssEncoding = config.get<string>(
          'defaultMainframeUssEncoding',
          'IBM-1047'
        );

        // Mock only when mock directory is set and native systems is empty; otherwise native mode.
        if (mockDataDirectory && nativeSystems.length === 0) {
          args.push('--mock', mockDataDirectory);
          log.info(`Mock mode enabled: ${mockDataDirectory}`);
        } else {
          args.push('--native');
          for (const spec of nativeSystems) {
            if (typeof spec === 'string' && spec.trim()) {
              args.push('--system', spec.trim());
            }
          }
          if (!installZoweNativeServerAutomatically) {
            args.push('--native-server-auto-install=false');
          }
          if (zoweNativeServerPath?.trim()) {
            args.push('--native-server-path', zoweNativeServerPath.trim());
          }
          if (nativeResponseTimeout > 0 && nativeResponseTimeout !== 60) {
            args.push('--native-response-timeout', String(nativeResponseTimeout));
          }
          log.info(`Native (SSH) mode enabled: ${nativeSystems.length} system(s)`);
        }
        if (defaultMainframeMvsEncoding?.trim()) {
          args.push('--default-mvs-encoding', defaultMainframeMvsEncoding.trim());
        }
        if (defaultMainframeUssEncoding?.trim()) {
          args.push('--default-uss-encoding', defaultMainframeUssEncoding.trim());
        }

        return [
          new vscode.McpStdioServerDefinition('Zowe', 'node', args, {
            MCP_DISCOVERY_DIR: discoveryDir,
            WORKSPACE_ID: workspaceId,
          }),
        ];
      },
    })
  );

  // Register the "Generate Mock Data" command
  context.subscriptions.push(
    vscode.commands.registerCommand('zowe-mcp.initMockData', () =>
      initMockData(context, serverModule)
    )
  );

  // Register the "Clear Stored Password" command
  context.subscriptions.push(
    vscode.commands.registerCommand('zowe-mcp.clearStoredPassword', () =>
      clearStoredPassword(context)
    )
  );

  // Watch for setting changes and forward to connected MCP servers
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('zoweMCP.logLevel')) {
        // Read after VS Code has applied the change (avoids reading stale value)
        void Promise.resolve().then(() => {
          const config = vscode.workspace.getConfiguration('zoweMCP');
          const level = config.get<string>('logLevel', 'info');
          log.info(`Log level setting changed to "${level}", forwarding to MCP servers`);
          sendLogLevelEvent(level);
        });
      }
      if (e.affectsConfiguration('zoweMCP.nativeSystems')) {
        log.info('Native systems setting changed, forwarding to MCP servers');
        sendSystemsUpdateEvent();
      }
      if (
        e.affectsConfiguration('zoweMCP.installZoweNativeServerAutomatically') ||
        e.affectsConfiguration('zoweMCP.zoweNativeServerPath') ||
        e.affectsConfiguration('zoweMCP.nativeResponseTimeout')
      ) {
        log.info('Native options setting changed, forwarding to MCP servers');
        sendNativeOptionsUpdateEvent();
      }
      if (
        e.affectsConfiguration('zoweMCP.defaultMainframeMvsEncoding') ||
        e.affectsConfiguration('zoweMCP.defaultMainframeUssEncoding')
      ) {
        log.info('Encoding options setting changed, forwarding to MCP servers');
        sendEncodingOptionsUpdateEvent();
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

/**
 * Generates mock z/OS data by running the bundled server's `init-mock` command.
 *
 * Prompts the user for an output directory, runs the generator, and offers
 * to set `zoweMCP.mockDataDirectory` to the generated directory.
 */
async function initMockData(
  context: vscode.ExtensionContext,
  serverModule: string
): Promise<void> {
  const log = getLog();

  // Ask user to pick an output folder
  const folders = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select output folder for mock data',
    title: 'Generate Zowe MCP Mock Data',
  });

  if (!folders || folders.length === 0) {
    return; // User cancelled
  }

  const outputDir = path.join(folders[0].fsPath, 'zowe-mcp-mock-data');
  log.info(`Generating mock data in: ${outputDir}`);

  // Show progress while generating
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating Zowe MCP mock data...',
      cancellable: false,
    },
    () =>
      new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { execFile } = require('child_process') as typeof import('child_process');
        execFile(
          process.execPath,
          [serverModule, 'init-mock', '--output', outputDir],
          { cwd: context.extensionPath },
          (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
              log.error(`Mock data generation failed: ${stderr || error.message}`);
              reject(error);
            } else {
              log.info(`Mock data generated successfully: ${stdout.trim()}`);
              resolve();
            }
          }
        );
      })
  );

  // Offer to configure the setting
  const configure = 'Use as Mock Data';
  const choice = await vscode.window.showInformationMessage(
    `Mock data generated in: ${outputDir}`,
    configure
  );

  if (choice === configure) {
    const config = vscode.workspace.getConfiguration('zoweMCP');
    await config.update('mockDataDirectory', outputDir, vscode.ConfigurationTarget.Workspace);
    log.info(`Set zoweMCP.mockDataDirectory to: ${outputDir}`);

    const reload = 'Reload Window';
    const reloadChoice = await vscode.window.showInformationMessage(
      'Mock data directory configured. Reload the window to restart the MCP server with mock data.',
      reload
    );
    if (reloadChoice === reload) {
      void vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }
}

/**
 * Parses a connection spec (user@host or user@host:port) into user and host.
 */
function parseConnectionSpec(spec: string): { user: string; host: string } | undefined {
  const at = spec.indexOf('@');
  if (at <= 0 || at >= spec.length - 1) return undefined;
  const user = spec.slice(0, at);
  const hostPart = spec.slice(at + 1);
  const colon = hostPart.indexOf(':');
  const host = colon >= 0 ? hostPart.slice(0, colon) : hostPart;
  if (!user.trim() || !host.trim()) return undefined;
  return { user: user.trim(), host: host.trim() };
}

/**
 * Clears the stored SSH password from SecretStorage for a chosen connection.
 * Shows a QuickPick of configured native systems, or an input box if none configured.
 */
async function clearStoredPassword(context: vscode.ExtensionContext): Promise<void> {
  const log = getLog();
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const nativeSystems = (config.get<string[]>('nativeSystems', []) ?? []).filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0
  );

  let spec: string;
  if (nativeSystems.length > 0) {
    const chosen = await vscode.window.showQuickPick(nativeSystems, {
      title: 'Zowe MCP: Clear Stored Password',
      placeHolder: 'Select connection (user@host) to clear stored password',
      matchOnDescription: false,
    });
    if (!chosen) return;
    spec = chosen.trim();
  } else {
    const entered = await vscode.window.showInputBox({
      title: 'Zowe MCP: Clear Stored Password',
      prompt: 'Enter connection (user@host or user@host:port) to clear stored password',
      placeHolder: 'USER@host.example.com',
      validateInput(value: string) {
        if (!value.trim()) return 'Enter a connection spec';
        const parsed = parseConnectionSpec(value.trim());
        return parsed ? null : 'Must be user@host or user@host:port';
      },
    });
    if (!entered?.trim()) return;
    spec = entered.trim();
  }

  const parsed = parseConnectionSpec(spec);
  if (!parsed) {
    log.warn(`Invalid connection spec for clear password: ${spec}`);
    void vscode.window.showErrorMessage(
      'Invalid connection spec. Use user@host or user@host:port.'
    );
    return;
  }

  const key = getNativePasswordKey(parsed.user, parsed.host);
  await context.secrets.delete(key);
  log.info(`Cleared stored password for ${parsed.user}@${parsed.host}`);
  void vscode.window.showInformationMessage(
    `Stored password cleared for ${parsed.user}@${parsed.host}.`
  );
}

export function deactivate(): void {
  // Cleanup is handled by VS Code disposing subscriptions
}
