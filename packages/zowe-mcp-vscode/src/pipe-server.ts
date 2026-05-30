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
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { handleServerEvent } from './event-handler';
import { getLog } from './log';
import {
  getZowexConnectionsWithMigration,
  getZowexResponseTimeout,
  getZowexServerAutoInstall,
  getZowexServerPath,
} from './zowex-settings';

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
 *
 * On Unix, the socket is placed in `os.tmpdir()` (per-user on macOS; world-writable
 * on Linux). A random suffix keeps the filename unguessable so pre-emption is not
 * feasible. Permissions are set to 0o600 after the socket is created. The discovery
 * file (written to the per-user `globalStorageUri`) is the only channel through which
 * legitimate MCP server processes learn the full socket path.
 *
 * On Windows, the named-pipe namespace is used. The random suffix prevents name
 * collisions and brute-force guessing.
 */
function getPipeName(workspaceId: string, randomSuffix: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\zowe-mcp-${workspaceId}-${randomSuffix}`;
  }
  return path.join(os.tmpdir(), `zowe-mcp-${workspaceId}-${randomSuffix}.sock`);
}

/** How long a newly-connected peer has to send the handshake before the connection is closed. */
const HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * Starts the named-pipe server and writes the discovery file.
 *
 * Security hardening applied here:
 *  - The socket filename includes a cryptographically random 8-byte suffix so
 *    the path cannot be guessed or pre-empted by another local process.
 *  - On Unix the socket file permissions are set to 0o600 immediately after the
 *    server starts listening (effective on Linux; advisory on macOS/BSD).
 *  - A 32-byte random `pipeSecret` is generated and written into the per-user
 *    discovery file in `globalStorageUri`. Every connecting peer must send a
 *    `{"type":"pipe-handshake","secret":"<value>"}` line as its very first
 *    message. Connections that do not authenticate within 5 s are closed.
 *    Initial configuration events are only broadcast after authentication.
 *
 * @returns Pipe server info needed to set env vars on the MCP server definition.
 */
export function startPipeServer(context: vscode.ExtensionContext): PipeServerInfo {
  const log = getLog();
  const workspaceId = getWorkspaceId();

  // Cryptographically random suffix — prevents pre-emption and name guessing.
  const pipeSuffix = crypto.randomBytes(8).toString('hex');
  const pipeName = getPipeName(workspaceId, pipeSuffix);
  const discoveryDir = context.globalStorageUri.fsPath;

  // One-time secret that the MCP server must present as its first message.
  const pipeSecret = crypto.randomBytes(32).toString('hex');

  // Clean up stale socket file on Unix
  if (process.platform !== 'win32' && fs.existsSync(pipeName)) {
    fs.unlinkSync(pipeName);
  }

  const server = net.createServer((socket: net.Socket) => {
    log.info('New pipe client connecting — awaiting authentication');

    let authenticated = false;
    let buffer = '';

    // Reject unauthenticated connections after the grace period.
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        log.warn('Pipe client did not authenticate in time — closing connection');
        socket.destroy();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim().length === 0) continue;

        if (!authenticated) {
          // The very first non-empty line must be the handshake.
          let msg: unknown;
          try {
            msg = JSON.parse(line);
          } catch {
            log.warn('Pipe client sent non-JSON as handshake — closing connection');
            clearTimeout(authTimeout);
            socket.destroy();
            return;
          }

          const handshake = msg as { type?: unknown; secret?: unknown };
          if (handshake.type === 'pipe-handshake' && handshake.secret === pipeSecret) {
            authenticated = true;
            clearTimeout(authTimeout);
            log.info('MCP server authenticated on extension pipe');

            connectedClients.push(socket);
            sendInitialLogLevel();
            sendInitialConnections();
            sendInitialZowexOptions();
            sendInitialEncodingOptions();
            sendInitialJobCards();
            sendInitialCliPluginConfiguration();
            sendInitialZoweExplorerStatus();
          } else {
            log.warn('Pipe client sent incorrect handshake — closing connection');
            clearTimeout(authTimeout);
            socket.destroy();
            return;
          }
          continue;
        }

        // Authenticated path: process events normally.
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
      clearTimeout(authTimeout);
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (authenticated) {
        log.info('MCP server disconnected from extension pipe');
        const idx = connectedClients.indexOf(socket);
        if (idx !== -1) {
          connectedClients.splice(idx, 1);
        }
      }
    });
  });

  server.listen(pipeName, () => {
    log.info(`Extension pipe server listening on ${pipeName}`);

    // Restrict socket access on Unix. On Linux this prevents other local users
    // from connecting; on macOS directory permissions apply, but this adds a
    // defence-in-depth layer.
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(pipeName, 0o600);
      } catch (e) {
        log.warn(`Could not set pipe socket permissions: ${String(e)}`);
      }
    }

    // Write discovery file (already in per-user globalStorageUri).
    fs.mkdirSync(discoveryDir, { recursive: true });
    const discoveryFile = path.join(discoveryDir, `mcp-discovery-${workspaceId}.json`);
    fs.writeFileSync(
      discoveryFile,
      JSON.stringify({
        socketPath: pipeName,
        workspaceId,
        timestamp: Date.now(),
        pid: process.pid,
        pipeSecret,
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
 * Sends the current Zowe Remote SSH connection list to all connected servers.
 * Called when a new server connects. Uses `zowexConnections` with migration from legacy keys.
 */
function sendInitialConnections(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const connections = getZowexConnectionsWithMigration(config);
  if (connections.length > 0) {
    sendEventToServers({
      type: 'connections-update',
      data: { connections },
      timestamp: Date.now(),
    } as ExtensionToServerEvent);
  }
}

/**
 * Reads the current Zowe Remote SSH (zowex) options from VS Code settings and sends a
 * `zowex-options-update` event to all connected servers. Called when a new server connects.
 */
function sendInitialZowexOptions(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const zowexServerAutoInstall = getZowexServerAutoInstall(config);
  const zowexServerPath = getZowexServerPath(config);
  const responseTimeout = getZowexResponseTimeout(config);
  sendEventToServers({
    type: 'zowex-options-update',
    data: {
      zowexServerAutoInstall,
      zowexServerPath: zowexServerPath?.trim() || undefined,
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
  sendEncodingOptionsUpdateEvent();
}

/**
 * Sends a connections-update event to all connected MCP server instances.
 * Call when zoweMCP.zowexConnections (or legacy nativeConnections) configuration changes.
 */
export function sendConnectionsUpdateEvent(): void {
  sendInitialConnections();
}

/**
 * Sends the current zowex client options to all connected MCP server instances.
 * Call when zowex or legacy native server path / auto-install / response timeout settings change.
 */
export function sendZowexOptionsUpdateEvent(): void {
  sendInitialZowexOptions();
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

/**
 * Sends the current CLI plugin configuration to all connected servers.
 * Called when a new server connects.
 */
function sendInitialCliPluginConfiguration(): void {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const cliPluginConfiguration =
    config.get<Record<string, unknown>>('cliPluginConfiguration', {}) ?? {};
  const configuration: Record<string, unknown> = {};
  for (const [name, profilesObj] of Object.entries(cliPluginConfiguration)) {
    if (profilesObj !== null && typeof profilesObj === 'object') {
      configuration[name] = profilesObj;
    }
  }
  sendEventToServers({
    type: 'cli-plugin-configuration-update',
    data: { configuration },
    timestamp: Date.now(),
  } as unknown as ExtensionToServerEvent);
}

/**
 * Sends the current CLI plugin configuration to all connected MCP server instances.
 * Call when zoweMCP.cliPluginConfiguration changes.
 */
export function sendCliPluginConfigurationUpdateEvent(): void {
  sendInitialCliPluginConfiguration();
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
