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
 *
 * Optional Bearer JWT (ZOWE_MCP_JWT_ISSUER + ZOWE_MCP_JWKS_URI) scopes
 * sessions to OIDC `sub` for shared per-user caches and CLI plugin state.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { JwtAuthConfig, TenantJwtClaims } from '../auth/bearer-jwt.js';
import { extractBearerToken, verifyBearerJwt } from '../auth/bearer-jwt.js';
import type { Logger } from '../log.js';
import { registerPasswordUrlElicitRoutes } from './http-password-elicit.js';

/** OIDC discovery document subset (we only read registration_endpoint). */
interface OidcDiscoveryDocument {
  registration_endpoint?: string;
}

/**
 * Best-effort fetch of `{issuer}/.well-known/openid-configuration`. Logs at notice level only
 * when the document includes `registration_endpoint` (the only registration URL defined by OIDC discovery).
 */
function logOidcRegistrationDiscovery(issuer: string, log: Logger): void {
  const base = issuer.replace(/\/$/, '');
  const discoveryUrl = `${base}/.well-known/openid-configuration`;
  void (async () => {
    try {
      const res = await fetch(discoveryUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        log.debug('OIDC discovery HTTP status', { discoveryUrl, status: res.status });
        return;
      }
      const doc = (await res.json()) as OidcDiscoveryDocument;
      const reg = doc.registration_endpoint?.trim();
      if (reg) {
        log.notice('OIDC discovery lists registration_endpoint', {
          discoveryUrl,
          registration_endpoint: reg,
        });
      } else {
        log.debug('OIDC discovery has no registration_endpoint', { discoveryUrl });
      }
    } catch (e) {
      log.debug('OIDC discovery fetch failed', {
        discoveryUrl,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
}

/** Factory receives verified OIDC claims when JWT auth is enabled; otherwise undefined. */
export type HttpServerFactory = (tenant?: TenantJwtClaims) => McpServer;

export interface StartHttpOptions {
  /** When set, requires `Authorization: Bearer` on every /mcp request and binds sessions to `sub`. */
  jwtAuth?: JwtAuthConfig;
}

/** Handle returned by {@link startHttp} so tests (or embedding) can shut down the listener. */
export interface HttpTransportHandle {
  /** TCP port the server is listening on (may differ from the requested port when `0` is used). */
  port: number;
  close: () => Promise<void>;
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  /** OIDC subject when `jwtAuth` is configured. */
  sub?: string;
}

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
 * @param options - Optional JWT verification for multi-tenant HTTP.
 */
export async function startHttp(
  createServer: HttpServerFactory,
  port = 7542,
  logger: Logger,
  options?: StartHttpOptions
): Promise<HttpTransportHandle> {
  const log = logger.child('http');
  const jwtAuth = options?.jwtAuth;
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  registerPasswordUrlElicitRoutes(app, logger);

  // MCP OAuth 2.0 / RFC 9728: discovery so clients (e.g. MCP Inspector browser flow) can find the IdP.
  // Without this, GET /.well-known/oauth-protected-resource fails and Inspector shows "fetch" errors.
  if (jwtAuth) {
    const oauthDiscoveryPaths = [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ];
    const setDiscoveryCors = (res: Response): void => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Accept, MCP-Protocol-Version, Content-Type, Authorization'
      );
    };
    const resourceUrl = (req: Request): string => {
      const explicit = process.env.ZOWE_MCP_OAUTH_RESOURCE?.trim();
      if (explicit) {
        return explicit;
      }
      const host = req.get('host') ?? `127.0.0.1:${String(req.socket.localPort ?? port)}`;
      const xfProto = req.headers['x-forwarded-proto'];
      const proto =
        typeof xfProto === 'string' ? xfProto.split(',')[0]?.trim() || 'http' : req.protocol;
      return `${proto}://${host}/mcp`;
    };
    const sendProtectedResourceMetadata = (req: Request, res: Response): void => {
      setDiscoveryCors(res);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).json({
        resource: resourceUrl(req),
        authorization_servers: [jwtAuth.issuer],
        scopes_supported: ['openid', 'profile', 'email'],
      });
    };
    app.options(oauthDiscoveryPaths, (req: Request, res: Response) => {
      setDiscoveryCors(res);
      res.status(204).end();
    });
    app.get(oauthDiscoveryPaths, sendProtectedResourceMetadata);
    log.info('OAuth protected resource metadata routes enabled (JWT HTTP)', {
      paths: oauthDiscoveryPaths,
    });
    logOidcRegistrationDiscovery(jwtAuth.issuer, log);
  }

  /** Map of active session ID → transport and optional JWT subject. */
  const sessions: Record<string, SessionEntry> = {};

  async function verifyBearerOrRespond(
    req: Request,
    res: Response,
    sessionSub: string | undefined
  ): Promise<TenantJwtClaims | null> {
    if (!jwtAuth) {
      return null;
    }
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: missing Bearer token' },
        id: null,
      });
      return null;
    }
    try {
      const claims = await verifyBearerJwt(token, jwtAuth);
      if (sessionSub !== undefined && claims.sub !== sessionSub) {
        res.status(403).json({
          jsonrpc: '2.0',
          error: {
            code: -32003,
            message: 'Forbidden: Bearer token subject does not match MCP session',
          },
          id: null,
        });
        return null;
      }
      return claims;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32002, message: `Unauthorized: ${msg}` },
        id: null,
      });
      return null;
    }
  }

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

      if (sessionId && sessions[sessionId]) {
        const entry = sessions[sessionId];
        const claims = await verifyBearerOrRespond(req, res, entry.sub);
        if (jwtAuth && claims === null) {
          return;
        }
        transport = entry.transport;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const claims = await verifyBearerOrRespond(req, res, undefined);
        if (jwtAuth && claims === null) {
          return;
        }
        const tenant = claims ?? undefined;
        const boundSub = tenant?.sub;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions[sid] = { transport, sub: boundSub };
            log.info('MCP session initialized', { mcpSessionId: sid, tenantSub: boundSub });
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions[sid]) {
            delete sessions[sid];
          }
        };

        const server = createServer(tenant);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
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
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    const entry = sessions[sessionId];
    const claims = await verifyBearerOrRespond(req, res, entry.sub);
    if (jwtAuth && claims === null) {
      return;
    }
    await entry.transport.handleRequest(req, res);
  });

  // -----------------------------------------------------------------------
  // DELETE /mcp — session termination
  // -----------------------------------------------------------------------
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    const entry = sessions[sessionId];
    try {
      const claims = await verifyBearerOrRespond(req, res, entry.sub);
      if (jwtAuth && claims === null) {
        return;
      }
      await entry.transport.handleRequest(req, res);
    } catch (error) {
      log.error('Error handling session termination', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  return new Promise<HttpTransportHandle>((resolve, reject) => {
    const httpServer = app.listen(port, () => {
      const addr = httpServer.address();
      const actualPort =
        typeof addr === 'object' && addr !== null && 'port' in addr ? addr.port : port;
      log.info(`Zowe MCP Server (HTTP) listening on port ${actualPort}`);
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((res, rej) => {
            httpServer.close(err => (err ? rej(err) : res()));
          }),
      });
    });
    httpServer.on('error', reject);
  });
}
