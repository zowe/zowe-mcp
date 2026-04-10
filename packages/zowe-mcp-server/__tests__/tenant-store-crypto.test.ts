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
});
