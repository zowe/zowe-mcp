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
 * Per-tenant (OIDC `sub`) resources for shared HTTP MCP: response caches and CLI plugin state maps.
 */

import type { CliPluginState } from '../tools/cli-bridge/types.js';
import type { ResponseCache, ResponseCacheOptions } from '../zos/response-cache.js';
import { createResponseCache } from '../zos/response-cache.js';

/** Tenant key when no JWT / stdio (single default bucket). */
export const DEFAULT_TENANT_KEY = '__default__';

const tenantResponseCaches = new Map<string, ResponseCache>();
const tenantCliPluginRootMaps = new Map<string, Map<string, CliPluginState>>();

/**
 * Returns a stable tenant key for cache and CLI plugin scoping.
 */
export function tenantKeyFromSub(sub: string | undefined): string {
  const t = sub?.trim();
  if (t === undefined || t === '') {
    return DEFAULT_TENANT_KEY;
  }
  return t;
}

/**
 * Per-tenant response cache (shared by all HTTP sessions for the same `sub`).
 */
export function getOrCreateTenantResponseCache(
  tenantKey: string,
  options?: ResponseCacheOptions
): ResponseCache {
  let c = tenantResponseCaches.get(tenantKey);
  if (!c) {
    c = createResponseCache(options);
    tenantResponseCaches.set(tenantKey, c);
  }
  return c;
}

/**
 * Per-tenant map of plugin name → CliPluginState (HTTP shared server).
 */
export function getOrCreateTenantCliPluginStates(tenantKey: string): Map<string, CliPluginState> {
  let m = tenantCliPluginRootMaps.get(tenantKey);
  if (!m) {
    m = new Map();
    tenantCliPluginRootMaps.set(tenantKey, m);
  }
  return m;
}

/** Clears tenant maps — for tests only. */
export function __resetTenantResourcesForTests(): void {
  tenantResponseCaches.clear();
  tenantCliPluginRootMaps.clear();
}
