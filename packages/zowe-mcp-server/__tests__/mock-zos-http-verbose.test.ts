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
 * Verifies that `--verbose` (a.k.a. `verbose: true` passed to startMockZosHost)
 * causes the z/OSMF access-log middleware to dump full request/response
 * details, with credential headers redacted.
 *
 * We capture process.stderr.write — the daemon's logger writes there — and
 * scan the captured output for the expected lines.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disposeMockZos, spawnMockZos, type SpawnedMockZos } from './helpers/spawn-mock-zos.js';

/**
 * Hook process.stderr.write while the callback runs and return everything that
 * was written. Restores the original writer no matter what.
 */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ value: T; output: string }> {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: unknown, ...rest: unknown[]) => {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : ''
    );
    return (orig as unknown as (...a: unknown[]) => boolean)(chunk, ...rest);
  };
  try {
    const value = await fn();
    return { value, output: chunks.join('') };
  } finally {
    process.stderr.write = orig;
  }
}

describe('mock-zos --verbose HTTP traces', () => {
  let env: SpawnedMockZos;

  beforeEach(async () => {
    env = await spawnMockZos({
      verbose: true,
      seedDatasets: [
        {
          dsn: 'USER1.NOTES.TXT',
          dsorg: 'PS',
          recfm: 'FB',
          lrecl: 80,
          content: 'verbose-trace-body\n',
        },
      ],
    });
  });

  afterEach(async () => {
    await disposeMockZos(env);
  });

  it('dumps full request + response details and redacts Authorization', async () => {
    const { output } = await captureStderr(async () => {
      const res = await fetch(`${env.httpBaseUrl!}/zosmf/restfiles/ds/USER1.NOTES.TXT`, {
        headers: {
          Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
          'X-CSRF-ZOSMF-HEADER': 'x',
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('verbose-trace-body\n');
    });

    // Request trace line
    expect(output).toMatch(/--> GET \/zosmf\/restfiles\/ds\/USER1\.NOTES\.TXT/);
    // Authorization header should be redacted; the literal Basic value must NOT appear
    expect(output).toMatch(/authorization: <redacted: \d+ chars>/i);
    expect(output).not.toContain('Basic VVNFUjE6cGFzc3dvcmQ='); // base64 of USER1:password
    // X-CSRF-ZOSMF-HEADER is also redacted
    expect(output).toMatch(/x-csrf-zosmf-header: <redacted: \d+ chars>/i);
    // Response trace line
    expect(output).toMatch(/<-- 200/);
    // Response headers visible (ETag included)
    expect(output).toMatch(/< etag:/i);
    // Response body shown verbatim
    expect(output).toContain('verbose-trace-body');
  });

  it('redacts Cookie on subsequent calls', async () => {
    // Login first to get a cookie, then make a call with the cookie and
    // verify the verbose dump masks the LtpaToken2 value.
    const login = await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    const setCookie = login.headers.get('set-cookie') ?? '';
    const m = /LtpaToken2=([^;]+)/.exec(setCookie);
    const token = m?.[1];
    expect(token).toBeTruthy();

    const { output } = await captureStderr(async () => {
      const res = await fetch(`${env.httpBaseUrl!}/zosmf/restfiles/ds/USER1.NOTES.TXT`, {
        headers: {
          Cookie: `LtpaToken2=${token!}`,
          'X-CSRF-ZOSMF-HEADER': 'x',
        },
      });
      expect(res.status).toBe(200);
    });

    // Cookie value must NOT appear verbatim — it's a sensitive bearer token.
    expect(output).not.toContain(token!);
    expect(output).toMatch(/cookie: <redacted: \d+ chars>/i);
  });
});
