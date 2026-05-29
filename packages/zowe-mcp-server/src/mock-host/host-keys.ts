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
 * Host-key resolution for the mock SSH daemon.
 *
 * Goal: give every mockDir on the same user account the **same** fingerprint,
 * so that wiping and re-seeding `~/mock-zos` does not produce a fresh key that
 * makes `ssh` complain about `REMOTE HOST IDENTIFICATION HAS CHANGED`.
 *
 * Resolution order (first hit wins, falls through otherwise):
 *   1. `opts.keyFile` — explicit override (e.g. `--host-key /path`).
 *   2. `ZOWE_MCP_MOCK_HOST_KEY` env var.
 *   3. `<mockDir>/_ssh/host_key` — per-mock-dir copy.
 *   4. `<userCache>/mock-host_key` — machine-stable cache (`$ZOWE_MCP_HOME` or
 *      `~/.zowe-mcp/`). If present, copied into the mockDir for traceability.
 *   5. Generated fresh: RSA-3072, saved to BOTH the machine cache and the
 *      mockDir, so the fingerprint stays the same forever after on this user
 *      account.
 *
 * Different machines (or different OS user accounts) get different keys
 * automatically because the cache is under `~`. To share a key across machines
 * point all of them at the same file via `--host-key` / `ZOWE_MCP_MOCK_HOST_KEY`.
 */

import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Path to the per-mockDir copy of the host key. */
export function hostKeyPath(mockDir: string): string {
  return path.join(mockDir, '_ssh', 'host_key');
}

/** Path to the machine-stable cache (per OS user). */
export function machineCacheKeyPath(): string {
  const explicit = process.env.ZOWE_MCP_HOME?.trim();
  const base = explicit && explicit.length > 0 ? explicit : path.join(os.homedir(), '.zowe-mcp');
  return path.join(base, 'mock-host_key');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readKey(p: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(p);
  } catch {
    return undefined;
  }
}

interface KeyGenOpts {
  /** Force re-generation even if a key exists. */
  force?: boolean;
  /** Skip the user-cache lookup; always use the per-mockDir copy. */
  isolateToMockDir?: boolean;
  /** Explicit key file path (highest priority). */
  keyFile?: string;
}

/**
 * Ensure a host key exists for this mockDir, returning its filesystem path.
 *
 * - `keyFile` (or `ZOWE_MCP_MOCK_HOST_KEY`) → returned directly, nothing written.
 * - Otherwise: prefer `<mockDir>/_ssh/host_key`, fall back to the machine cache,
 *   else generate fresh and persist to both locations.
 * - `force=true` always regenerates, replacing both copies.
 */
export async function generateAndPersistHostKey(
  mockDir: string,
  opts: KeyGenOpts = {}
): Promise<string> {
  const explicit = (opts.keyFile ?? process.env.ZOWE_MCP_MOCK_HOST_KEY ?? '').trim();
  if (explicit) {
    if (!(await pathExists(explicit))) {
      throw new Error(
        `Host key file not found: ${explicit}\n` + `(set via --host-key or ZOWE_MCP_MOCK_HOST_KEY)`
      );
    }
    return explicit;
  }

  const localKey = hostKeyPath(mockDir);
  const localPub = `${localKey}.pub`;
  await fs.mkdir(path.dirname(localKey), { recursive: true });

  if (opts.force) {
    return generateFreshKey(localKey, localPub, !opts.isolateToMockDir);
  }
  if (await pathExists(localKey)) {
    return localKey;
  }
  // Machine cache — copy in to keep the per-mock-dir layout self-contained.
  if (!opts.isolateToMockDir) {
    const cachePath = machineCacheKeyPath();
    const cached = await readKey(cachePath);
    if (cached) {
      await fs.writeFile(localKey, cached, { mode: 0o600 });
      const cachedPub = await readKey(`${cachePath}.pub`);
      if (cachedPub) await fs.writeFile(localPub, cachedPub, { mode: 0o644 });
      return localKey;
    }
  }
  return generateFreshKey(localKey, localPub, !opts.isolateToMockDir);
}

async function generateFreshKey(
  localKey: string,
  localPub: string,
  alsoSaveToMachineCache: boolean
): Promise<string> {
  // ssh2's parseKey accepts PKCS#1 ("BEGIN RSA PRIVATE KEY") and OpenSSH formats —
  // PKCS#8 ("BEGIN PRIVATE KEY") is not supported. Use PKCS#1.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  await fs.writeFile(localKey, privateKey, { mode: 0o600 });
  await fs.writeFile(localPub, publicKey, { mode: 0o644 });

  if (alsoSaveToMachineCache) {
    try {
      const cachePath = machineCacheKeyPath();
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, privateKey, { mode: 0o600 });
      await fs.writeFile(`${cachePath}.pub`, publicKey, { mode: 0o644 });
    } catch {
      // Cache failure is non-fatal — we still wrote the per-mockDir copy.
    }
  }
  return localKey;
}

/**
 * Read the active host key as a Buffer, generating/copying it lazily if needed.
 *
 * @param mockDir per-mockDir layout root
 * @param opts optional overrides (`keyFile`, `force`, `isolateToMockDir`)
 */
export async function loadOrCreateHostKey(
  mockDir: string,
  opts: KeyGenOpts = {}
): Promise<Buffer> {
  const keyPath = await generateAndPersistHostKey(mockDir, opts);
  return fs.readFile(keyPath);
}
