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
 * Helpers to spin up the z/OS-side test doubles the e2e scenarios need:
 *   - the filesystem mock data directory (`init-mock`), and
 *   - the mock z/OS SSH host daemon (`mock-zos start`), both via the real
 *     `zowe-mcp-server` CLI (dist build) as child processes — this exercises
 *     the exact code paths the shipped extension/server use, not a
 *     re-implementation.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolves the built zowe-mcp-server CLI entrypoint (dist/index.js), building it first if missing. */
export function resolveServerCliPath(): string {
  const serverPkgDir = path.resolve(__dirname, '..', '..', 'zowe-mcp-server');
  const cli = path.join(serverPkgDir, 'dist', 'index.js');
  if (!fs.existsSync(cli)) {
    throw new Error(
      `zowe-mcp-server is not built: ${cli} does not exist. Run "npm run build -w @zowe/mcp-server" first.`
    );
  }
  return cli;
}

/** Generates a filesystem mock data directory via `init-mock --output <dir> --preset default`. Synchronous; fast. */
export function initFilesystemMock(outputDir: string, preset = 'default'): void {
  const cli = resolveServerCliPath();
  const result = spawnSync(
    process.execPath,
    [cli, 'init-mock', '--output', outputDir, '--preset', preset],
    {
      encoding: 'utf8',
      timeout: 60_000,
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `init-mock failed (status ${String(result.status)}):\n${result.stdout}\n${result.stderr}`
    );
  }
}

export interface MockZosHandle {
  process: ChildProcess;
  mockDir: string;
  host: string;
  port: number;
  logPath: string;
  stop(): Promise<void>;
}

export interface ThrowawaySshKeypair {
  privateKeyPath: string;
  publicKeyPath: string;
  /** The public key line (e.g. "ssh-ed25519 AAAA... comment"), ready to drop into a users.json `authorizedKeys` array. */
  publicKey: string;
}

/**
 * Generates a throwaway ed25519 keypair via the system `ssh-keygen` binary
 * (present on macOS/Linux by default) into `dir` (caller's scratch dir —
 * never `~/.ssh`). Used so the mock z/OS SSH host's key-auth path can be
 * exercised end-to-end (see `authorizeSshKeyForUser`) without ever touching
 * the real user's SSH keys.
 */
export function generateThrowawaySshKeypair(dir: string): ThrowawaySshKeypair {
  const privateKeyPath = path.join(dir, 'id_e2e_throwaway');
  fs.rmSync(privateKeyPath, { force: true });
  fs.rmSync(`${privateKeyPath}.pub`, { force: true });
  const keygenBin = process.env.VSCODE_E2E_SSH_KEYGEN ?? 'ssh-keygen';
  const result = spawnSync(
    keygenBin,
    ['-t', 'ed25519', '-N', '', '-C', 'zowe-mcp-e2e-throwaway', '-f', privateKeyPath],
    { encoding: 'utf8', timeout: 15_000 }
  );
  if (result.status !== 0) {
    throw new Error(
      `ssh-keygen failed (status ${String(result.status)}):\n${result.stdout}\n${result.stderr}`
    );
  }
  const publicKeyPath = `${privateKeyPath}.pub`;
  return {
    privateKeyPath,
    publicKeyPath,
    publicKey: fs.readFileSync(publicKeyPath, 'utf8').trim(),
  };
}

/**
 * Adds `publicKey` to `<mockDir>/_ssh/users.json`'s `authorizedKeys` for
 * `username`. Must be called AFTER `mock-zos gen-fixtures` (which writes
 * the file) and BEFORE `mock-zos start` (which reads it once at startup).
 */
export function authorizeSshKeyForUser(
  mockDir: string,
  username: string,
  publicKey: string
): void {
  const usersPath = path.join(mockDir, '_ssh', 'users.json');
  const parsed = JSON.parse(fs.readFileSync(usersPath, 'utf8')) as {
    users: { username: string; authorizedKeys?: string[] }[];
  };
  const user = parsed.users.find(u => u.username === username);
  if (!user) {
    throw new Error(`authorizeSshKeyForUser: no user "${username}" in ${usersPath}`);
  }
  user.authorizedKeys = [...(user.authorizedKeys ?? []), publicKey];
  fs.writeFileSync(usersPath, JSON.stringify(parsed, null, 2));
}

/** Reads a file if it exists, returning `fallback` on ENOENT (avoids a check-then-read TOCTOU). */
function readFileIfExists(filePath: string, fallback: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }
}

/**
 * Starts the mock z/OS SSH daemon (`mock-zos start`) as a detached child
 * process on an ephemeral port, after seeding fixtures with `gen-fixtures`.
 * Resolves once the "SSH    listening on host:port" line appears in its log.
 *
 * When `sshKeyForUser` is given, a throwaway keypair is generated and
 * authorized for that user BEFORE the daemon starts (so key-based auth is
 * available from the first connection) — the caller is responsible for
 * pointing the MCP server at the resulting private key via the
 * `ZOWE_MCP_PRIVATE_KEY_<USER>_<HOST>` env var (see
 * `packages/zowe-mcp-server/src/zos/native/connection-spec.ts`'s
 * `toPrivateKeyEnvVarName`); the returned handle exposes `sshKey` for that.
 */
export async function startMockZosDaemon(opts: {
  mockDir?: string;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  timeoutMs?: number;
  /** Generate + authorize a throwaway SSH keypair for this username before starting the daemon. */
  sshKeyForUser?: string;
}): Promise<MockZosHandle & { sshKey?: ThrowawaySshKeypair }> {
  const cli = resolveServerCliPath();
  const mockDir = opts.mockDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-mcp-e2e-mockzos-'));

  const genResult = spawnSync(
    process.execPath,
    [cli, 'mock-zos', 'gen-fixtures', '--mock-dir', mockDir],
    {
      encoding: 'utf8',
      timeout: 30_000,
    }
  );
  if (genResult.status !== 0) {
    throw new Error(`mock-zos gen-fixtures failed:\n${genResult.stdout}\n${genResult.stderr}`);
  }

  let sshKey: ThrowawaySshKeypair | undefined;
  if (opts.sshKeyForUser) {
    sshKey = generateThrowawaySshKeypair(mockDir);
    authorizeSshKeyForUser(mockDir, opts.sshKeyForUser, sshKey.publicKey);
  }

  const logPath = path.join(mockDir, 'mock-zos.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(
    process.execPath,
    [
      cli,
      'mock-zos',
      'start',
      '--mock-dir',
      mockDir,
      '--port',
      '0',
      '--log-level',
      opts.logLevel ?? 'info',
    ],
    { stdio: ['ignore', logFd, logFd] }
  );

  const timeoutMs = opts.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let host: string | undefined;
  let port: number | undefined;
  while (Date.now() < deadline) {
    const content = readFileIfExists(logPath, '');
    const m = /SSH\s+listening on ([\d.]+):(\d+)/.exec(content);
    if (m) {
      host = m[1];
      port = Number(m[2]);
      break;
    }
    if (child.exitCode !== null) {
      throw new Error(`mock-zos start exited early (code ${String(child.exitCode)}):\n${content}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!host || !port) {
    child.kill('SIGKILL');
    throw new Error(
      `Timed out after ${String(timeoutMs)}ms waiting for mock-zos SSH listener.\nLog:\n${readFileIfExists(logPath, '(no log)')}`
    );
  }

  const stop = (): Promise<void> =>
    new Promise(resolve => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });
      child.kill('SIGTERM');
    });

  return { process: child, mockDir, host, port, logPath, stop, sshKey };
}
