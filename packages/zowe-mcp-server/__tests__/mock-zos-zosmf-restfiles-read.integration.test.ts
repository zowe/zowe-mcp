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
 * Integration tests for the data set read endpoints:
 *   GET /zosmf/restfiles/ds/<dsname>            — sequential data set
 *   GET /zosmf/restfiles/ds/<dsname>/<member>   — PDS / PDS-E member
 *
 * Exercised via the same spawn-mock-zos helper as the list-endpoint tests so
 * the on-disk fixture layout stays consistent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  disposeMockZos,
  loginAndGetCookie,
  spawnMockZos,
  type SpawnedMockZos,
} from './helpers/spawn-mock-zos.js';

const RESTFILES_DS = '/zosmf/restfiles/ds';

const PS_BODY = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\n';
const PDS_HELLO = 'PROCEDURE DIVISION.\nDISPLAY "HI".\nSTOP RUN.\n';
const PDS_WORLD = 'PROCEDURE DIVISION.\nDISPLAY "WORLD".\nSTOP RUN.\n';

interface ZosmfErrorBody {
  rc: number;
  reason: number;
  category: number;
  message: string;
}

describe('mock-zos GET /zosmf/restfiles/ds/{dsname}[/{member}]', () => {
  let env: SpawnedMockZos;
  let cookie: string;

  async function login(): Promise<string> {
    return loginAndGetCookie(env.httpBaseUrl!);
  }

  beforeEach(async () => {
    env = await spawnMockZos({
      seedDatasets: [
        {
          dsn: 'USER1.NOTES.TXT',
          dsorg: 'PS',
          recfm: 'FB',
          lrecl: 80,
          content: PS_BODY,
        },
        {
          dsn: 'USER1.SAMPLE.COBOL',
          dsorg: 'PO-E',
          recfm: 'FB',
          lrecl: 80,
          members: { HELLO: PDS_HELLO, WORLD: PDS_WORLD },
        },
      ],
    });
    cookie = await login();
  });

  afterEach(async () => {
    await disposeMockZos(env);
  });

  it('reads a sequential dataset body via cookie auth', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOTES.TXT`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    expect(res.headers.get('etag')).toMatch(/^[0-9a-f]+$/);
    expect(res.headers.get('x-ibm-data-type')).toBe('text');
    expect(await res.text()).toBe(PS_BODY);
  });

  it('reads a PDS member via the slash form (legacy / tolerant)', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.SAMPLE.COBOL/HELLO`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PDS_HELLO);

    const other = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.SAMPLE.COBOL/WORLD`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(await other.text()).toBe(PDS_WORLD);
  });

  it('reads a PDS member via the IBM parens form USER1.SAMPLE.COBOL(HELLO)', async () => {
    // Both unencoded and percent-encoded variants should resolve to the same
    // dataset + member. Zowe Explorer can send either depending on its URL
    // builder.
    const url1 = `${env.httpBaseUrl!}${RESTFILES_DS}/USER1.SAMPLE.COBOL(HELLO)`;
    const url2 = `${env.httpBaseUrl!}${RESTFILES_DS}/USER1.SAMPLE.COBOL%28HELLO%29`;

    const r1 = await fetch(url1, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(r1.status).toBe(200);
    expect(await r1.text()).toBe(PDS_HELLO);

    const r2 = await fetch(url2, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe(PDS_HELLO);
  });

  it('lists PDS members at /<dsname>/member (z/OSMF canonical endpoint)', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.SAMPLE.COBOL/member`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as {
      items: { member: string }[];
      returnedRows: number;
      JSONversion: number;
    };
    expect(body.JSONversion).toBe(1);
    expect(body.returnedRows).toBe(2);
    expect(body.items.map(i => i.member).sort()).toEqual(['HELLO', 'WORLD']);
    // Real z/OSMF NEVER returns `name` here — the field is `member`.
    expect(body.items[0]).not.toHaveProperty('name');
  });

  it('returns 404 when listing members of a non-PDS / missing dataset', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOTES.TXT/member`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUF013E/);
  });

  it('caps member listing by X-IBM-Max-Items', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.SAMPLE.COBOL/member`, {
      headers: {
        Cookie: `LtpaToken2=${cookie}`,
        'X-CSRF-ZOSMF-HEADER': 'x',
        'X-IBM-Max-Items': '1',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { member: string }[]; returnedRows: number };
    expect(body.returnedRows).toBe(1);
    expect(body.items).toHaveLength(1);
  });

  it('lowercases requests upper-cased before backend lookup', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/user1.notes.txt`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PS_BODY);
  });

  it('returns 304 when If-None-Match matches the current ETag', async () => {
    const first = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOTES.TXT`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^[0-9a-f]+$/);

    const second = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOTES.TXT`, {
      headers: {
        Cookie: `LtpaToken2=${cookie}`,
        'X-CSRF-ZOSMF-HEADER': 'x',
        'If-None-Match': etag,
      },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('returns 404 + IZUF013E when the dataset does not exist', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOSUCH.DATA`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUF013E/);
    expect(body.message).toContain('USER1.NOSUCH.DATA');
  });

  it('returns 404 + IZUF013E when the member does not exist in a PDS', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.SAMPLE.COBOL/NOPE`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUF013E/);
    expect(body.message).toContain('NOPE');
  });

  it('returns 400 + IZUF010E for malformed DSNs', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/123invalid`, {
      headers: { Cookie: `LtpaToken2=${cookie}`, 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUF010E/);
  });

  it('rejects with 403 + IZUM112E when X-CSRF-ZOSMF-HEADER is missing', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOTES.TXT`, {
      headers: { Cookie: `LtpaToken2=${cookie}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUM112E/);
  });

  it('rejects with 401 + WWW-Authenticate when no credentials are presented', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOTES.TXT`, {
      headers: { 'X-CSRF-ZOSMF-HEADER': 'x' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Basic/);
    const body = (await res.json()) as ZosmfErrorBody;
    expect(body.message).toMatch(/IZUG1077E/);
  });

  it('works with Basic auth and no cookie', async () => {
    const res = await fetch(`${env.httpBaseUrl!}${RESTFILES_DS}/USER1.NOTES.TXT`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PS_BODY);
  });
});
