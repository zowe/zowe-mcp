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
 * Tests for the AT-TLS aware outbound HTTP wrapper (ZOWE_MCP_ATTLS_CLIENT):
 * routing rules (https:// and guard-off stay on global fetch; http:// goes
 * through the gated agent when the guard is active), fail-closed behavior
 * with zero bytes written, and the bearer-jwt wiring
 * (resolveJwksUriFromIssuer through the guard).
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtTlsClientError, type AtTlsQueryResult } from 'zos-attls';
import {
  __resetAtTlsClientHttpForTests,
  atTlsAwareJsonGet,
  atTlsClientMode,
  initAtTlsClientHttp,
  loadAtTlsClientEnvOptions,
} from '../src/auth/attls-client-http.js';
import { resolveJwksUriFromIssuer } from '../src/auth/bearer-jwt.js';

const secure: AtTlsQueryResult = {
  policyStatus: 'enabled',
  connStatus: 'secure',
  protocol: 'TLSv1.2',
  cipher: '009D',
  securityType: 'client',
};
const noPolicy: AtTlsQueryResult = { policyStatus: 'noPolicy', connStatus: 'notSecure' };

const noopLog = () => undefined;

describe('loadAtTlsClientEnvOptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to off with strict loopback', () => {
    vi.stubEnv('ZOWE_MCP_ATTLS_CLIENT', '');
    vi.stubEnv('ZOWE_MCP_ATTLS_MODULE', '');
    vi.stubEnv('ZOWE_MCP_ATTLS_LOOPBACK_CLEAR', '');
    const opts = loadAtTlsClientEnvOptions();
    expect(opts.mode).toBe('off');
    expect(opts.modulePath).toBeUndefined();
    expect(opts.allowLoopbackClear).toBe(false);
  });

  it('reads mode, module path, and the shared loopback opt-in', () => {
    vi.stubEnv('ZOWE_MCP_ATTLS_CLIENT', 'required');
    vi.stubEnv('ZOWE_MCP_ATTLS_MODULE', '/u/somewhere/zos-attls');
    vi.stubEnv('ZOWE_MCP_ATTLS_LOOPBACK_CLEAR', 'allow');
    const opts = loadAtTlsClientEnvOptions();
    expect(opts.mode).toBe('required');
    expect(opts.modulePath).toBe('/u/somewhere/zos-attls');
    expect(opts.allowLoopbackClear).toBe(true);
  });

  it('rejects an invalid mode', () => {
    vi.stubEnv('ZOWE_MCP_ATTLS_CLIENT', 'yes');
    expect(() => loadAtTlsClientEnvOptions()).toThrow(/invalid AT-TLS mode/);
  });
});

describe('initAtTlsClientHttp startup contract', () => {
  afterEach(() => {
    __resetAtTlsClientHttpForTests();
  });

  it('mode off leaves routing inactive', () => {
    expect(initAtTlsClientHttp({ mode: 'off', log: noopLog })).toBe('off');
    expect(atTlsClientMode()).toBe('off');
  });

  it('required fails fast off z/OS (no injected query)', () => {
    expect(() =>
      initAtTlsClientHttp({ mode: 'required', log: noopLog, platform: 'linux' })
    ).toThrow(/client mode needs z\/OS/);
  });

  it('monitor degrades to off off z/OS and keeps plain fetch', () => {
    const effective = initAtTlsClientHttp({ mode: 'monitor', log: noopLog, platform: 'linux' });
    expect(effective).toBe('off');
    expect(atTlsClientMode()).toBe('off');
  });
});

describe('atTlsAwareJsonGet routing', () => {
  let server: http.Server | undefined;

  afterEach(() => {
    __resetAtTlsClientHttpForTests();
    server?.close();
    server = undefined;
    vi.unstubAllGlobals();
  });

  async function listenJson(body: unknown): Promise<{ port: number; bytesSeen: () => number }> {
    let bytes = 0;
    server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });
    server.on('connection', s => s.on('data', (c: Buffer) => (bytes += c.length)));
    const s = server;
    await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
    return { port: (s.address() as AddressInfo).port, bytesSeen: () => bytes };
  }

  it('uses global fetch when the guard is not initialized', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await atTlsAwareJsonGet('http://idp.example/jwks');
    expect(fetchMock).toHaveBeenCalledWith('http://idp.example/jwks', {});
  });

  it('routes http:// through the gated agent when active (secure verdict)', async () => {
    const { port } = await listenJson({ hello: 'attls' });
    const queryFn = vi.fn(() => secure);
    initAtTlsClientHttp({ mode: 'required', queryFn, log: noopLog });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await atTlsAwareJsonGet(`http://127.0.0.1:${port}/doc`, {
      Accept: 'application/json',
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: 'attls' });
    expect(queryFn).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves https:// on global fetch even when the guard is active', async () => {
    const queryFn = vi.fn(() => secure);
    initAtTlsClientHttp({ mode: 'required', queryFn, log: noopLog });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await atTlsAwareJsonGet('https://idp.example/jwks');
    expect(fetchMock).toHaveBeenCalled();
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('fails closed on noPolicy: rejects with AtTlsClientError, zero bytes written', async () => {
    const { port, bytesSeen } = await listenJson({ never: 'seen' });
    initAtTlsClientHttp({ mode: 'required', queryFn: () => noPolicy, log: noopLog });

    await expect(atTlsAwareJsonGet(`http://127.0.0.1:${port}/doc`)).rejects.toThrow(
      AtTlsClientError
    );
    await new Promise(r => setTimeout(r, 50));
    expect(bytesSeen()).toBe(0);
  });

  it('monitor mode logs a would-refuse but the request goes through', async () => {
    const { port } = await listenJson({ monitored: true });
    const entries: string[] = [];
    initAtTlsClientHttp({
      mode: 'monitor',
      queryFn: () => noPolicy,
      log: (_level, msg) => entries.push(msg),
    });

    const res = await atTlsAwareJsonGet(`http://127.0.0.1:${port}/doc`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ monitored: true });
    expect(entries.some(m => m.includes('would refuse'))).toBe(true);
  });

  it('wires bearer-jwt: resolveJwksUriFromIssuer goes through the guard', async () => {
    const { port } = await listenJson({ jwks_uri: 'http://idp.example/jwks.json' });
    const queryFn = vi.fn(() => secure);
    initAtTlsClientHttp({ mode: 'required', queryFn, log: noopLog });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const jwksUri = await resolveJwksUriFromIssuer(`http://127.0.0.1:${port}`);
    expect(jwksUri).toBe('http://idp.example/jwks.json');
    expect(queryFn).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
