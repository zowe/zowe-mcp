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
 * HTTP Streamable transport for the Zowe MCP Server.
 *
 * Runs an Express server with per-session StreamableHTTPServerTransport
 * instances for remote/stateful MCP connections. Each client that sends
 * an initialization request gets its own McpServer + transport pair,
 * enabling multiple concurrent sessions on a single HTTP port.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../log.js';

/**
 * Starts the MCP HTTP server with multi-session support.
 *
 * For every new initialization request a fresh McpServer (via `createServer`)
 * and StreamableHTTPServerTransport are created and stored by session ID.
 * Subsequent requests with a valid `mcp-session-id` header are routed to
 * the matching transport.
 *
 * @param createServer - Factory that returns a fully-configured McpServer.
 * @param port - The port to listen on (default: 7542, Zowe MCP; Zowe API ML uses 7552-7558).
 * @param logger - Logger instance for diagnostic messages.
 */
export async function startHttp(
  createServer: () => McpServer,
  port = 7542,
  logger: Logger
): Promise<void> {
  const log = logger.child('http');
  const app = express();
  app.use(express.json());

  /** Map of active session ID → transport. */
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // -----------------------------------------------------------------------
  // POST /mcp — initialization + regular JSON-RPC requests
  // -----------------------------------------------------------------------
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId) {
        log.debug('MCP request', { mcpSessionId: sessionId });
      }
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Existing session — reuse transport
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request — create a new server + transport pair
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports[sid] = transport;
            log.info('MCP session initialized', { mcpSessionId: sid });
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
          }
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        // No valid session and not an init request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log.error('Error handling MCP request', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // GET /mcp — SSE streams for server-initiated messages
  // -----------------------------------------------------------------------
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // -----------------------------------------------------------------------
  // DELETE /mcp — session termination
  // -----------------------------------------------------------------------
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      log.error('Error handling session termination', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  return new Promise<void>(resolve => {
    app.listen(port, () => {
      log.info(`Zowe MCP Server (HTTP) listening on port ${port}`);
      resolve();
    });
  });
}
