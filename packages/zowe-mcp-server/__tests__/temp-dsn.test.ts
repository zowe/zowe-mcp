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
 * Unit and integration tests for temporary dataset name generation and cleanup (temp-dsn.ts).
 *
 * Covers generateTempDsnPrefix, generateTempDsn, ensureUniquePrefix, ensureUniqueDsn,
 * and deleteDatasetsUnderPrefix with mock backend.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DsnError, validateDsn } from '../src/zos/dsn.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import {
  deleteDatasetsUnderPrefix,
  ensureUniqueDsn,
  ensureUniquePrefix,
  generateTempDsn,
  generateTempDsnPrefix,
} from '../src/zos/temp-dsn.js';

const MAX_DSN_LENGTH = 44;
const SYSTEM_HOST = 'temp-test.example.com';

let mockDir: string;
let backend: FilesystemMockBackend;

beforeAll(async () => {
  mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-temp-dsn-'));
  const config: MockSystemsConfig = {
    systems: [
      {
        host: SYSTEM_HOST,
        port: 443,
        description: 'Temp test',
        credentials: [{ user: 'TMPUSER', password: 'x' }],
      },
    ],
  };
  await fs.writeFile(path.join(mockDir, 'systems.json'), JSON.stringify(config));
  const sysDir = path.join(mockDir, SYSTEM_HOST);
  await fs.mkdir(path.join(sysDir, 'TMPUSER'), { recursive: true });
  backend = new FilesystemMockBackend(mockDir);
});

afterAll(async () => {
  await fs.rm(mockDir, { recursive: true, force: true });
});

describe('generateTempDsnPrefix', () => {
  it('should return a prefix with length <= 44 and valid qualifiers', () => {
    const prefix = generateTempDsnPrefix('USER.TMP');
    expect(prefix.length).toBeLessThanOrEqual(MAX_DSN_LENGTH);
    expect(prefix).toMatch(/^USER\.TMP\.[A-Z0-9]{8}\.[A-Z0-9]{8}$/);
    expect(() => validateDsn(prefix)).not.toThrow();
  });

  it('should include optional suffix', () => {
    const prefix = generateTempDsnPrefix('USER.TMP', 'EXT');
    expect(prefix).toMatch(/^USER\.TMP\.[A-Z0-9]{8}\.[A-Z0-9]{8}\.EXT$/);
    expect(() => validateDsn(prefix)).not.toThrow();
  });

  it('should throw when prefix is empty', () => {
    expect(() => generateTempDsnPrefix('')).toThrow(DsnError);
    expect(() => generateTempDsnPrefix('   ')).toThrow(DsnError);
  });

  it('should produce different values on multiple calls', () => {
    const a = generateTempDsnPrefix('U.TMP');
    const b = generateTempDsnPrefix('U.TMP');
    expect(a).not.toBe(b);
  });
});

describe('generateTempDsn', () => {
  it('should return a full DSN under the given prefix', () => {
    const dsn = generateTempDsn('USER.TMP.A1B2C3D4.E5F6G7H8');
    expect(dsn).toMatch(/^USER\.TMP\.A1B2C3D4\.E5F6G7H8\.[A-Z0-9]{8}$/);
    expect(() => validateDsn(dsn)).not.toThrow();
  });

  it('should use provided qualifier', () => {
    const dsn = generateTempDsn('USER.TMP.X.Y', 'DATA');
    expect(dsn).toBe('USER.TMP.X.Y.DATA');
  });

  it('should throw when prefix is empty', () => {
    expect(() => generateTempDsn('')).toThrow(DsnError);
  });
});

describe('ensureUniquePrefix (integration with mock backend)', () => {
  it('should return a prefix under which no datasets exist', async () => {
    const prefix = await ensureUniquePrefix(backend, SYSTEM_HOST, 'TMPUSER.TMP', 'TMPUSER');
    expect(prefix).toMatch(/^TMPUSER\.TMP\.[A-Z0-9]{8}\.[A-Z0-9]{8}$/);
    const list = await backend.listDatasets(
      SYSTEM_HOST,
      `${prefix}.**`,
      undefined,
      'TMPUSER',
      false
    );
    expect(list).toHaveLength(0);
  });
});

describe('ensureUniqueDsn (integration with mock backend)', () => {
  it('should return a DSN that does not exist on the system', async () => {
    const dsn = await ensureUniqueDsn(backend, SYSTEM_HOST, 'TMPUSER.TMP');
    expect(dsn).toMatch(/^TMPUSER\.TMP\.[A-Z0-9]{8}\.[A-Z0-9]{8}\.[A-Z0-9]{8}$/);
    await expect(backend.getAttributes(SYSTEM_HOST, dsn)).rejects.toThrow();
  });

  it('should accept optional qualifier', async () => {
    const dsn = await ensureUniqueDsn(backend, SYSTEM_HOST, 'TMPUSER.TMP', 'MYDATA');
    expect(dsn).toMatch(/\.MYDATA$/);
  });
});

describe('deleteDatasetsUnderPrefix (integration with mock backend)', () => {
  it('should reject prefix with fewer than 3 qualifiers', async () => {
    await expect(
      deleteDatasetsUnderPrefix(backend, SYSTEM_HOST, 'USER', undefined)
    ).rejects.toThrow(DsnError);
    await expect(
      deleteDatasetsUnderPrefix(backend, SYSTEM_HOST, 'USER.TMP', undefined)
    ).rejects.toThrow(DsnError);
  });

  it('should reject prefix without TMP qualifier', async () => {
    await expect(
      deleteDatasetsUnderPrefix(backend, SYSTEM_HOST, 'USER.OTHER.XXXXXXXX', undefined)
    ).rejects.toThrow(DsnError);
  });

  it('should delete all datasets under a prefix and return list', async () => {
    const prefix = await ensureUniquePrefix(backend, SYSTEM_HOST, 'TMPUSER.TMP', 'TMPUSER');
    const dsn1 = `${prefix}.ONE`;
    const dsn2 = `${prefix}.TWO`;
    await backend.createDataset(
      SYSTEM_HOST,
      dsn1,
      { type: 'PS', recfm: 'FB', lrecl: 80 },
      undefined
    );
    await backend.createDataset(
      SYSTEM_HOST,
      dsn2,
      { type: 'PS', recfm: 'FB', lrecl: 80 },
      undefined
    );
    const listBefore = await backend.listDatasets(
      SYSTEM_HOST,
      `${prefix}.**`,
      undefined,
      'TMPUSER',
      false
    );
    expect(listBefore).toHaveLength(2);

    const { deleted } = await deleteDatasetsUnderPrefix(backend, SYSTEM_HOST, prefix, 'TMPUSER');
    expect(deleted).toHaveLength(2);
    expect(deleted).toContain(dsn1);
    expect(deleted).toContain(dsn2);

    const listAfter = await backend.listDatasets(
      SYSTEM_HOST,
      `${prefix}.**`,
      undefined,
      'TMPUSER',
      false
    );
    expect(listAfter).toHaveLength(0);
  });
});
