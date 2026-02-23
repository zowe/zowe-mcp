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
  CreateDatasetApplied,
  CreateDatasetOptions,
  CreateDatasetResult,
  CreateUssFileOptions,
  DatasetAttributes,
  DatasetEntry,
  ListUssFilesOptions,
  MemberEntry,
  ReadDatasetResult,
  ReadUssFileResult,
  SearchInDatasetOptions,
  SearchInDatasetResult,
  UssFileEntry,
  WriteDatasetResult,
  WriteUssFileResult,
} from '../backend.js';
import { memberPatternToRegExp } from '../member-pattern.js';
import { runSearchWithListAndRead, type SearchBackendAdapter } from '../search-runner.js';
import type { SystemId } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import type { NativeCredentialProvider } from './native-credential-provider.js';
import { cacheKey, type SshClientCache } from './ssh-client-cache.js';

const log = getLogger().child('native');

/** Per connection (user@host:port) lock so only one request uses the client at a time. */
const connectionLocks = new Map<string, Promise<void>>();

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
  readDataset(req: {
    dsname: string;
    localEncoding?: string;
    encoding?: string;
  }): Promise<{ etag?: string; data?: string }>;
  writeDataset(req: {
    dsname: string;
    data?: string;
    localEncoding?: string;
    encoding?: string;
    etag?: string;
  }): Promise<{ etag: string }>;
  createDataset(req: {
    dsname: string;
    attributes: Record<string, unknown>;
  }): Promise<{ success: boolean }>;
  deleteDataset(req: { dsname: string }): Promise<{ success: boolean }>;
  renameDataset(req: { dsnameBefore: string; dsnameAfter: string }): Promise<{ success: boolean }>;
  renameMember(req: {
    dsname: string;
    memberBefore: string;
    memberAfter: string;
  }): Promise<{ success: boolean }>;
}

/** Subset of ZSshClient.uss we use (ZNP USS RPCs). */
interface NativeUssApi {
  listFiles(req: {
    fspath: string;
    all?: boolean;
    long?: boolean;
    depth?: number;
    maxItems?: number;
  }): Promise<{
    items?: { name: string; size?: number; mode?: string; mtime?: string; filetag?: string }[];
    returnedRows?: number;
  }>;
  readFile(req: { fspath: string; encoding?: string; localEncoding?: string }): Promise<{
    etag?: string;
    data?: string;
    encoding?: string;
  }>;
  writeFile(req: {
    fspath: string;
    data?: string;
    etag?: string;
    encoding?: string;
    localEncoding?: string;
  }): Promise<{ etag: string; created?: boolean }>;
  createFile(req: {
    fspath: string;
    isDir?: boolean;
    permissions?: string;
  }): Promise<{ success?: boolean }>;
  deleteFile(req: { fspath: string; recursive?: boolean }): Promise<{ success?: boolean }>;
  chmodFile(req: {
    fspath: string;
    mode: string;
    recursive?: boolean;
  }): Promise<{ success?: boolean }>;
  chownFile(req: {
    fspath: string;
    owner: string;
    recursive?: boolean;
  }): Promise<{ success?: boolean }>;
  chtagFile(req: {
    fspath: string;
    tag: string;
    recursive?: boolean;
  }): Promise<{ success?: boolean }>;
}

/** Subset of ZSshClient.cmds we use (ZNP command RPCs). */
interface NativeCmdsApi {
  issueUnix(req: { commandText: string }): Promise<{ data?: string }>;
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

    const credentials = await this.options.credentialProvider.getCredentials(systemId, userId, {
      progress,
    });

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

  /** List members using an already-acquired client (avoids re-entering withNativeClient). */
  private async _listMembersWithClient(
    client: ZSshClient,
    dsn: string,
    pattern?: string
  ): Promise<MemberEntry[]> {
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
  }

  /** Read dataset using an already-acquired client (avoids re-entering withNativeClient). */
  private async _readDatasetWithClient(
    client: ZSshClient,
    dsn: string,
    member?: string,
    encoding?: string
  ): Promise<ReadDatasetResult> {
    const resolvedDsn = member ? `${dsn}(${member})` : dsn;
    const mainframeEncoding = encoding ?? 'IBM-1047';
    const ds = (client as unknown as { ds: NativeDsApi }).ds;
    const response = await ds.readDataset({
      dsname: resolvedDsn,
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
  }

  /** Adapter for runSearchWithListAndRead that uses an already-acquired client (single lock). */
  private makeSearchAdapter(client: ZSshClient): SearchBackendAdapter {
    return {
      listMembers: (_systemId, dsn) => this._listMembersWithClient(client, dsn),
      readDataset: (_systemId, dsn, member, encoding) =>
        this._readDatasetWithClient(client, dsn, member, encoding),
    };
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
        const resolvedDsn = member ? `${dsn}(${member})` : dsn;
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
          dsname: resolvedDsn,
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
    startLine?: number,
    endLine?: number,
    progress?: BackendProgressCallback
  ): Promise<WriteDatasetResult> {
    const mainframeEncoding = encoding ?? 'IBM-1047';
    if (startLine != null) {
      const readResult = await this.readDataset(
        systemId,
        dsn,
        member,
        mainframeEncoding,
        progress
      );
      const lines = readResult.text.split(/\r?\n/);
      const contentLines = content.split(/\r?\n/);
      const startIdx = startLine - 1;

      if (endLine != null) {
        const endIdx = Math.min(endLine - 1, lines.length - 1);
        const removeCount = Math.max(0, endIdx - startIdx + 1);
        while (lines.length < startIdx) {
          lines.push('');
        }
        lines.splice(startIdx, removeCount, ...contentLines);
      } else {
        const N = contentLines.length;
        while (lines.length < startIdx + N) {
          lines.push('');
        }
        for (let i = 0; i < N; i++) {
          lines[startIdx + i] = contentLines[i];
        }
      }
      content = lines.join('\n');
      etag = readResult.etag;
    }

    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        const targetDsn = member ? `${dsn}(${member})` : dsn;
        const ds = (client as unknown as { ds: NativeDsApi }).ds;
        const data = Buffer.from(content, 'utf-8').toString('base64');
        const response = await ds.writeDataset({
          dsname: targetDsn,
          data,
          localEncoding: LOCAL_ENCODING_UTF8,
          encoding: mainframeEncoding,
          etag,
        });
        return { etag: response.etag };
      },
      progress
    );
  }

  async createDataset(
    systemId: SystemId,
    dsn: string,
    options: CreateDatasetOptions,
    _progress?: BackendProgressCallback
  ): Promise<CreateDatasetResult> {
    const DEFAULT_RECFM = 'FB';
    const DEFAULT_LRECL = 80;
    const DEFAULT_BLKSZ = 27920;
    const DEFAULT_DIRBLK = 5;
    const appliedRecfm = options.recfm ?? DEFAULT_RECFM;
    const appliedLrecl = options.lrecl ?? DEFAULT_LRECL;
    const appliedBlksz = options.blksz ?? DEFAULT_BLKSZ;
    // PDS (PO) uses directory blocks; PDSE (PO-E / LIBRARY) does not—do not pass dirblk for PO-E.
    const appliedDirblk = options.type === 'PO' ? (options.dirblk ?? DEFAULT_DIRBLK) : undefined;

    // PDSE: z/OS allocation uses DSORG=PO + DSNTYPE=LIBRARY (no dirblk).
    const effectiveDsorg = options.type === 'PO-E' ? 'PO' : options.type;
    const attributes: Record<string, unknown> = {
      dsorg: effectiveDsorg,
      recfm: appliedRecfm,
      lrecl: appliedLrecl,
      primary: options.primary ?? 1,
    };
    if (appliedBlksz !== undefined) attributes.blksize = appliedBlksz;
    if (options.secondary !== undefined) attributes.secondary = options.secondary;
    if (appliedDirblk !== undefined) attributes.dirblk = appliedDirblk;
    if (options.type === 'PO-E') attributes.dsntype = 'LIBRARY';

    await this.withNativeClient(
      systemId,
      undefined,
      async client => {
        const ds = (client as unknown as { ds: NativeDsApi }).ds;
        await ds.createDataset({ dsname: dsn, attributes });
      },
      _progress
    );

    const applied: CreateDatasetApplied = {
      dsorg: options.type,
      recfm: appliedRecfm,
      lrecl: appliedLrecl,
      blksz: appliedBlksz,
      dirblk: appliedDirblk,
      primary: options.primary,
      secondary: options.secondary,
    };
    const messages = ['Dataset created on z/OS.'];
    return { applied, messages };
  }

  async deleteDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    const targetDsn = member ? `${dsn}(${member})` : dsn;
    await this.withNativeClient(
      systemId,
      undefined,
      async client => {
        const ds = (client as unknown as { ds: NativeDsApi }).ds;
        await ds.deleteDataset({ dsname: targetDsn });
      },
      progress
    );
  }

  async getAttributes(
    systemId: SystemId,
    dsn: string,
    progress?: BackendProgressCallback
  ): Promise<DatasetAttributes> {
    const entries = await this.listDatasets(systemId, dsn, undefined, undefined, true, progress);
    const exact = entries.find(e => e.dsn.toUpperCase() === dsn.toUpperCase());
    if (!exact) {
      throw new Error(
        `Dataset '${dsn}' not found on ${systemId}. ` +
          'Use listDatasets to see available datasets.'
      );
    }
    return {
      dsn: exact.dsn,
      dsorg: exact.dsorg,
      recfm: exact.recfm,
      lrecl: exact.lrecl,
      blksz: exact.blksz,
      volser: exact.volser,
      creationDate: exact.creationDate,
    };
  }

  async copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    const readResult = await this.readDataset(
      systemId,
      sourceDsn,
      sourceMember,
      undefined,
      progress
    );
    await this.writeDataset(
      systemId,
      targetDsn,
      readResult.text,
      targetMember,
      undefined,
      readResult.encoding,
      undefined,
      undefined,
      progress
    );
  }

  async renameDataset(
    systemId: SystemId,
    dsn: string,
    newDsn: string,
    member?: string,
    newMember?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    await this.withNativeClient(
      systemId,
      undefined,
      async client => {
        const ds = (client as unknown as { ds: NativeDsApi }).ds;
        if (member && newMember) {
          await ds.renameMember({
            dsname: dsn,
            memberBefore: member,
            memberAfter: newMember,
          });
        } else {
          await ds.renameDataset({
            dsnameBefore: dsn,
            dsnameAfter: newDsn,
          });
        }
      },
      progress
    );
  }

  async searchInDataset(
    systemId: SystemId,
    dsn: string,
    options: SearchInDatasetOptions,
    progress?: BackendProgressCallback
  ): Promise<SearchInDatasetResult> {
    // Use the client we already hold so we don't re-enter withNativeClient (listMembers/readDataset
    // would otherwise acquire the same connection lock again). When ZNP client.tool.search is
    // available (see https://github.com/zowe/zowe-native-proto/pull/809), call it here instead.
    return this.withNativeClient(
      systemId,
      undefined,
      client =>
        runSearchWithListAndRead(this.makeSearchAdapter(client), systemId, dsn, options, log),
      progress
    );
  }

  // -------------------------------------------------------------------------
  // USS operations
  // -------------------------------------------------------------------------

  private getUss(client: ZSshClient): NativeUssApi {
    return (client as unknown as { uss: NativeUssApi }).uss;
  }

  private getCmds(client: ZSshClient): NativeCmdsApi {
    return (client as unknown as { cmds: NativeCmdsApi }).cmds;
  }

  private mapUssItem(item: {
    name: string;
    size?: number;
    mode?: string;
    mtime?: string;
    filetag?: string;
  }): UssFileEntry {
    return {
      name: item.name,
      size: item.size,
      mode: item.mode,
      mtime: item.mtime,
      filetag: item.filetag,
    };
  }

  async listUssFiles(
    systemId: SystemId,
    path: string,
    options?: ListUssFilesOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<UssFileEntry[]> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        const response = await uss.listFiles({
          fspath: path,
          all: options?.includeHidden,
          long: options?.longFormat,
          depth: options?.depth ?? 1,
          maxItems: options?.maxItems,
        });
        const items = response.items ?? [];
        return items.map(item => this.mapUssItem(item));
      },
      progress
    );
  }

  async readUssFile(
    systemId: SystemId,
    path: string,
    encoding?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ReadUssFileResult> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        const mainframeEncoding = encoding ?? 'IBM-1047';
        const response = await uss.readFile({
          fspath: path,
          encoding: mainframeEncoding,
          localEncoding: LOCAL_ENCODING_UTF8,
        });
        const raw = response.data ?? '';
        const text = raw.length > 0 ? Buffer.from(raw, 'base64').toString('utf-8') : '';
        return {
          text,
          etag: response.etag ?? '',
          encoding: response.encoding ?? mainframeEncoding,
        };
      },
      progress
    );
  }

  async writeUssFile(
    systemId: SystemId,
    path: string,
    content: string,
    etag?: string,
    encoding?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<WriteUssFileResult> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        const mainframeEncoding = encoding ?? 'IBM-1047';
        const data = Buffer.from(content, 'utf-8').toString('base64');
        const response = await uss.writeFile({
          fspath: path,
          data,
          etag,
          encoding: mainframeEncoding,
          localEncoding: LOCAL_ENCODING_UTF8,
        });
        return {
          etag: response.etag,
          created: response.created ?? false,
        };
      },
      progress
    );
  }

  async createUssFile(
    systemId: SystemId,
    path: string,
    options: CreateUssFileOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        await uss.createFile({
          fspath: path,
          isDir: options.isDirectory,
          permissions: options.permissions,
        });
      },
      progress
    );
  }

  async deleteUssFile(
    systemId: SystemId,
    path: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        await uss.deleteFile({ fspath: path, recursive });
      },
      progress
    );
  }

  async chmodUssFile(
    systemId: SystemId,
    path: string,
    mode: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        await uss.chmodFile({ fspath: path, mode, recursive });
      },
      progress
    );
  }

  async chownUssFile(
    systemId: SystemId,
    path: string,
    owner: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        await uss.chownFile({ fspath: path, owner, recursive });
      },
      progress
    );
  }

  async chtagUssFile(
    systemId: SystemId,
    path: string,
    tag: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        await uss.chtagFile({ fspath: path, tag, recursive });
      },
      progress
    );
  }

  async runUnixCommand(
    systemId: SystemId,
    commandText: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        log.info('runUnixCommand resolving cmds API', { systemId, commandText });
        const cmds = this.getCmds(client);
        log.info('runUnixCommand calling issueUnix', { systemId, commandText });
        const response = await cmds.issueUnix({ commandText });
        const data = response.data ?? '';
        log.debug('runUnixCommand completed', {
          systemId,
          commandText,
          outputLength: data.length,
        });
        return data;
      },
      progress
    );
  }

  async getUssHome(
    systemId: SystemId,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        log.info('getUssHome resolving cmds API', { systemId });
        const cmds = this.getCmds(client);
        log.info('getUssHome calling issueUnix(echo $HOME)', { systemId });
        try {
          const response = await cmds.issueUnix({ commandText: 'echo $HOME' });
          const home = (response.data ?? '').trim();
          log.debug('getUssHome issueUnix response', {
            systemId,
            homeLength: home.length,
            home: home || '(empty)',
          });
          if (!home) {
            throw new Error('Could not determine USS home directory (echo $HOME returned empty).');
          }
          return home;
        } catch (err) {
          log.warning('getUssHome issueUnix failed', {
            systemId,
            error: (err as Error).message,
          });
          throw err;
        }
      },
      progress
    );
  }

  async getUssTempDir(
    systemId: SystemId,
    basePath: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        const existing = await uss.listFiles({
          fspath: basePath,
          all: true,
          maxItems: 5000,
        });
        const names = new Set((existing.items ?? []).map(e => e.name));
        const { randomBytes } = await import('node:crypto');
        for (let i = 0; i < 20; i++) {
          const name = `tmp.${randomBytes(4).toString('hex')}`;
          if (!names.has(name)) {
            return `${basePath.replace(/\/$/, '')}/${name}`;
          }
        }
        throw new Error('Could not find unique temp directory after 20 attempts.');
      },
      progress
    );
  }

  async getUssTempPath(
    systemId: SystemId,
    dirPath: string,
    prefix?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        const existing = await uss.listFiles({
          fspath: dirPath,
          all: true,
          maxItems: 5000,
        });
        const names = new Set((existing.items ?? []).map(e => e.name));
        const { randomBytes } = await import('node:crypto');
        for (let i = 0; i < 20; i++) {
          const name = prefix
            ? `${prefix}.${randomBytes(4).toString('hex')}`
            : randomBytes(8).toString('hex');
          if (!names.has(name)) {
            return `${dirPath.replace(/\/$/, '')}/${name}`;
          }
        }
        throw new Error('Could not find unique temp path after 20 attempts.');
      },
      progress
    );
  }

  async deleteUssUnderPath(
    systemId: SystemId,
    path: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<{ deleted: string[] }> {
    const normalized = path.replace(/\/$/, '') || path;
    await this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        progress?.(`Deleting ${normalized}`);
        await uss.deleteFile({ fspath: normalized, recursive: true });
      },
      progress
    );
    return { deleted: [normalized] };
  }
}
