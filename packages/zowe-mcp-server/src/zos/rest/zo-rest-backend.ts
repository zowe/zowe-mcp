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

import { UtilsApi, type certificates as ZowexCerts } from '@zowe/zowex-for-zowe-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { getVerifiedRequestIdentity } from '../../auth/request-identity.js';
import type * as B from '../backend.js';
import { resolveDsn, resolvePattern } from '../dsn.js';
import { memberPatternToRegExp } from '../member-pattern.js';
import {
  mapCertActionResult,
  mapCertificateDetails,
  mapCertificateExport,
  mapDatasetToEntry,
  mapJobToEntry,
  mapMemberToEntry,
  mapSearchSummary,
  type ZoDatasetItem,
  type ZoMemberItem,
} from '../zo-mappers.js';
import { parseRestJson, type ZoRestApi } from './api.js';
import { RestError, type RestResponse } from './http.js';

function datasetPath(dsn: string, member?: string): string {
  const resolved = resolveDsn(dsn, member);
  return encodeURIComponent(
    resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn
  );
}

function filePath(path: string): string {
  if (!path.startsWith('/') || path.includes('\0'))
    throw new Error('An absolute USS path is required.');
  return posix.normalize(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function contentHeaders(encoding: string, etag?: string): Record<string, string> {
  if (/[\r\n;]/.test(encoding)) throw new Error('Invalid content encoding.');
  return {
    'X-IBM-Data-Type': encoding === 'binary' ? 'binary' : `text;fileEncoding=${encoding}`,
    'Content-Type':
      encoding === 'binary' ? 'application/octet-stream' : 'text/plain; charset=UTF-8',
    ...(etag ? { 'If-Match': etag } : {}),
  };
}

function contentText(response: RestResponse, encoding: string): string {
  return response.body.toString(encoding === 'binary' ? 'base64' : 'utf8');
}

/** Implements the documented zo-rest surfaces; no SSH connection or implicit transport fallback. */
export class ZoRestBackend implements B.ZosBackend {
  readonly instructions =
    'This server connects to zo over REST. TSO commands are stateless: each runs in a fresh environment with no retained prefix, allocations, or variables. Use fully qualified quoted data set names. USS home lookup and UNIX/console commands are unavailable; use absolute USS paths or changeUssDirectory with an absolute path. To submit JCL from USS, read it and use submitJob. A write conflict requires a fresh read and conflict resolution; never replay a failed mutation automatically.';
  /** These operations require facilities absent from zo-rest 0.6.0. */
  readonly unsupportedTools = [
    'runSafeUssCommand',
    'runConsoleCommand',
    'display',
    'getUssHome',
    'submitJobFromUss',
  ] as const;

  constructor(private readonly apis: Map<string, ZoRestApi>) {}

  getConnectionStatuses(): B.BackendConnectionStatus[] {
    return [...this.apis].map(([system, api]) => ({
      system,
      backend: 'zo-rest',
      endpoint: api.connection.url,
      configuredUser: api.connection.user,
      configuredDeployment: api.connection.deployment,
      ...api.getStatus(),
      unsupportedTools: this.unsupportedTools,
    }));
  }

  getCacheIdentity(): string {
    // Conservatively scope the shared tool cache to the whole backend. A token rotation
    // or one system's auth transition may cause cache misses for other systems; this
    // protects results without changing backend-agnostic system routing.
    const identity = getVerifiedRequestIdentity();
    const modes = [...this.apis.values()].map(api => api.getCacheIdentity());
    return createHash('sha256')
      .update(JSON.stringify([identity?.accessToken ?? '', modes]))
      .digest('hex');
  }

  private api(systemId: string, userId?: string): ZoRestApi {
    const api = this.apis.get(systemId);
    if (!api) throw new Error(`No zo-rest connection for system ${systemId}.`);
    if (userId && userId.toUpperCase() !== api.connection.user)
      throw new Error(`No zo-rest connection for user ${userId} on ${systemId}.`);
    return api;
  }

  private async listing<T extends { name: string }>(
    systemId: string,
    route: string,
    query: object
  ): Promise<T[]> {
    const items: T[] = [];
    let start: string | undefined;
    for (;;) {
      const page = await this.api(systemId).json<{ items: T[]; moreRows?: boolean }>('zo', route, {
        query: { ...query, maxItems: 1000, start },
      });
      const next = page.items.at(-1)?.name;
      items.push(...page.items.filter(item => item.name !== start));
      if (!page.moreRows) return items;
      if (!next || next === start || items.length >= 100_000)
        throw new Error(
          'zo-rest listing cannot advance past its limit. Narrow the pattern to retrieve a complete result.'
        );
      start = next;
    }
  }

  async listDatasets(
    systemId: string,
    pattern: string,
    volser?: string,
    userId?: string,
    attributes = true
  ): Promise<B.DatasetEntry[]> {
    this.api(systemId, userId);
    const items = await this.listing<ZoDatasetItem>(systemId, 'ds', {
      pattern: resolvePattern(pattern),
      volser,
      attributes,
    });
    return items.map(mapDatasetToEntry);
  }

  async listMembers(systemId: string, dsn: string, pattern?: string): Promise<B.MemberEntry[]> {
    const items = await this.listing<ZoMemberItem>(systemId, `ds/${datasetPath(dsn)}/members`, {
      pattern: pattern?.replace(/%/g, '?'),
      attributes: true,
    });
    const regex = pattern ? memberPatternToRegExp(pattern) : undefined;
    return items
      .map(mapMemberToEntry)
      .filter(item => !regex || regex.test(item.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async readDataset(
    systemId: string,
    dsn: string,
    member?: string,
    encoding = 'IBM-037'
  ): Promise<B.ReadDatasetResult> {
    const response = await this.api(systemId).request(
      'zosmf',
      `restfiles/ds/${datasetPath(dsn, member)}`,
      { headers: contentHeaders(encoding) }
    );
    return {
      text: contentText(response, encoding),
      etag: String(response.headers.etag ?? ''),
      encoding,
    };
  }

  async writeDataset(
    systemId: string,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    encoding = 'IBM-037',
    startLine?: number,
    endLine?: number
  ): Promise<B.WriteDatasetResult> {
    if (endLine !== undefined && startLine === undefined)
      throw new Error('endLine requires startLine.');
    if (startLine !== undefined) {
      if (encoding === 'binary')
        throw new Error(
          'Binary writes replace the whole data set; line ranges are not supported.'
        );
      if (
        !Number.isInteger(startLine) ||
        startLine < 1 ||
        (endLine !== undefined && (!Number.isInteger(endLine) || endLine < startLine))
      )
        throw new Error('Invalid data set line range.');
      const current = await this.readDataset(systemId, dsn, member, encoding);
      if (!current.etag || (etag !== undefined && etag !== current.etag))
        throw new RestError(412, 'ETag does not match the current data set.');
      const lines = current.text.split(/\r?\n/);
      const replacement = content.split(/\r?\n/);
      while (lines.length < startLine - 1) lines.push('');
      lines.splice(
        startLine - 1,
        endLine === undefined ? replacement.length : endLine - startLine + 1,
        ...replacement
      );
      content = lines.join('\n');
      etag = current.etag;
    }
    const response = await this.api(systemId).request(
      'zosmf',
      `restfiles/ds/${datasetPath(dsn, member)}`,
      {
        method: 'PUT',
        headers: contentHeaders(encoding, etag),
        body: encoding === 'binary' ? Buffer.from(content, 'base64') : content,
      }
    );
    return {
      etag: String(response.headers.etag ?? ''),
      ...(response.headers['x-zo-truncation-warning']
        ? { warning: String(response.headers['x-zo-truncation-warning']) }
        : {}),
    };
  }

  async createDataset(
    systemId: string,
    dsn: string,
    options: B.CreateDatasetOptions
  ): Promise<B.CreateDatasetResult> {
    const recfm = options.recfm ?? 'FB';
    const lrecl = options.lrecl ?? 80;
    const blksz = options.blksz ?? (recfm === 'FB' ? Math.floor(27920 / lrecl) * lrecl : 27920);
    const dirblk = options.type === 'PO' ? (options.dirblk ?? 5) : undefined;
    await this.api(systemId).request('zosmf', `restfiles/ds/${datasetPath(dsn)}`, {
      method: 'POST',
      json: {
        dsorg: options.type === 'PO-E' ? 'PO' : options.type,
        ...(options.type === 'PO-E' ? { dsntype: 'LIBRARY' } : {}),
        recfm,
        lrecl,
        blksize: blksz,
        alcunit: 'TRK',
        primary: options.primary ?? 1,
        secondary: options.secondary,
        dirblk,
        volser: options.volser,
        dataclass: options.dataClass,
        storclass: options.storageClass,
        mgntclass: options.managementClass,
      },
    });
    return {
      applied: {
        dsorg: options.type,
        recfm,
        lrecl,
        blksz,
        dirblk,
        primary: options.primary ?? 1,
        secondary: options.secondary,
      },
      messages: [
        'Data set created on z/OS. Allocation defaults were supplied; SMS may override these attributes.',
      ],
    };
  }

  async deleteDataset(systemId: string, dsn: string, member?: string): Promise<void> {
    await this.api(systemId).request('zosmf', `restfiles/ds/${datasetPath(dsn, member)}`, {
      method: 'DELETE',
    });
  }

  async getAttributes(systemId: string, dsn: string): Promise<B.DatasetAttributes> {
    const name = resolveDsn(dsn).dsn;
    const entry = (await this.listDatasets(systemId, name)).find(item => item.dsn === name);
    if (!entry) throw new RestError(404, `Data set ${name} was not found.`);
    return {
      ...entry,
      smsClass: { data: entry.dataclass, storage: entry.storclass, management: entry.mgmtclass },
    };
  }

  private async datasetUtility(
    systemId: string,
    dsn: string,
    json: object,
    member?: string
  ): Promise<void> {
    await this.api(systemId).request('zosmf', `restfiles/ds/${datasetPath(dsn, member)}`, {
      method: 'PUT',
      json,
    });
  }

  async copyDataset(
    systemId: string,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string
  ): Promise<void> {
    const source = resolveDsn(sourceDsn, sourceMember);
    await this.datasetUtility(
      systemId,
      targetDsn,
      {
        request: 'copy',
        'from-dataset': { dsn: source.dsn, member: source.member },
        replace: false,
      },
      targetMember
    );
  }

  async renameDataset(
    systemId: string,
    dsn: string,
    newDsn: string,
    member?: string,
    newMember?: string
  ): Promise<void> {
    const source = resolveDsn(dsn, member);
    await this.datasetUtility(
      systemId,
      newDsn,
      { request: 'rename', 'from-dataset': { dsn: source.dsn, member: source.member } },
      newMember
    );
  }

  async restoreDataset(systemId: string, dsn: string): Promise<void> {
    await this.datasetUtility(systemId, dsn, { request: 'hrecall' });
  }

  async searchInDataset(
    systemId: string,
    dsn: string,
    options: B.SearchInDatasetOptions
  ): Promise<B.SearchInDatasetResult> {
    const response = await this.api(systemId).json<{ data: string }>(
      'zo',
      `ds/${datasetPath(dsn, options.member)}/search`,
      { query: { string: options.string, parms: options.parms } }
    );
    const parsed = UtilsApi.tools.parseSearchOutput(response.data);
    if (parsed.summary.linesFound > 0 && parsed.members.length === 0)
      throw new Error(
        'zo-rest SuperC output contains matches but could not be parsed. Narrow the search or read the target member.'
      );
    return {
      dataset: dsn,
      members: parsed.members.map(member => ({
        name: member.name ?? '',
        matches: member.matches,
      })),
      summary: mapSearchSummary(parsed.summary, options),
    };
  }

  async listUssFiles(
    systemId: string,
    path: string,
    options?: B.ListUssFilesOptions,
    userId?: string
  ): Promise<B.UssFileEntry[]> {
    const response = await this.api(systemId, userId).json<{
      items: B.UssFileEntry[];
      returnedRows?: number;
      totalRows?: number;
    }>('zo', 'fs/list', {
      query: { path, depth: options?.depth ?? 1, maxItems: options?.maxItems ?? 100_000 },
    });
    if (response.totalRows !== undefined && response.totalRows > response.items.length)
      throw new Error(
        'zo-rest USS listing was truncated. Use a narrower directory or smaller depth.'
      );
    return response.items
      .filter(
        item => (options?.includeHidden ?? false) || !posix.basename(item.name).startsWith('.')
      )
      .map(item => ({ ...item, isDirectory: item.mode?.startsWith('d') }));
  }

  async readUssFile(
    systemId: string,
    path: string,
    encoding = 'IBM-1047',
    userId?: string
  ): Promise<B.ReadUssFileResult> {
    const response = await this.api(systemId, userId).request(
      'zosmf',
      `restfiles/fs/${filePath(path)}`,
      { headers: contentHeaders(encoding) }
    );
    return {
      text: contentText(response, encoding),
      etag: String(response.headers.etag ?? ''),
      encoding,
    };
  }

  async writeUssFile(
    systemId: string,
    path: string,
    content: string,
    etag?: string,
    encoding = 'IBM-1047',
    userId?: string
  ): Promise<B.WriteUssFileResult> {
    const response = await this.api(systemId, userId).request(
      'zosmf',
      `restfiles/fs/${filePath(path)}`,
      {
        method: 'PUT',
        headers: contentHeaders(encoding, etag),
        body: encoding === 'binary' ? Buffer.from(content, 'base64') : content,
      }
    );
    return { etag: String(response.headers.etag ?? ''), created: response.status === 201 };
  }

  async createUssFile(
    systemId: string,
    path: string,
    options: B.CreateUssFileOptions,
    userId?: string
  ): Promise<void> {
    await this.api(systemId, userId).request('zosmf', `restfiles/fs/${filePath(path)}`, {
      method: 'POST',
      // zo accepts octal or symbolic modes. Preserve all four octal digits, including special bits.
      json: { type: options.isDirectory ? 'directory' : 'file', mode: options.permissions },
    });
  }

  async deleteUssFile(
    systemId: string,
    path: string,
    recursive = false,
    userId?: string
  ): Promise<void> {
    await this.api(systemId, userId).request('zosmf', `restfiles/fs/${filePath(path)}`, {
      method: 'DELETE',
      headers: recursive ? { 'X-IBM-Option': 'recursive' } : {},
    });
  }

  private async fileUtility(
    systemId: string,
    path: string,
    json: object,
    userId?: string
  ): Promise<void> {
    await this.api(systemId, userId).request('zosmf', `restfiles/fs/${filePath(path)}`, {
      method: 'PUT',
      json,
    });
  }

  async chmodUssFile(
    systemId: string,
    path: string,
    mode: string,
    recursive = false,
    userId?: string
  ): Promise<void> {
    await this.fileUtility(systemId, path, { request: 'chmod', mode, recursive }, userId);
  }

  async chownUssFile(
    systemId: string,
    path: string,
    owner: string,
    recursive = false,
    userId?: string
  ): Promise<void> {
    const [user, group] = owner.split(':');
    if (!user)
      throw new Error(
        'zo-rest does not support changing only the group. Supply an owner, optionally followed by :group.'
      );
    await this.fileUtility(
      systemId,
      path,
      { request: 'chown', owner: user, group, recursive },
      userId
    );
  }

  async chtagUssFile(
    systemId: string,
    path: string,
    tag: string,
    recursive = false,
    userId?: string
  ): Promise<void> {
    await this.api(systemId, userId).request('zo', 'fs/chtag', {
      method: 'PUT',
      json: { path, tag, recursive },
    });
  }

  async copyUssFile(
    systemId: string,
    sourcePath: string,
    targetPath: string,
    options?: B.CopyUssFileOptions,
    userId?: string
  ): Promise<void> {
    // Like SSH's cp, writable targets may be replaced without force. The flag means
    // cp -f (remove an unopenable target), not an atomic no-overwrite guarantee.
    await this.api(systemId, userId).request('zo', 'fs/copy', {
      method: 'POST',
      json: { from: sourcePath, to: targetPath, ...options },
    });
  }

  async runTsoCommand(systemId: string, commandText: string, userId?: string): Promise<string> {
    const response = await this.api(systemId, userId).json<{
      command: string;
      rc: number;
      output: string;
    }>('zo', 'tso/command', { method: 'POST', json: { command: commandText } });
    const output = response.output.replace(
      /^IKJ56644I NO VALID TSO USERID, DEFAULT USER ATTRIBUTES USED\s*\r?\n?/m,
      ''
    );
    // SSH reports every nonzero tsocmd RC as an execution error, including informative RC4.
    // Throw so both TSO tools return isError while retaining the host's output.
    if (response.rc !== 0)
      throw new Error(`Error running command, rc '${response.rc}'\n${output}`);
    return output;
  }

  runUnixCommand(): Promise<string> {
    return Promise.reject(
      new Error(
        'zo-rest does not provide UNIX command execution. Use the dedicated USS tools or configure an SSH backend.'
      )
    );
  }
  runConsoleCommand(): Promise<string> {
    return Promise.reject(
      new Error(
        'zo-rest does not provide console commands. Configure an SSH backend if this operation is required.'
      )
    );
  }
  getUssHome(): Promise<string> {
    return Promise.reject(
      new Error(
        'zo-rest does not expose the USS home directory. Supply an absolute USS path or use changeUssDirectory with an absolute path.'
      )
    );
  }

  async getUssTempPath(
    systemId: string,
    dirPath: string,
    prefix = 'mcp-',
    userId?: string
  ): Promise<string> {
    filePath(dirPath);
    if (prefix.includes('/') || prefix.includes('\0'))
      throw new Error('Temporary path prefix must be a filename prefix without a slash or NUL.');
    const api = this.api(systemId, userId);
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = posix.join(dirPath, `${prefix}${randomUUID()}`);
      try {
        // depth=0 lists the exact path itself, including an existing directory, without
        // enumerating its contents. A 404 verifies absence; it does not reserve the name.
        await api.request('zo', 'fs/list', { query: { path: candidate, depth: 0, maxItems: 1 } });
      } catch (error) {
        if (error instanceof RestError && error.status === 404) return candidate;
        throw error;
      }
    }
    throw new Error('Could not find a unique temporary USS path after 20 attempts.');
  }

  getUssTempDir(systemId: string, basePath: string, userId?: string): Promise<string> {
    return this.getUssTempPath(systemId, basePath, 'mcp-', userId);
  }

  async deleteUssUnderPath(
    systemId: string,
    path: string,
    userId?: string
  ): Promise<{ deleted: string[] }> {
    await this.deleteUssFile(systemId, path, true, userId);
    return { deleted: [path] };
  }

  async submitJob(systemId: string, jcl: string): Promise<B.SubmitJobResult> {
    const job = await this.api(systemId).json<B.JobEntry>('zo', 'jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      query: { encoding: 'IBM-1047' },
      body: jcl,
    });
    return { jobId: job.id, jobName: job.name };
  }

  async getJobStatus(systemId: string, jobId: string): Promise<B.JobStatusResult> {
    return mapJobToEntry(
      await this.api(systemId).json<B.JobEntry>('zo', `jobs/${encodeURIComponent(jobId)}`),
      jobId
    );
  }
  async listJobFiles(systemId: string, jobId: string): Promise<B.JobFileEntry[]> {
    const files = await this.api(systemId).json<B.JobFileEntry[]>(
      'zo',
      `jobs/${encodeURIComponent(jobId)}/spool`
    );
    return files.map(({ id, ddname, stepname, dsname, procstep }) => ({
      id,
      ddname,
      stepname,
      dsname,
      procstep,
    }));
  }
  async listJobs(systemId: string, options?: B.ListJobsOptions): Promise<B.JobEntry[]> {
    const jobs = await this.api(systemId).json<B.JobEntry[]>('zo', 'jobs', {
      query: { ...options, maxItems: options?.maxItems ?? 1000 },
    });
    return jobs.map(job => mapJobToEntry(job));
  }

  async readJobFile(
    systemId: string,
    jobId: string,
    jobFileId: number,
    _progress?: B.BackendProgressCallback,
    encoding = 'IBM-1047'
  ): Promise<B.ReadJobFileResult> {
    const response = await this.api(systemId).request(
      'zo',
      `jobs/${encodeURIComponent(jobId)}/spool/${jobFileId}`,
      { query: { encoding } }
    );
    return { text: contentText(response, encoding), encoding };
  }

  async getJcl(systemId: string, jobId: string): Promise<string> {
    return (
      await this.api(systemId).request('zo', `jobs/${encodeURIComponent(jobId)}/jcl`)
    ).body.toString('utf8');
  }
  private async jobAction(systemId: string, jobId: string, action?: string): Promise<void> {
    await this.api(systemId).request(
      'zo',
      `jobs/${encodeURIComponent(jobId)}${action ? `/${action}` : ''}`,
      { method: action ? 'POST' : 'DELETE' }
    );
  }
  cancelJob(systemId: string, jobId: string): Promise<void> {
    return this.jobAction(systemId, jobId, 'cancel');
  }
  holdJob(systemId: string, jobId: string): Promise<void> {
    return this.jobAction(systemId, jobId, 'hold');
  }
  releaseJob(systemId: string, jobId: string): Promise<void> {
    return this.jobAction(systemId, jobId, 'release');
  }
  deleteJob(systemId: string, jobId: string): Promise<void> {
    return this.jobAction(systemId, jobId);
  }

  async submitJobFromDataset(systemId: string, dsn: string): Promise<B.SubmitJobResult> {
    const resolved = resolveDsn(dsn);
    const job = await this.api(systemId).json<B.JobEntry>('zo', 'jobs/dataset', {
      method: 'POST',
      json: { dsname: resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn },
    });
    return { jobId: job.id, jobName: job.name };
  }

  submitJobFromUss(): Promise<B.SubmitJobResult> {
    return Promise.reject(
      new Error(
        'zo-rest does not support job submission from a USS file. Read the JCL and use submitJob.'
      )
    );
  }

  async listApfLibraries(systemId: string, userId?: string): Promise<B.ListApfResult> {
    const response = await this.api(systemId, userId).json<{
      items: { dsname: string; volume: string }[];
    }>('zo', 'system/apf');
    return { items: response.items.map(item => ({ dsn: item.dsname, volser: item.volume })) };
  }
  private async concatenation(
    systemId: string,
    kind: string,
    userId?: string
  ): Promise<B.ListProclibResult> {
    const response = await this.api(systemId, userId).json<{ items: string[] }>(
      'zo',
      `system/${kind}`
    );
    return { items: response.items.map(dsn => ({ dsn })) };
  }
  listProclib(systemId: string, userId?: string): Promise<B.ListProclibResult> {
    return this.concatenation(systemId, 'proclib', userId);
  }
  listParmlib(systemId: string, userId?: string): Promise<B.ListParmlibResult> {
    return this.concatenation(systemId, 'parmlib', userId);
  }
  async listLinklist(systemId: string, userId?: string): Promise<B.ListLinklistResult> {
    const response = await this.api(systemId, userId).json<{
      items: { dsname: string; volume: string; apf: boolean }[];
    }>('zo', 'system/linklist');
    return {
      items: response.items.map(item => ({
        dsn: item.dsname,
        volser: item.volume,
        apfAuthorized: item.apf,
      })),
    };
  }
  async viewSyslog(
    systemId: string,
    options?: B.ViewSyslogOptions,
    userId?: string
  ): Promise<B.ViewSyslogResult> {
    const { data, ...metadata } = await this.api(systemId, userId).json<
      { data: string } & Omit<B.ViewSyslogResult, 'text'>
    >('zo', 'system/syslog', { query: options });
    return { ...metadata, text: data };
  }

  private certificatePath(options: B.ShowCertificateOptions): string {
    return `keyrings/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.keyring)}/certificates/${encodeURIComponent(options.label)}`;
  }
  private async certificateAction(
    systemId: string,
    route: string,
    method: string,
    json?: object,
    userId?: string
  ): Promise<B.CertActionResult> {
    const response = await this.api(systemId, userId).request('zo', route, { method, json });
    if (!response.body.length) return {};
    return mapCertActionResult(parseRestJson<ZowexCerts.CertCommandResponse>(response));
  }
  async showCertificate(
    systemId: string,
    options: B.ShowCertificateOptions,
    userId?: string
  ): Promise<B.ShowCertificateResult> {
    return mapCertificateDetails(
      await this.api(systemId, userId).json<ZowexCerts.ShowCertificateResponse>(
        'zo',
        this.certificatePath(options)
      )
    );
  }
  connectCertificate(
    systemId: string,
    options: B.ConnectCertificateOptions,
    userId?: string
  ): Promise<B.CertActionResult> {
    return this.certificateAction(
      systemId,
      this.certificatePath(options),
      'PUT',
      {
        request: 'connect',
        fromRing: options.fromRing,
        fromDatabase: options.fromDatabase,
        usage: options.usage,
        default: options.isDefault,
      },
      userId
    );
  }
  setDefaultCertificate(
    systemId: string,
    options: B.SetDefaultCertificateOptions,
    userId?: string
  ): Promise<B.CertActionResult> {
    return this.certificateAction(
      systemId,
      this.certificatePath(options),
      'PUT',
      { request: 'set-default' },
      userId
    );
  }
  trustCertificate(
    systemId: string,
    options: B.TrustCertificateOptions,
    userId?: string
  ): Promise<B.CertActionResult> {
    return this.certificateAction(
      systemId,
      `certificates/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.label)}`,
      'PUT',
      { request: 'trust', status: options.status },
      userId
    );
  }
  renameCertificate(
    systemId: string,
    options: B.RenameCertificateOptions,
    userId?: string
  ): Promise<B.CertActionResult> {
    return this.certificateAction(
      systemId,
      `certificates/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.label)}`,
      'PUT',
      { request: 'rename', newLabel: options.newLabel },
      userId
    );
  }
  async deleteCertificate(
    systemId: string,
    options: B.DeleteCertificateOptions,
    userId?: string
  ): Promise<B.CertActionResult> {
    const route = options.database
      ? `certificates/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.label)}`
      : this.certificatePath({ ...options, keyring: options.keyring ?? '' });
    const response = await this.api(systemId, userId).request('zo', route, {
      method: 'DELETE',
      query: { skipRefresh: options.skipRefresh },
    });
    return response.body.length
      ? mapCertActionResult(parseRestJson<ZowexCerts.CertCommandResponse>(response))
      : {};
  }
  async exportCertificate(
    systemId: string,
    options: B.ExportCertificateOptions,
    userId?: string
  ): Promise<B.ExportCertificateResult> {
    const route = `${this.certificatePath(options)}/export`;
    if (!options.file && (options.format ?? 'pem') === 'pem') {
      return mapCertificateExport(
        await this.api(systemId, userId).json<ZowexCerts.ExportCertificateResponse>('zo', route)
      );
    }
    return mapCertificateExport(
      await this.api(systemId, userId).json<ZowexCerts.ExportCertificateResponse>('zo', route, {
        method: 'POST',
        json: { format: options.format ?? 'pem', file: options.file, password: options.password },
      })
    );
  }
  async importCertificate(
    systemId: string,
    options: B.ImportCertificateOptions,
    userId?: string
  ): Promise<B.ImportCertificateResult> {
    const response = await this.api(systemId, userId).json<ZowexCerts.ImportCertificateResponse>(
      'zo',
      'certificates/import',
      {
        method: 'POST',
        json: options,
      }
    );
    return {
      ...mapCertActionResult(response),
      label: response.label,
      owner: response.owner,
      keyring: response.keyring,
    };
  }
  refreshCertificateClass(systemId: string, userId?: string): Promise<B.CertActionResult> {
    return this.certificateAction(systemId, 'keyrings/refresh', 'POST', undefined, userId);
  }
}
