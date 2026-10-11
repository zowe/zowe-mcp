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
 * Native SAF backend: node-racf result/error mapping (the error strings are the
 * exact EDC*I texts observed on a live RACF LPAR, 2026-09-11), backend
 * resolution (`--saf-check auto|native|ssh`), and the new login outcomes
 * (expired password, backend unavailable) on both login endpoints.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  classifyRacfError,
  SAF_PROBE_USERID,
  verifyWithRacfModule,
  type RacfModule,
} from '../src/saf-check-native.js';
import { runSafDoctor, steplibDatasets } from '../src/saf-doctor.js';
import { resolveSafVerifier, type SafVerifier, type SafVerifyResult } from '../src/saf-verify.js';
import { createIdpApp, type IdpServerConfig } from '../src/server.js';
import {
  registerClient,
  runCodeFlow,
  startOidcTestServer,
  type CodeFlowFailure,
} from './helpers.js';

/** Narrows to the 'unavailable' arm (or fails the test) so asserts stay unconditional. */
function unavailableDetail(result: SafVerifyResult): string {
  if (result.outcome !== 'unavailable') {
    throw new Error(`expected outcome 'unavailable', got '${result.outcome}'`);
  }
  return result.detail;
}

/** Narrows to the login-failed arm (or fails the test) so asserts stay unconditional. */
function loginFailure(flow: { outcome: string }): CodeFlowFailure {
  if (flow.outcome !== 'login_failed') {
    throw new Error(`expected outcome 'login_failed', got '${flow.outcome}'`);
  }
  return flow as CodeFlowFailure;
}

describe('verifyWithRacfModule', () => {
  const fakeRacf = (impl: (u: string, p: string) => boolean): RacfModule => ({
    authenticate: impl,
  });

  it('maps true/false to authenticated/invalid_credentials', () => {
    expect(
      verifyWithRacfModule(
        fakeRacf(() => true),
        'U',
        'p'
      )
    ).toEqual({
      outcome: 'authenticated',
    });
    expect(
      verifyWithRacfModule(
        fakeRacf(() => false),
        'U',
        'p'
      )
    ).toEqual({
      outcome: 'invalid_credentials',
    });
  });

  it('maps a thrown ESRCH (unknown user) to plain invalid_credentials', () => {
    const racf = fakeRacf(() => {
      throw new TypeError('EDC5143I No such process.');
    });
    expect(verifyWithRacfModule(racf, 'NOSUCHU9', 'p')).toEqual({
      outcome: 'invalid_credentials',
    });
  });

  it('maps a thrown expired-password error to expired_password', () => {
    const racf = fakeRacf(() => {
      throw new TypeError('EDC5164I The password has expired.');
    });
    expect(verifyWithRacfModule(racf, 'U', 'p')).toEqual({ outcome: 'expired_password' });
  });

  it('maps EMVSERR (JRENVDIRTY) to unavailable with program-control remediation', () => {
    const racf = fakeRacf(() => {
      throw new TypeError('EDC5157I An internal error has occurred.');
    });
    const detail = unavailableDetail(verifyWithRacfModule(racf, 'U', 'p'));
    expect(detail).toMatch(/program-controlled/);
    expect(detail).toMatch(/extattr \+p/);
    expect(detail).toMatch(/PROGRAM class/);
  });

  it('maps any other throw to unavailable and never invents credentials text', () => {
    const result = classifyRacfError('EDC5111I Permission denied.');
    expect(unavailableDetail(result)).toContain('EDC5111I');
  });
});

describe('resolveSafVerifier', () => {
  it("defaults to the ssh backend and honors mode 'ssh'", () => {
    expect(resolveSafVerifier().backend).toBe('ssh');
    expect(resolveSafVerifier({ mode: 'ssh' }).backend).toBe('ssh');
  });

  it("mode 'auto' falls back to ssh off z/OS", () => {
    // process.platform is not 'os390' in CI — auto must not try to load racf.
    const log = vi.fn();
    const resolved = resolveSafVerifier({ mode: 'auto', log });
    expect(resolved.backend).toBe('ssh');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ssh'));
  });

  it("mode 'native' fails fast with an actionable error when racf cannot load", () => {
    expect(() => resolveSafVerifier({ mode: 'native' })).toThrowError(/racf/);
    expect(() => resolveSafVerifier({ mode: 'native' })).toThrowError(/doctor/);
  });

  it("mode 'native' probes the environment at startup and picks native when clean", async () => {
    // A clean environment answers the unknown-probe-user with ESRCH -> the
    // module throws "No such process", which counts as a passing probe.
    const authenticate = vi.fn((user: string) => {
      if (user === SAF_PROBE_USERID) throw new TypeError('EDC5143I No such process.');
      return true;
    });
    const resolved = resolveSafVerifier({ mode: 'native', racfModule: { authenticate } });
    expect(resolved.backend).toBe('native');
    expect(authenticate).toHaveBeenCalledWith(SAF_PROBE_USERID, expect.any(String));
    await expect(resolved.verifier('USER1', 'pw')).resolves.toEqual({ outcome: 'authenticated' });
  });

  it("mode 'native' fails fast when the startup probe finds a dirty environment", () => {
    const dirty: RacfModule = {
      authenticate: () => {
        throw new TypeError('EDC5157I An internal error has occurred.');
      },
    };
    expect(() => resolveSafVerifier({ mode: 'native', racfModule: dirty })).toThrowError(
      /program-controlled/
    );
  });
});

describe('runSafDoctor', () => {
  it('off z/OS: reports info and succeeds (nothing to set up)', () => {
    const report = runSafDoctor({ platform: 'darwin' });
    expect(report.ok).toBe(true);
    expect(report.checks[0]).toMatchObject({ name: 'platform', status: 'info' });
  });

  it('dirty environment: fails with instructions split by required authority', () => {
    const dirty: RacfModule = {
      authenticate: () => {
        throw new TypeError('EDC5157I An internal error has occurred.');
      },
    };
    const report = runSafDoctor({
      platform: 'os390',
      racfModule: dirty,
      env: { STEPLIB: 'CEE.SCEERUN2.OVERRIDE' },
    });
    expect(report.ok).toBe(false);
    const probe = report.checks.find(check => check.name === 'environment probe');
    const instructions = (probe?.instructions ?? []).join('\n');
    expect(instructions).toContain('extattr +p');
    expect(instructions).toContain("RALTER PROGRAM * ADDMEM('CEE.SCEERUN2.OVERRIDE'//NOPADCHK)");
    expect(instructions).toContain('SETROPTS WHEN(PROGRAM) REFRESH');
    expect(instructions).toContain('BPX.FILEATTR.PROGCTL');
  });

  it('--fix applies extattr (only) and re-probes', () => {
    let fixed = false;
    const racf: RacfModule = {
      authenticate: () => {
        throw new TypeError(
          fixed ? 'EDC5143I No such process.' : 'EDC5157I An internal error has occurred.'
        );
      },
    };
    const runExtattr = vi.fn(() => {
      fixed = true;
      return { ok: true, message: 'extattr +p applied' };
    });
    const report = runSafDoctor({ platform: 'os390', racfModule: racf, fix: true, runExtattr });
    expect(runExtattr).toHaveBeenCalledTimes(1);
    expect(report.fixesApplied).toHaveLength(1);
    expect(report.ok).toBe(true);
  });

  it('steplibDatasets parses and filters STEPLIB', () => {
    expect(steplibDatasets({ STEPLIB: 'CEE.SCEERUN2.OVERRIDE:none:CURRENT:SYS1.X' })).toEqual([
      'CEE.SCEERUN2.OVERRIDE',
      'SYS1.X',
    ]);
    expect(steplibDatasets({})).toEqual([]);
  });
});

describe('login outcomes surfaced by the routes', () => {
  async function withServer(
    verifier: SafVerifier,
    run: (baseUrl: string) => Promise<void>,
    extra: Partial<IdpServerConfig> = {}
  ): Promise<void> {
    const running = await startOidcTestServer(createIdpApp, { safVerifier: verifier, ...extra });
    try {
      await run(running.baseUrl);
    } finally {
      await running.close();
    }
  }

  function postLogin(baseUrl: string): Promise<Response> {
    return fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'USER1', password: 'pw' }),
    });
  }

  it('POST /login: expired password -> 401 password_expired', async () => {
    await withServer(
      () => Promise.resolve({ outcome: 'expired_password' }),
      async baseUrl => {
        const res = await postLogin(baseUrl);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'password_expired' });
      }
    );
  });

  it('POST /login: backend unavailable -> 503 without leaking the detail', async () => {
    await withServer(
      () => Promise.resolve({ outcome: 'unavailable', detail: 'JRENVDIRTY extattr hint' }),
      async baseUrl => {
        const res = await postLogin(baseUrl);
        expect(res.status).toBe(503);
        const text = JSON.stringify(await res.json());
        expect(text).toContain('temporarily_unavailable');
        expect(text).not.toContain('JRENVDIRTY');
      }
    );
  });

  it('interaction login: expired password renders an actionable message', async () => {
    await withServer(
      () => Promise.resolve({ outcome: 'expired_password' }),
      async baseUrl => {
        const client = await registerClient(baseUrl);
        const flow = await runCodeFlow({ baseUrl, client, username: 'USER1', password: 'pw' });
        const failure = loginFailure(flow);
        expect(failure.status).toBe(401);
        expect(failure.body).toMatch(/expired/i);
      },
      { systemName: 'TESTSYS' }
    );
  });

  it('interaction login: unavailable renders a generic 503 page, detail goes to the log', async () => {
    const log = vi.fn();
    await withServer(
      () => Promise.resolve({ outcome: 'unavailable', detail: 'secret operator detail' }),
      async baseUrl => {
        const client = await registerClient(baseUrl);
        const flow = await runCodeFlow({ baseUrl, client, username: 'USER1', password: 'pw' });
        const failure = loginFailure(flow);
        expect(failure.status).toBe(503);
        expect(failure.body).toMatch(/temporarily unavailable/i);
        expect(failure.body).not.toContain('secret operator detail');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('secret operator detail'));
      },
      { log }
    );
  });
});
