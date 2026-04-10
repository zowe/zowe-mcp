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
 * Key: {@link ZOWE_MCP_TENANT_STORE_KEY} (64 hex chars or 43+ char base64 for 32 bytes).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = Buffer.from('ZMTENC1\n', 'utf8');

function parseKeyFromEnv(): Buffer | undefined {
  const raw = process.env.ZOWE_MCP_TENANT_STORE_KEY?.trim();
  if (!raw) {
    return undefined;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) {
      return b;
    }
  } catch {
    /* fall through */
  }
  const pass = raw;
  const salt = Buffer.from('zowe-mcp-tenant-store', 'utf8');
  return scryptSync(pass, salt, 32);
}

let cachedKey: Buffer | undefined | null;

/** Test helper: reset cached key after changing env. */
export function clearTenantStoreEncryptionKeyCacheForTests(): void {
  cachedKey = undefined;
}

export function tenantStoreEncryptionKey(): Buffer | undefined {
  if (cachedKey === null) {
    return undefined;
  }
  if (cachedKey !== undefined) {
    return cachedKey;
  }
  const k = parseKeyFromEnv();
  cachedKey = k ?? null;
  return k;
}

export function encryptTenantJsonUtf8(plainUtf8: string): Buffer {
  const key = tenantStoreEncryptionKey();
  if (!key) {
    return Buffer.from(plainUtf8, 'utf8');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainUtf8, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

export function decryptTenantFileToUtf8(data: Buffer): string {
  if (data.length < MAGIC.length || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    return data.toString('utf8');
  }
  const key = tenantStoreEncryptionKey();
  if (!key) {
    throw new Error(
      'Tenant store file is encrypted but ZOWE_MCP_TENANT_STORE_KEY is not set or invalid'
    );
  }
  const iv = data.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = data.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const enc = data.subarray(MAGIC.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
