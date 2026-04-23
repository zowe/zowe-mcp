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
 * Optional HashiCorp Vault KV read for connection passwords (same key shape as ZOWE_MCP_CREDENTIALS).
 *
 * Env: ZOWE_MCP_VAULT_ADDR, ZOWE_MCP_VAULT_TOKEN, ZOWE_MCP_VAULT_KV_PATH (e.g. secret/data/myapp/zowe-mcp).
 */

import type { ParsedConnectionSpec } from './connection-spec.js';
import { parseConnectionSpec, toConnectionsEnvLookupKey } from './connection-spec.js';

let cache: { map: Map<string, string>; fetchedAt: number } | null = null;

function vaultCacheTtlMs(): number {
  const n = Number(process.env.ZOWE_MCP_VAULT_CACHE_TTL_MS ?? 60_000);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

function vaultKvUrl(): string | undefined {
  const addr = process.env.ZOWE_MCP_VAULT_ADDR?.trim();
  const path = process.env.ZOWE_MCP_VAULT_KV_PATH?.trim();
  if (!addr || !path) {
    return undefined;
  }
  return `${addr.replace(/\/$/, '')}/v1/${path.replace(/^\//, '')}`;
}

export function clearVaultCredentialsCacheForTests(): void {
  cache = null;
}

async function fetchVaultJson(): Promise<Record<string, unknown> | undefined> {
  const url = vaultKvUrl();
  const token = process.env.ZOWE_MCP_VAULT_TOKEN?.trim();
  if (!url || !token) {
    return undefined;
  }
  const res = await fetch(url, {
    headers: { 'X-Vault-Token': token },
  });
  if (!res.ok) {
    throw new Error(
      `Vault KV read failed: HTTP ${res.status} ${await res.text().catch(() => '')}`
    );
  }
  const body = (await res.json()) as {
    data?: { data?: Record<string, unknown> } | Record<string, unknown>;
  };
  // KV v2: { data: { data: { ... } } }
  const inner = body.data;
  if (
    inner &&
    typeof inner === 'object' &&
    'data' in inner &&
    inner.data &&
    typeof inner.data === 'object'
  ) {
    return inner.data as Record<string, unknown>;
  }
  if (inner && typeof inner === 'object' && !('data' in inner)) {
    return inner as Record<string, unknown>;
  }
  return undefined;
}

async function getVaultCredentialsMap(): Promise<Map<string, string>> {
  const ttl = vaultCacheTtlMs();
  if (ttl > 0 && cache && Date.now() - cache.fetchedAt < ttl) {
    return cache.map;
  }
  if (!vaultKvUrl() || !process.env.ZOWE_MCP_VAULT_TOKEN?.trim()) {
    return new Map();
  }
  const obj = await fetchVaultJson();
  const map = new Map<string, string>();
  if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== 'string' || value === '') {
        continue;
      }
      try {
        const spec = parseConnectionSpec(key);
        map.set(toConnectionsEnvLookupKey(spec.user, spec.host, spec.port), value);
      } catch {
        // ignore bad keys
      }
    }
  }
  cache = { map, fetchedAt: Date.now() };
  return map;
}

/**
 * Resolves a password from Vault KV when configured (after env vars / ZOWE_MCP_CREDENTIALS).
 */
export async function getStandalonePasswordFromVault(
  spec: ParsedConnectionSpec
): Promise<string | undefined> {
  if (!vaultKvUrl()) {
    return undefined;
  }
  const map = await getVaultCredentialsMap();
  const key = toConnectionsEnvLookupKey(spec.user, spec.host, spec.port);
  const v = map.get(key);
  if (v !== undefined && v !== '') {
    return v;
  }
  return undefined;
}
