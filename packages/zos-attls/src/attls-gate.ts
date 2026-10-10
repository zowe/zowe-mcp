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
 * AT-TLS enforcement gate: turns AT-TLS's fail-open (a connection with no
 * matching policy silently stays cleartext) into fail-closed. Each accepted
 * connection is queried against the TCP stack (SIOCTTLSCTL, TTLS_QUERY_ONLY)
 * on its first HTTP request; connections not secured by AT-TLS are rejected
 * with 403 before any body parsing or auth runs. Design and the full verdict
 * matrix: docs/zos-attls-aware-mode.md.
 *
 * The query function is injected, so all verdict logic is testable
 * off-platform with a fake; the real addon is loaded via attls-load.ts.
 */

import type { Server as HttpServer } from 'node:http';
import * as net from 'node:net';
import type { AtTlsQueryResult } from './attls-load.js';
import type { AtTlsLogFn, AtTlsMode } from './attls-runtime.js';
import { errorCode, resolveAtTlsRuntime } from './attls-runtime.js';

export type { AtTlsLogFn, AtTlsLogLevel, AtTlsMode } from './attls-runtime.js';

/**
 * Structural subsets of Express's Request/Response (which extend Node's
 * IncomingMessage/ServerResponse), so the gate needs no express dependency
 * yet its middleware is assignable to an express RequestHandler.
 */
export interface GateRequest {
  socket: net.Socket;
}
export interface GateResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}
export type AtTlsMiddleware = (req: GateRequest, res: GateResponse, next: () => void) => void;

export interface AtTlsGate {
  /** Effective mode — may be 'off' after a monitor-mode degradation. */
  readonly mode: AtTlsMode;
  /** Connection gate — install FIRST, before any parsing/auth/logging. */
  readonly middleware: AtTlsMiddleware;
  /** Destroys not-secure upgrade attempts in required mode (defensive). */
  attachUpgradeGuard(server: HttpServer): void;
  /**
   * One loopback self-connection after listen; queries the accepted socket
   * (no HTTP request is sent, so this is log-only and independent of the
   * loopback-clear setting) and logs whether an AT-TLS policy is installed
   * at the port. Never rejects — remote traffic is already fail-closed.
   */
  startupSelfProbe(server: HttpServer, port: number): Promise<void>;
}

export interface AtTlsGateOptions {
  mode: AtTlsMode;
  /** Injected for tests; when absent the native addon is loaded. */
  queryFn?: (fd: number) => AtTlsQueryResult;
  /** ZOWE_MCP_ATTLS_MODULE — explicit addon path for out-of-tree builds. */
  modulePath?: string;
  /**
   * ZOWE_MCP_ATTLS_LOOPBACK_CLEAR=allow — permits cleartext from loopback
   * peers only (verdict row 2). Default false: strict, every connection must
   * be AT-TLS secured.
   */
  allowLoopbackClear?: boolean;
  log: AtTlsLogFn;
  /** Injected for tests; defaults to process.platform. */
  platform?: string;
}

/** Parses ZOWE_MCP_ATTLS / --attls. Absent or empty means 'off'. */
export function parseAtTlsMode(raw: string | undefined): AtTlsMode {
  if (raw === undefined || raw === '') return 'off';
  if (raw === 'off' || raw === 'monitor' || raw === 'required') return raw;
  throw new Error(
    `invalid AT-TLS mode ${JSON.stringify(raw)}: expected "off", "monitor", or "required"`
  );
}

/** Parses ZOWE_MCP_ATTLS_LOOPBACK_CLEAR. Absent or empty means 'reject' (strict). */
export function parseLoopbackClear(raw: string | undefined): boolean {
  if (raw === undefined || raw === '' || raw === 'reject') return false;
  if (raw === 'allow') return true;
  throw new Error(
    `invalid ZOWE_MCP_ATTLS_LOOPBACK_CLEAR ${JSON.stringify(raw)}: expected "allow" or "reject"`
  );
}

/** Loopback peers: 127.0.0.0/8, ::1, and the IPv4-mapped form. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const v4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** Verdict matrix row (docs/zos-attls-aware-mode.md § 4.2), kept in logs. */
interface Verdict {
  allow: boolean;
  row: 1 | 2 | 3 | 4 | 5 | 6;
  reason: string;
  fields: Record<string, unknown>;
}

/** Per-socket verdict cache: AT-TLS status cannot change mid-connection. */
const VERDICT = Symbol('zosAtTlsVerdict');

/**
 * `socket._handle.fd` is internal but stable on POSIX libuv; a missing fd is
 * verdict row 6 (reject). Proven on-platform by native/test.mjs. Exported for
 * attls-probe.ts (package-internal; not re-exported from the index).
 */
export function socketFd(socket: net.Socket): number | undefined {
  const handle = (socket as unknown as { _handle?: { fd?: unknown } })._handle;
  return typeof handle?.fd === 'number' && handle.fd >= 0 ? handle.fd : undefined;
}

export function createAtTlsGate(opts: AtTlsGateOptions): AtTlsGate {
  const log = opts.log;
  const allowLoopbackClear = opts.allowLoopbackClear ?? false;
  const platform = opts.platform ?? process.platform;

  // Startup fail-fast (§ 4.4): required refuses to start on anything a doctor
  // could detect; monitor warns and degrades to off.
  const { mode, queryFn } = resolveAtTlsRuntime({
    mode: opts.mode,
    queryFn: opts.queryFn,
    modulePath: opts.modulePath,
    platform,
    log,
    what: 'AT-TLS aware mode',
  });

  function evaluate(socket: net.Socket): Verdict {
    const remote = socket.remoteAddress;
    const fd = socketFd(socket);
    if (fd === undefined) {
      return {
        allow: false,
        row: 6,
        reason: 'socket file descriptor unavailable',
        fields: { remote },
      };
    }
    let query: AtTlsQueryResult;
    try {
      // queryFn is always set here: mode !== 'off' guarantees the addon
      // loaded (or the gate degraded/threw at construction).
      query = queryFn!(fd);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'EWOULDBLOCK' || code === 'EAGAIN') {
        // Handshake still in progress at request time — should not occur
        // (cleartext bytes only surface once AT-TLS decided); reject
        // defensively rather than trust an undecided connection.
        return {
          allow: false,
          row: 5,
          reason: 'AT-TLS handshake in progress',
          fields: { remote, code },
        };
      }
      return {
        allow: false,
        row: 6,
        reason: 'AT-TLS query failed',
        fields: { remote, code, error: err instanceof Error ? err.message : String(err) },
      };
    }
    if (query.connStatus === 'secure') {
      return {
        allow: true,
        row: 1,
        reason: 'connection secured by AT-TLS',
        fields: { remote, protocol: query.protocol, cipher: query.cipher },
      };
    }
    if (query.connStatus === 'handshakeInProgress') {
      return {
        allow: false,
        row: 5,
        reason: 'AT-TLS handshake in progress',
        fields: { remote, policyStatus: query.policyStatus },
      };
    }
    // connStatus === 'notSecure'
    if (allowLoopbackClear && isLoopbackAddress(remote)) {
      return {
        allow: true,
        row: 2,
        reason: 'cleartext loopback allowed by explicit ZOWE_MCP_ATTLS_LOOPBACK_CLEAR=allow',
        fields: { remote, policyStatus: query.policyStatus },
      };
    }
    if (query.policyStatus === 'notEnabled') {
      // A rule matched and explicitly says clear — intended by the policy,
      // but cleartext is still not permitted here (defense in depth against
      // an over-broad clear rule). Distinct log from row 4 on purpose.
      return {
        allow: false,
        row: 3,
        reason: 'explicit AT-TLS clear rule matched but cleartext not permitted here',
        fields: { remote, policyStatus: query.policyStatus },
      };
    }
    return {
      allow: false,
      row: 4,
      reason: 'AT-TLS fail-open detected (PAGENT down / no rule / NOTTLS)',
      fields: { remote, policyStatus: query.policyStatus },
    };
  }

  function verdictFor(socket: net.Socket): Verdict {
    const cache = socket as unknown as Record<typeof VERDICT, Verdict | undefined>;
    const cached = cache[VERDICT];
    if (cached) return cached;
    const verdict = evaluate(socket);
    cache[VERDICT] = verdict;
    if (verdict.allow) {
      log('debug', `AT-TLS: ${verdict.reason}`, { row: verdict.row, ...verdict.fields });
    } else {
      const action = mode === 'required' ? 'rejecting connection' : 'would reject (monitor mode)';
      log(verdict.row === 6 ? 'error' : 'warn', `AT-TLS: ${verdict.reason} — ${action}`, {
        row: verdict.row,
        ...verdict.fields,
      });
    }
    return verdict;
  }

  const middleware: AtTlsMiddleware = (req, res, next) => {
    if (mode === 'off') {
      next();
      return;
    }
    const verdict = verdictFor(req.socket);
    if (verdict.allow || mode !== 'required') {
      next();
      return;
    }
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Connection', 'close');
    res.end(JSON.stringify({ error: 'connection_not_secured_by_attls' }));
  };

  function attachUpgradeGuard(server: HttpServer): void {
    if (mode === 'off') return;
    server.on('upgrade', (_req, duplex) => {
      // Node hands upgrades a stream.Duplex; for a TCP listener it is the
      // net.Socket (the fd extraction treats anything else as row 6).
      const socket = duplex as net.Socket;
      const verdict = verdictFor(socket);
      if (mode === 'required' && !verdict.allow) {
        socket.destroy();
        return;
      }
      // With no 'upgrade' listeners Node destroys upgrade sockets itself;
      // our listener suppresses that default, so restore it when nothing
      // else handles upgrades (neither service speaks WebSocket).
      if (server.listenerCount('upgrade') === 1) {
        socket.destroy();
      }
    });
  }

  async function startupSelfProbe(server: HttpServer, port: number): Promise<void> {
    if (mode === 'off') return;
    await new Promise<void>(resolve => {
      let done = false;
      const pending: net.Socket[] = [];
      let clientPort: number | undefined;

      // `client` and `timer` are initialized below, before anything can
      // call finish (all callers are event listeners or the timer itself).
      const finish = () => {
        if (done) return;
        done = true;
        server.removeListener('connection', onConnection);
        clearTimeout(timer);
        client.destroy();
        resolve();
      };

      const probe = (socket: net.Socket) => {
        try {
          const fd = socketFd(socket);
          if (fd === undefined) {
            log('warn', 'AT-TLS self-probe: accepted socket has no file descriptor');
            return;
          }
          const query = queryFn!(fd);
          if (query.policyStatus === 'noPolicy' || query.policyStatus === 'off') {
            log(
              mode === 'required' ? 'error' : 'warn',
              'AT-TLS self-probe: NO POLICY AT PORT — remote connections will be ' +
                (mode === 'required' ? 'rejected' : 'flagged') +
                ' until PAGENT installs the policy',
              { port, policyStatus: query.policyStatus }
            );
          } else {
            log('info', `AT-TLS self-probe: policy installed (status=${query.policyStatus})`, {
              port,
            });
          }
        } catch (err) {
          log('warn', 'AT-TLS self-probe: query failed', {
            port,
            code: errorCode(err),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      // Match our own connection among concurrently accepted ones by peer
      // port; querying is read-only, but only ours is guaranteed idle.
      const tryMatch = () => {
        if (clientPort === undefined) return;
        const match = pending.find(s => s.remotePort === clientPort);
        if (!match) return;
        probe(match);
        finish();
      };
      const onConnection = (socket: net.Socket) => {
        pending.push(socket);
        tryMatch();
      };

      server.on('connection', onConnection);
      const client = net.connect({ host: '127.0.0.1', port });
      client.on('connect', () => {
        clientPort = client.localPort;
        tryMatch();
      });
      client.on('error', err => {
        log('warn', 'AT-TLS self-probe: loopback connect failed', { port, error: err.message });
        finish();
      });
      const timer = setTimeout(() => {
        log('warn', 'AT-TLS self-probe: timed out waiting for the accepted socket', { port });
        finish();
      }, 2000);
      timer.unref();
    });
  }

  return { mode, middleware, attachUpgradeGuard, startupSelfProbe };
}
