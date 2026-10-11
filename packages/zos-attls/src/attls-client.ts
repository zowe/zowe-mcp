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
 * AT-TLS aware CLIENT guard: fail-closed enforcement for OUTBOUND
 * connections that rely on an AT-TLS `Direction Outbound` rule for TLS.
 * AT-TLS fails open — with no mapped rule the connection silently stays
 * cleartext — so the guard queries the stack (SIOCTTLSCTL, TTLS_QUERY_ONLY)
 * on the connected socket BEFORE the first byte is written and refuses to
 * proceed unless the stack proves TLS. Design, measured Host-A behavior
 * (handshake completes during connection setup), and the verdict matrix:
 * docs/zos-attls-client-mode.md § 3.
 *
 * Like the inbound gate, the query function is injected for off-platform
 * tests; the real addon is loaded via attls-load.ts.
 */

import * as http from 'node:http';
import * as net from 'node:net';
import { isLoopbackAddress, socketFd } from './attls-gate.js';
import type { AtTlsQueryResult } from './attls-load.js';
import {
  errorCode,
  resolveAtTlsRuntime,
  type AtTlsLogFn,
  type AtTlsMode,
  type AtTlsQueryFn,
} from './attls-runtime.js';

/** Verdict matrix row (docs/zos-attls-client-mode.md § 3), kept in logs. */
export interface AtTlsClientVerdict {
  allow: boolean;
  row: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  reason: string;
  /** Last query result, when one was obtained. */
  query?: AtTlsQueryResult;
  /** Row 3 only: the rule is mapped but the handshake has not run yet —
   * callers should confirm with confirmSecured() after the first read. */
  needsPostflight?: boolean;
}

/** Rejection raised by the guard in required mode; the socket is destroyed. */
export class AtTlsClientError extends Error {
  readonly code = 'ATTLS_CLIENT_REJECTED';
  readonly verdict: AtTlsClientVerdict;
  constructor(verdict: AtTlsClientVerdict) {
    super(`outbound connection not secured by AT-TLS: ${verdict.reason}`);
    this.name = 'AtTlsClientError';
    this.verdict = verdict;
  }
}

export interface AtTlsClientGuardOptions {
  mode: AtTlsMode;
  /** Injected for tests; when absent the native addon is loaded. */
  queryFn?: AtTlsQueryFn;
  /** ZOWE_MCP_ATTLS_MODULE — explicit addon path for out-of-tree builds. */
  modulePath?: string;
  /**
   * Permits cleartext to loopback peers only (verdict row 2) — the outbound
   * mirror of the server gate's ZOWE_MCP_ATTLS_LOOPBACK_CLEAR. Default
   * false: strict, every outbound connection must be AT-TLS secured.
   */
  allowLoopbackClear?: boolean;
  /**
   * How long to wait for connStatus=handshakeInProgress (or EWOULDBLOCK) to
   * resolve before rejecting, in ms. On Host-A the handshake finishes during
   * connection setup, so this is defensive headroom, not a normal wait.
   */
  handshakeWaitMs?: number;
  log: AtTlsLogFn;
  /** Injected for tests; defaults to process.platform. */
  platform?: string;
}

export interface AtTlsClientGuard {
  /** Effective mode — may be 'off' after a monitor-mode degradation. */
  readonly mode: AtTlsMode;
  /**
   * Gate an already-connected outbound socket BEFORE anything is written.
   * Resolving means "proceed" — in monitor mode that includes would-refuse
   * connections, whose verdict still reports allow=false (and is logged).
   * In required mode a rejected socket is destroyed and the promise rejects
   * with AtTlsClientError.
   */
  gateSocket(socket: net.Socket): Promise<AtTlsClientVerdict>;
  /** net.connect + gateSocket in one step; resolves with a writable socket. */
  connect(options: net.TcpNetConnectOpts): Promise<net.Socket>;
  /**
   * Post-flight confirmation (row 3, or belt-and-braces after a response):
   * re-queries and requires connStatus=secure. Throws AtTlsClientError in
   * required mode when the connection is not secure; logs otherwise.
   */
  confirmSecured(socket: net.Socket): AtTlsQueryResult | undefined;
  /**
   * An http.Agent that runs the gate on every new connection, so plain
   * `http.request(url, { agent })` gets the write-nothing-unless-secured
   * guarantee (Node hands the request bytes to the socket only after the
   * async createConnection callback delivers it).
   */
  createHttpAgent(options?: http.AgentOptions): http.Agent;
}

/** Per-socket verdict cache: AT-TLS status cannot change mid-connection. */
const VERDICT = Symbol('zosAtTlsClientVerdict');

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createAtTlsClientGuard(opts: AtTlsClientGuardOptions): AtTlsClientGuard {
  const log = opts.log;
  const allowLoopbackClear = opts.allowLoopbackClear ?? false;
  const handshakeWaitMs = opts.handshakeWaitMs ?? 2000;

  const { mode, queryFn } = resolveAtTlsRuntime({
    mode: opts.mode,
    queryFn: opts.queryFn,
    modulePath: opts.modulePath,
    platform: opts.platform,
    log,
    what: 'AT-TLS aware client mode',
  });

  /**
   * One query → verdict. `pending` (handshake still running) is returned to
   * the caller loop instead of a verdict.
   */
  function classify(socket: net.Socket): AtTlsClientVerdict | 'pending' {
    const remote = `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`;
    const fd = socketFd(socket);
    if (fd === undefined) {
      return { allow: false, row: 8, reason: `socket file descriptor unavailable (${remote})` };
    }
    let query: AtTlsQueryResult;
    try {
      // queryFn is always set here: mode !== 'off' guarantees the addon
      // loaded (or the guard degraded/threw at construction).
      query = queryFn!(fd);
    } catch (err) {
      const code = errorCode(err);
      // Unlike the inbound gate, EWOULDBLOCK is expected here: the query can
      // race the connect-time handshake. Poll until handshakeWaitMs is spent.
      if (code === 'EWOULDBLOCK' || code === 'EAGAIN') return 'pending';
      return {
        allow: false,
        row: 8,
        reason: `AT-TLS query failed (${code ?? 'unknown'}) for ${remote}`,
      };
    }
    if (query.connStatus === 'secure') {
      return {
        allow: true,
        row: 1,
        reason: `outbound connection secured by AT-TLS (${remote})`,
        query,
      };
    }
    if (query.connStatus === 'handshakeInProgress') return 'pending';
    // connStatus === 'notSecure'
    if (query.policyStatus === 'enabled') {
      // Rule mapped but handshake not yet run (never observed on Host-A, where
      // the handshake completes during connect — docs § 2.1). Data written
      // now goes through System SSL, never in clear, so proceeding is safe;
      // confirmSecured() closes the loop after the first read.
      return {
        allow: true,
        row: 3,
        reason: `AT-TLS rule mapped, handshake pending (${remote})`,
        query,
        needsPostflight: true,
      };
    }
    if (allowLoopbackClear && isLoopbackAddress(socket.remoteAddress)) {
      return {
        allow: true,
        row: 2,
        reason: `cleartext loopback allowed by explicit opt-in (${remote})`,
        query,
      };
    }
    if (query.policyStatus === 'applControlled') {
      // ApplicationControlled On: TLS starts only on TTLS_INIT_CONNECTION,
      // which this guard never issues — writes would leave in cleartext.
      return {
        allow: false,
        row: 6,
        reason: `AT-TLS policy is application-controlled; handshake would never start (${remote})`,
        query,
      };
    }
    if (query.policyStatus === 'notEnabled') {
      return {
        allow: false,
        row: 4,
        reason: `explicit AT-TLS clear rule matched but cleartext not permitted here (${remote})`,
        query,
      };
    }
    return {
      allow: false,
      row: 5,
      reason: `AT-TLS fail-open detected (PAGENT down / no rule / NOTTLS) for ${remote}`,
      query,
    };
  }

  async function evaluate(socket: net.Socket): Promise<AtTlsClientVerdict> {
    const deadline = Date.now() + handshakeWaitMs;
    for (;;) {
      const verdict = classify(socket);
      if (verdict !== 'pending') return verdict;
      if (Date.now() >= deadline) {
        return {
          allow: false,
          row: 7,
          reason: `AT-TLS handshake did not complete within ${handshakeWaitMs}ms`,
        };
      }
      await sleep(50);
    }
  }

  function logVerdict(verdict: AtTlsClientVerdict): void {
    const fields: Record<string, unknown> = { row: verdict.row };
    if (verdict.query) {
      fields.policyStatus = verdict.query.policyStatus;
      fields.protocol = verdict.query.protocol;
      fields.cipher = verdict.query.cipher;
    }
    if (verdict.allow) {
      log(verdict.row === 1 ? 'debug' : 'warn', `AT-TLS client: ${verdict.reason}`, fields);
    } else {
      const action = mode === 'required' ? 'refusing to send' : 'would refuse (monitor mode)';
      log(
        verdict.row === 8 ? 'error' : 'warn',
        `AT-TLS client: ${verdict.reason} — ${action}`,
        fields
      );
    }
  }

  async function gateSocket(socket: net.Socket): Promise<AtTlsClientVerdict> {
    if (mode === 'off') return { allow: true, row: 1, reason: 'AT-TLS client mode is off' };
    const cache = socket as unknown as Record<typeof VERDICT, AtTlsClientVerdict | undefined>;
    let verdict = cache[VERDICT];
    if (!verdict) {
      verdict = await evaluate(socket);
      cache[VERDICT] = verdict;
      logVerdict(verdict);
    }
    if (!verdict.allow && mode === 'required') {
      socket.destroy();
      throw new AtTlsClientError(verdict);
    }
    return verdict;
  }

  function connect(options: net.TcpNetConnectOpts): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(options);
      let settled = false;
      const settle = (err?: Error, result?: net.Socket): void => {
        if (settled) return;
        settled = true;
        socket.removeListener('error', onError);
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          resolve(result!);
        }
      };
      // Stays attached through the whole async gating window — a socket
      // 'error' with zero listeners (e.g. an RST while gateSocket polls the
      // handshake) would otherwise crash the process.
      const onError = (err: Error) => settle(err);
      socket.on('error', onError);
      socket.once('connect', () => {
        gateSocket(socket).then(
          () => settle(undefined, socket),
          err => settle(err instanceof Error ? err : new Error(String(err)))
        );
      });
    });
  }

  function confirmSecured(socket: net.Socket): AtTlsQueryResult | undefined {
    if (mode === 'off') return undefined;
    const fd = socketFd(socket);
    let query: AtTlsQueryResult | undefined;
    let reason: string | undefined;
    if (fd === undefined) {
      reason = 'socket file descriptor unavailable';
    } else {
      try {
        query = queryFn!(fd);
      } catch (err) {
        reason = `AT-TLS query failed (${errorCode(err) ?? 'unknown'})`;
      }
    }
    if (query?.connStatus === 'secure') return query;
    reason ??= `connection is ${query?.connStatus ?? 'unknown'} (policy ${query?.policyStatus ?? 'unknown'})`;
    const verdict: AtTlsClientVerdict = {
      allow: false,
      row: 5,
      reason: `post-flight check failed: ${reason}`,
      query,
    };
    logVerdict(verdict);
    if (mode === 'required') {
      socket.destroy();
      throw new AtTlsClientError(verdict);
    }
    return query;
  }

  function createHttpAgent(options?: http.AgentOptions): http.Agent {
    const agent = new http.Agent(options);
    // Node calls createConnection(options, callback) and, given the callback
    // form, hands the request bytes to the socket only after the callback
    // delivers it — which preserves write-nothing-unless-secured. The method
    // is documented public API but absent from @types/node, hence the cast.
    (agent as unknown as Record<string, unknown>).createConnection = (
      connectOptions: net.TcpNetConnectOpts,
      callback: (err: Error | null, socket?: net.Socket) => void
    ): void => {
      connect(connectOptions).then(
        socket => callback(null, socket),
        err => callback(err instanceof Error ? err : new Error(String(err)))
      );
    };
    return agent;
  }

  return { mode, gateSocket, connect, confirmSecured, createHttpAgent };
}
