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
 * Optional AES-256-GCM encryption for tenant connection JSON files.
 * Key: {@link ZOWE_MCP_TENANT_STORE_KEY} (64 hex chars or 43+ char base64 for 32 bytes,
 * or any other string treated as a passphrase). Passphrases are stretched with scrypt
 * using a random per-deployment salt persisted next to the store (`.tenant-store-salt`,
 * mode 0600), so precomputed dictionaries built against a public constant salt are useless.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAGIC = Buffer.from('ZMTENC1\n', 'utf8');
const SALT_FILE = '.tenant-store-salt';
/** Salt used by releases before the per-deployment salt file existed; decrypt fallback only. */
const LEGACY_SALT = Buffer.from('zowe-mcp-tenant-store', 'utf8');

interface EnvKeyMaterial {
  /** Full-strength key (hex/base64 forms). */
  key?: Buffer;
  /** Passphrase needing scrypt stretching with the per-store salt. */
  passphrase?: string;
}

function parseKeyMaterialFromEnv(): EnvKeyMaterial | undefined {
  const raw = process.env.ZOWE_MCP_TENANT_STORE_KEY?.trim();
  if (!raw) {
    return undefined;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return { key: Buffer.from(raw, 'hex') };
  }
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) {
      return { key: b };
    }
  } catch {
    /* fall through */
  }
  return { passphrase: raw };
}

function loadOrCreateStoreSalt(storeDir: string): Buffer {
  const path = join(storeDir, SALT_FILE);
  try {
    const existing = readFileSync(path);
    if (existing.length >= 16) {
      return existing;
    }
  } catch {
    /* create below */
  }
  const salt = randomBytes(16);
  mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, salt, { mode: 0o600 });
  return salt;
}

/** Cache: raw env key under '', passphrase-derived keys per store dir. */
const cachedKeys = new Map<string, Buffer | null>();

/** Test helper: reset cached keys after changing env. */
export function clearTenantStoreEncryptionKeyCacheForTests(): void {
  cachedKeys.clear();
}

/**
 * Resolves the AES-256 key. `storeDir` is required to stretch a passphrase (per-store salt);
 * without it a passphrase-form key resolves to undefined (callers always have the dir).
 */
export function tenantStoreEncryptionKey(storeDir?: string): Buffer | undefined {
  const cacheId = storeDir ?? '';
  const hit = cachedKeys.get(cacheId);
  if (hit !== undefined) {
    return hit ?? undefined;
  }
  const material = parseKeyMaterialFromEnv();
  let key: Buffer | null;
  if (!material) {
    key = null;
  } else if (material.key) {
    key = material.key;
  } else if (material.passphrase !== undefined && storeDir) {
    key = scryptSync(material.passphrase, loadOrCreateStoreSalt(storeDir), 32);
  } else {
    key = null;
  }
  cachedKeys.set(cacheId, key);
  return key ?? undefined;
}

/** Legacy constant-salt key for reading stores written before the per-deployment salt. */
function legacyPassphraseKey(): Buffer | undefined {
  const material = parseKeyMaterialFromEnv();
  if (material?.passphrase === undefined) {
    return undefined;
  }
  return scryptSync(material.passphrase, LEGACY_SALT, 32);
}

export function encryptTenantJsonUtf8(plainUtf8: string, storeDir?: string): Buffer {
  const key = tenantStoreEncryptionKey(storeDir);
  if (!key) {
    return Buffer.from(plainUtf8, 'utf8');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainUtf8, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

function decryptWithKey(data: Buffer, key: Buffer): string {
  const iv = data.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = data.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const enc = data.subarray(MAGIC.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function decryptTenantFileToUtf8(data: Buffer, storeDir?: string): string {
  if (data.length < MAGIC.length || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    return data.toString('utf8');
  }
  const key = tenantStoreEncryptionKey(storeDir);
  if (!key) {
    throw new Error(
      'Tenant store file is encrypted but ZOWE_MCP_TENANT_STORE_KEY is not set or invalid'
    );
  }
  try {
    return decryptWithKey(data, key);
  } catch (e) {
    // Files written by older releases used a constant scrypt salt; the next write
    // re-encrypts with the per-deployment salt.
    const legacy = legacyPassphraseKey();
    if (legacy) {
      return decryptWithKey(data, legacy);
    }
    throw e;
  }
}
