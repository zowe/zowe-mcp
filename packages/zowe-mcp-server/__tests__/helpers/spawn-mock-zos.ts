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
 * Test helper: spin up the mock z/OS daemon in-process on ephemeral ports
 * against a temporary mockDir seeded with a small users.json catalog.
 *
 * Each call creates a unique tmpdir, generates fresh fixtures (host key
 * isolated to the mockDir via `isolateHostKey: true`), and returns a handle
 * the test can dispose in `afterAll`/`afterEach`.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { startMockZosHost, type StartMockZosResult } from '../../src/mock-host/server.js';
import type { MockUsersFile } from '../../src/mock-host/users.js';

export interface SpawnMockZosOptions {
  /** Extra users to seed in addition to the default USER1/EXPIRED/LOCKED/WARNING. */
  extraUsers?: MockUsersFile['users'];
  /** Default catalog to use. If unset, a minimal catalog with all four scenario users is written. */
  users?: MockUsersFile['users'];
  /** Set httpPort=undefined to skip the HTTP listener. Default 0 (ephemeral). */
  httpPort?: number;
  /** Set port=undefined to skip the SSH listener too (not supported yet — always starts). */
  sshPort?: number;
  /** Pass through to startMockZosHost — enable full HTTP request/response traces. */
  verbose?: boolean;
  /**
   * Datasets to seed under `<mockDir>/sys1/<HLQ>/<rest.of.dsn>` (with a sibling
   * `_meta.json` describing attributes). Used by restfiles-ds tests so
   * listDatasets returns something. When omitted, no datasets are seeded.
   */
  seedDatasets?: {
    dsn: string;
    dsorg?: 'PS' | 'PO' | 'PO-E';
    recfm?: string;
    lrecl?: number;
    blksz?: number;
    volser?: string;
    creationDate?: string;
    /** Body for a sequential (PS) dataset. Empty string when omitted. */
    content?: string;
    /** Member name → body, for PDS/PDS-E. Keys are uppercased. */
    members?: Record<string, string>;
  }[];
}

export interface SpawnedMockZos {
  handle: StartMockZosResult;
  mockDir: string;
  sshHost: string;
  sshPort: number;
  httpHost?: string;
  httpPort?: number;
  /** Resolved base URL for the HTTP listener (no trailing slash). */
  httpBaseUrl?: string;
}

const DEFAULT_USERS: MockUsersFile['users'] = [
  {
    username: 'USER1',
    password: 'password',
    uid: 12345,
    gid: 10,
    primaryGroup: 'STCGROUP',
    groups: ['SYS1'],
    home: '/u/user1',
    systemId: 'sys1',
    scenario: 'normal',
  },
  {
    username: 'EXPIRED',
    password: 'password',
    home: '/u/expired',
    systemId: 'sys1',
    scenario: 'passwordExpired',
  },
  {
    username: 'LOCKED',
    password: 'password',
    home: '/u/locked',
    systemId: 'sys1',
    scenario: 'racfRevoked',
  },
  {
    username: 'WARNING',
    password: 'password',
    home: '/u/warning',
    systemId: 'sys1',
    scenario: 'passwordExpiresInDays',
    scenarioValue: 3,
  },
];

export async function spawnMockZos(opts: SpawnMockZosOptions = {}): Promise<SpawnedMockZos> {
  const mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mock-zos-test-'));
  await fs.mkdir(path.join(mockDir, '_ssh'), { recursive: true });

  const users: MockUsersFile = {
    defaultSystemId: 'sys1',
    users: [...(opts.users ?? DEFAULT_USERS), ...(opts.extraUsers ?? [])],
  };
  await fs.writeFile(path.join(mockDir, '_ssh', 'users.json'), JSON.stringify(users, null, 2));
  // Minimal systems.json so loadMockUsers's fallback path is consistent.
  await fs.writeFile(
    path.join(mockDir, 'systems.json'),
    JSON.stringify(
      {
        systems: [
          {
            host: 'sys1',
            port: 22,
            defaultUser: 'USER1',
            credentials: [{ user: 'USER1', password: 'password' }],
          },
        ],
      },
      null,
      2
    )
  );

  // Seed dataset fixtures (optional). The FilesystemMockBackend's on-disk
  // layout is `<mockDir>/<systemId>/<HLQ>/<rest.of.dsn>` for sequential data
  // sets (a file) or PDS/E (a directory containing members). For listDatasets
  // tests we only need the file/directory present; attributes are stored in
  // `_meta.json` sidecars next to the file or inside the PDS directory.
  for (const ds of opts.seedDatasets ?? []) {
    await seedDataset(mockDir, ds);
  }

  const handle = await startMockZosHost({
    host: '127.0.0.1',
    port: opts.sshPort ?? 0,
    mockDir,
    // Verbose mode forces logger calls so we promote logLevel to 'info' when
    // the test explicitly opts in; otherwise stay quiet at 'error'.
    logLevel: opts.verbose ? 'info' : 'error',
    isolateHostKey: true,
    httpPort: opts.httpPort ?? 0,
    httpHost: '127.0.0.1',
    verbose: opts.verbose,
  });

  return {
    handle,
    mockDir,
    sshHost: handle.ssh.host,
    sshPort: handle.ssh.port,
    httpHost: handle.http?.host,
    httpPort: handle.http?.port,
    httpBaseUrl: handle.http ? `http://${handle.http.host}:${handle.http.port}` : undefined,
  };
}

/**
 * Write one dataset fixture under `<mockDir>/sys1/<HLQ>/<rest.of.dsn>`
 * matching the layout FilesystemMockBackend expects. Sequential = file;
 * PDS / PDS-E = directory.
 */
async function seedDataset(
  mockDir: string,
  ds: {
    dsn: string;
    dsorg?: 'PS' | 'PO' | 'PO-E';
    recfm?: string;
    lrecl?: number;
    blksz?: number;
    volser?: string;
    creationDate?: string;
    content?: string;
    members?: Record<string, string>;
  }
): Promise<void> {
  const dsorg = ds.dsorg ?? 'PS';
  const upper = ds.dsn.toUpperCase();
  const dotIdx = upper.indexOf('.');
  const hlq = dotIdx === -1 ? upper : upper.slice(0, dotIdx);
  const rest = dotIdx === -1 ? '' : upper.slice(dotIdx + 1);
  const base = path.join(mockDir, 'sys1', hlq);
  await fs.mkdir(base, { recursive: true });
  const meta = {
    dsn: upper,
    dsorg,
    recfm: ds.recfm ?? 'FB',
    lrecl: ds.lrecl ?? 80,
    blksz: ds.blksz ?? 27920,
    volser: ds.volser ?? 'VOL001',
    creationDate: ds.creationDate ?? new Date().toISOString().slice(0, 10),
  };
  if (dsorg === 'PO' || dsorg === 'PO-E') {
    const dsDir = path.join(base, rest);
    await fs.mkdir(dsDir, { recursive: true });
    await fs.writeFile(path.join(dsDir, '_meta.json'), JSON.stringify(meta, null, 2));
    // Optional member fixtures — FilesystemMockBackend's member detection
    // strips file extensions, so a `.cbl` suffix is fine and is what the
    // SSH-side fixtures use.
    for (const [name, body] of Object.entries(ds.members ?? {})) {
      await fs.writeFile(path.join(dsDir, `${name.toUpperCase()}.cbl`), body);
    }
  } else {
    const file = path.join(base, rest);
    await fs.writeFile(file, ds.content ?? '');
    await fs.writeFile(`${file}_meta.json`, JSON.stringify(meta, null, 2));
  }
}

/** Tear down the mock and clean its tmpdir. Safe to call multiple times. */
export async function disposeMockZos(spawned: SpawnedMockZos): Promise<void> {
  try {
    await spawned.handle.dispose();
  } catch {
    /* already torn down */
  }
  try {
    await fs.rm(spawned.mockDir, { recursive: true, force: true });
  } catch {
    /* tolerate */
  }
}

/** Convenience: pull the LtpaToken2 cookie out of a Set-Cookie header. */
export function extractLtpaCookie(setCookie: string | string[] | undefined): string | undefined {
  if (!setCookie) return undefined;
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const h of headers) {
    const m = /LtpaToken2=([^;]+)/.exec(h);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * POST to z/OSMF authenticate, assert HTTP 200, and return the LtpaToken2
 * cookie value. Throws an error on failure.
 */
export async function loginAndGetCookie(
  httpBaseUrl: string,
  username = 'USER1',
  password = 'password'
): Promise<string> {
  const loginRes = await fetch(`${httpBaseUrl}/zosmf/services/authenticate`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      'X-CSRF-ZOSMF-HEADER': 'x',
    },
  });
  if (loginRes.status !== 200) {
    throw new Error(`loginAndGetCookie: expected 200 from authenticate, got ${loginRes.status}`);
  }
  const token = extractLtpaCookie(loginRes.headers.get('set-cookie') ?? undefined);
  if (!token) throw new Error('loginAndGetCookie: no LtpaToken2 cookie in authenticate response');
  return token;
}
