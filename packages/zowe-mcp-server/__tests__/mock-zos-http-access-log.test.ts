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
 * Tests for the HTTP access log — `<mockDir>/_ssh/last_http.json`.
 *
 * - Every finished z/OSMF HTTP request must append one structured record.
 * - The ring buffer caps at 100 entries (drops oldest).
 * - Auth context (username) is captured when the route resolved it.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disposeMockZos, spawnMockZos, type SpawnedMockZos } from './helpers/spawn-mock-zos.js';

interface HttpAccessRecord {
  at: string;
  method: string;
  path: string;
  query?: string;
  status: number;
  username?: string;
  durationMs: number;
}

async function readAccessLog(env: SpawnedMockZos): Promise<HttpAccessRecord[]> {
  const file = path.join(env.mockDir, '_ssh', 'last_http.json');
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as HttpAccessRecord[];
  } catch {
    return [];
  }
}

/** Wait for the file to contain at least `min` entries (the writer is async). */
async function waitForEntries(env: SpawnedMockZos, min: number): Promise<HttpAccessRecord[]> {
  for (let i = 0; i < 50; i++) {
    const entries = await readAccessLog(env);
    if (entries.length >= min) return entries;
    await new Promise(r => setTimeout(r, 20));
  }
  return readAccessLog(env);
}

describe('mock-zos HTTP access log', () => {
  let env: SpawnedMockZos;

  beforeEach(async () => {
    env = await spawnMockZos({
      seedDatasets: [{ dsn: 'USER1.NOTES.TXT', dsorg: 'PS' }],
    });
  });

  afterEach(async () => {
    await disposeMockZos(env);
  });

  it('appends a record for each finished request with method/path/status/duration', async () => {
    // 1. POST authenticate
    await fetch(`${env.httpBaseUrl!}/zosmf/services/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });
    // 2. GET restfiles/ds
    await fetch(`${env.httpBaseUrl!}/zosmf/restfiles/ds?dslevel=USER1.*`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('USER1:password').toString('base64'),
        'X-CSRF-ZOSMF-HEADER': 'x',
      },
    });

    const entries = await waitForEntries(env, 2);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const auth = entries.find(e => e.path === '/zosmf/services/authenticate');
    expect(auth).toBeDefined();
    expect(auth!.method).toBe('POST');
    expect(auth!.status).toBe(200);
    expect(auth!.durationMs).toBeGreaterThanOrEqual(0);
    expect(auth!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const list = entries.find(e => e.path === '/zosmf/restfiles/ds');
    expect(list).toBeDefined();
    expect(list!.method).toBe('GET');
    expect(list!.status).toBe(200);
    expect(list!.query).toBe('dslevel=USER1.*');
    expect(list!.username).toBe('USER1');
  });

  it('caps the buffer at 100 entries (ring buffer)', async () => {
    // Fire 110 unauthenticated requests; each will produce a 403 entry.
    const url = `${env.httpBaseUrl!}/zosmf/restfiles/ds?dslevel=USER1.*`;
    for (let i = 0; i < 110; i++) {
      await fetch(url, { headers: { 'X-CSRF-ZOSMF-HEADER': 'x' } });
    }
    const entries = await waitForEntries(env, 100);
    expect(entries.length).toBe(100);
    // All entries should be the GET restfiles/ds we fired.
    for (const e of entries) {
      expect(e.path).toBe('/zosmf/restfiles/ds');
      expect(e.method).toBe('GET');
    }
  });
});
