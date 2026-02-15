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
 * Named-pipe client that connects the MCP server to the VS Code extension.
 *
 * The VS Code extension creates a named pipe server per workspace and writes
 * a discovery file containing the socket path. This module reads the discovery
 * file (located via `MCP_DISCOVERY_DIR` + `WORKSPACE_ID` env vars), connects
 * to the pipe, and provides a typed event API for bidirectional communication.
 *
 * When the env vars are absent (e.g. standalone server mode) the client is
 * simply not created and the server operates identically to before.
 */

import { existsSync, readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import type { AnyMcpEvent, ExtensionToServerEvent, ServerToExtensionEvent } from './events.js';
import type { Logger } from './log.js';

/** Shape of the JSON discovery file written by the VS Code extension. */
interface DiscoveryFile {
  socketPath: string;
  workspaceId: string;
  timestamp: number;
  pid: number;
}

/** Callback for handling events received from the extension. */
export type EventHandler = (event: ExtensionToServerEvent) => void;

const MAX_CONNECT_ATTEMPTS = 10;
const CONNECT_RETRY_MS = 1000;

/**
 * Client that communicates with the VS Code extension over a named pipe.
 *
 * Use {@link connectExtensionClient} to create and connect an instance.
 */
export class ExtensionClient {
  private _socket: Socket | null = null;
  private _buffer = '';
  private readonly _handlers: EventHandler[] = [];

  /** Whether the pipe is currently connected and writable. */
  get connected(): boolean {
    return this._socket?.writable === true;
  }

  /**
   * Attempts to connect to the VS Code extension pipe.
   *
   * Reads the discovery file from `discoveryDir` and retries up to
   * {@link MAX_CONNECT_ATTEMPTS} times with a 1 s delay between attempts.
   */
  async connect(discoveryDir: string, workspaceId: string, logger: Logger): Promise<void> {
    const discoveryPath = join(discoveryDir, `mcp-discovery-${workspaceId}.json`);

    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
      if (existsSync(discoveryPath)) {
        try {
          const raw = readFileSync(discoveryPath, 'utf-8');
          const discovery: DiscoveryFile = JSON.parse(raw) as DiscoveryFile;
          await this._connectToPipe(discovery.socketPath, logger);
          return;
        } catch (err) {
          logger.warning(`Extension pipe connect attempt ${attempt} failed`, err);
        }
      } else {
        logger.debug(`Discovery file not found (attempt ${attempt}): ${discoveryPath}`);
      }

      if (attempt < MAX_CONNECT_ATTEMPTS) {
        await new Promise<void>(resolve => setTimeout(resolve, CONNECT_RETRY_MS));
      }
    }

    logger.warning('Could not connect to VS Code extension pipe after all retries');
  }

  /** Sends a typed event to the VS Code extension. */
  sendEvent(event: ServerToExtensionEvent): void {
    if (this._socket?.writable) {
      this._socket.write(JSON.stringify(event) + '\n');
    }
  }

  /** Registers a handler for events received from the extension. */
  onEvent(handler: EventHandler): void {
    this._handlers.push(handler);
  }

  /** Closes the pipe connection. */
  close(): void {
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private _connectToPipe(socketPath: string, logger: Logger): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = connect(socketPath);

      socket.on('connect', () => {
        logger.info('Connected to VS Code extension pipe', { socketPath });
        this._socket = socket;
        resolve();
      });

      socket.on('data', (data: Buffer) => {
        this._buffer += data.toString();
        const lines = this._buffer.split('\n');
        // Keep the last (possibly incomplete) chunk in the buffer
        this._buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          try {
            const event = JSON.parse(line) as AnyMcpEvent;
            this._dispatch(event as ExtensionToServerEvent);
          } catch {
            logger.warning('Failed to parse event from extension', { raw: line });
          }
        }
      });

      socket.on('error', (err: Error) => {
        logger.debug('Extension pipe socket error', { message: err.message });
        reject(err);
      });

      socket.on('close', () => {
        logger.info('Disconnected from VS Code extension pipe');
        this._socket = null;
      });
    });
  }

  private _dispatch(event: ExtensionToServerEvent): void {
    for (const handler of this._handlers) {
      try {
        handler(event);
      } catch {
        // Swallow handler errors to avoid crashing the server
      }
    }
  }
}

/**
 * Creates and connects an {@link ExtensionClient} using the standard
 * environment variables (`MCP_DISCOVERY_DIR`, `WORKSPACE_ID`).
 *
 * Returns `undefined` when the env vars are not set (standalone mode).
 */
export async function connectExtensionClient(
  logger: Logger
): Promise<ExtensionClient | undefined> {
  const discoveryDir = process.env.MCP_DISCOVERY_DIR;
  const workspaceId = process.env.WORKSPACE_ID;

  if (!discoveryDir || !workspaceId) {
    logger.debug('MCP_DISCOVERY_DIR or WORKSPACE_ID not set — extension pipe disabled');
    return undefined;
  }

  const client = new ExtensionClient();
  await client.connect(discoveryDir, workspaceId, logger);

  if (!client.connected) {
    return undefined;
  }

  return client;
}
