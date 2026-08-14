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
 * Start the JSON-RPC dispatcher on an SSH exec channel whose command was
 * `<path>/zowex server`. Emits the readiness JSON line first, then reads
 * newline-delimited JSON-RPC requests from stdin.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import ssh2 from 'ssh2';
import type { MockLogger } from '../log.js';
import { createDispatcher } from '../rpc/dispatcher.js';
import type { MockHostStore } from '../store.js';
import type { MockUser } from '../users.js';

export interface RpcChannelCtx {
  store: MockHostStore;
  user: MockUser;
  systemId: string;
  log: MockLogger;
}

export function startRpcChannel(channel: ssh2.ServerChannel, ctx: RpcChannelCtx): void {
  const checksums = loadChecksums();
  const version = loadServerVersion();
  // Readiness — must be first line on stdout. zowex-sdk parses any JSON received on
  // either stdout or stderr; emit on stdout to avoid noise on stderr.
  //
  // `version` is required as of zowex-sdk 0.7.1: ZSshClient stores this as
  // `mServerInfo.version` (see ZSshClient.js's `getServerStatus`/`serverVersion`
  // getter), and ZSshUtils.checkIfOutdated() treats a missing/invalid version as
  // outdated by default — which would otherwise trigger a redeploy on every
  // connection. `checksums` is kept for backward compat with older SDKs that
  // still key off it.
  const ready = { status: 'ready', data: { checksums, version } };
  channel.write(JSON.stringify(ready) + '\n');
  ctx.log(
    'info',
    `RPC ready user=${ctx.user.username} checksums=${Object.keys(checksums).length} version=${version}`
  );

  const dispatch = createDispatcher(
    {
      writeLine: line => channel.write(line + '\n'),
      log: (lvl, msg) => ctx.log(lvl, `RPC ${msg}`),
    },
    { store: ctx.store, user: ctx.user, systemId: ctx.systemId }
  );

  channel.on('data', (chunk: Buffer) => dispatch(chunk));
  channel.on('end', () => {
    ctx.log('info', `RPC stream ended user=${ctx.user.username}`);
    channel.end();
  });
}

/**
 * Load the SDK's `checksums.asc` from the running node_modules so the readiness
 * announcement matches what `checkIfOutdated()` expects (no redeploy bounce).
 */
function loadChecksums(): Record<string, string> {
  try {
    // Two candidate locations: as a sibling of this script after build, or in the
    // running node_modules of zowex-sdk.
    const candidates: string[] = [];
    try {
      // CommonJS-resolution-style trick: import.meta.url isn't available here; rely
      // on require.resolve via createRequire if needed. Simplest: walk node_modules
      // upward.
      let dir = path.dirname(new URL(import.meta.url).pathname);
      for (let i = 0; i < 8; i++) {
        const candidate = path.join(dir, 'node_modules', 'zowex-sdk', 'bin', 'checksums.asc');
        candidates.push(candidate);
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      /* not URL-resolvable; skip */
    }

    for (const c of candidates) {
      try {
        const raw = fs.readFileSync(c, 'utf-8');
        return parseChecksums(raw);
      } catch {
        /* try next */
      }
    }
  } catch {
    /* fall through */
  }
  // Stable fallback so the client doesn't repeatedly deploy when the SDK file is
  // unreadable. Any non-empty map is fine — the client only triggers redeploy on
  // mismatch with its OWN locally-known checksum file, which may also be missing.
  return { zowex: 'mock-stable-checksum' };
}

/**
 * Resolve the version string the running `@zowe/zowex-for-zowe-sdk` expects the
 * remote `zowex server` to report, so `ZSshUtils.checkIfOutdated()` (which
 * compares against `ZSshConstants.BUNDLED_SSH_SERVER_VERSION`) never sees the
 * mock as outdated. Resolved dynamically — like {@link loadChecksums} — so a
 * future SDK bump doesn't require touching the mock.
 *
 * Preference order:
 *   1. `@zowe/zowex-for-zowe-sdk/package.json`'s `version` field (the package
 *      version tracks `BUNDLED_SSH_SERVER_VERSION` 1:1 — both come from the
 *      same release).
 *   2. `@zowe/zowex-for-zowe-sdk/lib/ZSshConstants.js`'s
 *      `BUNDLED_SSH_SERVER_VERSION` export, parsed textually (the module is
 *      CommonJS; this file is ESM, so a regex avoids a `createRequire` just for
 *      one constant).
 *   3. A stable fallback version so the client doesn't repeatedly redeploy when
 *      the SDK's files are unreadable — better to run a slightly-stale mock
 *      than hang forever.
 */
export function loadServerVersion(): string {
  for (const dir of candidateSdkDirs()) {
    try {
      const pkgRaw = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* try next */
    }
    try {
      const constantsRaw = fs.readFileSync(path.join(dir, 'lib', 'ZSshConstants.js'), 'utf-8');
      const m = /BUNDLED_SSH_SERVER_VERSION\s*=\s*["']([^"']+)["']/.exec(constantsRaw);
      if (m) return m[1];
    } catch {
      /* try next */
    }
  }
  return '0.0.0';
}

/**
 * Candidate `@zowe/zowex-for-zowe-sdk` package directories, walking upward
 * from this compiled file's location through `node_modules` (mirrors
 * {@link loadChecksums}'s resolution, generalized to the scoped package name).
 */
function candidateSdkDirs(): string[] {
  const candidates: string[] = [];
  try {
    let dir = path.dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 8; i++) {
      candidates.push(path.join(dir, 'node_modules', '@zowe', 'zowex-for-zowe-sdk'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* not URL-resolvable; skip */
  }
  return candidates;
}

function parseChecksums(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]+)\s+(\S+)$/.exec(line.trim());
    if (m) out[m[2]] = m[1];
  }
  return out;
}
