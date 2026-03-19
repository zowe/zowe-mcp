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
 * Named-pipe server for bidirectional communication with MCP server instances.
 *
 * The VS Code extension creates a per-workspace pipe server on activation.
 * MCP server processes discover the pipe via a JSON file written to the
 * extension's global storage directory and connect to exchange typed events.
 *
 * Events are framed as newline-delimited JSON (NDJSON).
 */

import type {
  ExtensionToServerEvent,
  ServerToExtensionEvent,
} from '@zowe/mcp-server/dist/events.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { handleServerEvent } from './event-handler';
import { getLog } from './log';

/** Information returned to the caller so env vars can be set on the MCP server. */
export interface PipeServerInfo {
  workspaceId: string;
  discoveryDir: string;
}

/** Active client sockets connected to the pipe server. */
const connectedClients: net.Socket[] = [];

/**
 * Sends a typed event to all connected MCP server instances.
 */
export function sendEventToServers(event: ExtensionToServerEvent): void {
  const payload = JSON.stringify(event) + '\n';
  for (const socket of connectedClients) {
    if (socket.writable) {
      socket.write(payload);
    }
  }
}

/**
 * Generates a short, workspace-unique identifier.
 *
 * Uses an MD5 hash of the first workspace folder path. Falls back to a
 * timestamp-based ID when no workspace folder is open.
 */
function getWorkspaceId(): string {
  const folderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folderPath) {
    return crypto.createHash('md5').update(folderPath).digest('hex').substring(0, 8);
  }
  return `window-${Date.now()}`;
}

/**
 * Returns the platform-specific pipe/socket path.
 */
function getPipeName(workspaceId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\zowe-mcp-${workspaceId}`;
  }
  return path.join('/tmp', `zowe-mcp-${workspaceId}.sock`);
}

/**
 * Starts the named-pipe server and writes the discovery file.
 *
 * @returns Pipe server info needed to set env vars on the MCP server definition.
 */
export function startPipeServer(context: vscode.ExtensionContext): PipeServerInfo {
  const log = getLog();
  const workspaceId = getWorkspaceId();
  const pipeName = getPipeName(workspaceId);
  const discoveryDir = context.globalStorageUri.fsPath;

  // Clean up stale socket file on Unix
  if (process.platform !== 'win32' && fs.existsSync(pipeName)) {
    fs.unlinkSync(pipeName);
  }

  const server = net.createServer((socket: net.Socket) => {
    log.info(`MCP server connected to extension pipe`);
    connectedClients.push(socket);

    sendInitialLogLevel();
    sendInitialConnections();
    sendInitialNativeOptions();
    sendInitialEncodingOptions();
    sendInitialJobCards();
    sendInitialZoweExplorerStatus();

    let buffer = '';
    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        try {
          const event = JSON.parse(line) as ServerToExtensionEvent;
          handleServerEvent(log, event, {
            context,
            sendEventToServers,
          });
        } catch (e) {
          log.warn(`Failed to parse event from MCP server: ${String(e)}`);
        }
      }
    });

    socket.on('error', (err: Error) => {
      log.warn(`Extension pipe socket error: ${err.message}`);
    });

    socket.on('close', () => {
      log.info('MCP server disconnected from extension pipe');
      const idx = connectedClients.indexOf(socket);
      if (idx !== -1) {
        connectedClients.splice(idx, 1);
      }
    });
  });

  server.listen(pipeName, () => {
    log.info(`Extension pipe server listening on ${pipeName}`);

    // Write discovery file
    fs.mkdirSync(discoveryDir, { recursive: true });
    const discoveryFile = path.join(discoveryDir, `mcp-discovery-${workspaceId}.json`);
    fs.writeFileSync(
      discoveryFile,
      JSON.stringify({
        socketPath: pipeName,
        workspaceId,
        timestamp: Date.now(),
        pid: process.pid,
      })
    );
    log.info(`Discovery file written: ${discoveryFile}`);
  });

  server.on('error', (err: Error) => {
    log.error(`Extension pipe server error: ${err.message}`);
  });

  // Register cleanup
  context.subscriptions.push({
    dispose: () => {
      // Close all connected clients
      for (const socket of connectedClients) {
        socket.destroy();
      }
      connectedClients.length = 0;

      // Close the server
      server.close();

      // Remove socket file on Unix
      if (process.platform !== 'win32' && fs.existsSync(pipeName)) {
        try {
          fs.unlinkSync(pipeName);
        } catch {
          // Best-effort cleanup
        }
      }

      // Remove discovery file
      const discoveryFile = path.join(discoveryDir, `mcp-discovery-${workspaceId}.json`);
      if (fs.existsSync(discoveryFile)) {
        try {
          fs.unlinkSync(discoveryFile);
        } catch {
          // Best-effort cleanup
        }
      }
    },
  });

  return { workspaceId, discoveryDir };
}

/**
 * Sends the current `zoweMCP.logLevel` setting as a `log-level` event
 * to all connected MCP server instances.
 */
export function sendLogLevelEvent(level: string): void {
  sendEventToServers({
    type: 'log-level',
    data: { level },
    timestamp: Date.now(),
  } as ExtensionToServerEvent);
}

/**
 * Reads the current log-level from VS Code settings and sends it
 * to all connected servers. Called when a new server connects.
 */
function sendInitialLogLevel(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const level = config.get<string>('logLevel', 'info');
  sendLogLevelEvent(level);
}

/**
 * Sends the current native connections setting to all connected servers.
 * Called when a new server connects. Uses nativeConnections with migration from nativeSystems.
 */
function sendInitialConnections(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  let connections = config.get<string[]>('nativeConnections', []) ?? [];
  if (connections.length === 0) {
    const legacy = config.get<string[]>('nativeSystems', []) ?? [];
    connections = legacy.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  } else {
    connections = connections.filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0
    );
  }
  if (connections.length > 0) {
    sendEventToServers({
      type: 'connections-update',
      data: { connections },
      timestamp: Date.now(),
    } as ExtensionToServerEvent);
  }
}

/**
 * Reads the current native options from VS Code settings and sends a
 * native-options-update event to all connected servers. Called when a new server connects.
 */
function sendInitialNativeOptions(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const installZoweNativeServerAutomatically = config.get<boolean>(
    'installZoweNativeServerAutomatically',
    true
  );
  const zoweNativeServerPath = config.get<string>('zoweNativeServerPath', '~/.zowe-server');
  const responseTimeout = config.get<number>('nativeResponseTimeout', 60);
  sendEventToServers({
    type: 'native-options-update',
    data: {
      installZoweNativeServerAutomatically,
      zoweNativeServerPath: zoweNativeServerPath?.trim() || undefined,
      responseTimeout: responseTimeout > 0 ? responseTimeout : undefined,
    },
    timestamp: Date.now(),
  } as ExtensionToServerEvent);
}

/**
 * Sends the current default mainframe encoding settings to all connected servers.
 * Called when a new server connects.
 */
function sendInitialEncodingOptions(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const defaultMainframeMvsEncoding = config.get<string>('defaultMainframeMvsEncoding', 'IBM-037');
  const defaultMainframeUssEncoding = config.get<string>(
    'defaultMainframeUssEncoding',
    'IBM-1047'
  );
  sendEventToServers({
    type: 'encoding-options-update',
    data: {
      defaultMainframeMvsEncoding: defaultMainframeMvsEncoding?.trim() || undefined,
      defaultMainframeUssEncoding: defaultMainframeUssEncoding?.trim() || undefined,
    },
    timestamp: Date.now(),
  } as ExtensionToServerEvent);
}

/**
 * Sends a connections-update event to all connected MCP server instances.
 * Call when zoweMCP.nativeConnections configuration changes.
 */
export function sendConnectionsUpdateEvent(): void {
  sendInitialConnections();
}

/**
 * Sends the current native options to all connected MCP server instances.
 * Call when zoweMCP.installZoweNativeServerAutomatically or zoweMCP.zoweNativeServerPath changes.
 */
export function sendNativeOptionsUpdateEvent(): void {
  sendInitialNativeOptions();
}

/**
 * Sends the current default mainframe encoding options to all connected MCP server instances.
 * Call when zoweMCP.defaultMainframeMvsEncoding or zoweMCP.defaultMainframeUssEncoding changes.
 */
export function sendEncodingOptionsUpdateEvent(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const defaultMainframeMvsEncoding = config.get<string>('defaultMainframeMvsEncoding', 'IBM-037');
  const defaultMainframeUssEncoding = config.get<string>(
    'defaultMainframeUssEncoding',
    'IBM-1047'
  );
  sendEventToServers({
    type: 'encoding-options-update',
    data: {
      defaultMainframeMvsEncoding: defaultMainframeMvsEncoding?.trim() || undefined,
      defaultMainframeUssEncoding: defaultMainframeUssEncoding?.trim() || undefined,
    },
    timestamp: Date.now(),
  } as ExtensionToServerEvent);
}

/**
 * Sends the current job cards setting to all connected servers.
 * Called when a new server connects.
 */
function sendInitialJobCards(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const jobCards = config.get<Record<string, string | string[]>>('jobCards', {});
  const valid =
    jobCards && typeof jobCards === 'object'
      ? Object.fromEntries(
          Object.entries(jobCards).filter(
            (e): e is [string, string | string[]] =>
              typeof e[0] === 'string' &&
              e[0].trim().length > 0 &&
              (typeof e[1] === 'string' || Array.isArray(e[1]))
          )
        )
      : {};
  sendEventToServers({
    type: 'job-cards-update',
    data: { jobCards: valid },
    timestamp: Date.now(),
  } as ExtensionToServerEvent);
}

/**
 * Sends the current job cards to all connected MCP server instances.
 * Call when zoweMCP.jobCards configuration changes.
 */
export function sendJobCardsUpdateEvent(): void {
  sendInitialJobCards();
}

const ZOWE_EXPLORER_EXTENSION_ID = 'Zowe.vscode-extension-for-zowe';

/**
 * Returns whether the Zowe Explorer extension is installed (and thus available for open-in-editor tools).
 */
function isZoweExplorerAvailable(): boolean {
  return vscode.extensions.getExtension(ZOWE_EXPLORER_EXTENSION_ID) != null;
}

/**
 * Sends the current Zowe Explorer availability to all connected servers.
 * Called when a new server connects to the pipe.
 */
function sendInitialZoweExplorerStatus(): void {
  sendZoweExplorerUpdateEvent(isZoweExplorerAvailable());
}

/**
 * Sends a zowe-explorer-update event to all connected MCP server instances.
 * Call when Zowe Explorer is installed, activated, or disabled.
 */
export function sendZoweExplorerUpdateEvent(available: boolean): void {
  sendEventToServers({
    type: 'zowe-explorer-update',
    data: { available },
    timestamp: Date.now(),
  } as ExtensionToServerEvent);
}
