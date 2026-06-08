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
 * Integration tests for `GET /zosmf/restfiles/ds`.
 *
 * Spins the daemon in-process on ephemeral ports with a couple of seeded
 * datasets and exercises:
 *   - happy path (cookie + Basic)
 *   - empty match → 200 + items:[]
 *   - missing dslevel → 400 + IZUF010E
 *   - missing CSRF → 403 + IZUM112E
 *   - missing auth → 401 + WWW-Authenticate
 *   - X-IBM-Max-Items cap
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  disposeMockZos,
  loginAndGetCookie,
  spawnMockZos,
  type SpawnedMockZos,
} from './helpers/spawn-mock-zos.js';
// Use the production response types (not a local duplicate) so the test stays
// in sync with the z/OSMF wire shape the server actually emits.
import type { ZosmfDataSetListResponse } from '../src/mock-host/zosmf/response.js';

const RESTFILES_DS = '/zosmf/restfiles/ds';

interface ZosmfErrorBody {
  rc: number;
  reason: number;
  category: number;
  message: string;
}

describe('mock-zos GET /zosmf/restfiles/ds', () => {
  let env: SpawnedMockZos;

  beforeEach(async () => {
    env = await spawnMockZos({
      seedDatasets: [
        { dsn: 'USER1.NOTES.TXT', dsorg: 'PS', recfm: 'FB', lrecl: 80 },
        { dsn: 'USER1.SAMPLE.COBOL', dsorg: 'PO-E', recfm: 'FB', lrecl: 80 },
        { dsn: 'USER1.JCL.LIB', dsorg: 'PO', recfm: 'FB', lrecl: 80 },
        { dsn: 'OTHER.SOURCE', dsorg: 'PS', recfm: 'FB', lrecl: 80 },
      ],
    });
  });

  afterEach(async () => {
    await disposeMockZos(env);
  });

  it('lists datasets matching the dslevel via cookie auth', async () => {
    // 1. Login to get a cookie.
    const token = await loginAndGetCookie(env.httpBaseUrl!);

    // 2. List USER1.*
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}?dslevel=USER1.*`, {
      headers: { Cookie: `LtpaToken2=${token}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ZosmfDataSetListResponse;
    expect(body.JSONversion).toBe(1);
    expect(body.returnedRows).toBe(3);
    expect(body.items.map(i => i.dsname).sort()).toEqual([
      'USER1.JCL.LIB',
      'USER1.NOTES.TXT',
      'USER1.SAMPLE.COBOL',
    ]);
    // Confirm IBM REST field names and types per item (NOT the ZNP/RPC names).
    // Real z/OSMF 5.30 returns numeric-looking fields as strings (e.g. lrecl: "80").
    const notes = body.items.find(i => i.dsname === 'USER1.NOTES.TXT')!;
    expect(notes.dsorg).toBe('PS');
    expect(notes.recfm).toBe('FB');
    expect(notes.lrecl).toBe('80');
    expect(notes.blksz).toBe('27920');
    expect(notes.vol).toBe('VOL001');
    // migr and mvol use z/OSMF string forms
    expect(notes.migr).toBe('NO');
    expect(notes.mvol).toBe('N');
    expect(notes.ovf).toBe('NO');
    // edate uses "***None***" when no expiry (not null)
    expect(notes.edate).toBe('***None***');
    // Real z/OSMF clients should NEVER see ZNP-style aliases.
    expect(notes).not.toHaveProperty('name');
    expect(notes).not.toHaveProperty('blksize');
    expect(notes).not.toHaveProperty('volser');
  });

  it('works with Basic auth and no cookie', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}?dslevel=USER1.*`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ZosmfDataSetListResponse;
    expect(body.returnedRows).toBeGreaterThan(0);
  });

  it('returns 200 + items:[] for an empty match', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}?dslevel=NOSUCH.**`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ZosmfDataSetListResponse;
    expect(body.items).toEqual([]);
    expect(body.returnedRows).toBe(0);
    expect(body.JSONversion).toBe(1);
  });

  it('rejects missing dslevel with 400 + IZUF010E', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUF010E/);
    expect(body.message).toMatch(/dslevel/);
  });

  it('rejects missing X-CSRF-ZOSMF-HEADER with 403 + IZUM112E', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}?dslevel=USER1.*`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUM112E/);
  });

  it('rejects missing auth with 401 + WWW-Authenticate', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}?dslevel=USER1.*`, {
      headers: { 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm="z\/OSMF"/);
  });

  it('honors X-IBM-Max-Items to cap the result count', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}?dslevel=USER1.*`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
        'X-IBM-Max-Items': '1',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ZosmfDataSetListResponse;
    expect(body.items.length).toBe(1);
    expect(body.returnedRows).toBe(1);
    // moreRows must be true when the list was truncated by X-IBM-Max-Items
    expect(body.moreRows).toBe(true);
  });

  it('honors the `start` query cursor (skip entries lexically before it)', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}?dslevel=USER1.*&start=USER1.S`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ZosmfDataSetListResponse;
    // Expected: only USER1.SAMPLE.COBOL (JCL.LIB and NOTES.TXT sort before USER1.S)
    expect(body.items.map(i => i.dsname)).toEqual(['USER1.SAMPLE.COBOL']);
  });
});
