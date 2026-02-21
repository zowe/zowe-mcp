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
import { ZSshClient, ZSshUtils } from 'zowe-native-proto-sdk';
import { getLogger } from '../../server.js';
import type { Credentials } from '../credentials.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { passwordHash } from './password-hash.js';

const log = getLogger().child('native.ssh');

/** Builds a cache key from a parsed spec (user@host:port). */
export function cacheKey(spec: ParsedConnectionSpec): string {
  const portSuffix = spec.port === 22 ? '' : `:${spec.port}`;
  return `${spec.user}@${spec.host}${portSuffix}`;
}

/**
 * Returns true if the error indicates the ZNP server binary is not present on the remote (FSUM7351 / "Server not found").
 */
export function isZnpServerNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('Server not found') || msg.includes('FSUM7351');
}

/** Default ZNP response timeout in seconds (used when not configured). */
export const DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC = 60;

export interface NativeOptions {
  autoInstallZnp: boolean;
  serverPath: string;
  /** Response timeout in seconds for each ZNP request (default 60). */
  responseTimeout: number;
}

export interface SshClientCacheOptions {
  /** When true (default), deploy ZNP via ZSshUtils.installServer when "Server not found" is detected, then retry. */
  autoInstallZnp?: boolean;
  /** Remote path where the ZNP server is installed/run (default: ZSshClient.DEFAULT_SERVER_PATH). */
  serverPath?: string;
  /** Response timeout in seconds for ZNP requests (default 60). */
  responseTimeout?: number;
  /** When set, options are read at getOrCreate time (allows runtime updates from extension). */
  getOptions?: () => NativeOptions;
}

/**
 * In-memory cache of ZSshClient instances.
 * Call evict() on auth/connection errors so the next request can create a new client.
 */
export class SshClientCache {
  private readonly clients = new Map<string, ZSshClient>();
  private readonly staticOptions: NativeOptions | undefined;
  private readonly getOptions: (() => NativeOptions) | undefined;

  constructor(options: SshClientCacheOptions = {}) {
    if (options.getOptions) {
      this.getOptions = options.getOptions;
      this.staticOptions = undefined;
    } else {
      this.getOptions = undefined;
      this.staticOptions = {
        autoInstallZnp: options.autoInstallZnp ?? true,
        serverPath: options.serverPath ?? ZSshClient.DEFAULT_SERVER_PATH,
        responseTimeout: options.responseTimeout ?? DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC,
      };
    }
  }

  private options(): NativeOptions {
    if (this.getOptions) return this.getOptions();
    return this.staticOptions!;
  }

  /**
   * Returns an existing client or creates one for the given spec and credentials.
   * On connection failure the client is not cached; the caller may retry with new credentials.
   * When "Server not found" (ZNP not deployed) is detected and autoInstallZnp is true, installs ZNP then retries once.
   */
  async getOrCreate(spec: ParsedConnectionSpec, credentials: Credentials): Promise<ZSshClient> {
    const key = cacheKey(spec);
    log.debug('SSH client getOrCreate: entry', {
      key,
      host: spec.host,
      port: spec.port,
      user: spec.user,
      cached: this.clients.has(key),
    });

    const existing = this.clients.get(key);
    if (existing) {
      log.debug('SSH client: cache hit, returning existing client', {
        key,
        host: spec.host,
        port: spec.port,
        user: spec.user,
      });
      return existing;
    }

    const opts = this.options();
    log.debug('SSH client: cache miss, creating new session and ZSshClient', {
      key,
      host: spec.host,
      port: spec.port,
      user: spec.user,
      passwordHash: passwordHash(credentials.password),
      responseTimeoutSec: opts.responseTimeout,
    });
    const session = new SshSession({
      hostname: spec.host,
      port: spec.port,
      user: credentials.user,
      password: credentials.password,
    });

    const createOpts = {
      serverPath: opts.serverPath,
      responseTimeout: opts.responseTimeout ?? DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC,
      onClose: () => {
        log.debug('SSH client: session closed (onClose callback)', { key, host: spec.host });
        this.evictKey(key);
      },
    };

    let client: ZSshClient;
    try {
      log.debug('SSH client: calling ZSshClient.create', {
        key,
        host: spec.host,
        port: spec.port,
      });
      client = await ZSshClient.create(session, createOpts);
      log.debug('SSH client: ZSshClient.create succeeded', {
        key,
        host: spec.host,
        port: spec.port,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : undefined;
      log.info('SSH connection failed', {
        key,
        host: spec.host,
        port: spec.port,
        user: spec.user,
        passwordHash: passwordHash(credentials.password),
        errorMessage: msg,
        errorCode: code,
      });
      if (!isZnpServerNotFoundError(err) || !opts.autoInstallZnp) {
        throw err;
      }
      log.info('Installing Zowe Native server on host (retry after install)', {
        host: spec.host,
        port: spec.port,
        user: spec.user,
        serverPath: opts.serverPath,
      });
      try {
        await ZSshUtils.installServer(session, opts.serverPath);
        client = await ZSshClient.create(session, createOpts);
      } catch (installErr) {
        const installMsg = installErr instanceof Error ? installErr.message : String(installErr);
        const installCode =
          installErr && typeof installErr === 'object' && 'code' in installErr
            ? String((installErr as { code: unknown }).code)
            : undefined;
        log.info('ZNP install or retry failed', {
          key,
          host: spec.host,
          port: spec.port,
          user: spec.user,
          errorMessage: installMsg,
          errorCode: installCode,
        });
        throw installErr;
      }
    }

    this.clients.set(key, client);
    log.debug('SSH client: connected and cached', {
      key,
      host: spec.host,
      port: spec.port,
      user: spec.user,
      cacheSize: this.clients.size,
    });
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
      log.debug('SSH client: evicting client from cache', { key });
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
    const keys = [...this.clients.keys()];
    if (keys.length > 0) {
      log.debug('SSH cache dispose: closing all clients', { count: keys.length, keys });
    }
    for (const key of keys) {
      this.evictKey(key);
    }
  }
}
