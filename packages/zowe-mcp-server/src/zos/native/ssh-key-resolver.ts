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
 * Resolves an SSH private key for a connection by leveraging the workstation's
 * existing SSH setup — no Zowe MCP configuration required.
 *
 * Resolution order (first match wins):
 *   1. Explicit env override `ZOWE_MCP_PRIVATE_KEY_<USER>_<HOST>` (power users).
 *   2. `~/.ssh/config` entry whose `Host` alias or `HostName` matches the host,
 *      using its `IdentityFile` (via `SshConfigUtils.migrateSshConfig`).
 *   3. Default identity files in `~/.ssh` (`id_ed25519`, `id_rsa`, `id_ecdsa`,
 *      `id_dsa`) via `SshConfigUtils.findPrivateKeys`.
 *
 * Returns `undefined` when no readable key is found, so callers fall back to the
 * password flow with zero regression for password-only users.
 *
 * NOTE: only key *file paths* are supported in v1. ssh-agent (`SSH_AUTH_SOCK`)
 * is not used because the zowex-sdk `buildSshConfig` does not wire it up.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import ssh2 from 'ssh2';
import { SshConfigUtils } from 'zowex-sdk';
import { getLogger } from '../../server.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { toKeyPassphraseEnvVarName, toPrivateKeyEnvVarName } from './connection-spec.js';

const log = getLogger().child('native.sshkey');

/** Subset of a `~/.ssh/config` host entry returned by SshConfigUtils.migrateSshConfig. */
export interface SshConfigEntry {
  /** The `Host` alias. */
  name?: string;
  /** The resolved `HostName`. */
  hostname?: string;
  /** The `IdentityFile` path, if any. */
  privateKey?: string;
}

/** A resolved private key: the file path and whether it is passphrase-protected. */
export interface ResolvedSshKey {
  /** Absolute path to the private key file. */
  privateKeyPath: string;
  /** True when the key is encrypted and needs a passphrase to be used. */
  encrypted: boolean;
}

/** Injectable dependencies so the resolver can be unit-tested without touching the real ~/.ssh. */
export interface SshKeyResolverDeps {
  /** Reads an environment variable (default: process.env lookup). */
  getEnv: (name: string) => string | undefined;
  /** Returns `~/.ssh/config` host entries (default: SshConfigUtils.migrateSshConfig). */
  loadSshConfigEntries: () => Promise<SshConfigEntry[]>;
  /** Returns default identity-file paths in ~/.ssh (default: SshConfigUtils.findPrivateKeys). */
  loadDefaultKeyPaths: () => Promise<string[]>;
  /** Reads a key file's contents as UTF-8 (default: fs.readFileSync). */
  readKeyFile: (keyPath: string) => string;
  /** Home directory for `~` expansion (default: os.homedir()). */
  home: () => string;
}

const defaultDeps: SshKeyResolverDeps = {
  getEnv: name => process.env[name],
  loadSshConfigEntries: () => SshConfigUtils.migrateSshConfig(),
  loadDefaultKeyPaths: () => SshConfigUtils.findPrivateKeys(),
  readKeyFile: keyPath => readFileSync(keyPath, 'utf-8'),
  home: () => homedir(),
};

/** Expands a leading `~` to the home directory. */
function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

/**
 * Returns whether a private key file is passphrase-protected.
 * Uses ssh2's key parser: an encrypted key with no passphrase yields an Error
 * whose message mentions "encrypted" / "passphrase".
 * A key that cannot be parsed at all (malformed) is reported as `undefined`.
 */
export function classifyKeyEncryption(keyContent: string): boolean | undefined {
  const parsed = ssh2.utils.parseKey(keyContent);
  if (parsed instanceof Error) {
    if (/passphrase|encrypted/i.test(parsed.message)) return true;
    return undefined; // unparseable / unsupported — not a usable key
  }
  return false;
}

/** Returns true if `passphrase` successfully decrypts the key (validated via ssh2). */
export function isPassphraseValid(keyContent: string, passphrase: string): boolean {
  const parsed = ssh2.utils.parseKey(keyContent, passphrase);
  return !(parsed instanceof Error);
}

/**
 * Resolves a usable private key for the given connection spec, or `undefined`
 * when no readable key is found (caller should fall back to password auth).
 */
export async function resolveSshKey(
  spec: ParsedConnectionSpec,
  deps: Partial<SshKeyResolverDeps> = {}
): Promise<ResolvedSshKey | undefined> {
  const d: SshKeyResolverDeps = { ...defaultDeps, ...deps };

  const candidate = await resolveKeyPath(spec, d);
  if (!candidate) return undefined;

  let content: string;
  try {
    content = d.readKeyFile(candidate.path);
  } catch (err) {
    log.debug('SSH key file unreadable; skipping', {
      host: spec.host,
      user: spec.user,
      source: candidate.source,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  const encrypted = classifyKeyEncryption(content);
  if (encrypted === undefined) {
    log.debug('SSH key file is not a usable private key; skipping', {
      host: spec.host,
      user: spec.user,
      keyFile: path.basename(candidate.path),
      source: candidate.source,
    });
    return undefined;
  }

  log.debug('Resolved SSH private key for connection', {
    host: spec.host,
    user: spec.user,
    keyFile: path.basename(candidate.path),
    source: candidate.source,
    encrypted,
  });
  return { privateKeyPath: candidate.path, encrypted };
}

/** Returns the passphrase configured via env override, if any. */
export function getKeyPassphraseFromEnv(
  spec: ParsedConnectionSpec,
  deps: Partial<SshKeyResolverDeps> = {}
): string | undefined {
  const getEnv = deps.getEnv ?? defaultDeps.getEnv;
  const value = getEnv(toKeyPassphraseEnvVarName(spec.user, spec.host));
  return value !== undefined && value !== '' ? value : undefined;
}

interface KeyCandidate {
  path: string;
  source: 'env' | 'ssh-config' | 'default';
}

/** Finds a candidate private key path (without reading/parsing it). */
async function resolveKeyPath(
  spec: ParsedConnectionSpec,
  d: SshKeyResolverDeps
): Promise<KeyCandidate | undefined> {
  // 1. Explicit env override.
  const envPath = d.getEnv(toPrivateKeyEnvVarName(spec.user, spec.host));
  if (envPath !== undefined && envPath !== '') {
    return { path: expandHome(envPath, d.home()), source: 'env' };
  }

  // 2. ~/.ssh/config IdentityFile for a matching host.
  try {
    const entries = await d.loadSshConfigEntries();
    const match = entries.find(
      e =>
        e.privateKey !== undefined &&
        e.privateKey !== '' &&
        (e.name?.toLowerCase() === spec.host || e.hostname?.toLowerCase() === spec.host)
    );
    if (match?.privateKey) {
      return { path: expandHome(match.privateKey, d.home()), source: 'ssh-config' };
    }
  } catch (err) {
    log.debug('Reading ~/.ssh/config failed; skipping', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Default identity files.
  try {
    const defaults = await d.loadDefaultKeyPaths();
    if (defaults.length > 0) {
      return { path: defaults[0], source: 'default' };
    }
  } catch (err) {
    log.debug('Listing default SSH keys failed; skipping', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return undefined;
}
