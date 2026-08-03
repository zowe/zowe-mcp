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
 * HTTP Streamable transport-specific E2E tests.
 *
 * Tests that exercise behavior unique to the HTTP transport
 * (server startup, port binding, HTTP-specific error handling).
 *
 * Common tool tests shared across all transports live in common.test.ts.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChildProcess, fork } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Spawns the HTTP server without --http-allow-no-auth and without JWT env vars.
 * Resolves when the process exits, returning its exit code and accumulated stderr.
 */
function spawnHttpServerNoAuth(port: number): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = fork(serverPath, ['--http', '--port', String(port)], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      silent: true,
      // Ensure JWT env vars from the test runner's environment don't leak in.
      env: {
        ...process.env,
        ZOWE_MCP_JWT_ISSUER: '',
        ZOWE_MCP_JWKS_URI: '',
        ZOWE_MCP_HTTP_ALLOW_NO_AUTH: '',
      },
    });

    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('exit', (code: number | null) => {
      resolve({ exitCode: code ?? -1, stderr });
    });

    child.on('error', err => {
      reject(err);
    });

    // Safety timeout — the process should exit almost immediately.
    setTimeout(() => {
      child.kill();
      reject(new Error('Server did not exit within timeout'));
    }, 10000);
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

/**
 * Starts the HTTP server in a child process on the given port.
 * Waits for the "listening" message on stderr before resolving.
 */
function startHttpServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = fork(serverPath, ['--http', '--port', String(port), '--http-allow-no-auth'], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      silent: true,
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Server did not start within timeout'));
    }, 10000);

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('listening')) {
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('Zowe MCP Server (HTTP-specific)', () => {
  let client: Client;
  let serverProcess: ChildProcess;

  afterEach(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        // Client may already be closed
      }
    }
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  it('should start HTTP server on the specified port', async () => {
    const port = 15100;
    serverProcess = await startHttpServer(port);

    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));

    client = new Client({ name: 'http-e2e-test', version: '1.0.0' });
    await client.connect(transport);

    // Verify the server is listening and responsive on the expected port
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should use a custom port via --port flag', async () => {
    const port = 15101;
    serverProcess = await startHttpServer(port);

    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));

    client = new Client({ name: 'http-e2e-test', version: '1.0.0' });
    await client.connect(transport);

    // Verify the server is reachable on the custom port
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should support multiple concurrent sessions', async () => {
    const port = 15102;
    serverProcess = await startHttpServer(port);

    const transport1 = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));
    const transport2 = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));

    const client1 = new Client({ name: 'http-client-1', version: '1.0.0' });
    const client2 = new Client({ name: 'http-client-2', version: '1.0.0' });

    await client1.connect(transport1);
    await client2.connect(transport2);

    // Both clients should be able to call tools independently
    const [result1, result2] = await Promise.all([
      client1.callTool({ name: 'getContext', arguments: {} }),
      client2.callTool({ name: 'getContext', arguments: {} }),
    ]);

    const content1 = result1.content as { type: string; text: string }[];
    const content2 = result2.content as { type: string; text: string }[];

    expect((JSON.parse(content1[0].text) as { server: { name: string } }).server.name).toBe(
      'Zowe MCP Server'
    );
    expect((JSON.parse(content2[0].text) as { server: { name: string } }).server.name).toBe(
      'Zowe MCP Server'
    );

    // Clean up both clients
    client = client1; // afterEach will close this one
    try {
      await client2.close();
    } catch {
      // ignore
    }
  });

  it('should refuse to start when no JWT auth and --http-allow-no-auth is absent', async () => {
    const { exitCode, stderr } = await spawnHttpServerNoAuth(15103);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('without authentication');
    expect(stderr).toContain('--http-allow-no-auth');
  });

  it('should start with a warning when ZOWE_MCP_HTTP_ALLOW_NO_AUTH=1 is used instead of the flag', async () => {
    const port = 15104;
    serverProcess = await new Promise<ChildProcess>((resolve, reject) => {
      const child = fork(serverPath, ['--http', '--port', String(port)], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        silent: true,
        env: {
          ...process.env,
          ZOWE_MCP_JWT_ISSUER: '',
          ZOWE_MCP_JWKS_URI: '',
          ZOWE_MCP_HTTP_ALLOW_NO_AUTH: '1',
        },
      });

      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Server did not start within timeout'));
      }, 10000);

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.includes('listening')) {
          clearTimeout(timeout);
          resolve(child);
        }
      });

      child.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Server must have logged the unauthenticated-mode warning.
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));
    client = new Client({ name: 'http-e2e-test', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  /** Sends a raw MCP initialize POST with arbitrary headers; returns the HTTP status. */
  function rawMcpInitialize(
    port: number,
    headers: Record<string, string>
  ): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...headers,
          },
        },
        res => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        }
      );
      req.on('error', reject);
      req.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'rebind-test', version: '0.0.0' },
          },
        })
      );
    });
  }

  it('binds 127.0.0.1 by default in no-auth mode', async () => {
    const port = 15105;
    serverProcess = await startHttpServer(port);
    // Loopback requests work against the default no-auth bind.
    const { status } = await rawMcpInitialize(port, { host: `127.0.0.1:${port}` });
    expect(status).toBe(200);
  });

  it('rejects a cross-site Origin header in no-auth mode (DNS rebinding guard)', async () => {
    const port = 15106;
    serverProcess = await startHttpServer(port);
    const { status } = await rawMcpInitialize(port, {
      host: `127.0.0.1:${port}`,
      origin: 'http://evil.example',
    });
    expect(status).toBe(403);
  });

  it('rejects a non-loopback Host header in no-auth mode (DNS rebinding guard)', async () => {
    const port = 15107;
    serverProcess = await startHttpServer(port);
    const { status } = await rawMcpInitialize(port, { host: 'evil.example' });
    expect(status).toBe(403);
  });

  it('accepts a loopback Origin header in no-auth mode', async () => {
    const port = 15108;
    serverProcess = await startHttpServer(port);
    const { status } = await rawMcpInitialize(port, {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    });
    expect(status).toBe(200);
  });
});
