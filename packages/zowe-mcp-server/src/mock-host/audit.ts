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
 * Best-effort append-only audit logs for the mock z/OS daemon.
 *
 * Two parallel ring buffers under `<mockDir>/_ssh/`:
 *
 *   last_auth.json — authentication outcomes from both the SSH server and the
 *                    z/OSMF HTTP routes. Outcome strings include 'wrongPassword',
 *                    'tooManyAttempts', 'racfRevoked', 'passwordExpired',
 *                    'passwordExpiringSoon' (SSH) and 'tokenIssued',
 *                    'tokenRevoked' (HTTP).
 *
 *   last_http.json — one entry per finished z/OSMF HTTP request, so tests can
 *                    assert "this request happened" without scraping stderr.
 *
 * Both files are capped at the last {@link MAX_ENTRIES} entries. Concurrent
 * writers race in theory; the all-encompassing try/catch makes both writers
 * best-effort, which is acceptable for a development mock.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const MAX_ENTRIES = 100;

// ───── Auth outcomes (existing) ─────────────────────────────────────────────

export interface AuthOutcomeRecord {
  at: string;
  username: string;
  outcome: string;
  value?: number;
}

export async function recordAuthOutcome(
  mockDir: string,
  username: string,
  outcome: string,
  value?: number
): Promise<void> {
  await appendRingBuffer<AuthOutcomeRecord>(mockDir, 'last_auth.json', {
    at: new Date().toISOString(),
    username,
    outcome,
    value,
  });
}

// ───── HTTP access (new) ────────────────────────────────────────────────────

export interface HttpAccessRecord {
  at: string;
  method: string;
  path: string;
  /** Raw query string without the leading '?'. Useful for `dslevel=` debugging. */
  query?: string;
  status: number;
  /** Authenticated user when the request resolved auth before middleware finished. */
  username?: string;
  durationMs: number;
}

export async function recordHttpAccess(
  mockDir: string,
  record: Omit<HttpAccessRecord, 'at'>
): Promise<void> {
  await appendRingBuffer<HttpAccessRecord>(mockDir, 'last_http.json', {
    at: new Date().toISOString(),
    ...record,
  });
}

// ───── Shared ring-buffer writer ───────────────────────────────────────────

/**
 * Per-file serialization. `recordHttpAccess` is called fire-and-forget from
 * the access-log middleware, so consecutive requests may issue their I/O
 * before the previous one finishes. A simple promise chain keyed by file path
 * serializes the read-modify-write so concurrent appends don't lose entries
 * to the last-writer-wins race.
 */
const writeChains = new Map<string, Promise<void>>();

function appendRingBuffer<T>(mockDir: string, filename: string, entry: T): Promise<void> {
  const file = path.join(mockDir, '_ssh', filename);
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev.then(() => doAppend<T>(mockDir, file, entry));
  // Always advance the chain — even if `next` rejects, we record the resolved
  // version so the next caller's write proceeds. Reset to undefined once this
  // is the tail to let the Map shrink.
  const tail = next
    .catch(() => undefined)
    .finally(() => {
      if (writeChains.get(file) === tail) writeChains.delete(file);
    });
  writeChains.set(file, tail);
  return tail;
}

async function doAppend<T>(mockDir: string, file: string, entry: T): Promise<void> {
  try {
    await fs.mkdir(path.join(mockDir, '_ssh'), { recursive: true });
    let prev: T[] = [];
    try {
      const raw: unknown = JSON.parse(await fs.readFile(file, 'utf-8'));
      if (Array.isArray(raw)) prev = raw as T[];
    } catch {
      /* new file */
    }
    prev.push(entry);
    if (prev.length > MAX_ENTRIES) prev = prev.slice(-MAX_ENTRIES);
    await fs.writeFile(file, JSON.stringify(prev, null, 2));
  } catch {
    /* persistence is best-effort */
  }
}
