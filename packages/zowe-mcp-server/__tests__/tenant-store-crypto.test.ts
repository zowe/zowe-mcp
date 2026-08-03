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

import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTenantStoreEncryptionKeyCacheForTests,
  decryptTenantFileToUtf8,
  encryptTenantJsonUtf8,
} from '../src/persistence/tenant-store-crypto.js';

describe('tenant-store-crypto', () => {
  afterEach(() => {
    delete process.env.ZOWE_MCP_TENANT_STORE_KEY;
    clearTenantStoreEncryptionKeyCacheForTests();
  });

  it('round-trips JSON when key is 64 hex chars', () => {
    process.env.ZOWE_MCP_TENANT_STORE_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    clearTenantStoreEncryptionKeyCacheForTests();
    const plain = '{"systems":["u@h"],"updatedAt":"2020-01-01T00:00:00.000Z"}\n';
    const buf = encryptTenantJsonUtf8(plain);
    expect(buf.subarray(0, 8).toString('utf8')).toBe('ZMTENC1\n');
    expect(decryptTenantFileToUtf8(buf)).toBe(plain);
  });

  it('encryptTenantJsonUtf8 passes through when key unset', () => {
    const plain = '{"x":1}\n';
    const buf = encryptTenantJsonUtf8(plain);
    expect(buf.toString('utf8')).toBe(plain);
  });

  describe('passphrase key with per-deployment salt', () => {
    let storeDir: string;

    afterEach(() => {
      rmSync(storeDir, { recursive: true, force: true });
    });

    it('round-trips with a passphrase and creates a random salt file', () => {
      storeDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-store-'));
      process.env.ZOWE_MCP_TENANT_STORE_KEY = 'correct horse battery staple';
      clearTenantStoreEncryptionKeyCacheForTests();
      const plain = '{"systems":["u@h"]}\n';
      const buf = encryptTenantJsonUtf8(plain, storeDir);
      expect(buf.subarray(0, 8).toString('utf8')).toBe('ZMTENC1\n');
      expect(decryptTenantFileToUtf8(buf, storeDir)).toBe(plain);
      const saltPath = join(storeDir, '.tenant-store-salt');
      expect(existsSync(saltPath)).toBe(true);
      expect(readFileSync(saltPath).length).toBeGreaterThanOrEqual(16);
    });

    it.skipIf(process.platform === 'win32')('creates the salt file with mode 0600', () => {
      storeDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-store-'));
      process.env.ZOWE_MCP_TENANT_STORE_KEY = 'correct horse battery staple';
      clearTenantStoreEncryptionKeyCacheForTests();
      encryptTenantJsonUtf8('{"systems":[]}\n', storeDir);
      const saltPath = join(storeDir, '.tenant-store-salt');
      expect(statSync(saltPath).mode & 0o777).toBe(0o600);
    });

    it('different deployments derive different keys from the same passphrase', () => {
      storeDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-store-'));
      const otherDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-store-'));
      try {
        process.env.ZOWE_MCP_TENANT_STORE_KEY = 'shared passphrase';
        clearTenantStoreEncryptionKeyCacheForTests();
        const plain = '{"systems":[]}\n';
        const encA = encryptTenantJsonUtf8(plain, storeDir);
        // A ciphertext from deployment A must not decrypt under deployment B's salt
        // (B has no legacy-format files, so the legacy fallback also fails).
        expect(() => decryptTenantFileToUtf8(encA, otherDir)).toThrow();
      } finally {
        rmSync(otherDir, { recursive: true, force: true });
      }
    });

    it('still reads files written with the legacy constant salt', () => {
      storeDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-store-'));
      process.env.ZOWE_MCP_TENANT_STORE_KEY = 'legacy passphrase';
      clearTenantStoreEncryptionKeyCacheForTests();
      // Simulate a pre-upgrade file: build the legacy ciphertext with the constant salt.
      const legacyKey = scryptSync(
        'legacy passphrase',
        Buffer.from('zowe-mcp-tenant-store', 'utf8'),
        32
      );
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', legacyKey, iv);
      const plain = '{"systems":["old@host"]}\n';
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const legacyFile = Buffer.concat([
        Buffer.from('ZMTENC1\n', 'utf8'),
        iv,
        cipher.getAuthTag(),
        enc,
      ]);
      expect(decryptTenantFileToUtf8(legacyFile, storeDir)).toBe(plain);
    });
  });
});
