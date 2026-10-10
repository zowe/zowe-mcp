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
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AtTlsGate } from 'zos-attls';
import { atTlsAwareJsonGet } from '../auth/attls-client-http.js';
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
 *
 * When ZOWE_MCP_JWKS_URI declares a separate transport to the IdP (plain http
 * over an outbound AT-TLS rule — docs/zos-attls-client-mode.md § 6.2), the
 * issuer's https origin is not reachable from this host in-process (the
 * outbound rule would double-wrap Node TLS), so the fetch uses the JWKS
 * origin as its base and rides the gated AT-TLS client path.
 */
function logOidcRegistrationDiscovery(jwtAuth: JwtAuthConfig, log: Logger): void {
  const transportBase = process.env.ZOWE_MCP_JWKS_URI?.trim()
    ? new URL(jwtAuth.jwksUri).origin
    : jwtAuth.issuer.replace(/\/$/, '');
  const discoveryUrl = `${transportBase}/.well-known/openid-configuration`;
  void (async () => {
    try {
      const res = await atTlsAwareJsonGet(discoveryUrl, { Accept: 'application/json' }, 5000);
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
  /**
   * Address to bind the listener to. Callers should default this to 127.0.0.1 when running
   * without authentication so unauthenticated MCP is not exposed beyond the local host.
   */
  host?: string;
  /**
   * Extra Host/Origin values accepted by the DNS-rebinding guard (in addition to the ones
   * derived from `host` and the actual port). Only used when `jwtAuth` is not set.
   */
  extraAllowedHosts?: string[];
  /**
   * AT-TLS aware-mode gate (z/OS, docs/zos-attls-aware-mode.md). Installed as
   * the FIRST middleware so no request is parsed and no bearer token is read
   * off a connection AT-TLS did not secure; also guards upgrades and runs a
   * startup policy self-probe against the live port.
   */
  atTlsGate?: AtTlsGate;
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
  const bindHostTrimmed = options?.host?.trim();
  const bindHost =
    bindHostTrimmed === undefined || bindHostTrimmed === '' ? undefined : bindHostTrimmed;
  const loopbackNames = ['127.0.0.1', 'localhost', '::1', '[::1]'];
  const loopbackBind = bindHost === undefined || loopbackNames.includes(bindHost);
  // Without JWT auth the only barrier is network reachability, so guard the transport
  // against DNS-rebinding / browser-driven access (MCP Streamable HTTP spec requires
  // Origin validation). Populated with the actual port once the listener is up.
  const dnsRebindingGuard = !jwtAuth;
  const allowedHosts: string[] = [];
  const allowedOrigins: string[] = [];

  /** Base URL as the client sees it (honors X-Forwarded-Proto behind a proxy). */
  const deriveBaseUrl = (req: Request): string => {
    const host = req.get('host') ?? `127.0.0.1:${String(req.socket.localPort ?? port)}`;
    const xfProto = req.headers['x-forwarded-proto'];
    const proto =
      typeof xfProto === 'string' ? xfProto.split(',')[0]?.trim() || 'http' : req.protocol;
    return `${proto}://${host}`;
  };
  /** RFC 9728 §5.1: where the WWW-Authenticate challenge points clients for discovery. */
  const protectedResourceMetadataUrl = (req: Request): string =>
    `${deriveBaseUrl(req)}/.well-known/oauth-protected-resource/mcp`;

  const atTlsGate = options?.atTlsGate;

  const app = express();
  if (atTlsGate) {
    app.use(atTlsGate.middleware);
  }
  // Express's default JSON body limit is 100kb, which rejects legitimate MCP
  // requests carrying data set / USS file content (e.g. writeDataset of a few
  // hundred lines) with PayloadTooLargeError. Default sized for the documented
  // workloads; override via ZOWE_MCP_HTTP_BODY_LIMIT (any express byte string).
  const bodyLimit = process.env.ZOWE_MCP_HTTP_BODY_LIMIT?.trim() ?? '16mb';
  logger.info('HTTP JSON body limit', { limit: bodyLimit });
  // Bearer-JWT gate BEFORE the body parser: the large body limit exists for
  // authenticated MCP payloads (writeDataset etc.) — an unauthenticated
  // request must be rejected from the headers alone, not after buffering and
  // parsing up to `bodyLimit` of JSON.
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    void mcpAuthGate(req, res, next);
  });
  app.use(express.json({ limit: bodyLimit }));
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
      return `${deriveBaseUrl(req)}/mcp`;
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
    logOidcRegistrationDiscovery(jwtAuth, log);
  }

  /** Map of active session ID → transport and optional JWT subject. */
  const sessions: Record<string, SessionEntry> = {};

  /**
   * /mcp auth gate, registered BEFORE the JSON body parser (hoisted function
   * declaration — see the app.use('/mcp', ...) above). On success the claims
   * are stashed in `res.locals.tenantClaims` for the route handlers; on
   * failure the 401/403 has already been sent and the chain stops here.
   */
  async function mcpAuthGate(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!jwtAuth) {
      next();
      return;
    }
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const entry = sessionId ? sessions[sessionId] : undefined;
    try {
      const claims = await verifyBearerOrRespond(req, res, entry?.sub);
      if (claims === null) {
        return;
      }
      res.locals.tenantClaims = claims;
      next();
    } catch (error) {
      // verifyBearerOrRespond answers its own failures; this is a backstop.
      log.error('Error in Bearer auth gate', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }

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
      // MCP authorization spec / RFC 9728 §5.1: point the client at the
      // protected-resource metadata so it can discover the authorization
      // server. RFC 6750 §3: no `error` attribute when credentials are absent.
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${protectedResourceMetadataUrl(req)}"`
      );
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
      // error_description is a quoted-string: strip characters that would
      // break the header syntax.
      const description = msg.replace(/["\\\r\n]/g, "'");
      res.setHeader(
        'WWW-Authenticate',
        `Bearer error="invalid_token", error_description="${description}", ` +
          `resource_metadata="${protectedResourceMetadataUrl(req)}"`
      );
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
        // Auth (incl. the session-sub binding) ran in mcpAuthGate.
        transport = sessions[sessionId].transport;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const tenant = jwtAuth ? (res.locals.tenantClaims as TenantJwtClaims) : undefined;
        const boundSub = tenant?.sub;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions[sid] = { transport, sub: boundSub };
            log.info('MCP session initialized', { mcpSessionId: sid, tenantSub: boundSub });
          },
          ...(dnsRebindingGuard
            ? {
                enableDnsRebindingProtection: true,
                // Host allowlist only makes sense when bound to loopback; an explicit
                // non-loopback bind is reachable under names we cannot enumerate.
                ...(loopbackBind ? { allowedHosts } : {}),
                allowedOrigins,
              }
            : {}),
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
    // Auth (incl. the session-sub binding) ran in mcpAuthGate.
    await sessions[sessionId].transport.handleRequest(req, res);
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
    try {
      // Auth (incl. the session-sub binding) ran in mcpAuthGate.
      await sessions[sessionId].transport.handleRequest(req, res);
    } catch (error) {
      log.error('Error handling session termination', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  return new Promise<HttpTransportHandle>((resolve, reject) => {
    const onListening = (): void => {
      const addr = httpServer.address();
      const actualPort =
        typeof addr === 'object' && addr !== null && 'port' in addr ? addr.port : port;
      if (dnsRebindingGuard) {
        const hostNames = new Set(loopbackNames);
        if (bindHost !== undefined) {
          hostNames.add(bindHost);
        }
        for (const name of hostNames) {
          allowedHosts.push(name, `${name}:${String(actualPort)}`);
          allowedOrigins.push(`http://${name}:${String(actualPort)}`);
        }
        for (const extra of options?.extraAllowedHosts ?? []) {
          allowedHosts.push(extra);
          allowedOrigins.push(`http://${extra}`, `https://${extra}`);
        }
        log.info('DNS-rebinding protection enabled for unauthenticated HTTP', {
          hostAllowlist: loopbackBind,
        });
      }
      log.info(
        `Zowe MCP Server (HTTP) listening on ${bindHost ?? 'all interfaces'}:${String(actualPort)}`
      );
      if (atTlsGate) {
        atTlsGate.attachUpgradeGuard(httpServer);
        log.info(`AT-TLS aware mode: ${atTlsGate.mode}`);
        // Log-only policy check at the real port; the service keeps running
        // either way (remote traffic is already fail-closed in required mode).
        void atTlsGate.startupSelfProbe(httpServer, actualPort);
      }
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((res, rej) => {
            httpServer.close(err => (err ? rej(err) : res()));
          }),
      });
    };
    const httpServer =
      bindHost !== undefined
        ? app.listen(port, bindHost, onListening)
        : app.listen(port, onListening);
    httpServer.on('error', reject);
  });
}
