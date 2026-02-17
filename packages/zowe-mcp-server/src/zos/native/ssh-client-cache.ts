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
 * Cache of ZSshClient instances keyed by user@host:port.
 *
 * One client per (user, host, port). On connection/auth errors the caller
 * should evict the entry so the next request can retry with new credentials.
 */

import { SshSession } from '@zowe/zos-uss-for-zowe-sdk';
import { ZSshClient } from 'zowe-native-proto-sdk';
import type { Credentials } from '../credentials.js';
import type { ParsedConnectionSpec } from './connection-spec.js';

/** Builds a cache key from a parsed spec (user@host:port). */
export function cacheKey(spec: ParsedConnectionSpec): string {
  const portSuffix = spec.port === 22 ? '' : `:${spec.port}`;
  return `${spec.user}@${spec.host}${portSuffix}`;
}

/**
 * In-memory cache of ZSshClient instances.
 * Call evict() on auth/connection errors so the next request can create a new client.
 */
export class SshClientCache {
  private readonly clients = new Map<string, ZSshClient>();

  /**
   * Returns an existing client or creates one for the given spec and credentials.
   * On connection failure the client is not cached; the caller may retry with new credentials.
   */
  async getOrCreate(spec: ParsedConnectionSpec, credentials: Credentials): Promise<ZSshClient> {
    const key = cacheKey(spec);
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }

    const session = new SshSession({
      hostname: spec.host,
      port: spec.port,
      user: credentials.user,
      password: credentials.password,
    });

    const client = await ZSshClient.create(session, {
      onClose: () => {
        this.evictKey(key);
      },
    });

    this.clients.set(key, client);
    return client;
  }

  /** Removes the client for the given key and disposes it. */
  evict(spec: ParsedConnectionSpec): void {
    this.evictKey(cacheKey(spec));
  }

  /** Removes the client for the given key and disposes it. */
  evictKey(key: string): void {
    const client = this.clients.get(key);
    if (client) {
      try {
        client.dispose();
      } catch {
        // ignore dispose errors
      }
      this.clients.delete(key);
    }
  }

  /** Disposes all cached clients. */
  dispose(): void {
    for (const key of [...this.clients.keys()]) {
      this.evictKey(key);
    }
  }
}
