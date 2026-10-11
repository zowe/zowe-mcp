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
 * Off-platform tests for the AT-TLS client guard: the outbound verdict matrix
 * of docs/zos-attls-client-mode.md § 3, driven with an injected fake query
 * function (the real SIOCTTLSCTL behavior is exercised on z/OS by
 * native/test.mjs and deploy/attls-client-probe.mjs).
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AtTlsClientError,
  createAtTlsClientGuard,
  type AtTlsClientGuardOptions,
  type AtTlsMode,
  type AtTlsQueryResult,
} from '../src/index.js';
import { makeLog, queryResults } from './fixtures.js';

function fakeSocket(remoteAddress = '10.0.0.7', fd: number | null = 5): net.Socket {
  return {
    remoteAddress,
    remotePort: 8046,
    _handle: fd === null ? undefined : { fd },
    destroy: vi.fn(),
  } as unknown as net.Socket;
}

/** The destroy mock as a function property, keeping unbound-method quiet. */
function destroySpy(socket: net.Socket) {
  return (socket as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy;
}

const {
  secure,
  mappedNotStarted,
  clearRuleMatched,
  noPolicy,
  stackOff,
  applControlled,
  handshake,
} = queryResults;

function makeGuard(overrides: Partial<AtTlsClientGuardOptions> & { mode: AtTlsMode }) {
  const { entries, log } = makeLog();
  const guard = createAtTlsClientGuard({
    queryFn: () => secure,
    allowLoopbackClear: false,
    handshakeWaitMs: 200,
    log,
    ...overrides,
  });
  return { guard, entries };
}

describe('outbound verdict matrix', () => {
  interface Row {
    name: string;
    query: () => AtTlsQueryResult;
    remote?: string;
    fd?: number | null;
    allowLoopbackClear?: boolean;
    rejectInRequired: boolean;
  }
  const rows: Row[] = [
    { name: 'row 1: secure at connect', query: () => secure, rejectInRequired: false },
    {
      name: 'row 2: cleartext loopback with explicit opt-in',
      query: () => noPolicy,
      remote: '127.0.0.1',
      allowLoopbackClear: true,
      rejectInRequired: false,
    },
    {
      name: 'row 3: rule mapped, handshake pending',
      query: () => mappedNotStarted,
      rejectInRequired: false,
    },
    {
      name: 'row 4: explicit clear rule matched (notEnabled)',
      query: () => clearRuleMatched,
      rejectInRequired: true,
    },
    { name: 'row 5: fail-open (noPolicy)', query: () => noPolicy, rejectInRequired: true },
    { name: 'row 5: stack TTLS off', query: () => stackOff, rejectInRequired: true },
    {
      name: 'row 6: application-controlled policy',
      query: () => applControlled,
      rejectInRequired: true,
    },
    {
      name: 'row 8: ioctl error',
      query: () => {
        throw Object.assign(new Error('not connected'), { code: 'ENOTCONN' });
      },
      rejectInRequired: true,
    },
    {
      name: 'row 8: socket fd unavailable',
      query: () => secure,
      fd: null,
      rejectInRequired: true,
    },
  ];

  for (const row of rows) {
    for (const mode of ['required', 'monitor', 'off'] as const) {
      if (row.rejectInRequired && mode === 'required') {
        it(`${row.name} — ${mode} mode rejects and destroys the socket`, async () => {
          const { guard } = makeGuard({
            mode,
            queryFn: row.query,
            allowLoopbackClear: row.allowLoopbackClear ?? false,
          });
          const socket = fakeSocket(row.remote ?? '10.0.0.7', row.fd !== undefined ? row.fd : 5);
          await expect(guard.gateSocket(socket)).rejects.toThrow(AtTlsClientError);
          expect(destroySpy(socket)).toHaveBeenCalled();
        });
      } else {
        it(`${row.name} — ${mode} mode proceeds`, async () => {
          const { guard } = makeGuard({
            mode,
            queryFn: row.query,
            allowLoopbackClear: row.allowLoopbackClear ?? false,
          });
          const socket = fakeSocket(row.remote ?? '10.0.0.7', row.fd !== undefined ? row.fd : 5);
          // Resolving (not throwing) is the proceed signal; in monitor mode
          // the verdict still reports allow=false for would-refuse rows.
          const verdict = await guard.gateSocket(socket);
          const expectAllowed = mode === 'off' || !row.rejectInRequired;
          expect(verdict.allow).toBe(expectAllowed);
          expect(destroySpy(socket)).not.toHaveBeenCalled();
        });
      }
    }
  }

  it('row 3 verdict flags the post-flight requirement', async () => {
    const { guard } = makeGuard({ mode: 'required', queryFn: () => mappedNotStarted });
    const verdict = await guard.gateSocket(fakeSocket());
    expect(verdict.row).toBe(3);
    expect(verdict.needsPostflight).toBe(true);
  });

  it('the rejection error carries the verdict', async () => {
    const { guard } = makeGuard({ mode: 'required', queryFn: () => noPolicy });
    const err = await guard.gateSocket(fakeSocket()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AtTlsClientError);
    const verdict = (err as AtTlsClientError).verdict;
    expect(verdict.row).toBe(5);
    expect(verdict.query?.policyStatus).toBe('noPolicy');
    expect((err as AtTlsClientError).code).toBe('ATTLS_CLIENT_REJECTED');
  });

  it('monitor mode logs a would-refuse warning but allows', async () => {
    const { guard, entries } = makeGuard({ mode: 'monitor', queryFn: () => noPolicy });
    const verdict = await guard.gateSocket(fakeSocket());
    expect(verdict.allow).toBe(false);
    const warn = entries.find(e => e.level === 'warn');
    expect(warn?.msg).toMatch(/fail-open/);
    expect(warn?.msg).toMatch(/would refuse/);
  });

  it('the loopback opt-in never exempts a remote peer', async () => {
    const { guard } = makeGuard({
      mode: 'required',
      queryFn: () => noPolicy,
      allowLoopbackClear: true,
    });
    await expect(guard.gateSocket(fakeSocket('192.0.2.10'))).rejects.toThrow(AtTlsClientError);
  });
});

describe('handshake-in-progress polling', () => {
  it('re-queries until secure (EWOULDBLOCK and HS_INPROGRESS both poll)', async () => {
    const answers: (() => AtTlsQueryResult)[] = [
      () => {
        throw Object.assign(new Error('would block'), { code: 'EWOULDBLOCK' });
      },
      () => handshake,
      () => secure,
    ];
    const queryFn = vi.fn(() => answers.shift()!());
    const { guard } = makeGuard({ mode: 'required', queryFn, handshakeWaitMs: 1000 });
    const verdict = await guard.gateSocket(fakeSocket());
    expect(verdict.row).toBe(1);
    expect(queryFn).toHaveBeenCalledTimes(3);
  });

  it('rejects (row 7) when the handshake never completes within the wait', async () => {
    const { guard } = makeGuard({
      mode: 'required',
      queryFn: () => handshake,
      handshakeWaitMs: 120,
    });
    const err = await guard.gateSocket(fakeSocket()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AtTlsClientError);
    expect((err as AtTlsClientError).verdict.row).toBe(7);
  });
});

describe('per-socket verdict caching', () => {
  it('queries once per socket', async () => {
    const queryFn = vi.fn(() => secure);
    const { guard } = makeGuard({ mode: 'required', queryFn });
    const socket = fakeSocket();
    await guard.gateSocket(socket);
    await guard.gateSocket(socket);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe('confirmSecured (post-flight)', () => {
  it('returns the query when secure', () => {
    const { guard } = makeGuard({ mode: 'required' });
    expect(guard.confirmSecured(fakeSocket())?.connStatus).toBe('secure');
  });

  it('throws and destroys in required mode when not secure', () => {
    const { guard } = makeGuard({ mode: 'required', queryFn: () => mappedNotStarted });
    const socket = fakeSocket();
    expect(() => guard.confirmSecured(socket)).toThrow(AtTlsClientError);
    expect(destroySpy(socket)).toHaveBeenCalled();
  });

  it('logs but does not throw in monitor mode', () => {
    const { guard, entries } = makeGuard({ mode: 'monitor', queryFn: () => noPolicy });
    expect(() => guard.confirmSecured(fakeSocket())).not.toThrow();
    expect(entries.some(e => e.msg.includes('post-flight'))).toBe(true);
  });

  it('is a no-op in off mode', () => {
    const queryFn = vi.fn(() => noPolicy);
    const { guard } = makeGuard({ mode: 'off', queryFn });
    expect(guard.confirmSecured(fakeSocket())).toBeUndefined();
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('startup fail-fast', () => {
  it('required mode refuses to start off z/OS when no queryFn is injected', () => {
    const { log } = makeLog();
    expect(() => createAtTlsClientGuard({ mode: 'required', log, platform: 'linux' })).toThrow(
      /client mode needs z\/OS/
    );
  });

  it('monitor mode degrades to off with a warning off z/OS', async () => {
    const { entries, log } = makeLog();
    const guard = createAtTlsClientGuard({ mode: 'monitor', log, platform: 'linux' });
    expect(guard.mode).toBe('off');
    expect(entries.some(e => e.level === 'warn' && e.msg.includes('degrading'))).toBe(true);
    const verdict = await guard.gateSocket(fakeSocket('10.0.0.7', null));
    expect(verdict.allow).toBe(true);
  });

  it('off mode never touches the addon or the socket', async () => {
    const queryFn = vi.fn(() => secure);
    const { guard } = makeGuard({ mode: 'off', queryFn });
    const verdict = await guard.gateSocket(fakeSocket('10.0.0.7', null));
    expect(verdict.allow).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('connect() and createHttpAgent() against a real loopback server', () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function listen(): Promise<number> {
    server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello');
    });
    const s = server;
    await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
    return (s.address() as AddressInfo).port;
  }

  it('connect() resolves with a gated socket when the query says secure', async () => {
    const port = await listen();
    const queryFn = vi.fn(() => secure);
    const { guard } = makeGuard({ mode: 'required', queryFn });
    const socket = await guard.connect({ host: '127.0.0.1', port });
    expect(queryFn).toHaveBeenCalledTimes(1);
    socket.destroy();
  });

  it('connect() rejects fail-closed before anything is written on noPolicy', async () => {
    const port = await listen();
    let bytesSeen = 0;
    server!.on('connection', s => s.on('data', c => (bytesSeen += c.length)));
    const { guard } = makeGuard({ mode: 'required', queryFn: () => noPolicy });
    await expect(guard.connect({ host: '127.0.0.1', port })).rejects.toThrow(AtTlsClientError);
    await new Promise(r => setTimeout(r, 50));
    expect(bytesSeen).toBe(0);
  });

  it('connect() propagates plain connection errors (nothing listening)', async () => {
    const { guard } = makeGuard({ mode: 'required' });
    await expect(guard.connect({ host: '127.0.0.1', port: 1 })).rejects.toThrow();
  });

  it('http.request through createHttpAgent() completes when secured', async () => {
    const port = await listen();
    const { guard } = makeGuard({ mode: 'required' });
    const agent = guard.createHttpAgent();
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', agent }, res => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', c => (buf += c));
        res.on('end', () => resolve(buf));
      });
      req.on('error', reject);
      req.end();
    });
    expect(body).toBe('hello');
    agent.destroy();
  });

  it('http.request through createHttpAgent() fails closed on noPolicy, writing nothing', async () => {
    const port = await listen();
    let bytesSeen = 0;
    server!.on('connection', s => s.on('data', c => (bytesSeen += c.length)));
    const { guard } = makeGuard({ mode: 'required', queryFn: () => noPolicy });
    const agent = guard.createHttpAgent();
    const err = await new Promise<unknown>(resolve => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', agent }, () =>
        resolve(new Error('unexpected response'))
      );
      req.on('error', resolve);
      req.end();
    });
    expect(err).toBeInstanceOf(AtTlsClientError);
    await new Promise(r => setTimeout(r, 50));
    expect(bytesSeen).toBe(0);
    agent.destroy();
  });
});
