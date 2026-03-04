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

import { dump as yamlDump } from 'js-yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ZSshClient } from 'zowe-native-proto-sdk';
import type { CeedumpCollectedEventData } from '../../events.js';
import { getCurrentMcpTool } from '../../mcp-tool-context.js';
import { getLogger } from '../../server.js';
import type {
  BackendProgressCallback,
  CreateDatasetApplied,
  CreateDatasetOptions,
  CreateDatasetResult,
  CreateUssFileOptions,
  DatasetAttributes,
  DatasetEntry,
  JobEntry,
  JobFileEntry,
  JobStatusResult,
  ListJobsOptions,
  ListUssFilesOptions,
  MemberEntry,
  ReadDatasetResult,
  ReadJobFileResult,
  ReadUssFileResult,
  SearchInDatasetOptions,
  SearchInDatasetResult,
  SubmitJobResult,
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
import {
  installStderrAbendCapture,
  sanitizeAbendMessage,
  takeAbendSnippet,
} from './stderr-abend-capture.js';
import { logZnpResponse, requireMethods, sanitizeZnpString } from './znp-debug.js';

const log = getLogger().child('native');

/** Suggested link for reporting ZNP server abends (CEE3204S/0C4, etc.). */
const ZNP_ISSUES_URL = 'https://github.com/zowe/zowe-native-proto/issues';

/** Per connection (user@host:port) lock so only one request uses the client at a time. */
const connectionLocks = new Map<string, Promise<void>>();

/** Typical USS base paths to probe for home when echo $HOME is unavailable (same as uss-tools). */
const USS_HOME_PROBE_BASES = ['/u', '/a', '/z', '/u/users', '/u/users/group/product'] as const;

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
      rdate?: string;
      edate?: string;
      multivolume?: boolean;
      migrated?: boolean;
      encrypted?: boolean;
      dsntype?: string;
      dataclass?: string;
      mgmtclass?: string;
      storclass?: string;
      spacu?: string;
      usedp?: number;
      usedx?: number;
      primary?: number;
      secondary?: number;
      devtype?: string;
      volsers?: string[];
    }[];
  }>;
  listDsMembers(req: {
    dsname: string;
    pattern?: string;
  }): Promise<{ items?: { name: string }[] }>;
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
  issueCmd(req: { commandText: string }): Promise<{ data?: string }>;
}

/** Subset of ZSshClient.tso we use (ZNP TSO RPCs — SDK 0.3.0+). */
interface NativeTsoApi {
  issueCmd(req: { commandText: string }): Promise<{ data?: string }>;
}

/** Subset of ZSshClient.tool we use (ZNP tool RPCs — SDK 0.3.0+). */
interface NativeToolApi {
  search(req: { dsname: string; string: string; parms?: string }): Promise<{ data?: string }>;
}

/** Subset of ZSshClient.console we use (ZNP console RPCs). */
interface NativeConsoleApi {
  issueCmd(req: { commandText: string; consoleName?: string }): Promise<{ data?: string }>;
}

/** Shape returned by UtilsApi.tools.parseSearchOutput (SDK 0.3.0+). */
interface ZnpParsedSearchResult {
  dataset: string;
  header: string;
  members: {
    name: string;
    matches: {
      lineNumber: number;
      content: string;
      beforeContext: string[];
      afterContext: string[];
    }[];
  }[];
  summary: {
    linesFound: number;
    linesProcessed: number;
    membersWithLines: number;
    membersWithoutLines: number;
    compareColumns: string;
    longestLine: number;
    processOptions: string;
    searchPattern: string;
  };
}

/** ZNP spool item shape (listSpools response). */
interface ZnpSpoolItem {
  id?: number;
  spoolId?: number;
  ddname?: string;
  stepname?: string;
  dsname?: string;
  procstep?: string;
}

/** Subset of ZSshClient.jobs we use (ZNP job RPCs). ZNP uses getStatus (not getJobStatus). */
interface NativeJobsApi {
  submitJcl(req: {
    jcl: string;
    localEncoding?: string;
    encoding?: string;
  }): Promise<{ jobId?: string; jobName?: string }>;
  /** ZNP method name is getStatus. */
  getStatus(req: { jobId: string }): Promise<{
    id?: string;
    name?: string;
    owner?: string;
    status?: string;
    type?: string;
    class?: string;
    retcode?: string;
    subsystem?: string;
    phase?: number;
    phaseName?: string;
    correlator?: string;
  }>;
  listSpools(req: { jobId: string }): Promise<{ items?: ZnpSpoolItem[] }>;
  readSpool(req: {
    jobId: string;
    spoolId: number;
    encoding?: string;
    localEncoding?: string;
  }): Promise<{ data?: string }>;
  listJobs(req: {
    owner?: string;
    prefix?: string;
    status?: string;
    maxItems?: number;
  }): Promise<{ items?: ZnpJobItem[] }>;
  getJcl(req: { jobId: string }): Promise<{ jcl?: string; data?: string }>;
  cancelJob(req: { jobId: string }): Promise<{ success?: boolean }>;
  holdJob(req: { jobId: string }): Promise<{ success?: boolean }>;
  releaseJob(req: { jobId: string }): Promise<{ success?: boolean }>;
  deleteJob(req: { jobId: string }): Promise<{ success?: boolean }>;
  submitJob(req: { dsname: string }): Promise<{ jobId?: string; jobName?: string }>;
  submitUss(req: { fspath: string }): Promise<{ jobId?: string; jobName?: string }>;
}

/** ZNP job item (listJobs response). */
interface ZnpJobItem {
  id?: string;
  name?: string;
  owner?: string;
  status?: string;
  type?: string;
  class?: string;
  retcode?: string;
  subsystem?: string;
  phase?: number;
  phaseName?: string;
  correlator?: string;
}

function mapDatasetToEntry(item: {
  name: string;
  dsorg?: string;
  recfm?: string;
  lrecl?: number;
  blksize?: number;
  cdate?: string;
  volser?: string;
  rdate?: string;
  edate?: string;
  multivolume?: boolean;
  migrated?: boolean;
  encrypted?: boolean;
  dsntype?: string;
  dataclass?: string;
  mgmtclass?: string;
  storclass?: string;
  spacu?: string;
  usedp?: number;
  usedx?: number;
  primary?: number;
  secondary?: number;
  devtype?: string;
  volsers?: string[];
}): DatasetEntry {
  return {
    dsn: item.name,
    dsorg: item.dsorg as DatasetEntry['dsorg'],
    recfm: item.recfm as DatasetEntry['recfm'],
    lrecl: item.lrecl,
    blksz: item.blksize,
    volser: item.volser,
    creationDate: item.cdate,
    referenceDate: item.rdate,
    expirationDate: item.edate,
    multivolume: item.multivolume,
    migrated: item.migrated,
    encrypted: item.encrypted,
    dsntype: item.dsntype,
    dataclass: item.dataclass,
    mgmtclass: item.mgmtclass,
    storclass: item.storclass,
    spaceUnits: item.spacu,
    usedPercent: item.usedp,
    usedExtents: item.usedx,
    primary: item.primary,
    secondary: item.secondary,
    devtype: item.devtype,
    volsers: item.volsers,
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

/**
 * Returns true if the error message indicates the ZNP server on z/OS abended
 * (e.g. CEE3204S protection exception 0C4). Used to trigger CEEDUMP collection
 * and to surface a clearer error to the client.
 */
function isAbendError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid json') ||
    lower.includes('protection exception') ||
    lower.includes('completion code') ||
    /\b0c4\b/i.test(message) ||
    /cee3204s/i.test(message)
  );
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
  /** VS Code mode: call when a CEEDUMP file was saved after an abend; extension can show a message and offer to open the file. */
  onCeedumpCollected?: (data: CeedumpCollectedEventData) => void;
}

export class NativeBackend {
  constructor(private readonly options: NativeBackendOptions) {}

  /** Optional context for CEEDUMP metadata when the ZNP server abends. */
  private async withNativeClient<T>(
    systemId: SystemId,
    userId: string | undefined,
    fn: (client: ZSshClient) => Promise<T>,
    progress?: BackendProgressCallback,
    operationContext?: { operation: string; params: Record<string, unknown> }
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

      let rejectAbend: (err: Error) => void;
      const abendPromise = new Promise<never>((_, reject) => {
        rejectAbend = reject;
      });
      const unbindStderr = installStderrAbendCapture(key, (snippet: string) => {
        rejectAbend(new Error(snippet));
      });
      const baseTimeoutSec = this.options.getResponseTimeout?.() ?? 60;
      const timeoutSec = this.options.clientCache.hasKey(key)
        ? baseTimeoutSec
        : baseTimeoutSec * 2;
      const timeoutMs = timeoutSec * 1000;
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Request timed out after ${timeoutSec} s`)),
          timeoutMs
        );
      });
      try {
        const result = await Promise.race([
          fn(client).finally(() => clearTimeout(timeoutId!)),
          timeoutPromise,
          abendPromise,
        ]);
        log.debug('Native backend: operation completed', { key, systemId });
        return result;
      } finally {
        unbindStderr();
      }
    } catch (err: unknown) {
      const abendSnippet = takeAbendSnippet(key);
      const isTimeout = err instanceof Error && err.message.includes('timed out');
      const toThrow = abendSnippet && isTimeout ? new Error(abendSnippet) : err;
      const msg = toThrow instanceof Error ? toThrow.message : String(toThrow);
      const code =
        toThrow && typeof toThrow === 'object' && 'code' in toThrow
          ? String((toThrow as { code: unknown }).code)
          : undefined;
      const { isConnectionError, isInvalidPassword } = classifyNativeError(msg);
      const abendDetected = isAbendError(msg);
      const znpOperation = operationContext?.operation ?? 'unknown';
      const mcpTool = getCurrentMcpTool() ?? 'unknown';
      // Error message used as display string only (sanitized for trailing dots/spaces)

      const abendReason: string | undefined = abendDetected
        ? sanitizeAbendMessage(String(msg))
        : undefined;
      log.info('Native backend error (SSH/connection or auth)', {
        message: msg,
        errorCode: code,
        systemId,
        host: spec.host,
        port: spec.port,
        user: spec.user,
        isConnectionError,
        isInvalidPassword,
        abendDetected,
      });
      if (abendDetected) {
        log.notice(
          `Zowe Native server on z/OS abended during Zowe Native operation '${znpOperation}' (MCP tool: '${mcpTool}'). ${abendReason}. Connection evicted; next request will use a new connection. Set ZOWE_MCP_CEEDUMP_SAVE_DIR to collect CEEDUMPs. Please report via GitHub issues: ${ZNP_ISSUES_URL}`,
          { systemId, host: spec.host, user: spec.user, znpOperation, mcpTool, abendReason }
        );
        log.error(
          `Zowe Native unexpected internal error: abend during Zowe Native call '${znpOperation}' (MCP tool: '${mcpTool}'). Details: ${abendReason}. Please report via GitHub issues: ${ZNP_ISSUES_URL}`
        );
      }
      log.debug('Native backend error detail', {
        err: toThrow instanceof Error ? toThrow.stack : String(toThrow),
      });

      if (isInvalidPassword) {
        this.options.credentialProvider.markInvalid(spec);
        this.options.clientCache.evict(spec);
        this.options.onPasswordInvalid?.(spec.user, spec.host, spec.port);
      } else if (isConnectionError) {
        this.options.clientCache.evict(spec);
        log.info(
          'Native connection evicted due to backend/connection error; lock released — next request will use a new connection',
          { key, systemId, host: spec.host, user: spec.user }
        );
        if (abendDetected) {
          void this.collectCeedumpAfterAbend(
            spec,
            systemId,
            userId,
            String(abendReason ?? msg),
            operationContext,
            mcpTool
          );
        }
      }
      if (abendDetected) {
        const userMessage = `An unexpected internal error occurred in Zowe Native (z/OS). Details: ${abendReason}. Please report via GitHub issues: ${ZNP_ISSUES_URL}`;
        throw new Error(userMessage);
      }
      throw toThrow;
    } finally {
      release!();
      log.debug('Native backend: connection lock released', { key, systemId });
    }
  }

  /**
   * Probe typical USS base paths for a directory matching the user ID (case-insensitive).
   * Used for CEEDUMP collection when echo $HOME is unavailable (e.g. ZNP unixCommand not implemented).
   * Returns the first existing path or '' if none found.
   */
  private async probeUssHomeFromBases(uss: NativeUssApi, userId: string): Promise<string> {
    const lower = userId.toLowerCase();
    for (const base of USS_HOME_PROBE_BASES) {
      try {
        const res = await uss.listFiles({
          fspath: base,
          all: true,
          maxItems: 500,
        });
        const items = res.items ?? [];
        const entry = items.find(
          e => (e.name === userId || e.name === lower) && (e.mode?.startsWith('d') ?? true)
        );
        if (entry) {
          const homePath = `${base.replace(/\/$/, '')}/${entry.name}`;
          log.info('CEEDUMP collection: resolved USS home via directory probe', {
            path: homePath,
            base,
          });
          return homePath;
        }
        const fallback = items.find(e => e.name === userId || e.name === lower);
        if (fallback) {
          const homePath = `${base.replace(/\/$/, '')}/${fallback.name}`;
          log.info('CEEDUMP collection: resolved USS home via directory probe', {
            path: homePath,
            base,
          });
          return homePath;
        }
      } catch {
        // Base may not exist or be listable; skip
      }
    }
    return '';
  }

  /**
   * After a ZNP server abend, connect with a new session, locate CEEDUMP in the user's
   * USS home, and save it locally (YAML meta + dump in one file). Runs fire-and-forget.
   * Save dir: ZOWE_MCP_CEEDUMP_SAVE_DIR ?? ZOWE_MCP_WORKSPACE_DIR ?? process.cwd().
   */
  private async collectCeedumpAfterAbend(
    spec: ParsedConnectionSpec,
    systemId: SystemId,
    userId: string | undefined,
    errorMessage: string,
    operationContext?: { operation: string; params: Record<string, unknown> },
    mcpTool?: string
  ): Promise<void> {
    const explicitDir =
      process.env.ZOWE_MCP_CEEDUMP_SAVE_DIR?.trim() ?? process.env.ZOWE_MCP_WORKSPACE_DIR?.trim();
    const saveDir = explicitDir !== undefined && explicitDir !== '' ? explicitDir : process.cwd();
    let client: ZSshClient | undefined;
    try {
      const credentials = await this.options.credentialProvider.getCredentials(
        systemId,
        userId,
        {}
      );
      client = await this.options.clientCache.getOrCreate(spec, credentials);
      const uss = this.getUss(client);

      let home: string;
      try {
        const res = await uss.issueCmd({ commandText: 'echo $HOME' });
        home = (res.data ?? '').trim();
      } catch {
        home = '';
      }
      if (!home) {
        log.debug('CEEDUMP collection: echo $HOME failed or empty, probing typical home bases');
        home = await this.probeUssHomeFromBases(uss, spec.user);
      }
      if (!home) {
        home = `/u/${spec.user.toLowerCase()}`;
        log.debug('CEEDUMP collection: no home found under typical bases, using fallback', {
          home,
        });
      }

      const listRes = await uss.listFiles({
        fspath: home,
        all: true,
        maxItems: 500,
      });
      const items = listRes.items ?? [];
      const ceedumps = items.filter(e => /^CEEDUMP/i.test(e.name));
      if (ceedumps.length === 0) {
        log.info('CEEDUMP collection: no CEEDUMP files found in USS home', {
          systemId,
          home,
          user: spec.user,
        });
        return;
      }
      ceedumps.sort((a, b) => {
        const ta = 'mtime' in a && typeof a.mtime === 'string' ? a.mtime : '';
        const tb = 'mtime' in b && typeof b.mtime === 'string' ? b.mtime : '';
        return tb.localeCompare(ta);
      });
      const newest = ceedumps[0];
      const dumpPath = `${home.replace(/\/$/, '')}/${newest.name}`;
      const readRes = await uss.readFile({
        fspath: dumpPath,
        localEncoding: LOCAL_ENCODING_UTF8,
      });
      const raw = readRes.data ?? '';
      const content = raw.length > 0 ? Buffer.from(raw, 'base64').toString('utf-8') : '';

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeHost = spec.host.replace(/[^a-zA-Z0-9.-]/g, '_');
      const baseName = `zowe-ceedump-${timestamp}-${safeHost}-${spec.user}`;
      const meta = {
        operation: operationContext?.operation ?? 'unknown',
        params: operationContext?.params ?? {},
        systemId,
        host: spec.host,
        user: spec.user,
        timestamp: new Date().toISOString(),
        errorMessage: errorMessage.slice(0, 2000),
        ussHome: home,
        dumpFileName: newest.name,
      };

      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
      const yamlBlock = yamlDump(meta, { lineWidth: -1 });
      const combined = `${yamlBlock}\n---\n${content}`;
      const filePath = path.join(saveDir, `${baseName}.txt`);
      fs.writeFileSync(filePath, combined, 'utf-8');
      const absolutePath = path.resolve(filePath);
      log.info('CEEDUMP saved after abend', {
        systemId,
        operation: meta.operation,
        filePath: absolutePath,
      });
      this.options.onCeedumpCollected?.({
        path: absolutePath,
        reason: errorMessage.slice(0, 500),
        znpOperation: meta.operation,
        mcpTool: mcpTool ?? undefined,
      });
    } catch (collectErr) {
      log.warning('CEEDUMP collection failed', {
        systemId,
        host: spec.host,
        user: spec.user,
        error: collectErr instanceof Error ? collectErr.message : String(collectErr),
      });
    } finally {
      if (client) {
        this.options.clientCache.evict(spec);
      }
    }
  }

  /** List members using an already-acquired client (avoids re-entering withNativeClient). */
  private async _listMembersWithClient(
    client: ZSshClient,
    dsn: string,
    pattern?: string
  ): Promise<MemberEntry[]> {
    const ds = (client as unknown as { ds: NativeDsApi }).ds;
    const znpPattern = pattern ? pattern.replace(/%/g, '?') : undefined;
    const response = await ds.listDsMembers({ dsname: dsn, pattern: znpPattern });
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

  /** Read data set using an already-acquired client (avoids re-entering withNativeClient). */
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
      progress,
      { operation: 'listDatasets', params: { pattern, attributes } }
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
        const znpPattern = pattern ? pattern.replace(/%/g, '?') : undefined;
        const response = await ds.listDsMembers({ dsname: dsn, pattern: znpPattern });
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
      progress,
      { operation: 'listMembers', params: { dsn, pattern } }
    );
  }

  /**
   * Reads data set content. Result is always UTF-8 (local encoding).
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
      progress,
      { operation: 'readDataset', params: { dsn, member, encoding } }
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
    if (options.volser) attributes.volser = options.volser;
    if (options.dataClass) attributes.dataclas = options.dataClass;
    if (options.storageClass) attributes.storclas = options.storageClass;
    if (options.managementClass) attributes.mgmtclas = options.managementClass;

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
        `Data set '${dsn}' not found on ${systemId}. ` +
          'Use listDatasets to see available data sets.'
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
      referenceDate: exact.referenceDate,
      expirationDate: exact.expirationDate,
      multivolume: exact.multivolume,
      migrated: exact.migrated,
      encrypted: exact.encrypted,
      dsntype: exact.dsntype,
      dataclass: exact.dataclass,
      mgmtclass: exact.mgmtclass,
      storclass: exact.storclass,
      spaceUnits: exact.spaceUnits,
      usedPercent: exact.usedPercent,
      usedExtents: exact.usedExtents,
      primary: exact.primary,
      secondary: exact.secondary,
      devtype: exact.devtype,
      volsers: exact.volsers,
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
    const forceFallback =
      process.env.ZOWE_MCP_SEARCH_FORCE_FALLBACK === '1' ||
      process.env.ZOWE_MCP_SEARCH_FORCE_FALLBACK === 'true';

    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        if (forceFallback) {
          log.info('searchInDataset using fallback (ZOWE_MCP_SEARCH_FORCE_FALLBACK)', {
            dsn,
            string: options.string,
          });
          return runSearchWithListAndRead(
            this.makeSearchAdapter(client),
            systemId,
            dsn,
            options,
            log
          );
        }
        return this.searchWithToolApi(client, dsn, options);
      },
      progress
    );
  }

  /**
   * Search using ZNP tool.search (SuperC on z/OS) + UtilsApi.tools.parseSearchOutput.
   * Falls back to list-and-read when the member filter cannot be expressed via SuperC.
   */
  private async searchWithToolApi(
    client: ZSshClient,
    dsn: string,
    options: SearchInDatasetOptions
  ): Promise<SearchInDatasetResult> {
    const tool = this.getTool(client);
    const searchDsn = options.member ? `${dsn}(${options.member})` : dsn;
    const parms = options.parms || undefined;
    log.info('searchInDataset using tool.search', {
      dsn: searchDsn,
      string: options.string,
      parms,
    });

    const response = await tool.search({
      dsname: searchDsn,
      string: options.string,
      parms,
    });
    const rawOutput = response.data ?? '';
    if (!rawOutput) {
      return {
        dataset: dsn,
        members: [],
        summary: {
          linesFound: 0,
          linesProcessed: 0,
          membersWithLines: 0,
          membersWithoutLines: 0,
          searchPattern: options.string,
          processOptions: options.parms,
        },
      };
    }

    const sdk = (await import('zowe-native-proto-sdk')) as unknown as {
      UtilsApi?: {
        tools: {
          parseSearchOutput: (output: string) => ZnpParsedSearchResult;
        };
      };
    };
    if (!sdk.UtilsApi?.tools?.parseSearchOutput) {
      throw new Error(
        'SDK does not export UtilsApi.tools.parseSearchOutput. Upgrade to zowe-native-proto-sdk 0.3.0+ or set ZOWE_MCP_SEARCH_FORCE_FALLBACK=1 to use the list+read fallback.'
      );
    }
    const parsed = sdk.UtilsApi.tools.parseSearchOutput(rawOutput);

    const members = parsed.members.map(m => ({
      name: m.name,
      matches: m.matches.map(match => ({
        lineNumber: match.lineNumber,
        content: match.content,
        ...(match.beforeContext?.length ? { beforeContext: match.beforeContext } : {}),
        ...(match.afterContext?.length ? { afterContext: match.afterContext } : {}),
      })),
    }));

    return {
      dataset: dsn,
      members,
      summary: {
        linesFound: parsed.summary.linesFound,
        linesProcessed: parsed.summary.linesProcessed,
        membersWithLines: parsed.summary.membersWithLines,
        membersWithoutLines: parsed.summary.membersWithoutLines,
        searchPattern: parsed.summary.searchPattern ?? options.string,
        processOptions: parsed.summary.processOptions ?? options.parms,
      },
    };
  }

  // -------------------------------------------------------------------------
  // USS operations
  // -------------------------------------------------------------------------

  private getUss(client: ZSshClient): NativeUssApi {
    return (client as unknown as { uss: NativeUssApi }).uss;
  }

  private getTso(client: ZSshClient): NativeTsoApi {
    return (client as unknown as { tso: NativeTsoApi }).tso;
  }

  private getTool(client: ZSshClient): NativeToolApi {
    return (client as unknown as { tool: NativeToolApi }).tool;
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

  async copyUssFile(
    systemId: SystemId,
    sourcePath: string,
    targetPath: string,
    options?: {
      recursive?: boolean;
      followSymlinks?: boolean;
      preserveAttributes?: boolean;
      force?: boolean;
    },
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    await this.withNativeClient(
      systemId,
      userId,
      async client => {
        const uss = this.getUss(client);
        await (
          uss as unknown as {
            copyUss: (req: {
              srcFsPath: string;
              dstFsPath: string;
              recursive?: boolean;
              followSymlinks?: boolean;
              preserveAttributes?: boolean;
              force?: boolean;
            }) => Promise<{ success?: boolean }>;
          }
        ).copyUss({
          srcFsPath: sourcePath,
          dstFsPath: targetPath,
          recursive: options?.recursive,
          followSymlinks: options?.followSymlinks,
          preserveAttributes: options?.preserveAttributes,
          force: options?.force,
        });
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
        log.info('runUnixCommand resolving uss API', { systemId, commandText });
        const uss = this.getUss(client);
        log.info('runUnixCommand calling uss.issueCmd', { systemId, commandText });
        const response = await uss.issueCmd({ commandText });
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

  async runTsoCommand(
    systemId: SystemId,
    commandText: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        log.info('runTsoCommand resolving tso API', { systemId, commandText });
        const tso = this.getTso(client);
        log.info('runTsoCommand calling tso.issueCmd', { systemId, commandText });
        const response = await tso.issueCmd({ commandText });
        const data = response.data ?? '';
        const maxLogOutput = 2000;
        const outputPreview =
          data.length <= maxLogOutput ? data : data.slice(0, maxLogOutput) + '... (truncated)';
        log.debug('runTsoCommand completed', {
          systemId,
          commandText,
          outputLength: data.length,
          output: outputPreview,
        });
        return data;
      },
      progress
    );
  }

  private getConsole(client: ZSshClient): NativeConsoleApi {
    return (client as unknown as { console: NativeConsoleApi }).console;
  }

  async runConsoleCommand(
    systemId: SystemId,
    commandText: string,
    consoleName?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string> {
    return this.withNativeClient(
      systemId,
      userId,
      async client => {
        log.info('runConsoleCommand calling console.issueCmd', { systemId, commandText });
        const consoleApi = this.getConsole(client);
        const response = await consoleApi.issueCmd({ commandText, consoleName });
        return response.data ?? '';
      },
      progress
    );
  }

  async restoreDataset(
    systemId: SystemId,
    dsn: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    await this.withNativeClient(
      systemId,
      undefined,
      async client => {
        const ds = (client as unknown as { ds: NativeDsApi }).ds;
        await (
          ds as unknown as {
            restoreDataset: (req: { dsname: string }) => Promise<{ success?: boolean }>;
          }
        ).restoreDataset({ dsname: dsn });
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
        log.info('getUssHome resolving uss API', { systemId });
        const uss = this.getUss(client);
        try {
          log.info('getUssHome calling uss.issueCmd(echo $HOME)', { systemId });
          const response = await uss.issueCmd({ commandText: 'echo $HOME' });
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
          log.warning('getUssHome uss.issueCmd failed', {
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

  private getJobs(client: ZSshClient): NativeJobsApi {
    const clientWithJobs = client as unknown as { jobs?: NativeJobsApi };
    const jobs = clientWithJobs.jobs;
    if (jobs == null) {
      log.debug('ZNP client.jobs is missing', {
        clientKeys: typeof client === 'object' && client !== null ? Object.keys(client) : [],
      });
      throw new Error(
        'Zowe Native Proto client does not expose jobs API (client.jobs is missing). Ensure the SDK and z/OS server support job operations.'
      );
    }
    const jobsRecord = jobs as unknown as Record<string, unknown>;
    requireMethods(log, 'ZNP client.jobs', jobsRecord, [
      'getStatus',
      'submitJcl',
      'listSpools',
      'readSpool',
      'listJobs',
      'getJcl',
      'cancelJob',
      'holdJob',
      'releaseJob',
      'deleteJob',
      'submitJob',
      'submitUss',
    ]);
    return jobs;
  }

  private mapZnpJobToEntry(item: ZnpJobItem, jobId: string): JobEntry {
    return {
      id: sanitizeZnpString(item.id) ?? jobId,
      name: sanitizeZnpString(item.name) ?? '',
      owner: sanitizeZnpString(item.owner) ?? '',
      status: sanitizeZnpString(item.status) ?? '',
      type: sanitizeZnpString(item.type) ?? '',
      class: sanitizeZnpString(item.class) ?? '',
      retcode: sanitizeZnpString(item.retcode) ?? item.retcode,
      subsystem: sanitizeZnpString(item.subsystem) ?? item.subsystem,
      phase: item.phase ?? 0,
      phaseName: sanitizeZnpString(item.phaseName) ?? '',
      correlator: sanitizeZnpString(item.correlator) ?? item.correlator,
    };
  }

  async submitJob(
    systemId: SystemId,
    jcl: string,
    progress?: BackendProgressCallback
  ): Promise<SubmitJobResult> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Submitting job to ${systemId}`);
        const jobs = this.getJobs(client);
        const jclBase64 = Buffer.from(jcl, 'utf-8').toString('base64');
        const response = await jobs.submitJcl({
          jcl: jclBase64,
          localEncoding: LOCAL_ENCODING_UTF8,
        });
        const jobId = response.jobId ?? '';
        const jobName = response.jobName ?? '';
        if (!jobId) {
          throw new Error('Submit JCL did not return a job ID');
        }
        const result: SubmitJobResult = { jobId, jobName };
        const raw = (typeof response === 'object' && response !== null ? response : {}) as Record<
          string,
          unknown
        >;
        logZnpResponse(log, 'submitJcl', raw, result, {
          matchesExpectation:
            typeof jobId === 'string' && typeof jobName === 'string' && jobId.length > 0,
        });
        return result;
      },
      progress
    );
  }

  async getJobStatus(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<JobStatusResult> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Getting status for job ${jobId}`);
        const jobs = this.getJobs(client);
        const jobIdUpper = jobId.toUpperCase();
        log.debug('getJobStatus calling ZNP getStatus', { jobId: jobIdUpper });
        const r = await jobs.getStatus({ jobId: jobIdUpper });
        const raw = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
        const result: JobStatusResult = {
          id: r.id ?? jobIdUpper,
          name: sanitizeZnpString(r.name) ?? r.name ?? '',
          owner: sanitizeZnpString(r.owner) ?? r.owner ?? '',
          status: sanitizeZnpString(r.status) ?? r.status ?? '',
          type: sanitizeZnpString(r.type) ?? r.type ?? '',
          class: sanitizeZnpString(r.class) ?? r.class ?? '',
          retcode: sanitizeZnpString(r.retcode) ?? r.retcode,
          subsystem: sanitizeZnpString(r.subsystem) ?? r.subsystem,
          phase: r.phase ?? 0,
          phaseName: sanitizeZnpString(r.phaseName) ?? r.phaseName ?? '',
          correlator: sanitizeZnpString(r.correlator) ?? r.correlator,
        };
        const expectedKeys = [
          'id',
          'name',
          'owner',
          'status',
          'type',
          'class',
          'retcode',
          'subsystem',
          'phase',
          'phaseName',
          'correlator',
        ];
        logZnpResponse(log, 'getStatus', raw, result, {
          expectedKeys,
          matchesExpectation: typeof result.id === 'string' && typeof result.status === 'string',
        });
        return result;
      },
      progress
    );
  }

  async listJobFiles(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<JobFileEntry[]> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Listing job files for ${jobId}`);
        const jobs = this.getJobs(client);
        const jobIdUpper = jobId.toUpperCase();
        const response = await jobs.listSpools({ jobId: jobIdUpper });
        const items: ZnpSpoolItem[] = response.items ?? [];
        const result: JobFileEntry[] = [];
        for (const item of items) {
          const id = item.id ?? item.spoolId ?? 0;
          result.push({
            id: typeof id === 'number' ? id : parseInt(String(id), 10) || 0,
            ddname: sanitizeZnpString(item.ddname) ?? item.ddname,
            stepname: sanitizeZnpString(item.stepname) ?? item.stepname,
            dsname: sanitizeZnpString(item.dsname) ?? item.dsname,
            procstep: sanitizeZnpString(item.procstep) ?? item.procstep,
          });
        }
        log.debug('listJobFiles', { jobId: jobIdUpper, count: result.length });
        return result;
      },
      progress
    );
  }

  async readJobFile(
    systemId: SystemId,
    jobId: string,
    jobFileId: number,
    progress?: BackendProgressCallback,
    _encoding?: string
  ): Promise<ReadJobFileResult> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Reading job file ${jobFileId} for job ${jobId}`);
        const jobs = this.getJobs(client);
        const jobIdUpper = jobId.toUpperCase();
        const response = await jobs.readSpool({
          jobId: jobIdUpper,
          spoolId: jobFileId,
          localEncoding: LOCAL_ENCODING_UTF8,
        });
        let text = response.data ?? '';
        if (typeof text === 'string' && /^[A-Za-z0-9+/=]+$/.test(text.trim())) {
          try {
            text = Buffer.from(text, 'base64').toString('utf-8');
          } catch {
            // leave as-is if not valid base64
          }
        }
        return { text };
      },
      progress
    );
  }

  async listJobs(
    systemId: SystemId,
    options?: ListJobsOptions,
    progress?: BackendProgressCallback
  ): Promise<JobEntry[]> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Listing jobs on ${systemId}`);
        const jobs = this.getJobs(client);
        const response = await jobs.listJobs({
          owner: options?.owner,
          prefix: options?.prefix,
          status: options?.status,
          maxItems: options?.maxItems,
        });
        const items: ZnpJobItem[] = response.items ?? [];
        const result: JobEntry[] = [];
        for (const item of items) {
          const id = sanitizeZnpString(item.id) ?? '';
          result.push(this.mapZnpJobToEntry(item, id));
        }
        log.debug('listJobs', { systemId, count: result.length });
        return result;
      },
      progress
    );
  }

  async getJcl(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<string> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Getting JCL for job ${jobId}`);
        const jobs = this.getJobs(client);
        const jobIdUpper = jobId.toUpperCase();
        const response = await jobs.getJcl({ jobId: jobIdUpper });
        const jcl = response.jcl ?? response.data ?? '';
        return typeof jcl === 'string' ? jcl : '';
      },
      progress
    );
  }

  async cancelJob(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Cancelling job ${jobId}`);
        const jobs = this.getJobs(client);
        await jobs.cancelJob({ jobId: jobId.toUpperCase() });
      },
      progress
    );
  }

  async holdJob(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Holding job ${jobId}`);
        const jobs = this.getJobs(client);
        await jobs.holdJob({ jobId: jobId.toUpperCase() });
      },
      progress
    );
  }

  async releaseJob(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Releasing job ${jobId}`);
        const jobs = this.getJobs(client);
        await jobs.releaseJob({ jobId: jobId.toUpperCase() });
      },
      progress
    );
  }

  async deleteJob(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<void> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Deleting job ${jobId}`);
        const jobs = this.getJobs(client);
        await jobs.deleteJob({ jobId: jobId.toUpperCase() });
      },
      progress
    );
  }

  async submitJobFromDataset(
    systemId: SystemId,
    dsn: string,
    progress?: BackendProgressCallback
  ): Promise<SubmitJobResult> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Submitting job from data set ${dsn}`);
        const jobs = this.getJobs(client);
        const dsnUpper = dsn.toUpperCase();
        const response = await jobs.submitJob({ dsname: dsnUpper });
        const jobId = response.jobId ?? '';
        const jobName = response.jobName ?? '';
        if (!jobId) {
          throw new Error('Submit job from data set did not return a job ID');
        }
        return { jobId, jobName };
      },
      progress
    );
  }

  async submitJobFromUss(
    systemId: SystemId,
    path: string,
    progress?: BackendProgressCallback
  ): Promise<SubmitJobResult> {
    return this.withNativeClient(
      systemId,
      undefined,
      async client => {
        progress?.(`Submitting job from USS ${path}`);
        const jobs = this.getJobs(client);
        const response = await jobs.submitUss({ fspath: path });
        const jobId = response.jobId ?? '';
        const jobName = response.jobName ?? '';
        if (!jobId) {
          throw new Error('Submit job from USS did not return a job ID');
        }
        return { jobId, jobName };
      },
      progress
    );
  }
}
