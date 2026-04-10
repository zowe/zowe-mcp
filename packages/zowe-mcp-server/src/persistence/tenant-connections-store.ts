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
 * Durable per-OIDC-sub z/OS connection list for shared HTTP deployments.
 *
 * When `ZOWE_MCP_TENANT_STORE_DIR` is set, each JWT `sub` has a JSON file with `user@host`
 * strings (written when **`addZosConnection`** runs; removed when **`removeZosConnection`** runs). Startup **`--config` / `--system`** lists
 * are merged for that tenant (intended for testing/bootstrap, not primary production config).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatNormalizedConnectionSpec } from '../zos/native/connection-spec.js';
import { decryptTenantFileToUtf8, encryptTenantJsonUtf8 } from './tenant-store-crypto.js';

export interface TenantConnectionsFile {
  /** Connection specs (same format as native config `systems`). */
  systems: string[];
  /** ISO timestamp when last written. */
  updatedAt?: string;
}

/** Directory from `ZOWE_MCP_TENANT_STORE_DIR`, or undefined to disable persistence. */
export function tenantStoreDirFromEnv(): string | undefined {
  const d = process.env.ZOWE_MCP_TENANT_STORE_DIR?.trim();
  return d && d.length > 0 ? d : undefined;
}

/** Filesystem-safe file base name derived from OIDC subject (no PII in filename). */
export function tenantFileBaseFromSub(sub: string): string {
  const h = createHash('sha256').update(sub, 'utf8').digest('hex');
  return `tenant-${h.slice(0, 32)}`;
}

function tenantFilePath(storeDir: string, sub: string): string {
  return join(storeDir, `${tenantFileBaseFromSub(sub)}.json`);
}

export function loadTenantSystems(storeDir: string, sub: string): string[] {
  const path = tenantFilePath(storeDir, sub);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const buf = readFileSync(path);
    const raw = decryptTenantFileToUtf8(buf);
    const data = JSON.parse(raw) as TenantConnectionsFile;
    if (!data || !Array.isArray(data.systems)) {
      return [];
    }
    return data.systems.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  } catch {
    return [];
  }
}

export function saveTenantSystems(storeDir: string, sub: string, systems: string[]): void {
  mkdirSync(storeDir, { recursive: true });
  const path = tenantFilePath(storeDir, sub);
  const payload: TenantConnectionsFile = {
    systems: [...new Set(systems.map(s => s.trim()).filter(Boolean))],
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const out = encryptTenantJsonUtf8(body);
  writeFileSync(tmp, out);
  renameSync(tmp, path);
}

/** Append one connection spec if not already present, then save. */
export function appendTenantSystem(storeDir: string, sub: string, spec: string): void {
  const s = spec.trim();
  if (!s) {
    return;
  }
  const existing = loadTenantSystems(storeDir, sub);
  if (existing.includes(s)) {
    return;
  }
  saveTenantSystems(storeDir, sub, [...existing, s]);
}

/**
 * Removes one connection spec from the tenant file (matches by normalized form, e.g. user@host vs user@host:22).
 * @returns true if a row was removed
 */
export function removeTenantSystem(storeDir: string, sub: string, spec: string): boolean {
  const target = formatNormalizedConnectionSpec(spec);
  const existing = loadTenantSystems(storeDir, sub);
  const filtered = existing.filter(entry => {
    try {
      return formatNormalizedConnectionSpec(entry) !== target;
    } catch {
      return true;
    }
  });
  if (filtered.length === existing.length) {
    return false;
  }
  saveTenantSystems(storeDir, sub, filtered);
  return true;
}
