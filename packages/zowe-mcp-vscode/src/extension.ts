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
  sendConnectionsUpdateEvent,
  sendEncodingOptionsUpdateEvent,
  sendJobCardsUpdateEvent,
  sendLogLevelEvent,
  sendNativeOptionsUpdateEvent,
  sendZoweExplorerUpdateEvent,
  startPipeServer,
} from './pipe-server';
import { plural } from './plural';
import { getNativePasswordKey } from './secrets';
import { logLanguageModels, logStartupInfo } from './startup-log';
import { initZoweMcpStatusBar } from './status-bar';

/** Set when we register the Zowe MCP server with Cursor's API; used for config updates and deactivate. */
let cursorMcpRegistered = false;

export function activate(context: vscode.ExtensionContext): void {
  const log = initLog(context);

  // Fire-and-forget: startup logging is non-critical and includes async model queries
  void logStartupInfo(context);

  // Start the named-pipe server for bidirectional communication with MCP servers
  const { workspaceId, discoveryDir } = startPipeServer(context);
  log.info(`Pipe server started`, { workspaceId, discoveryDir });

  initZoweMcpStatusBar(context);

  const serverModule = resolveServerPath(context);

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('zowe', {
      provideMcpServerDefinitions: async () => {
        const serverConfig = await buildServerConfig(
          context,
          serverModule,
          discoveryDir,
          workspaceId,
          log
        );
        return [
          new vscode.McpStdioServerDefinition(
            'Zowe',
            serverConfig.command,
            serverConfig.args,
            serverConfig.env
          ),
        ];
      },
    })
  );

  // When running in Cursor, register the MCP server with Cursor's API so users don't need mcp.json
  if (typeof vscode.cursor?.mcp?.registerServer === 'function') {
    void registerWithCursor(context, serverModule, discoveryDir, workspaceId, log);
  }

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
      if (e.affectsConfiguration('zoweMCP.nativeConnections')) {
        log.info('Native connections setting changed, forwarding to MCP servers');
        sendConnectionsUpdateEvent();
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
      if (e.affectsConfiguration('zoweMCP.jobCards')) {
        log.info('Job cards setting changed, forwarding to MCP servers');
        sendJobCardsUpdateEvent();
      }
      // When running in Cursor, update Cursor's stored MCP config so the next server start uses current settings
      const affectsServerStartup =
        e.affectsConfiguration('zoweMCP.mockDataDirectory') ||
        e.affectsConfiguration('zoweMCP.nativeConnections') ||
        e.affectsConfiguration('zoweMCP.installZoweNativeServerAutomatically') ||
        e.affectsConfiguration('zoweMCP.zoweNativeServerPath') ||
        e.affectsConfiguration('zoweMCP.nativeResponseTimeout') ||
        e.affectsConfiguration('zoweMCP.defaultMainframeMvsEncoding') ||
        e.affectsConfiguration('zoweMCP.defaultMainframeUssEncoding') ||
        e.affectsConfiguration('zoweMCP.jobCards');
      if (
        affectsServerStartup &&
        cursorMcpRegistered &&
        typeof vscode.cursor?.mcp?.registerServer === 'function'
      ) {
        void updateCursorRegistration(context, serverModule, discoveryDir, workspaceId, log);
      }
    })
  );

  // When extensions are installed or enabled/disabled, update Zowe Explorer status so the MCP server can register open-in-editor tools dynamically
  const ZOWE_EXPLORER_EXTENSION_ID = 'Zowe.vscode-extension-for-zowe';
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      const available = vscode.extensions.getExtension(ZOWE_EXPLORER_EXTENSION_ID) != null;
      log.info(`Zowe Explorer availability changed, notifying MCP servers: ${available}`);
      sendZoweExplorerUpdateEvent(available);
    })
  );

  // Log when the set of available language models changes (e.g. Copilot signs in/out)
  context.subscriptions.push(
    vscode.lm.onDidChangeChatModels(() => {
      void refreshLanguageModels();
    })
  );

  void showNoConnectionsNotificationIfNeeded();

  log.info(`${getDisplayName()} extension activated`);
}

/**
 * If no Zowe MCP connections are configured (no native connections and no mock
 * data directory), shows a one-time notification with a button to open Settings.
 * Exported for tests.
 */
export function showNoConnectionsNotificationIfNeeded(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const nativeConnections = getNativeConnectionsWithMigration(config);
  const mockDataDirectory = config.get<string>('mockDataDirectory', '').trim();
  if (nativeConnections.length > 0 || mockDataDirectory) {
    return;
  }
  const openSettings = 'Open Settings';
  void vscode.window
    .showInformationMessage(
      'Zowe MCP: No connections are configured. Add connections in Settings to connect to z/OS.',
      openSettings
    )
    .then(choice => {
      if (choice === openSettings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'zoweMCP');
      }
    });
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
 * Builds the command, args, and env used to start the Zowe MCP server.
 * Shared by the VS Code MCP provider and Cursor's registerServer.
 */
async function buildServerConfig(
  _context: vscode.ExtensionContext,
  serverModule: string,
  discoveryDir: string,
  workspaceId: string,
  log: ReturnType<typeof initLog>
): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
  const args = [serverModule, '--stdio'];
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const mockDataDirectory = config.get<string>('mockDataDirectory', '').trim();
  const nativeConnections = getNativeConnectionsWithMigration(config);
  const installZoweNativeServerAutomatically = config.get<boolean>(
    'installZoweNativeServerAutomatically',
    true
  );
  const zoweNativeServerPath = config.get<string>('zoweNativeServerPath', '~/.zowe-server');
  const nativeResponseTimeout = config.get<number>('nativeResponseTimeout', 60);
  const defaultMainframeMvsEncoding = config.get<string>('defaultMainframeMvsEncoding', 'IBM-037');
  const defaultMainframeUssEncoding = config.get<string>(
    'defaultMainframeUssEncoding',
    'IBM-1047'
  );

  if (mockDataDirectory && nativeConnections.length === 0) {
    args.push('--mock', mockDataDirectory);
    log.info(`Mock mode enabled: ${mockDataDirectory}`);
  } else {
    args.push('--native');
    for (const spec of nativeConnections) {
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
    log.info(
      `Native (SSH) mode enabled: ${nativeConnections.length} ${plural(nativeConnections.length, 'connection', 'connections')}`
    );
  }
  if (defaultMainframeMvsEncoding?.trim()) {
    args.push('--default-mvs-encoding', defaultMainframeMvsEncoding.trim());
  }
  if (defaultMainframeUssEncoding?.trim()) {
    args.push('--default-uss-encoding', defaultMainframeUssEncoding.trim());
  }

  let zeExt = vscode.extensions.getExtension('Zowe.vscode-extension-for-zowe');
  if (!zeExt) {
    await new Promise(r => setTimeout(r, 400));
    zeExt = vscode.extensions.getExtension('Zowe.vscode-extension-for-zowe');
  }
  if (zeExt) {
    try {
      await zeExt.activate();
    } catch {
      // Extension present but activation failed; still set env so server can register the tool.
    }
  }
  const zoweExplorerAvailable = zeExt != null;
  const firstFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const env: Record<string, string> = {
    MCP_DISCOVERY_DIR: discoveryDir,
    WORKSPACE_ID: workspaceId,
  };
  if (firstFolder) {
    env.ZOWE_MCP_WORKSPACE_DIR = firstFolder;
  }
  if (zoweExplorerAvailable) {
    env.ZOWE_EXPLORER_AVAILABLE = '1';
  }
  return { command: 'node', args, env };
}

/**
 * Registers the Zowe MCP server with Cursor's MCP API when running in Cursor.
 * Sets cursorMcpRegistered on success.
 */
async function registerWithCursor(
  context: vscode.ExtensionContext,
  serverModule: string,
  discoveryDir: string,
  workspaceId: string,
  log: ReturnType<typeof initLog>
): Promise<void> {
  if (typeof vscode.cursor?.mcp?.registerServer !== 'function') {
    return;
  }
  try {
    const serverConfig = await buildServerConfig(
      context,
      serverModule,
      discoveryDir,
      workspaceId,
      log
    );
    vscode.cursor.mcp.registerServer({
      name: 'zowe',
      server: {
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      },
    });
    cursorMcpRegistered = true;
    log.info('Registered Zowe MCP server with Cursor');
  } catch (err) {
    log.warn(`Cursor MCP registration failed: ${String(err)}`);
  }
}

/**
 * Unregisters and re-registers the Zowe MCP server with Cursor so the next server start uses current settings.
 */
async function updateCursorRegistration(
  context: vscode.ExtensionContext,
  serverModule: string,
  discoveryDir: string,
  workspaceId: string,
  log: ReturnType<typeof initLog>
): Promise<void> {
  if (typeof vscode.cursor?.mcp?.unregisterServer !== 'function') {
    return;
  }
  vscode.cursor.mcp.unregisterServer('zowe');
  try {
    const serverConfig = await buildServerConfig(
      context,
      serverModule,
      discoveryDir,
      workspaceId,
      log
    );
    vscode.cursor.mcp.registerServer({
      name: 'zowe',
      server: {
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      },
    });
    log.info('Updated Cursor MCP server registration with new settings');
  } catch (err) {
    log.warn(`Cursor MCP re-registration failed: ${String(err)}`);
  }
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

  // Let user choose preset (minimal = fastest, pagination = largest)
  const presets: { id: string; label: string; description: string }[] = [
    {
      id: 'minimal',
      label: 'Minimal',
      description: '1 system, 1 user, 5 data sets, 3 members — fastest',
    },
    { id: 'default', label: 'Default', description: '2 systems, 2 users, 8 data sets, 5 members' },
    { id: 'large', label: 'Large', description: '5 systems, 3 users, 20 data sets, 15 members' },
    {
      id: 'inventory',
      label: 'Inventory',
      description: '1 system + USER.INVNTORY with 2000 members',
    },
    {
      id: 'pagination',
      label: 'Pagination',
      description: 'Inventory + 1000 PEOPLE data sets (for evals)',
    },
  ];
  const chosen = await vscode.window.showQuickPick(presets, {
    title: 'Mock data preset',
    placeHolder: 'Choose a preset (minimal is fastest)',
    matchOnDescription: true,
  });
  if (!chosen) {
    return; // User cancelled
  }

  log.info(`Generating mock data in: ${outputDir} (preset: ${chosen.id})`);

  // Show progress while generating; stream output to log
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating Zowe MCP mock data...',
      cancellable: false,
    },
    () =>
      new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { spawn } = require('child_process') as typeof import('child_process');
        const child = spawn(
          process.execPath,
          [serverModule, 'init-mock', '--output', outputDir, '--preset', chosen.id],
          {
            cwd: context.extensionPath,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        const onData = (chunk: Buffer | string) => {
          const text = (typeof chunk === 'string' ? chunk : chunk.toString()).trim();
          if (text) {
            for (const line of text.split(/\r?\n/)) {
              if (line) log.info(line);
            }
          }
        };
        child.stdout?.on('data', (chunk: Buffer) => onData(chunk));
        child.stderr?.on('data', (chunk: Buffer) => onData(chunk));
        child.on('error', (err: Error) => {
          log.error(`Mock data generation failed: ${err.message}`);
          reject(err);
        });
        child.on('close', (code: number | null, signal: string | null) => {
          if (code === 0) {
            resolve();
          } else {
            const msg = signal
              ? `Process exited with signal ${signal}`
              : `Process exited with code ${code ?? 'unknown'}`;
            log.error(`Mock data generation failed: ${msg}`);
            reject(new Error(msg));
          }
        });
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
 * Returns the list of native connection specs, migrating from the old
 * nativeSystems setting to nativeConnections on first read if needed.
 */
function getNativeConnectionsWithMigration(config: vscode.WorkspaceConfiguration): string[] {
  const connections = config.get<string[]>('nativeConnections', []) ?? [];
  if (connections.length > 0) {
    return connections.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  }
  const legacy = config.get<string[]>('nativeSystems', []) ?? [];
  const valid = legacy.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  if (valid.length > 0) {
    void config.update('nativeConnections', valid, vscode.ConfigurationTarget.Global);
    return valid;
  }
  return [];
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
  const nativeConnections = getNativeConnectionsWithMigration(config);

  let spec: string;
  if (nativeConnections.length > 0) {
    const chosen = await vscode.window.showQuickPick(nativeConnections, {
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
  if (cursorMcpRegistered && typeof vscode.cursor?.mcp?.unregisterServer === 'function') {
    vscode.cursor.mcp.unregisterServer('zowe');
    cursorMcpRegistered = false;
  }
}
