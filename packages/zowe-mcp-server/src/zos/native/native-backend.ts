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
  BackendProgressCallback,
  CreateDatasetOptions,
  CreateDatasetResult,
  DatasetAttributes,
  DatasetEntry,
  MemberEntry,
  ReadDatasetResult,
  SearchInDatasetOptions,
  SearchInDatasetResult,
  WriteDatasetResult,
} from '../backend.js';
import { memberPatternToRegExp } from '../member-pattern.js';
import { runSearchWithListAndRead } from '../search-runner.js';
import type { SystemId } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import type { NativeCredentialProvider } from './native-credential-provider.js';
import { cacheKey, type SshClientCache } from './ssh-client-cache.js';

const log = getLogger().child('native');

/** Per connection (user@host:port) lock so only one request uses the client at a time. */
const connectionLocks = new Map<string, Promise<void>>();

const NOT_IMPL = 'Not implemented for Zowe Native backend';

/** Local encoding for ZNP read result; data in the MCP server is always UTF-8. */
const LOCAL_ENCODING_UTF8 = 'utf-8';

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
 * Classifies an error message as connection/network/backend error or invalid-password error.
 * Connection/backend errors mean the client should be evicted so the next request gets a new connection.
 * Password errors should mark credentials invalid.
 */
function classifyNativeError(message: string): {
  isConnectionError: boolean;
  isInvalidPassword: boolean;
} {
  const lowerCaseMessage = message.toLowerCase();
  const isConnectionError =
    lowerCaseMessage.includes('econnrefused') ||
    lowerCaseMessage.includes('enotfound') ||
    lowerCaseMessage.includes('etimedout') ||
    lowerCaseMessage.includes('econnreset') ||
    lowerCaseMessage.includes('enetunreach') ||
    lowerCaseMessage.includes('timeout') ||
    lowerCaseMessage.includes('connection') ||
    // Backend (ZNP server) abended or returned invalid response; connection is unusable
    lowerCaseMessage.includes('invalid json') ||
    lowerCaseMessage.includes('protection exception') ||
    lowerCaseMessage.includes('completion code') ||
    /\b0c4\b/i.test(message);

  const isInvalidPassword =
    !isConnectionError &&
    (/invalid.*password|password.*invalid|authentication failed|auth failed|permission denied/i.test(
      lowerCaseMessage
    ) ||
      (lowerCaseMessage.includes('authentication') && lowerCaseMessage.includes('fail')));

  return { isConnectionError, isInvalidPassword };
}

export interface NativeBackendOptions {
  credentialProvider: NativeCredentialProvider;
  clientCache: SshClientCache;
  /** Resolve (systemId, userId) to the connection spec for that connection. */
  getSpec: (systemId: SystemId, userId?: string) => ParsedConnectionSpec | undefined;
  /** VS Code mode: call when auth fails so extension can delete the secret. */
  onPasswordInvalid?: (user: string, host: string, port?: number) => void;
  /** Current response timeout in seconds. When set, operations are limited to this duration so a hung SDK does not block the lock. */
  getResponseTimeout?: () => number;
}

export class NativeBackend {
  constructor(private readonly options: NativeBackendOptions) {}

  private async withNativeClient<T>(
    systemId: SystemId,
    userId: string | undefined,
    fn: (client: ZSshClient) => Promise<T>,
    progress?: BackendProgressCallback
  ): Promise<T> {
    const spec = this.options.getSpec(systemId, userId);
    if (!spec) {
      throw new Error(
        `No connection spec for system "${systemId}"${userId ? ` and user "${userId}"` : ''}`
      );
    }

    const key = cacheKey(spec);
    const prev = connectionLocks.get(key) ?? Promise.resolve();
    let release: () => void;
    const done = new Promise<void>(r => {
      release = r;
    });
    connectionLocks.set(
      key,
      prev.then(() => done)
    );

    log.debug('Native backend: waiting for connection lock', { key, systemId });
    await prev;
    log.debug('Native backend: connection lock acquired', { key, systemId });

    const credentials = await this.options.credentialProvider.getCredentials(systemId, userId);

    try {
      log.debug('Native backend: getOrCreate client', { key, systemId });
      const client = await this.options.clientCache.getOrCreate(spec, credentials, progress);
      log.debug('Native backend: got client, running operation', { key, systemId });
      progress?.('Running Zowe Native operation');

      const timeoutSec = this.options.getResponseTimeout?.() ?? 60;
      const timeoutMs = timeoutSec * 1000;
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Request timed out after ${timeoutMs} ms`)),
          timeoutMs
        );
      });
      const result = await Promise.race([
        fn(client).finally(() => clearTimeout(timeoutId!)),
        timeoutPromise,
      ]);
      log.debug('Native backend: operation completed', { key, systemId });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : undefined;
      const { isConnectionError, isInvalidPassword } = classifyNativeError(msg);
      log.info('Native backend error (SSH/connection or auth)', {
        message: msg,
        errorCode: code,
        systemId,
        host: spec.host,
        port: spec.port,
        user: spec.user,
        isConnectionError,
        isInvalidPassword,
      });
      log.debug('Native backend error detail', {
        err: err instanceof Error ? err.stack : String(err),
      });

      if (isInvalidPassword) {
        this.options.credentialProvider.markInvalid(spec);
        this.options.clientCache.evict(spec);
        this.options.onPasswordInvalid?.(spec.user, spec.host, spec.port);
      } else if (isConnectionError) {
        this.options.clientCache.evict(spec);
      }
      throw err;
    } finally {
      release!();
      log.debug('Native backend: connection lock released', { key, systemId });
    }
  }

  async listDatasets(
    systemId: SystemId,
    pattern: string,
    _volser?: string,
    userId?: string,
    attributes?: boolean,
    progress?: BackendProgressCallback
  ): Promise<DatasetEntry[]> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const ds = (client as unknown as { ds: NativeDsApi }).ds;
        const response = await ds.listDatasets({
          pattern,
          attributes: attributes ?? true,
        });
        return (response.items ?? []).map(mapDatasetToEntry);
      },
      progress
    );
  }

  async listMembers(
    systemId: SystemId,
    dsn: string,
    pattern?: string,
    progress?: BackendProgressCallback
  ): Promise<MemberEntry[]> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
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
      },
      progress
    );
  }

  /**
   * Reads dataset content. Result is always UTF-8 (local encoding).
   * localEncoding is always UTF-8. The encoding argument is the mainframe (EBCDIC) encoding (tool layer resolves default).
   */
  async readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    encoding?: string,
    progress?: BackendProgressCallback
  ): Promise<ReadDatasetResult> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        const dsname = member ? `${dsn}(${member})` : dsn;
        const mainframeEncoding = encoding ?? 'IBM-1047';
        const ds = (
          client as unknown as {
            ds: {
              readDataset(req: {
                dsname: string;
                /** Local (client) encoding for the result: UTF-8. */
                localEncoding?: string;
                /** Mainframe (EBCDIC) encoding for conversion. */
                encoding?: string;
              }): Promise<{ etag?: string; data?: string }>;
            };
          }
        ).ds;
        const response = await ds.readDataset({
          dsname,
          localEncoding: LOCAL_ENCODING_UTF8,
          encoding: mainframeEncoding,
        });

        const raw = response.data ?? '';
        const text = raw.length > 0 ? Buffer.from(raw, 'base64').toString('utf-8') : '';

        return {
          text,
          etag: response.etag ?? '',
          encoding: mainframeEncoding,
        };
      },
      progress
    );
  }

  async writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    encoding?: string,
    _progress?: BackendProgressCallback
  ): Promise<WriteDatasetResult> {
    void [systemId, dsn, content, member, etag, encoding];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async createDataset(
    systemId: SystemId,
    dsn: string,
    options: CreateDatasetOptions,
    _progress?: BackendProgressCallback
  ): Promise<CreateDatasetResult> {
    void [systemId, dsn, options];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async deleteDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    void [systemId, dsn, member];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async getAttributes(
    systemId: SystemId,
    dsn: string,
    _progress?: BackendProgressCallback
  ): Promise<DatasetAttributes> {
    void [systemId, dsn];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string,
    _progress?: BackendProgressCallback
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
    newMember?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    void [systemId, dsn, newDsn, member, newMember];
    await Promise.resolve();
    throw new Error(NOT_IMPL);
  }

  async searchInDataset(
    systemId: SystemId,
    dsn: string,
    options: SearchInDatasetOptions,
    progress?: BackendProgressCallback
  ): Promise<SearchInDatasetResult> {
    // First implementation: use listMembers + readDataset + grep. When ZNP client.tool.search
    // is available (see https://github.com/zowe/zowe-native-proto/pull/809), call it here and
    // map the response to SearchInDatasetResult instead.
    // Progress is reported at withNativeClient level (Connecting, Running Zowe Native operation).
    return this.withNativeClient(
      systemId,
      undefined,
      () => runSearchWithListAndRead(this, systemId, dsn, options, log),
      progress
    );
  }
}
