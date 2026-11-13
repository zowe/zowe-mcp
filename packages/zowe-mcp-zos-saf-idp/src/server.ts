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
 * Standalone SAF/RACF-backed OAuth 2.1 / OIDC authorization server for
 * `@zowe/mcp-server`'s HTTP Bearer-JWT resource-server auth, plus the legacy
 * `POST /login` direct token mint. See docs/zos-saf-idp.md for scope and the
 * dev/test-only posture.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import type { ClientMetadata } from 'oidc-provider';
import { createAtTlsGate, type AtTlsGate, type AtTlsMode } from 'zos-attls';
import { generateIdpKeyPair } from './keys.js';
import { createInteractionRouter } from './oidc/interactions.js';
import { buildOidcProvider } from './oidc/provider.js';
import { createRedirectPolicy } from './oidc/redirect-policy.js';
import { createRegistrationGuard } from './oidc/registration-guard.js';
import { RegistrationLimiter } from './oidc/registration-limit.js';
import { LoginRateLimiter } from './rate-limit.js';
import { createJwksRouter } from './routes/jwks.js';
import { createLoginRouter } from './routes/login.js';
import { resolveSafVerifier, type SafCheckMode, type SafVerifier } from './saf-verify.js';

export interface IdpServerConfig {
  host?: string;
  port?: number;
  issuer?: string;
  /**
   * SAF verification backend: 'ssh' (default; the portable connect probe),
   * 'native' (node-racf/__passwd — startup fails if unavailable), or 'auto'
   * (native on z/OS when node-racf loads, else ssh).
   */
  safCheck?: SafCheckMode;
  /** Test/embedding hook: overrides the resolved backend entirely. */
  safVerifier?: SafVerifier;
  /** SSH target used to verify credentials — defaults to loopback (127.0.0.1:22). */
  safHost?: string;
  safPort?: number;
  rateLimitMaxAttempts?: number;
  rateLimitWindowMs?: number;
  /** Max anonymous DCR requests one source address may make per window. Defaults to 10. */
  dcrMaxPerSource?: number;
  /** Sliding window for the per-source DCR limit, in ms. Defaults to 15 minutes. */
  dcrWindowMs?: number;
  /**
   * Lifetime cap on accepted dynamic client registrations — kept below
   * oidc-provider's shared in-memory LRU size (1000) so DCR spam can never
   * evict live sessions/grants. Defaults to 100.
   */
  dcrMaxTotal?: number;
  /** Access-token lifetime in seconds. Defaults to 300 (5 min). */
  tokenTtlSeconds?: number;
  /** MCP server URL the OAuth access tokens are bound to (RFC 8707 resource; JWT `aud`). */
  mcpResource?: string;
  /** Extra exact-match redirect URIs allowed in dynamic client registration. */
  redirectAllow?: string[];
  /** Statically configured OAuth clients, in addition to DCR. */
  staticClients?: ClientMetadata[];
  /** Honor X-Forwarded-* headers (behind a TLS-terminating reverse proxy). */
  trustProxy?: boolean;
  /**
   * TLS is terminated outside the process by something that forwards a plain
   * socket with NO proxy headers (z/OS AT-TLS, an stunnel-style tunnel). Every
   * request is treated as https: client-supplied X-Forwarded-* headers are
   * dropped and the scheme is forced, so an `https://` issuer works and secure
   * cookies are set. Mutually exclusive with `trustProxy`; requires an
   * `https://` issuer.
   */
  tlsTerminated?: boolean;
  /**
   * AT-TLS aware mode (z/OS): verify per connection that AT-TLS actually
   * secured it — `required` rejects cleartext with 403 (fail-closed),
   * `monitor` only logs. Requires `tlsTerminated` (aware mode is the
   * enforcement of that assertion). See docs/zos-attls-aware-mode.md.
   */
  attls?: AtTlsMode;
  /**
   * ZOWE_MCP_ATTLS_LOOPBACK_CLEAR=allow: permit cleartext from loopback peers
   * (hosts whose policy deliberately keeps loopback clear). Default: reject.
   */
  attlsLoopbackClear?: boolean;
  /** Test/embedding hook: overrides the constructed AT-TLS gate entirely. */
  attlsGate?: AtTlsGate;
  /** Skip the consent page after login. */
  autoConsent?: boolean;
  /** Required acknowledgment to bind a non-loopback host (passwords over plain HTTP). */
  allowNonLoopback?: boolean;
  /** System name shown on the login form. Defaults to this host's name (`os.hostname()`). */
  systemName?: string;
  /** Security product label (RACF / ACF2 / Top Secret). Defaults to a generic SAF label; the CLI attempts detection on z/OS. */
  securityProduct?: string;
  /** Purpose banner shown on the login form. Defaults to a testing-only disclaimer. */
  loginNotice?: string;
  log?: (message: string) => void;
}

export interface IdpServerHandle {
  port: number;
  issuer: string;
  close(): Promise<void>;
}

export const DEFAULT_MCP_RESOURCE = 'http://127.0.0.1:7542/mcp';

export const GENERIC_SECURITY_PRODUCT = 'the system security manager (SAF)';

export const DEFAULT_LOGIN_NOTICE =
  'This identity provider is for testing purposes only — do not use it in production.';

const LOOPBACK_BIND_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const noopLog = (): void => {
  /* logging disabled by default */
};

/** Origin + path of a redirect target, with query/fragment (codes, state) dropped. */
function redactUrl(value: unknown): string {
  if (typeof value !== 'string') return '(none)';
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split('?')[0];
  }
}

/**
 * Rewrites RFC 8414 authorization-server-metadata requests to the OIDC
 * discovery path oidc-provider actually serves, so both well-known documents
 * come from one source of truth. (VS Code's MCP client tries the RFC 8414
 * path first.)
 */
const RFC8414_PATH = '/.well-known/oauth-authorization-server';
function rfc8414Alias(req: Request, _res: Response, next: NextFunction): void {
  if (req.url === RFC8414_PATH || req.url.startsWith(`${RFC8414_PATH}?`)) {
    req.url = req.url.replace(RFC8414_PATH, '/.well-known/openid-configuration');
  }
  next();
}

/** Express app-settings key under which createIdpApp stores the AT-TLS gate. */
export const ATTLS_GATE_APP_SETTING = 'zosAtTlsGate';

/** Builds the Express app. A fresh signing keypair is generated per app instance. */
export function createIdpApp(issuer: string, config: IdpServerConfig = {}): Express {
  if (config.tlsTerminated && config.trustProxy) {
    throw new Error(
      '--tls-terminated and --trust-proxy are mutually exclusive: a proxy sets ' +
        'X-Forwarded-* headers, a transparent terminator (AT-TLS) does not'
    );
  }
  if (config.tlsTerminated && !issuer.startsWith('https://')) {
    throw new Error(
      `--tls-terminated requires an https:// issuer (got ${issuer}): the discovery ` +
        'document would otherwise advertise http URLs that clients on the https origin reject'
    );
  }
  const attlsMode = config.attls ?? 'off';
  if (attlsMode !== 'off' && !config.tlsTerminated) {
    throw new Error(
      `--attls ${attlsMode} requires --tls-terminated: aware mode enforces the assertion ` +
        'that AT-TLS covers this port, which --tls-terminated makes'
    );
  }
  const keyPair = generateIdpKeyPair();
  const rateLimiter = new LoginRateLimiter(config.rateLimitMaxAttempts, config.rateLimitWindowMs);
  const log = config.log ?? noopLog;
  const mcpResource = config.mcpResource ?? DEFAULT_MCP_RESOURCE;
  const tokenTtlSeconds = config.tokenTtlSeconds ?? 300;

  const verifier =
    config.safVerifier ??
    resolveSafVerifier({
      mode: config.safCheck,
      safHost: config.safHost,
      safPort: config.safPort,
      log,
    }).verifier;

  const provider = buildOidcProvider({
    issuer,
    keyPair,
    mcpResource,
    tokenTtlSeconds,
    staticClients: config.staticClients,
    trustProxy: config.trustProxy,
    tlsTerminated: config.tlsTerminated,
    log,
  });
  const providerCallback = provider.callback();
  const redirectPolicy = createRedirectPolicy(config.redirectAllow);

  // AT-TLS gate first — before the tlsTerminated scrub and every router, so
  // no request bytes are interpreted off a connection AT-TLS did not secure.
  // In `required` mode construction fails fast (non-z/OS, addon missing).
  const attlsModulePath = process.env.ZOWE_MCP_ATTLS_MODULE?.trim();
  const attlsGate =
    config.attlsGate ??
    (attlsMode !== 'off'
      ? createAtTlsGate({
          mode: attlsMode,
          modulePath:
            attlsModulePath === undefined || attlsModulePath === '' ? undefined : attlsModulePath,
          allowLoopbackClear: config.attlsLoopbackClear ?? false,
          log: (level, msg, fields) => {
            log(`[attls ${level}] ${msg}${fields ? ` ${JSON.stringify(fields)}` : ''}`);
          },
        })
      : undefined);

  const app = express();
  app.disable('x-powered-by');
  if (attlsGate) {
    // Stashed in app settings so startIdpHttp can attach the upgrade guard
    // and run the startup self-probe against the live listener.
    app.set(ATTLS_GATE_APP_SETTING, attlsGate);
    app.use(attlsGate.middleware);
  }
  if (config.tlsTerminated) {
    // AT-TLS decrypts in the TCP/IP stack and hands the app a plain socket with
    // no proxy headers. Force the scheme (and drop anything client-supplied, so
    // provider.proxy never trusts a spoofed X-Forwarded-For) before the
    // provider callback sees the request.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      delete req.headers['x-forwarded-for'];
      delete req.headers['x-forwarded-host'];
      delete req.headers['x-forwarded-port'];
      req.headers['x-forwarded-proto'] = 'https';
      next();
    });
  }
  // Access log: method + path + status only — never query strings (they carry
  // authorization codes and state), bodies, or headers (credentials/tokens).
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      log(
        `${req.method} ${req.path} -> ${String(res.statusCode)}` +
          (res.statusCode >= 300 && res.statusCode < 400
            ? ` (redirect to ${redactUrl(res.getHeader('location'))})`
            : '')
      );
    });
    next();
  });
  // NOTE: no app-wide body parser — oidc-provider must read its own request
  // bodies; parsers are scoped inside the individual routers instead.
  app.use(
    createLoginRouter({
      issuer,
      keyPair,
      rateLimiter,
      verifier,
      // RFC 8707 audience binding — same resource the OIDC-flow tokens carry.
      mcpResource,
      tokenTtlSeconds,
      log,
    })
  );
  app.use(createJwksRouter(keyPair));
  app.use(
    createInteractionRouter({
      provider,
      rateLimiter,
      // The z/OS system name, read live from the host unless overridden.
      systemName: config.systemName ?? hostname(),
      securityProduct: config.securityProduct ?? GENERIC_SECURITY_PRODUCT,
      loginNotice: config.loginNotice ?? DEFAULT_LOGIN_NOTICE,
      verifier,
      autoConsent: config.autoConsent,
      log,
    })
  );
  app.post(
    '/reg',
    createRegistrationGuard({
      policy: redirectPolicy,
      limiter: new RegistrationLimiter(
        config.dcrMaxPerSource,
        config.dcrWindowMs,
        config.dcrMaxTotal
      ),
      providerCallback,
      log,
    })
  );
  app.use(rfc8414Alias);
  app.use(providerCallback);
  return app;
}

/** Starts the IdP HTTP listener. `issuer` defaults to `http://<host>:<port>`. */
export function startIdpHttp(config: IdpServerConfig = {}): Promise<IdpServerHandle> {
  const host = config.host ?? '127.0.0.1';
  const port = config.port ?? 8089;
  const issuer = config.issuer ?? `http://${host}:${port}`;
  const log = config.log ?? noopLog;

  if (!LOOPBACK_BIND_HOSTS.has(host) && !config.allowNonLoopback && !config.tlsTerminated) {
    return Promise.reject(
      new Error(
        `refusing to bind non-loopback host ${host}: SAF passwords would transit plain HTTP. ` +
          'Use an SSH tunnel to reach the loopback listener (recommended), pass ' +
          '--tls-terminated when AT-TLS or a TLS tunnel protects this port, or pass ' +
          '--allow-nonloopback to acknowledge the risk.'
      )
    );
  }
  if (!LOOPBACK_BIND_HOSTS.has(host)) {
    if (config.tlsTerminated) {
      log(
        `binding non-loopback host ${host} with external TLS termination (--tls-terminated): ` +
          'the wire is only protected if an AT-TLS policy or TLS tunnel actually covers this port.'
      );
    } else {
      log(
        `WARNING: binding non-loopback host ${host} — SAF passwords and tokens will transit ` +
          'PLAIN HTTP on this interface. Only do this on a trusted network or behind a ' +
          'TLS-terminating proxy (--trust-proxy).'
      );
    }
  }

  // createIdpApp can throw synchronously (e.g. --saf-check native with no racf
  // module) — surface that as a rejection, not an escaping throw.
  let app: Express;
  try {
    app = createIdpApp(issuer, config);
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }

  const attlsGate = app.get(ATTLS_GATE_APP_SETTING) as AtTlsGate | undefined;

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(port, host);
    server.once('error', reject);
    server.once('listening', () => {
      const actualPort = (server.address() as AddressInfo).port;
      if (attlsGate) {
        attlsGate.attachUpgradeGuard(server);
        // Log-only policy check at the real port; the service keeps running
        // either way (remote traffic is already fail-closed in required mode).
        void attlsGate.startupSelfProbe(server, actualPort);
      }
      resolve({
        // The actual bound port — differs from config.port when 0 (ephemeral).
        port: actualPort,
        issuer,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close(err => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
