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
 * AT-TLS aware mode integration (docs/zos-attls-aware-mode.md): configuration
 * coupling (--attls requires --tls-terminated) and gate placement — the gate
 * middleware must run before every route, so a connection the injected fake
 * query reports as not secure is rejected with 403 on any path. Gate verdict
 * logic itself is covered in packages/zos-attls.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAtTlsGate, type AtTlsQueryResult } from 'zos-attls';
import { runAtTlsDoctorChecks } from '../src/saf-doctor.js';
import type { SafVerifier } from '../src/saf-verify.js';
import { createIdpApp, startIdpHttp, type IdpServerHandle } from '../src/server.js';

const ISSUER = 'https://idp.example';

const stubVerifier: SafVerifier = () => Promise.resolve({ outcome: 'invalid_credentials' });

const secure: AtTlsQueryResult = {
  policyStatus: 'enabled',
  connStatus: 'secure',
  protocol: 'TLSv1.2',
  cipher: '003D',
};
const notSecure: AtTlsQueryResult = { policyStatus: 'noPolicy', connStatus: 'notSecure' };

function fakeGate(mode: 'monitor' | 'required', result: AtTlsQueryResult) {
  return createAtTlsGate({
    mode,
    queryFn: () => result,
    allowLoopbackClear: false,
    log: () => undefined,
  });
}

describe('--attls configuration coupling', () => {
  it('rejects --attls without --tls-terminated', () => {
    expect(() =>
      createIdpApp('http://127.0.0.1:1', { attls: 'required', safVerifier: stubVerifier })
    ).toThrow(/requires --tls-terminated/);
    expect(() =>
      createIdpApp('http://127.0.0.1:1', { attls: 'monitor', safVerifier: stubVerifier })
    ).toThrow(/requires --tls-terminated/);
  });

  it('accepts --attls off without --tls-terminated', () => {
    expect(() =>
      createIdpApp('http://127.0.0.1:1', { attls: 'off', safVerifier: stubVerifier })
    ).not.toThrow();
  });
});

describe('gate placement in the IdP app', () => {
  let handle: IdpServerHandle | undefined;
  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  async function startWith(gate: ReturnType<typeof fakeGate>) {
    handle = await startIdpHttp({
      port: 0,
      issuer: ISSUER,
      tlsTerminated: true,
      attls: gate.mode,
      attlsGate: gate,
      safVerifier: stubVerifier,
    });
    return handle;
  }

  it('required mode rejects a connection the stack reports as not secure — on every path', async () => {
    const { port } = await startWith(fakeGate('required', notSecure));
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/openid-configuration`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'connection_not_secured_by_attls' });
    expect(res.headers.get('connection')).toBe('close');
  });

  it('required mode passes a secure connection through to the routes', async () => {
    const { port } = await startWith(fakeGate('required', secure));
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { issuer?: string };
    expect(doc.issuer).toBe(ISSUER);
  });

  it('monitor mode lets a not-secure connection through (log-only)', async () => {
    const { port } = await startWith(fakeGate('monitor', notSecure));
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
  });
});

describe('doctor AT-TLS section (runAtTlsDoctorChecks)', () => {
  const MODULE_PATH = '/lpar/zos-attls/node_modules/zos-attls';

  it('is inactive when mode is off and no module is declared', async () => {
    expect(await runAtTlsDoctorChecks({ mode: 'off', env: {} })).toEqual([]);
  });

  it('activates on ZOWE_MCP_ATTLS_MODULE alone (deploy runs doctor without start flags)', async () => {
    const checks = await runAtTlsDoctorChecks({
      env: { ZOWE_MCP_ATTLS_MODULE: MODULE_PATH },
      platform: 'os390',
      probe: path => {
        expect(path).toBe(MODULE_PATH);
        return Promise.resolve({
          policyStatus: 'noPolicy' as const,
          connStatus: 'notSecure' as const,
        });
      },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('ok');
    expect(checks[0].detail).toContain('policyStatus=noPolicy');
    expect(checks[0].detail).toContain(MODULE_PATH);
  });

  it('reports a probe failure with build instructions', async () => {
    const checks = await runAtTlsDoctorChecks({
      mode: 'required',
      env: { ZOWE_MCP_ATTLS_MODULE: MODULE_PATH },
      platform: 'os390',
      probe: () => Promise.reject(new Error('cannot open shared object')),
    });
    expect(checks[0].status).toBe('fail');
    expect(checks[0].detail).toContain('cannot open shared object');
    expect(checks[0].instructions?.join('\n')).toContain('build.sh');
  });

  it('off z/OS: fail for required, info for monitor', async () => {
    const required = await runAtTlsDoctorChecks({ mode: 'required', env: {}, platform: 'darwin' });
    expect(required[0].status).toBe('fail');
    const monitor = await runAtTlsDoctorChecks({ mode: 'monitor', env: {}, platform: 'darwin' });
    expect(monitor[0].status).toBe('info');
  });
});
