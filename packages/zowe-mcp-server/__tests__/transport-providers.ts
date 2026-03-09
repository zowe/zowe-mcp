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
 * Transport provider abstraction for parameterized tests.
 *
 * Each provider knows how to set up and tear down a client connection
 * for a specific transport type (in-memory, stdio, HTTP).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ChildProcess, fork } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

/**
 * A transport provider creates a connected MCP client and cleans up after itself.
 */
export interface TransportProvider {
  /** Human-readable name for test output. */
  name: string;
  /** Create a connected client. */
  setup(): Promise<Client>;
  /** Tear down the client and any server processes. */
  teardown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory transport
// ---------------------------------------------------------------------------

export function createInMemoryProvider(): TransportProvider {
  let client: Client | undefined;
  let closeServer: (() => Promise<void>) | undefined;

  return {
    name: 'in-memory',
    async setup() {
      const server = createServer({ logToolCalls: true });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      client = new Client({ name: 'test-client', version: '1.0.0' });
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

      closeServer = async () => {
        await server.close();
      };

      return client;
    },
    async teardown() {
      if (client) {
        await client.close();
        client = undefined;
      }
      if (closeServer) {
        await closeServer();
        closeServer = undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

export function createStdioProvider(): TransportProvider {
  let client: Client | undefined;

  return {
    name: 'stdio',
    async setup() {
      const transport = new StdioClientTransport({
        command: 'node',
        args: [serverPath, '--stdio'],
      });

      client = new Client({ name: 'e2e-test', version: '1.0.0' });
      await client.connect(transport);

      return client;
    },
    async teardown() {
      if (client) {
        await client.close();
        client = undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP Streamable transport
// ---------------------------------------------------------------------------

let nextHttpPort = 14000;

/**
 * Starts the HTTP server in a child process on the given port.
 * Waits for the "listening" message on stderr before resolving.
 */
function startHttpServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = fork(serverPath, ['--http', '--port', String(port)], {
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

export function createHttpProvider(): TransportProvider {
  let client: Client | undefined;
  let serverProcess: ChildProcess | undefined;

  return {
    name: 'http',
    async setup() {
      const port = nextHttpPort++;
      serverProcess = await startHttpServer(port);

      const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));

      client = new Client({ name: 'http-e2e-test', version: '1.0.0' });
      await client.connect(transport);

      return client;
    },
    async teardown() {
      if (client) {
        try {
          await client.close();
        } catch {
          // Client may already be closed
        }
        client = undefined;
      }
      if (serverProcess) {
        serverProcess.kill();
        serverProcess = undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// All providers for parameterized tests
// ---------------------------------------------------------------------------

export const allProviders: (() => TransportProvider)[] = [
  createInMemoryProvider,
  createStdioProvider,
  createHttpProvider,
];
