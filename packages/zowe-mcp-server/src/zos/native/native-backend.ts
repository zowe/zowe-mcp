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
 * Implements listDatasets only; other methods throw "not implemented".
 */

import type {
  CreateDatasetOptions,
  CreateDatasetResult,
  DatasetAttributes,
  DatasetEntry,
  MemberEntry,
  ReadDatasetResult,
  WriteDatasetResult,
} from '../backend.js';
import type { SystemId } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import type { NativeCredentialProvider } from './native-credential-provider.js';
import type { SshClientCache } from './ssh-client-cache.js';

const NOT_IMPL = 'Not implemented for Zowe Native backend';

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

  async listDatasets(
    systemId: SystemId,
    pattern: string,
    _volser?: string,
    userId?: string
  ): Promise<DatasetEntry[]> {
    // TODO2: Can we move what is not listing datasets to a shared call?
    const spec = this.options.getSpec(systemId, userId);
    if (!spec) {
      throw new Error(
        `No connection spec for system "${systemId}"${userId ? ` and user "${userId}"` : ''}`
      );
    }

    const credentials = await this.options.credentialProvider.getCredentials(systemId, userId);

    try {
      const client = await this.options.clientCache.getOrCreate(spec, credentials);
      const response = await client.ds.listDatasets({ pattern });
      return (response.items ?? []).map(mapDatasetToEntry);
    } catch (err) {
      // TODO: Can we move this to a shared call and differentiate between authentication errors and other errors (connections)?
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('Authentication') ||
        msg.includes('auth') ||
        msg.includes('password') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND')
      ) {
        this.options.credentialProvider.markInvalid(spec);
        this.options.clientCache.evict(spec);
        this.options.onPasswordInvalid?.(spec.user, spec.host, spec.port);
      }
      throw err;
    }
  }

  async listMembers(systemId: SystemId, dsn: string, pattern?: string): Promise<MemberEntry[]> {
    void [systemId, dsn, pattern];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    codepage?: string
  ): Promise<ReadDatasetResult> {
    void [systemId, dsn, member, codepage];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
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
