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
  /** Optional per-connection job card text (same keys as native `jobCards`). */
  jobCards?: Record<string, string>;
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

/**
 * Loads the full tenant JSON (systems + optional jobCards). Returns null if missing or invalid.
 */
export function loadTenantConnectionsFile(
  storeDir: string,
  sub: string
): TenantConnectionsFile | null {
  const path = tenantFilePath(storeDir, sub);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const buf = readFileSync(path);
    const raw = decryptTenantFileToUtf8(buf);
    const data = JSON.parse(raw) as TenantConnectionsFile;
    if (!data || !Array.isArray(data.systems)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeTenantConnectionsFile(
  storeDir: string,
  sub: string,
  payload: TenantConnectionsFile
): void {
  mkdirSync(storeDir, { recursive: true });
  const path = tenantFilePath(storeDir, sub);
  const outPayload: TenantConnectionsFile = {
    ...payload,
    systems: [...new Set(payload.systems.map(s => s.trim()).filter(Boolean))],
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(outPayload, null, 2)}\n`;
  const out = encryptTenantJsonUtf8(body);
  writeFileSync(tmp, out);
  renameSync(tmp, path);
}

export function loadTenantSystems(storeDir: string, sub: string): string[] {
  const data = loadTenantConnectionsFile(storeDir, sub);
  if (!data) {
    return [];
  }
  return data.systems.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

/** Returns persisted job cards for a tenant, or undefined if none. */
export function loadTenantJobCards(
  storeDir: string,
  sub: string
): Record<string, string> | undefined {
  const data = loadTenantConnectionsFile(storeDir, sub);
  const jc = data?.jobCards;
  if (!jc || typeof jc !== 'object') {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(jc)) {
    if (k.trim().length > 0 && typeof v === 'string' && v.trim().length > 0) {
      out[k.trim()] = v.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function saveTenantSystems(storeDir: string, sub: string, systems: string[]): void {
  const existing = loadTenantConnectionsFile(storeDir, sub);
  writeTenantConnectionsFile(storeDir, sub, {
    systems,
    jobCards: existing?.jobCards,
  });
}

/**
 * Merges one job card into the tenant file and persists (preserves systems and other jobCards keys).
 */
export function mergeTenantJobCard(
  storeDir: string,
  sub: string,
  connectionSpec: string,
  jobCard: string
): void {
  const spec = connectionSpec.trim();
  const card = jobCard.trim();
  if (!spec || !card) {
    return;
  }
  const existing = loadTenantConnectionsFile(storeDir, sub);
  const systems = existing?.systems?.length
    ? existing.systems.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  const jobCards = { ...(existing?.jobCards ?? {}), [spec]: card };
  writeTenantConnectionsFile(storeDir, sub, { systems, jobCards });
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
