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
 * ZosBackend implementation using the Zowe Native Proto SDK (SSH).
 *
 * Implements listDatasets, listMembers, and readDataset; other methods throw "not implemented".
 */

import type { ZSshClient } from 'zowe-native-proto-sdk';
import { getLogger } from '../../server.js';
import type {
  CreateDatasetOptions,
  CreateDatasetResult,
  DatasetAttributes,
  DatasetEntry,
  MemberEntry,
  ReadDatasetResult,
  WriteDatasetResult,
} from '../backend.js';
import { memberPatternToRegExp } from '../member-pattern.js';
import type { SystemId } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import type { NativeCredentialProvider } from './native-credential-provider.js';
import type { SshClientCache } from './ssh-client-cache.js';

const log = getLogger().child('native');

const NOT_IMPL = 'Not implemented for Zowe Native backend';

/** Subset of ZSshClient.ds we use (SDK types may be loose). */
interface NativeDsApi {
  listDatasets(req: { pattern: string; attributes?: boolean }): Promise<{
    items?: {
      name: string;
      dsorg?: string;
      recfm?: string;
      lrecl?: number;
      blksize?: number;
      cdate?: string;
      volser?: string;
    }[];
  }>;
  listDsMembers(req: { dsname: string }): Promise<{ items?: { name: string }[] }>;
}

function mapDatasetToEntry(item: {
  name: string;
  dsorg?: string;
  recfm?: string;
  lrecl?: number;
  blksize?: number;
  cdate?: string;
  volser?: string;
}): DatasetEntry {
  return {
    dsn: item.name,
    dsorg: item.dsorg as DatasetEntry['dsorg'],
    recfm: item.recfm as DatasetEntry['recfm'],
    lrecl: item.lrecl,
    blksz: item.blksize,
    volser: item.volser,
    creationDate: item.cdate,
  };
}

/**
 * Classifies an error message as connection/network error or invalid-password error.
 * Connection errors should not mark credentials invalid; password errors should.
 */
function classifyNativeError(message: string): {
  isConnectionError: boolean;
  isInvalidPassword: boolean;
} {
  const isConnectionError =
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNRESET') ||
    message.includes('ENETUNREACH') ||
    message.includes('timeout') ||
    message.includes('Connection');

  const isInvalidPassword =
    !isConnectionError &&
    (/invalid.*password|password.*invalid|authentication failed|auth failed|permission denied/i.test(
      message
    ) ||
      (message.includes('Authentication') && message.toLowerCase().includes('fail')));

  return { isConnectionError, isInvalidPassword };
}

export interface NativeBackendOptions {
  credentialProvider: NativeCredentialProvider;
  clientCache: SshClientCache;
  /** Resolve (systemId, userId) to the connection spec for that connection. */
  getSpec: (systemId: SystemId, userId?: string) => ParsedConnectionSpec | undefined;
  /** VS Code mode: call when auth fails so extension can delete the secret. */
  onPasswordInvalid?: (user: string, host: string, port?: number) => void;
}

export class NativeBackend {
  constructor(private readonly options: NativeBackendOptions) {}

  private async withNativeClient<T>(
    systemId: SystemId,
    userId: string | undefined,
    fn: (client: ZSshClient) => Promise<T>
  ): Promise<T> {
    const spec = this.options.getSpec(systemId, userId);
    if (!spec) {
      throw new Error(
        `No connection spec for system "${systemId}"${userId ? ` and user "${userId}"` : ''}`
      );
    }

    const credentials = await this.options.credentialProvider.getCredentials(systemId, userId);

    try {
      const client = await this.options.clientCache.getOrCreate(spec, credentials);
      return await fn(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warning('Native backend error', {
        message: msg,
        systemId,
        user: spec.user,
        host: spec.host,
      });
      log.debug('Native backend error detail', {
        err: err instanceof Error ? err.stack : String(err),
      });

      const { isInvalidPassword } = classifyNativeError(msg);

      if (isInvalidPassword) {
        this.options.credentialProvider.markInvalid(spec);
        this.options.clientCache.evict(spec);
        this.options.onPasswordInvalid?.(spec.user, spec.host, spec.port);
      }
      throw err;
    }
  }

  async listDatasets(
    systemId: SystemId,
    pattern: string,
    _volser?: string,
    userId?: string,
    attributes?: boolean
  ): Promise<DatasetEntry[]> {
    return this.withNativeClient(systemId, userId, async client => {
      const ds = (client as unknown as { ds: NativeDsApi }).ds;
      const response = await ds.listDatasets({
        pattern,
        attributes: attributes ?? true,
      });
      return (response.items ?? []).map(mapDatasetToEntry);
    });
  }

  async listMembers(systemId: SystemId, dsn: string, pattern?: string): Promise<MemberEntry[]> {
    return this.withNativeClient(systemId, undefined, async client => {
      const ds = (client as unknown as { ds: NativeDsApi }).ds;
      const response = await ds.listDsMembers({ dsname: dsn });
      let members: MemberEntry[] = (response.items ?? []).map(m => ({
        name: m.name.toUpperCase(),
      }));

      if (pattern) {
        const regex = memberPatternToRegExp(pattern);
        if (regex) {
          members = members.filter(m => regex.test(m.name));
        }
      }

      return members.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    codepage?: string
  ): Promise<ReadDatasetResult> {
    return this.withNativeClient(systemId, undefined, async client => {
      const dsname = member ? `${dsn}(${member})` : dsn;
      const ds = (
        client as unknown as {
          ds: {
            readDataset(req: {
              dsname: string;
              localEncoding?: string;
            }): Promise<{ etag?: string; data?: string }>;
          };
        }
      ).ds;
      const response = await ds.readDataset({
        dsname,
        localEncoding: codepage ?? 'IBM-1047',
      });

      const raw = response.data ?? '';
      const text = raw.length > 0 ? Buffer.from(raw, 'base64').toString('utf-8') : '';

      return {
        text,
        etag: response.etag ?? '',
        codepage: codepage ?? 'IBM-1047',
      };
    });
  }

  async writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    codepage?: string
  ): Promise<WriteDatasetResult> {
    void [systemId, dsn, content, member, etag, codepage];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async createDataset(
    systemId: SystemId,
    dsn: string,
    options: CreateDatasetOptions
  ): Promise<CreateDatasetResult> {
    void [systemId, dsn, options];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async deleteDataset(systemId: SystemId, dsn: string, member?: string): Promise<void> {
    void [systemId, dsn, member];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async getAttributes(systemId: SystemId, dsn: string): Promise<DatasetAttributes> {
    void [systemId, dsn];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string
  ): Promise<void> {
    void [systemId, sourceDsn, targetDsn, sourceMember, targetMember];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async renameDataset(
    systemId: SystemId,
    dsn: string,
    newDsn: string,
    member?: string,
    newMember?: string
  ): Promise<void> {
    void [systemId, dsn, newDsn, member, newMember];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }
}
