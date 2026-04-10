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

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendTenantSystem,
  loadTenantConnectionsFile,
  loadTenantJobCards,
  loadTenantSystems,
  mergeTenantJobCard,
  removeTenantSystem,
  saveTenantSystems,
  tenantFileBaseFromSub,
} from '../src/persistence/tenant-connections-store.js';

describe('tenant-connections-store', () => {
  let dir: string;
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tenantFileBaseFromSub is stable and filesystem-safe', () => {
    const a = tenantFileBaseFromSub('user|oidc|sub');
    const b = tenantFileBaseFromSub('user|oidc|sub');
    expect(a).toBe(b);
    expect(a).toMatch(/^tenant-[a-f0-9]{32}$/);
  });

  it('save/load round-trip', () => {
    dir = mkdtempSync(join(tmpdir(), 'zowe-mcp-tenant-'));
    const sub = 'test-sub-123';
    saveTenantSystems(dir, sub, ['a@host1.example.com', 'b@host2.example.com:2022']);
    const loaded = loadTenantSystems(dir, sub);
    expect(loaded).toEqual(['a@host1.example.com', 'b@host2.example.com:2022']);
  });

  it('removeTenantSystem removes by normalized form', () => {
    dir = mkdtempSync(join(tmpdir(), 'zowe-mcp-tenant-'));
    const sub = 'sub-rem';
    saveTenantSystems(dir, sub, ['a@h.example.com', 'b@h.example.com:2022']);
    expect(removeTenantSystem(dir, sub, 'a@h.example.com')).toBe(true);
    expect(loadTenantSystems(dir, sub)).toEqual(['b@h.example.com:2022']);
    expect(removeTenantSystem(dir, sub, 'a@h.example.com')).toBe(false);
  });

  it('appendTenantSystem dedupes', () => {
    dir = mkdtempSync(join(tmpdir(), 'zowe-mcp-tenant-'));
    const sub = 's';
    appendTenantSystem(dir, sub, 'u@h');
    appendTenantSystem(dir, sub, 'u@h');
    appendTenantSystem(dir, sub, 'v@h');
    expect(loadTenantSystems(dir, sub)).toEqual(['u@h', 'v@h']);
  });

  it('writes pretty JSON with updatedAt', () => {
    dir = mkdtempSync(join(tmpdir(), 'zowe-mcp-tenant-'));
    const sub = 's2';
    saveTenantSystems(dir, sub, ['x@y']);
    const path = join(dir, `${tenantFileBaseFromSub(sub)}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      systems: string[];
      updatedAt?: string;
    };
    expect(raw.systems).toEqual(['x@y']);
    expect(raw.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('mergeTenantJobCard preserves systems and merges jobCards', () => {
    dir = mkdtempSync(join(tmpdir(), 'zowe-mcp-tenant-'));
    const sub = 'sub-jc';
    saveTenantSystems(dir, sub, ['u@h.example.com']);
    mergeTenantJobCard(dir, sub, 'u@h.example.com:2222', '//MYJOB JOB\n');
    const file = loadTenantConnectionsFile(dir, sub);
    expect(file?.systems).toEqual(['u@h.example.com']);
    expect(file?.jobCards?.['u@h.example.com:2222']).toBe('//MYJOB JOB');
    const loaded = loadTenantJobCards(dir, sub);
    expect(loaded?.['u@h.example.com:2222']).toBe('//MYJOB JOB');
  });

  it('saveTenantSystems preserves existing jobCards', () => {
    dir = mkdtempSync(join(tmpdir(), 'zowe-mcp-tenant-'));
    const sub = 'sub-preserve';
    mergeTenantJobCard(dir, sub, 'a@b', '//J1');
    saveTenantSystems(dir, sub, ['a@b', 'c@d']);
    const file = loadTenantConnectionsFile(dir, sub);
    expect(file?.systems).toEqual(['a@b', 'c@d']);
    expect(file?.jobCards?.['a@b']).toBe('//J1');
  });
});
