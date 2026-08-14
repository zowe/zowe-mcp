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

import { SshSession, ZSshClient, ZSshUtils } from '@zowe/zowex-for-zowe-sdk';
import { basename, posix } from 'node:path';
import { getLogger } from '../../server.js';
import type { Credentials } from '../credentials.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { passwordHash } from './password-hash.js';
import { formatErrorWithDetails, getAdditionalDetails } from './sdk-error-details.js';
import {
  isZowexTruncatedModuleError,
  probeDeploySpace,
  verifyZowexBinary,
} from './zowex-deploy-check.js';

const log = getLogger().child('native.ssh');

/**
 * Returns non-sensitive log fields describing how a connection authenticates.
 * Never logs key bytes or the passphrase — only the auth method, the key file
 * basename, and a short password hash for correlation.
 */
function credentialLogFields(credentials: Credentials): Record<string, unknown> {
  if (credentials.authMethod === 'key') {
    return {
      authMethod: 'key',
      keyFile: credentials.privateKeyPath ? basename(credentials.privateKeyPath) : undefined,
      encryptedKey: credentials.keyPassphrase !== undefined,
    };
  }
  return {
    authMethod: 'password',
    passwordHash: credentials.password ? passwordHash(credentials.password) : undefined,
  };
}

/** Builds a cache key from a parsed spec (user@host:port). */
export function cacheKey(spec: ParsedConnectionSpec): string {
  const portSuffix = spec.port === 22 ? '' : `:${spec.port}`;
  return `${spec.user}@${spec.host}${portSuffix}`;
}

/**
 * Returns true if the error indicates the zowex z/OS server binary is not present or could not start on the remote.
 *
 * The SDK throws "Server not found" (with FSUM7351 in additionalDetails) when the shell reports USS FSUM7351.
 * When the shell error does not contain FSUM7351 (e.g. different locale, /bin/sh "not found"), the SDK falls
 * back to "Error starting Zowe server: <command>" — we treat that as server-not-found too, since the most
 * common cause is a missing binary that can be resolved by auto-install.
 */
export function isZowexServerNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Server not found') ||
    msg.includes('FSUM7351') ||
    msg.includes('Error starting Zowe server')
  );
}

/**
 * Returns true if the error indicates the deployed zowex binary is truncated/corrupted
 * (z/OS SE06 abend, e.g. IEW4006I "MODULE HAS BEEN TRUNCATED"), most commonly caused by
 * a previous deploy running out of space partway through the upload or pax extraction.
 * Treated like "server not found": autoInstallZowex triggers a redeploy.
 */
export function isZowexTruncatedServerError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (isZowexTruncatedModuleError(msg)) return true;
  const details = getAdditionalDetails(err);
  return details != null && isZowexTruncatedModuleError(details);
}

/**
 * Installs the zowex z/OS server, guarding against zFS's ability to auto-grow (which makes
 * a `df` free-space check meaningless): probes for real, writable space before uploading,
 * and smoke-tests the deployed binary afterward so a truncated install fails fast here
 * instead of surfacing later as a cryptic SE06 abend.
 */
async function deployZowexServer(session: SshSession, serverPath: string): Promise<boolean> {
  await probeDeploySpace(session, serverPath);
  const installed = await ZSshUtils.installServer(session, serverPath);
  if (installed) {
    await verifyZowexBinary(session, serverPath);
  }
  return installed;
}

/** Default zowex-sdk response timeout in seconds (used when not configured). */
export const DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC = 60;

export interface ZowexClientOptions {
  autoInstallZowex: boolean;
  serverPath: string;
  /** Response timeout in seconds for each zowex-sdk request (default 60). */
  responseTimeout: number;
}

export interface SshClientCacheOptions {
  /** When true (default), deploy the z/OS server via ZSshUtils.installServer when "Server not found" is detected, then retry. */
  autoInstallZowex?: boolean;
  /** Remote path where the zowex z/OS server is installed/run (default: ZSshClient.DEFAULT_SERVER_PATH). */
  serverPath?: string;
  /** Response timeout in seconds for zowex-sdk requests (default 60). */
  responseTimeout?: number;
  /** When set, options are read at getOrCreate time (allows runtime updates from extension). */
  getOptions?: () => ZowexClientOptions;
}

/**
 * In-memory cache of ZSshClient instances.
 * Call evict() on auth/connection errors so the next request can create a new client.
 */
export class SshClientCache {
  private readonly clients = new Map<string, ZSshClient>();
  private readonly staticOptions: ZowexClientOptions | undefined;
  private readonly getOptions: (() => ZowexClientOptions) | undefined;

  constructor(options: SshClientCacheOptions = {}) {
    if (options.getOptions) {
      this.getOptions = options.getOptions;
      this.staticOptions = undefined;
    } else {
      this.getOptions = undefined;
      this.staticOptions = {
        autoInstallZowex: options.autoInstallZowex ?? true,
        serverPath: options.serverPath ?? ZSshClient.DEFAULT_SERVER_PATH,
        responseTimeout: options.responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC,
      };
    }
  }

  private options(): ZowexClientOptions {
    if (this.getOptions) return this.getOptions();
    return this.staticOptions!;
  }

  /** Caches a newly-created client under `key` and logs it. */
  private cache(key: string, client: ZSshClient, spec: ParsedConnectionSpec): ZSshClient {
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

  /**
   * Returns an existing client or creates one for the given spec and credentials.
   * On connection failure the client is not cached; the caller may retry with new credentials.
   * When "Server not found" (z/OS server not deployed) is detected and autoInstallZowex is true, installs then retries once.
   * @param progress - Optional callback for progress messages (e.g. "Connecting to host via SSH", "Deploying Zowe Remote SSH server to host").
   */
  async getOrCreate(
    spec: ParsedConnectionSpec,
    credentials: Credentials,
    progress?: (message: string) => void
  ): Promise<ZSshClient> {
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
      ...credentialLogFields(credentials),
      responseTimeoutSec: opts.responseTimeout,
    });
    const session = new SshSession(
      credentials.authMethod === 'key'
        ? {
            hostname: spec.host,
            port: spec.port,
            user: credentials.user,
            privateKey: credentials.privateKeyPath,
            keyPassphrase: credentials.keyPassphrase,
          }
        : {
            hostname: spec.host,
            port: spec.port,
            user: credentials.user,
            password: credentials.password,
          }
    );

    const createOpts = {
      serverPath: opts.serverPath,
      responseTimeout: opts.responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC,
      onClose: () => {
        log.debug('SSH client: session closed (onClose callback)', { key, host: spec.host });
        this.evictKey(key);
      },
    };

    let client: ZSshClient;
    try {
      progress?.(`Connecting to ${spec.host} via SSH`);
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

      const outdated = ZSshUtils.checkIfOutdated(client.serverVersion);
      if (outdated && opts.autoInstallZowex) {
        log.info('zowex z/OS server is outdated, redeploying', {
          key,
          host: spec.host,
          port: spec.port,
        });
        progress?.(`Updating Zowe Remote SSH server on ${spec.host}`);
        client.dispose();
        const redeployed = await deployZowexServer(session, opts.serverPath);
        if (!redeployed) {
          log.warning('zowex redeploy returned false, proceeding with reconnect anyway', {
            host: spec.host,
            port: spec.port,
          });
        }
        const reconnectOpts = {
          ...createOpts,
          responseTimeout: (opts.responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC) * 2,
        };
        client = await ZSshClient.create(session, reconnectOpts);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const additionalDetails = getAdditionalDetails(err);
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : undefined;
      const notFound = isZowexServerNotFoundError(err);
      const truncated = isZowexTruncatedServerError(err);
      log.info('SSH connection failed', {
        key,
        host: spec.host,
        port: spec.port,
        user: spec.user,
        ...credentialLogFields(credentials),
        errorMessage: msg,
        additionalDetails,
        errorCode: code,
        truncatedModuleDetected: truncated,
      });
      if ((!notFound && !truncated) || !opts.autoInstallZowex) {
        if (additionalDetails) {
          throw new Error(formatErrorWithDetails(msg, additionalDetails));
        }
        throw err;
      }

      // Before deploying our own copy (and taking on the disk-space risk that comes with
      // it), check whether a working zowex is already on the user's $PATH — e.g. an
      // admin-managed system-wide install — and use that instead.
      const onPath = await ZSshUtils.detectServerOnPath(session).catch(() => undefined);
      if (onPath?.serverPath && onPath.hasExecutePermission) {
        const pathServerDir = posix.dirname(onPath.serverPath);
        log.info('zowex found on PATH; using it instead of deploying', {
          key,
          host: spec.host,
          port: spec.port,
          user: spec.user,
          pathServerPath: onPath.serverPath,
          version: onPath.version,
        });
        progress?.(`Using existing Zowe Remote SSH server on ${spec.host} (found on PATH)`);
        try {
          client = await ZSshClient.create(session, { ...createOpts, serverPath: pathServerDir });
          return this.cache(key, client, spec);
        } catch (pathErr) {
          log.info('Connecting via PATH-detected zowex failed; falling back to deploy', {
            key,
            host: spec.host,
            port: spec.port,
            errorMessage: pathErr instanceof Error ? pathErr.message : String(pathErr),
          });
        }
      }

      progress?.(`Deploying Zowe Remote SSH server to ${spec.host}`);
      log.info('Installing Zowe Remote SSH server on host (retry after install)', {
        host: spec.host,
        port: spec.port,
        user: spec.user,
        serverPath: opts.serverPath,
        reason: truncated ? 'truncated-module' : 'server-not-found',
      });
      const installTimeoutSec = (opts.responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC) * 2;
      const createOptsAfterInstall = {
        ...createOpts,
        responseTimeout: installTimeoutSec,
      };
      try {
        const installed = await deployZowexServer(session, opts.serverPath);
        if (!installed) {
          throw new Error(
            `ZSshUtils.installServer returned false — server deployment to ${opts.serverPath} on ${spec.host} did not complete successfully`
          );
        }
        log.info('zowex z/OS server install succeeded, reconnecting', {
          host: spec.host,
          port: spec.port,
          serverPath: opts.serverPath,
        });
        client = await ZSshClient.create(session, createOptsAfterInstall);
      } catch (installErr) {
        const installMsg = installErr instanceof Error ? installErr.message : String(installErr);
        const installDetails = getAdditionalDetails(installErr);
        const installCode =
          installErr && typeof installErr === 'object' && 'code' in installErr
            ? String(installErr.code)
            : undefined;
        log.info('zowex z/OS server install or retry failed', {
          key,
          host: spec.host,
          port: spec.port,
          user: spec.user,
          errorMessage: installMsg,
          additionalDetails: installDetails,
          errorCode: installCode,
        });
        if (installDetails) {
          throw new Error(formatErrorWithDetails(installMsg, installDetails));
        }
        throw installErr;
      }
    }

    return this.cache(key, client, spec);
  }

  /** Returns true if a client for the given key is already cached (no connect/install needed). */
  hasKey(key: string): boolean {
    return this.clients.has(key);
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
