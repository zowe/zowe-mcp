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
 * Unit tests for the ExtensionClient class.
 *
 * Creates a mock named-pipe server, writes a discovery file to a temp
 * directory, and verifies that the client connects, sends events, and
 * receives events correctly.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEvent, LogLevelEvent, ServerToExtensionEvent } from '../src/events.js';
import { ExtensionClient, connectExtensionClient } from '../src/extension-client.js';
import { Logger } from '../src/log.js';

/** Poll until `predicate()` returns a truthy value, up to `timeoutMs`. */
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error('waitUntil timed out'));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

/** Read the first complete NDJSON line from a socket, resolving once it arrives. */
function readFirstLine(socket: Socket): Promise<string> {
  return new Promise<string>(resolve => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx !== -1) {
        socket.off('data', onData);
        resolve(buf.slice(0, idx));
      }
    };
    socket.on('data', onData);
  });
}

describe('ExtensionClient', () => {
  let mockServer: Server;
  let serverSocket: Socket | undefined;
  let pipePath: string;
  let discoveryDir: string;
  const workspaceId = 'test1234';
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Create a temp directory for the discovery file
    discoveryDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-test-'));

    // Create a unique pipe path
    pipePath = join(
      tmpdir(),
      `zowe-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`
    );

    // Start a mock pipe server
    await new Promise<void>(resolve => {
      mockServer = createServer(socket => {
        serverSocket = socket;
      });
      mockServer.listen(pipePath, () => {
        resolve();
      });
    });

    // Write the discovery file
    const discoveryFile = join(discoveryDir, `mcp-discovery-${workspaceId}.json`);
    writeFileSync(
      discoveryFile,
      JSON.stringify({
        socketPath: pipePath,
        workspaceId,
        timestamp: Date.now(),
        pid: process.pid,
      })
    );
  });

  afterEach(async () => {
    stderrSpy.mockRestore();
    serverSocket?.destroy();
    await new Promise<void>(resolve => {
      mockServer.close(() => resolve());
    });
    delete process.env.MCP_DISCOVERY_DIR;
    delete process.env.WORKSPACE_ID;
  });

  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------

  it('should connect to the pipe server via discovery file', async () => {
    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();

    await client.connect(discoveryDir, workspaceId, logger);

    expect(client.connected).toBe(true);
    client.close();
  });

  it('should report not connected before connect is called', () => {
    const client = new ExtensionClient();
    expect(client.connected).toBe(false);
  });

  it('should report not connected after close', async () => {
    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();

    await client.connect(discoveryDir, workspaceId, logger);
    expect(client.connected).toBe(true);

    client.close();
    expect(client.connected).toBe(false);
  });

  it('should handle missing discovery file gracefully', async () => {
    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();
    const emptyDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-empty-'));

    // Should not throw, just warn and return
    await client.connect(emptyDir, 'nonexistent', logger);

    expect(client.connected).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Sending events
  // -----------------------------------------------------------------------

  it('should send events to the pipe server as NDJSON', async () => {
    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();
    await client.connect(discoveryDir, workspaceId, logger);

    // Wait for the server to accept the connection
    await new Promise<void>(resolve => {
      const check = () => {
        if (serverSocket) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    const received = new Promise<string>(resolve => {
      serverSocket!.on('data', (data: Buffer) => {
        resolve(data.toString());
      });
    });

    const event: LogEvent = {
      type: 'log',
      data: {
        level: 'info',
        logger: 'test',
        message: 'hello from server',
      },
      timestamp: Date.now(),
    };

    client.sendEvent(event);

    const raw = await received;
    const parsed = JSON.parse(raw.trim()) as LogEvent;
    expect(parsed.type).toBe('log');
    expect(parsed.data.message).toBe('hello from server');
    expect(parsed.data.logger).toBe('test');

    client.close();
  });

  it('should not throw when sending events while disconnected', () => {
    const client = new ExtensionClient();
    const event: ServerToExtensionEvent = {
      type: 'log',
      data: { level: 'info', message: 'dropped' },
      timestamp: Date.now(),
    };

    // Should not throw
    expect(() => client.sendEvent(event)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Receiving events
  // -----------------------------------------------------------------------

  it('should dispatch received events to registered handlers', async () => {
    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();

    const receivedEvents: LogLevelEvent[] = [];
    client.onEvent(event => {
      if (event.type === 'log-level') receivedEvents.push(event);
    });

    await client.connect(discoveryDir, workspaceId, logger);

    // Wait for server socket
    await waitUntil(() => !!serverSocket);

    // Send a log-level event from the "extension" (mock server)
    const event: LogLevelEvent = {
      type: 'log-level',
      data: { level: 'debug' },
      timestamp: Date.now(),
    };
    serverSocket!.write(JSON.stringify(event) + '\n');

    // Wait for the event to be dispatched
    await new Promise<void>(resolve => {
      const check = () => {
        if (receivedEvents.length > 0) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].type).toBe('log-level');
    expect(receivedEvents[0].data.level).toBe('debug');

    client.close();
  });

  it('should handle multiple events in a single data chunk', async () => {
    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();

    const receivedEvents: LogLevelEvent[] = [];
    client.onEvent(event => {
      if (event.type === 'log-level') receivedEvents.push(event);
    });

    await client.connect(discoveryDir, workspaceId, logger);

    // Wait for server socket
    await waitUntil(() => !!serverSocket);

    // Send two events in one write
    const event1: LogLevelEvent = { type: 'log-level', data: { level: 'debug' }, timestamp: 1 };
    const event2: LogLevelEvent = { type: 'log-level', data: { level: 'error' }, timestamp: 2 };
    serverSocket!.write(JSON.stringify(event1) + '\n' + JSON.stringify(event2) + '\n');

    // Wait for both events
    await new Promise<void>(resolve => {
      const check = () => {
        if (receivedEvents.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0].data.level).toBe('debug');
    expect(receivedEvents[1].data.level).toBe('error');

    client.close();
  });

  // -----------------------------------------------------------------------
  // connectExtensionClient helper
  // -----------------------------------------------------------------------

  it('should return undefined when env vars are not set', async () => {
    delete process.env.MCP_DISCOVERY_DIR;
    delete process.env.WORKSPACE_ID;

    const logger = new Logger({ level: 'debug' });
    const client = await connectExtensionClient(logger);

    expect(client).toBeUndefined();
  });

  it('should connect when env vars are set correctly', async () => {
    process.env.MCP_DISCOVERY_DIR = discoveryDir;
    process.env.WORKSPACE_ID = workspaceId;

    const logger = new Logger({ level: 'debug' });
    const client = await connectExtensionClient(logger);

    expect(client).toBeDefined();
    expect(client!.connected).toBe(true);

    client!.close();
  });

  // -----------------------------------------------------------------------
  // Logger integration
  // -----------------------------------------------------------------------

  it('should forward log messages to the extension pipe when attached', async () => {
    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();
    await client.connect(discoveryDir, workspaceId, logger);

    // Wait for server socket
    await waitUntil(() => !!serverSocket);

    // Attach the extension client to the logger
    logger.attachExtension(client);

    const received = new Promise<string>(resolve => {
      let data = '';
      serverSocket!.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes('\n')) resolve(data);
      });
    });

    logger.info('test log message', { key: 'value' });

    const raw = await received;
    const parsed = JSON.parse(raw.trim()) as LogEvent;
    expect(parsed.type).toBe('log');
    expect(parsed.data.level).toBe('info');
    expect(parsed.data.message).toBe('test log message');
    expect(parsed.data.data).toEqual({ key: 'value' });

    client.close();
  });

  // -----------------------------------------------------------------------
  // Pipe handshake authentication
  // -----------------------------------------------------------------------

  it('sends pipe-handshake as the very first message when pipeSecret is in the discovery file', async () => {
    const pipeSecret = 'supersecret-test-42';

    // Overwrite the discovery file to include pipeSecret.
    const discoveryFile = join(discoveryDir, `mcp-discovery-${workspaceId}.json`);
    writeFileSync(
      discoveryFile,
      JSON.stringify({
        socketPath: pipePath,
        workspaceId,
        timestamp: Date.now(),
        pid: process.pid,
        pipeSecret,
      })
    );

    const logger = new Logger({ level: 'debug' });
    const client = new ExtensionClient();
    await client.connect(discoveryDir, workspaceId, logger);

    // Wait for the server side to accept the connection.
    await waitUntil(() => serverSocket !== undefined);

    // The socket is initially in paused mode, so the handshake data is buffered
    // until we add a listener — it is the first (and only) thing the client has sent.
    const firstLine = await readFirstLine(serverSocket!);
    const msg = JSON.parse(firstLine) as { type: string; secret: string };
    expect(msg.type).toBe('pipe-handshake');
    expect(msg.secret).toBe(pipeSecret);

    client.close();
  });

  it('logs a warning and skips the handshake when pipeSecret is absent from the discovery file', async () => {
    // The discovery file written by beforeEach has no pipeSecret field — this
    // represents a bug or a stale file.  The client should warn and still
    // attempt to connect (the server will reject it, but that is handled
    // server-side; the client itself should not crash).
    const warnMessages: string[] = [];
    const logger = new Logger({ level: 'debug' });
    // Capture warning output written to stderr.
    stderrSpy.mockImplementation((s: unknown) => {
      if (typeof s === 'string') warnMessages.push(s);
      return true;
    });

    const client = new ExtensionClient();
    await client.connect(discoveryDir, workspaceId, logger);

    await waitUntil(() => serverSocket !== undefined);

    // A warning must have been emitted about the missing secret.
    expect(warnMessages.some(m => m.includes('pipeSecret'))).toBe(true);

    // Trigger the first data by sending a regular event — no handshake prefix.
    const event: LogEvent = {
      type: 'log',
      data: { level: 'info', logger: 'test', message: 'no-handshake' },
      timestamp: Date.now(),
    };
    client.sendEvent(event);

    const firstLine = await readFirstLine(serverSocket!);
    const msg = JSON.parse(firstLine) as { type: string };
    expect(msg.type).toBe('log');

    client.close();
  });

  it('can exchange events after a mock server enforces handshake authentication', async () => {
    const pipeSecret = 'roundtrip-secret-99';
    const authPipePath = join(
      tmpdir(),
      `zowe-mcp-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`
    );

    // Build a mock server that enforces the handshake before forwarding events —
    // this mirrors the behaviour of the real pipe-server.ts after the security fix.
    const receivedEvents: LogEvent[] = [];
    let authServerSocket: Socket | undefined;

    const authServer = await new Promise<Server>(resolve => {
      const srv = createServer((socket: Socket) => {
        authServerSocket = socket;
        let buffer = '';
        let authenticated = false;

        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            if (!authenticated) {
              const msg = JSON.parse(line) as { type?: string; secret?: string };
              if (msg.type === 'pipe-handshake' && msg.secret === pipeSecret) {
                authenticated = true;
              } else {
                socket.destroy();
              }
              continue;
            }
            receivedEvents.push(JSON.parse(line) as LogEvent);
          }
        });
      });
      srv.listen(authPipePath, () => resolve(srv));
    });

    try {
      const authDiscoveryFile = join(discoveryDir, `mcp-discovery-authtest.json`);
      writeFileSync(
        authDiscoveryFile,
        JSON.stringify({
          socketPath: authPipePath,
          workspaceId: 'authtest',
          timestamp: Date.now(),
          pid: process.pid,
          pipeSecret,
        })
      );

      const logger = new Logger({ level: 'debug' });
      const client = new ExtensionClient();
      await client.connect(discoveryDir, 'authtest', logger);

      expect(client.connected).toBe(true);

      // Wait for the server to accept the connection.
      await waitUntil(() => authServerSocket !== undefined);

      // Give the handshake time to be processed.
      await new Promise<void>(resolve => setTimeout(resolve, 50));

      // Send a regular event — it should be dispatched after authentication.
      const event: LogEvent = {
        type: 'log',
        data: { level: 'info', logger: 'test', message: 'post-auth event' },
        timestamp: Date.now(),
      };
      client.sendEvent(event);

      await waitUntil(() => receivedEvents.length > 0);
      expect(receivedEvents[0].type).toBe('log');
      expect(receivedEvents[0].data.message).toBe('post-auth event');

      client.close();
    } finally {
      await new Promise<void>(resolve => authServer.close(() => resolve()));
    }
  });

  it('is disconnected when the server rejects an incorrect secret', async () => {
    const correctSecret = 'correct-secret';
    const wrongSecret = 'wrong-secret';
    const strictPipePath = join(
      tmpdir(),
      `zowe-mcp-strict-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`
    );

    // A mock server that closes the connection on a bad handshake.
    const strictServer = await new Promise<Server>(resolve => {
      const srv = createServer((socket: Socket) => {
        socket.once('data', (chunk: Buffer) => {
          const line = chunk.toString().split('\n')[0] ?? '';
          const msg = JSON.parse(line) as { type?: string; secret?: string };
          if (msg.type !== 'pipe-handshake' || msg.secret !== correctSecret) {
            socket.destroy();
          }
        });
      });
      srv.listen(strictPipePath, () => resolve(srv));
    });

    try {
      // Write discovery with the WRONG secret so the client sends the wrong one.
      const strictDiscoveryFile = join(discoveryDir, `mcp-discovery-strict.json`);
      writeFileSync(
        strictDiscoveryFile,
        JSON.stringify({
          socketPath: strictPipePath,
          workspaceId: 'strict',
          timestamp: Date.now(),
          pid: process.pid,
          pipeSecret: wrongSecret,
        })
      );

      const logger = new Logger({ level: 'debug' });
      const client = new ExtensionClient();
      await client.connect(discoveryDir, 'strict', logger);

      // The server will destroy the connection after receiving the wrong secret.
      await waitUntil(() => !client.connected);
      expect(client.connected).toBe(false);
    } finally {
      await new Promise<void>(resolve => strictServer.close(() => resolve()));
    }
  });

  // -----------------------------------------------------------------------
  // setLevel via log-level event
  // -----------------------------------------------------------------------

  it.skipIf(process.env.ZOWE_MCP_LOG_LEVEL !== undefined)(
    'should update logger level when receiving a log-level event',
    async () => {
      const logger = new Logger({ level: 'info' });
      const client = new ExtensionClient();

      // Register the log-level handler (same as index.ts does)
      client.onEvent(event => {
        if (event.type === 'log-level') {
          const { level } = event.data;
          logger.setLevel(level);
        }
      });

      await client.connect(discoveryDir, workspaceId, logger);

      // Wait for server socket
      await waitUntil(() => !!serverSocket);

      // Verify info is logged but debug is not
      logger.debug('should be suppressed');
      const debugCalls = (stderrSpy.mock.calls as string[][]).filter(
        c => typeof c[0] === 'string' && c[0].includes('should be suppressed')
      );
      expect(debugCalls).toHaveLength(0);

      // Send a log-level event to change to debug
      const event: LogLevelEvent = {
        type: 'log-level',
        data: { level: 'debug' },
        timestamp: Date.now(),
      };
      serverSocket!.write(JSON.stringify(event) + '\n');

      // Wait for the event to be processed
      await new Promise<void>(resolve => setTimeout(resolve, 100));

      // Now debug should be logged
      logger.debug('should now be visible');
      const visibleCalls = (stderrSpy.mock.calls as string[][]).filter(
        c => typeof c[0] === 'string' && c[0].includes('should now be visible')
      );
      expect(visibleCalls).toHaveLength(1);

      client.close();
    }
  );
});
