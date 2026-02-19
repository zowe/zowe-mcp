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
 * Generic in-memory cache for backend response get-or-fetch usage.
 *
 * Used by the tool layer to cache backend results (e.g. listDatasets, listMembers,
 * and future operations) so repeated calls with the same parameters do not hit the
 * backend. The cache is backend-agnostic: the caller builds the key and provides
 * the fetch function.
 *
 * **Where the cache is stored**: In process memory only (LRU). It is not persisted
 * to disk. Each call to createResponseCache() returns a new, empty cache. When
 * the server is created with createServer(), it creates one cache per server
 * instance (or uses an injected ResponseCache). So every new server process or
 * createServer() call starts with an empty cache unless you pass a pre-created
 * ResponseCache. Tests can pass responseCache: createResponseCache() to
 * guarantee an empty cache for that server.
 */

import { LRUCache } from 'lru-cache';

/** Default TTL for cache entries: 10 minutes. */
export const DEFAULT_RESPONSE_CACHE_TTL_MS = 600_000;

/** Default max cache size: 1 GB. */
export const DEFAULT_RESPONSE_CACHE_MAX_BYTES = 1_073_741_824;

/** Options for the response cache. */
export interface ResponseCacheOptions {
  /** TTL per entry in milliseconds. Default: 10 minutes. */
  ttlMs?: number;
  /** Max total size in bytes. Default: 1 GB. */
  maxSizeBytes?: number;
}

/**
 * A cache that returns the value for a key, or runs the provided fetch function
 * on miss, stores the result, and returns it. Independent of backend or call type.
 */
export interface ResponseCache {
  /**
   * Returns the cached value for the key, or runs `fetch()` on miss, stores the result, and returns it.
   */
  getOrFetch<T extends object>(key: string, fetch: () => Promise<T>): Promise<T>;
}

/**
 * Creates a generic response cache with the given options.
 * Callers build the key and pass a fetch function; the cache only handles get/set, TTL, and size.
 */
export function createResponseCache(options?: ResponseCacheOptions): ResponseCache {
  const ttlMs = options?.ttlMs ?? DEFAULT_RESPONSE_CACHE_TTL_MS;
  const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_RESPONSE_CACHE_MAX_BYTES;

  const cache = new LRUCache<string, object>({
    maxSize: maxSizeBytes,
    sizeCalculation: (value: object) => Buffer.byteLength(JSON.stringify(value), 'utf8'),
    ttl: ttlMs,
  });

  return {
    async getOrFetch<T extends object>(key: string, fetch: () => Promise<T>): Promise<T> {
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached as T;
      }
      const value = await fetch();
      cache.set(key, value);
      return value;
    },
  };
}

// --- Generic cache key builder ---

/**
 * Builds a stable cache key from a prefix and a set of key-value parameters.
 * Keys are sorted so the same logical params always produce the same key.
 * Undefined values are serialized as empty string.
 *
 * @param prefix - Operation or scope name (e.g. 'listDatasets', 'listMembers').
 * @param params - Key-value pairs; order does not matter, keys are sorted.
 */
export function buildCacheKey(prefix: string, params: Record<string, string | undefined>): string {
  const canonical = Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [k, v ?? ''] as const)
      .sort(([a], [b]) => a.localeCompare(b))
  );
  return `${prefix}\x01${JSON.stringify(canonical)}`;
}
