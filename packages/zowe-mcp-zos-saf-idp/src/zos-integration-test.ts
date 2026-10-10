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
 * z/OS integration tests for the native SAF backend — these validate the
 * CONTRACT between this package and z/OS (node-racf / __passwd semantics), so
 * they must run ON z/OS, against the real security manager. They are built on
 * `node:test` (zero dependencies) because vitest/esbuild cannot run on z/OS,
 * and they ship compiled in `dist/` so an installed tarball can run them:
 *
 *   . <node install>/activate-or-.env    # STEPLIB, AUTOCVT, PATH
 *   node --no-wasm-tier-up --no-wasm-dynamic-tiering \
 *     node_modules/zowe-mcp-zos-saf-idp/dist/zos-integration-test.js
 *
 * Contract-only tests need NO credentials (the no-credential probe). Tests
 * marked "credentials" need a disposable test account via env vars:
 *   ZOWE_MCP_IT_USER / ZOWE_MCP_IT_PASSWORD
 * NOTE: the wrong-password test records one failed attempt against that
 * account (immediately cleared by the following successful check) — use a
 * disposable account, never a production userid.
 *
 * Environment setup is a prerequisite, not part of the tests: run
 * `zowe-mcp-zos-saf-idp doctor` first — it checks the environment and prints
 * the setup split by required authority (extattr for the user, PROGRAM
 * class / FACILITY permits as instructions for the RACF admin).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAtTlsModule } from 'zos-attls';
import {
  loadRacfModule,
  probeNativeEnvironment,
  verifyWithRacfModule,
} from './saf-check-native.js';
import { describeRuntimeEnvironment } from './saf-doctor.js';
import { resolveSafVerifier, type SafVerifier } from './saf-verify.js';
import { startIdpHttp } from './server.js';

// The contract these tests validate depends on the environment the process was
// started with — record it in the test log for every run.
console.log(`Runtime environment: ${describeRuntimeEnvironment()}`);

// 'os390' is the z/OS platform tag; @types/node's Platform union omits it.
const onZos = (process.platform as string) === 'os390';
const skipOffZos = onZos ? false : 'z/OS only (native SAF contract)';

const attlsModulePath = process.env.ZOWE_MCP_ATTLS_MODULE;
const skipNoAttlsModule =
  !onZos || !attlsModulePath
    ? 'needs z/OS + ZOWE_MCP_ATTLS_MODULE (zos-attls addon built on this LPAR)'
    : false;

const itUser = process.env.ZOWE_MCP_IT_USER;
const itPassword = process.env.ZOWE_MCP_IT_PASSWORD;
const skipNoCreds =
  !onZos || !itUser || !itPassword
    ? 'needs z/OS + ZOWE_MCP_IT_USER/ZOWE_MCP_IT_PASSWORD (disposable test account)'
    : false;

void test('node-racf loads and exposes authenticate()', { skip: skipOffZos }, () => {
  const racf = loadRacfModule();
  assert.equal(typeof racf.authenticate, 'function');
});

void test(
  'contract: unknown user is ESRCH, mapped to invalid_credentials (clean environment)',
  { skip: skipOffZos },
  () => {
    // This is the no-credential probe: JRENVDIRTY here means the environment
    // is not program-controlled — run `zowe-mcp-zos-saf-idp doctor`.
    const probe = probeNativeEnvironment(loadRacfModule());
    assert.equal(
      probe.outcome,
      'invalid_credentials',
      probe.outcome === 'unavailable' ? probe.detail : `unexpected outcome ${probe.outcome}`
    );
  }
);

void test(
  "resolveSafVerifier: 'auto' picks the native backend on z/OS",
  { skip: skipOffZos },
  () => {
    const resolved = resolveSafVerifier({ mode: 'auto' });
    assert.equal(resolved.backend, 'native');
  }
);

void test(
  'contract (credentials): wrong password -> invalid_credentials, correct -> authenticated, lowercase folds',
  { skip: skipNoCreds },
  () => {
    const racf = loadRacfModule();
    // Order matters: the wrong-password attempt records a RACF failure for the
    // account; the successful checks right after clear the counter.
    assert.deepEqual(verifyWithRacfModule(racf, itUser!, 'WRONGPW1'), {
      outcome: 'invalid_credentials',
    });
    assert.deepEqual(verifyWithRacfModule(racf, itUser!, itPassword!), {
      outcome: 'authenticated',
    });
    assert.deepEqual(verifyWithRacfModule(racf, itUser!.toLowerCase(), itPassword!), {
      outcome: 'authenticated',
    });
  }
);

void test(
  'zos-attls addon loads from ZOWE_MCP_ATTLS_MODULE and exposes query()',
  { skip: skipNoAttlsModule },
  () => {
    const addon = loadAtTlsModule(attlsModulePath);
    assert.equal(typeof addon.query, 'function');
  }
);

// docs/zos-attls-aware-mode.md § 8.2 test 5 — THE fail-closed proof: a
// cleartext loopback request is exactly the PAGENT-down shape (cleartext
// reaching Node), and at the strict default it must be refused. These start
// the real gate (real addon via ZOWE_MCP_ATTLS_MODULE, live TCP stack); SAF
// verification is stubbed because the request never gets past the gate.
const attlsStubVerifier: SafVerifier = () => Promise.resolve({ outcome: 'invalid_credentials' });

/** Starts the IdP in required mode and fetches discovery over cleartext loopback. */
async function cleartextLoopbackThroughGate(
  attlsLoopbackClear: boolean
): Promise<{ status: number; body: unknown; connection: string | null }> {
  const idp = await startIdpHttp({
    host: '127.0.0.1',
    port: 0,
    issuer: 'https://idp.example',
    tlsTerminated: true,
    attls: 'required',
    attlsLoopbackClear,
    safVerifier: attlsStubVerifier,
  });
  try {
    const res = await fetch(`http://127.0.0.1:${idp.port}/.well-known/openid-configuration`);
    return {
      status: res.status,
      body: await res.json(),
      connection: res.headers.get('connection'),
    };
  } finally {
    await idp.close();
  }
}

void test(
  'AT-TLS gate (required, strict default): cleartext loopback request -> 403',
  { skip: skipNoAttlsModule },
  async () => {
    const res = await cleartextLoopbackThroughGate(false);
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'connection_not_secured_by_attls' });
    assert.equal(res.connection, 'close');
  }
);

void test(
  'AT-TLS gate (required, LOOPBACK_CLEAR=allow): cleartext loopback request -> 200',
  { skip: skipNoAttlsModule },
  async () => {
    const res = await cleartextLoopbackThroughGate(true);
    assert.equal(res.status, 200);
    assert.equal((res.body as { issuer?: string }).issuer, 'https://idp.example');
  }
);

void test(
  'end to end (credentials): POST /login through the native backend mints a JWT',
  { skip: skipNoCreds },
  async () => {
    const idp = await startIdpHttp({ host: '127.0.0.1', port: 0, safCheck: 'native' });
    try {
      // 401 first, then 200 — so the failed attempt is cleared immediately.
      const bad = await fetch(`http://127.0.0.1:${idp.port}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: itUser, password: 'WRONGPW1' }),
      });
      assert.equal(bad.status, 401);

      const good = await fetch(`http://127.0.0.1:${idp.port}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: itUser, password: itPassword }),
      });
      assert.equal(good.status, 200);
      const body = (await good.json()) as { access_token?: string; token_type?: string };
      assert.equal(body.token_type, 'Bearer');
      assert.equal(body.access_token?.split('.').length, 3);
    } finally {
      await idp.close();
    }
  }
);
