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
 * Off-platform tests for the AT-TLS gate: the verdict matrix of
 * docs/zos-attls-aware-mode.md § 4.2, driven with an injected fake query
 * function (the real SIOCTTLSCTL addon is exercised by native/test.mjs on
 * z/OS).
 */

import type { Server as HttpServer } from 'node:http';
import type * as net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  createAtTlsGate,
  isLoopbackAddress,
  parseAtTlsMode,
  parseLoopbackClear,
  type AtTlsGateOptions,
  type AtTlsMode,
  type AtTlsQueryResult,
} from '../src/index.js';

import { makeLog, queryResults } from './fixtures.js';

function fakeSocket(remoteAddress = '10.0.0.7', fd: number | null = 5): net.Socket {
  return { remoteAddress, _handle: fd === null ? undefined : { fd } } as unknown as net.Socket;
}

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as string | undefined,
    ended: false,
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      this.body = chunk;
      this.ended = true;
    },
  };
  return res;
}

const { secure, clearRuleMatched, noPolicy, stackOff, handshake } = queryResults;

function makeGate(overrides: Partial<AtTlsGateOptions> & { mode: AtTlsMode }) {
  const { entries, log } = makeLog();
  const gate = createAtTlsGate({
    queryFn: () => secure,
    allowLoopbackClear: false,
    log,
    ...overrides,
  });
  return { gate, entries };
}

function runMiddleware(gate: ReturnType<typeof makeGate>['gate'], socket: net.Socket) {
  const res = fakeRes();
  const next = vi.fn();
  gate.middleware({ socket }, res, next);
  return { res, next };
}

describe('verdict matrix', () => {
  interface Row {
    name: string;
    query: () => AtTlsQueryResult;
    remote?: string;
    fd?: number | null;
    allowLoopbackClear?: boolean;
    rejectInRequired: boolean;
  }
  const rows: Row[] = [
    { name: 'row 1: secure connection', query: () => secure, rejectInRequired: false },
    {
      name: 'row 2: cleartext loopback with explicit opt-in',
      query: () => noPolicy,
      remote: '127.0.0.1',
      allowLoopbackClear: true,
      rejectInRequired: false,
    },
    {
      name: 'row 3: explicit clear rule matched (notEnabled)',
      query: () => clearRuleMatched,
      rejectInRequired: true,
    },
    { name: 'row 4: fail-open (noPolicy)', query: () => noPolicy, rejectInRequired: true },
    { name: 'row 4: stack TTLS off', query: () => stackOff, rejectInRequired: true },
    { name: 'row 5: handshake in progress', query: () => handshake, rejectInRequired: true },
    {
      name: 'row 5: EWOULDBLOCK from the query',
      query: () => {
        throw Object.assign(new Error('EWOULDBLOCK'), { code: 'EWOULDBLOCK' });
      },
      rejectInRequired: true,
    },
    {
      name: 'row 6: ioctl error',
      query: () => {
        throw Object.assign(new Error('not connected'), { code: 'ENOTCONN' });
      },
      rejectInRequired: true,
    },
    {
      name: 'row 6: socket fd unavailable',
      query: () => secure,
      fd: null,
      rejectInRequired: true,
    },
  ];

  function runRow(row: Row, mode: AtTlsMode) {
    const { gate } = makeGate({
      mode,
      queryFn: row.query,
      allowLoopbackClear: row.allowLoopbackClear ?? false,
    });
    const socket = fakeSocket(row.remote ?? '10.0.0.7', row.fd !== undefined ? row.fd : 5);
    return runMiddleware(gate, socket);
  }

  for (const row of rows) {
    for (const mode of ['required', 'monitor', 'off'] as const) {
      if (row.rejectInRequired && mode === 'required') {
        it(`${row.name} — ${mode} mode rejects`, () => {
          const { res, next } = runRow(row, mode);
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(403);
          expect(res.headers.connection).toBe('close');
          expect(res.body && (JSON.parse(res.body) as Record<string, unknown>)).toEqual({
            error: 'connection_not_secured_by_attls',
          });
        });
      } else {
        it(`${row.name} — ${mode} mode allows`, () => {
          const { res, next } = runRow(row, mode);
          expect(next).toHaveBeenCalledOnce();
          expect(res.ended).toBe(false);
        });
      }
    }
  }

  it('monitor mode logs a would-reject warning for a not-secure connection', () => {
    const { gate, entries } = makeGate({ mode: 'monitor', queryFn: () => noPolicy });
    runMiddleware(gate, fakeSocket());
    const warn = entries.find(e => e.level === 'warn');
    expect(warn?.msg).toMatch(/fail-open/);
    expect(warn?.msg).toMatch(/would reject/);
  });

  it('rejection logs distinguish notEnabled (row 3) from noPolicy (row 4)', () => {
    const notEnabledLog = makeGate({ mode: 'required', queryFn: () => clearRuleMatched });
    runMiddleware(notEnabledLog.gate, fakeSocket());
    expect(notEnabledLog.entries.some(e => e.msg.includes('explicit AT-TLS clear rule'))).toBe(
      true
    );

    const noPolicyLog = makeGate({ mode: 'required', queryFn: () => noPolicy });
    runMiddleware(noPolicyLog.gate, fakeSocket());
    expect(noPolicyLog.entries.some(e => e.msg.includes('fail-open detected'))).toBe(true);
  });

  it('loopback cleartext is rejected at the strict default (no opt-in)', () => {
    const { gate } = makeGate({ mode: 'required', queryFn: () => clearRuleMatched });
    const { res, next } = runMiddleware(gate, fakeSocket('127.0.0.1'));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('the loopback opt-in never exempts a remote peer', () => {
    const { gate } = makeGate({
      mode: 'required',
      queryFn: () => noPolicy,
      allowLoopbackClear: true,
    });
    const { res, next } = runMiddleware(gate, fakeSocket('192.0.2.10'));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('per-socket verdict caching', () => {
  it('queries once per socket across keep-alive requests', () => {
    const queryFn = vi.fn(() => secure);
    const { gate } = makeGate({ mode: 'required', queryFn });
    const socket = fakeSocket();
    runMiddleware(gate, socket);
    runMiddleware(gate, socket);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('evaluates each socket independently', () => {
    const queryFn = vi.fn(() => secure);
    const { gate } = makeGate({ mode: 'required', queryFn });
    runMiddleware(gate, fakeSocket());
    runMiddleware(gate, fakeSocket());
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});

describe('startup fail-fast (§ 4.4)', () => {
  it('required mode refuses to start off z/OS when no queryFn is injected', () => {
    const { log } = makeLog();
    expect(() => createAtTlsGate({ mode: 'required', log, platform: 'linux' })).toThrow(
      /needs z\/OS/
    );
  });

  it('monitor mode degrades to off with a warning off z/OS', () => {
    const { entries, log } = makeLog();
    const gate = createAtTlsGate({ mode: 'monitor', log, platform: 'linux' });
    expect(gate.mode).toBe('off');
    expect(entries.some(e => e.level === 'warn' && e.msg.includes('degrading'))).toBe(true);
    const { next } = runMiddleware(gate, fakeSocket());
    expect(next).toHaveBeenCalledOnce();
  });

  it('off mode never touches the addon or the socket', () => {
    const queryFn = vi.fn(() => secure);
    const { gate } = makeGate({ mode: 'off', queryFn });
    const { next } = runMiddleware(gate, fakeSocket('10.0.0.7', null));
    expect(next).toHaveBeenCalledOnce();
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('upgrade guard', () => {
  function fakeServer() {
    const listeners: ((...args: unknown[]) => void)[] = [];
    return {
      listeners,
      on(_event: string, listener: (...args: never[]) => void) {
        listeners.push(listener as (...args: unknown[]) => void);
        return this;
      },
      removeListener() {
        return this;
      },
      listenerCount() {
        return listeners.length;
      },
      emitUpgrade(socket: net.Socket) {
        for (const l of [...listeners]) l({}, socket, Buffer.alloc(0));
      },
    };
  }

  function upgradeWith(queryFn: () => AtTlsQueryResult) {
    const { gate } = makeGate({ mode: 'required', queryFn });
    const server = fakeServer();
    gate.attachUpgradeGuard(server as unknown as HttpServer);
    const socket = fakeSocket();
    const destroy = vi.fn();
    (socket as unknown as { destroy: () => void }).destroy = destroy;
    server.emitUpgrade(socket);
    return destroy;
  }

  it('destroys a not-secure upgrade socket in required mode', () => {
    expect(upgradeWith(() => noPolicy)).toHaveBeenCalled();
  });

  it('destroys even a secure upgrade socket when nothing else handles upgrades (Node default)', () => {
    expect(upgradeWith(() => secure)).toHaveBeenCalled();
  });
});

describe('config parsing', () => {
  it('parses modes and defaults to off', () => {
    expect(parseAtTlsMode(undefined)).toBe('off');
    expect(parseAtTlsMode('')).toBe('off');
    expect(parseAtTlsMode('monitor')).toBe('monitor');
    expect(parseAtTlsMode('required')).toBe('required');
    expect(() => parseAtTlsMode('yes')).toThrow(/invalid AT-TLS mode/);
  });

  it('parses the loopback-clear opt-in and defaults to strict', () => {
    expect(parseLoopbackClear(undefined)).toBe(false);
    expect(parseLoopbackClear('reject')).toBe(false);
    expect(parseLoopbackClear('allow')).toBe(true);
    expect(() => parseLoopbackClear('true')).toThrow(/LOOPBACK_CLEAR/);
  });
});

describe('isLoopbackAddress', () => {
  it('classifies loopback forms', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.4.5.6')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::ffff:10.0.0.1')).toBe(false);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
