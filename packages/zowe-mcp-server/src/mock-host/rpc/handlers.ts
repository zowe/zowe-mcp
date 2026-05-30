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
 * RPC handlers for the mock zowex server. Each handler takes the JSON-RPC `params`
 * (the rest of the typed request after `command` was moved into the wire `method`)
 * and returns the typed response. Streaming flows go through the stream-channel
 * registry — see ds.readDataset / writeDataset and uss.readFile / writeFile below.
 *
 * Method names match the strings in zowex-sdk's RpcClientApi.
 */

import { awaitReceive, nextPipePath, registerSend } from '../channels/stream-channel.js';
import { ZosErrors } from '../errors.js';
import type { MockHostStore } from '../store.js';
import type { MockUser } from '../users.js';
import type { EmitNotification } from './dispatcher.js';

export interface RpcHandlerContext {
  store: MockHostStore;
  user: MockUser;
  systemId: string;
  /** Dispatcher fills this in before calling. */
  emit?: EmitNotification;
  requestId?: number;
}

/**
 * `params` arrives as a plain object after JSON-RPC parsing. We type it as
 * Record<string, unknown> here and cast at each call site as needed; the wire
 * shape per RPC method is documented in zowex-sdk/lib/doc/rpc/*.d.ts.
 */
type RpcParams = Record<string, unknown>;
/** Handlers may be sync or async — the dispatcher always awaits the result. */
type Handler = (params: RpcParams, ctx: RpcHandlerContext) => object | Promise<object>;

const STREAM_THRESHOLD = 64 * 1024;

function isStreamRequest(params: RpcParams): boolean {
  return typeof params.stream === 'number';
}

/** Shared streaming-send response for read operations (ds + uss). */
function buildReadResponse(
  result: { text: string; etag?: string; encoding?: string },
  params: RpcParams,
  ctx: RpcHandlerContext
): object {
  const bytes = Buffer.byteLength(result.text, 'utf8');
  if (isStreamRequest(params) && bytes > STREAM_THRESHOLD) {
    const pipePath = nextPipePath();
    registerSend(pipePath, Buffer.from(result.text, 'utf8'));
    ctx.emit?.('sendStream', { id: ctx.requestId, pipePath, contentLen: bytes });
    return { etag: result.etag, encoding: result.encoding, data: '', contentLen: bytes };
  }
  return { etag: result.etag, encoding: result.encoding, data: b64(result.text) };
}

/** Shared streaming-receive content resolution for write operations (ds + uss). */
async function resolveWriteContent(
  params: RpcParams,
  ctx: RpcHandlerContext
): Promise<{ content: string; contentLen: number }> {
  if (isStreamRequest(params)) {
    const pipePath = nextPipePath();
    const promise = awaitReceive(pipePath);
    ctx.emit?.('receiveStream', { id: ctx.requestId, pipePath });
    const buf = await promise;
    return { content: buf.toString('utf8'), contentLen: buf.length };
  }
  if (typeof params.data === 'string') {
    const content = fromB64(params.data);
    return { content, contentLen: Buffer.byteLength(content, 'utf8') };
  }
  return { content: '', contentLen: 0 };
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function fromB64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}

/** ------------------------------------------------------------------ ds.* */

const listDatasets: Handler = async (p, { store, systemId }) => {
  const items = await store.backend.listDatasets(
    systemId,
    p.pattern as string,
    p.volume as string | undefined,
    undefined,
    p.attributes !== false
  );
  // zowex `Dataset` shape uses dsname=name, blksize=blksz, etc. Map for the wire.
  return {
    items: items.map(d => ({
      name: d.dsn,
      dsorg: d.dsorg,
      recfm: d.recfm,
      lrecl: d.lrecl,
      blksize: d.blksz,
      volser: d.volser,
      cdate: d.creationDate,
    })),
    returnedRows: items.length,
  };
};

const listDsMembers: Handler = async (p, { store, systemId }) => {
  const items = await store.backend.listMembers(
    systemId,
    p.dsname as string,
    p.pattern as string | undefined
  );
  return { items: items.map(m => ({ name: m.name })), returnedRows: items.length };
};

const readDataset: Handler = async (p, ctx) => {
  const dsname = p.dsname as string;
  const match = /^([^()]+)(?:\(([^)]+)\))?$/.exec(dsname);
  const baseName = match ? match[1] : dsname;
  const member = match?.[2] ?? undefined;
  const result = await ctx.store.backend.readDataset(
    ctx.systemId,
    baseName,
    member,
    p.encoding as string | undefined
  );
  return buildReadResponse(result, p, ctx);
};

const writeDataset: Handler = async (p, ctx) => {
  const dsname = p.dsname as string;
  const match = /^([^()]+)(?:\(([^)]+)\))?$/.exec(dsname);
  const baseName = match ? match[1] : dsname;
  const member = match?.[2] ?? undefined;

  const { content, contentLen } = await resolveWriteContent(p, ctx);
  const result = await ctx.store.backend.writeDataset(
    ctx.systemId,
    baseName,
    content,
    member,
    p.etag as string | undefined,
    p.encoding as string | undefined
  );
  return { etag: result.etag, contentLen };
};

interface CreateDatasetWireAttrs {
  dsorg?: 'PS' | 'PO' | 'PO-E';
  recfm?: 'F' | 'FB' | 'V' | 'VB' | 'U' | 'FBA' | 'VBA';
  lrecl?: number;
  blksize?: number;
  primary?: number;
  secondary?: number;
  dirblk?: number;
  vol?: string;
}

const createDataset: Handler = async (p, { store, systemId }) => {
  const dsn = p.dsname as string;
  const attrs = (p.attributes ?? {}) as CreateDatasetWireAttrs;
  const dsorg = attrs.dsorg ?? 'PS';
  await store.backend.createDataset(systemId, dsn, {
    type: dsorg,
    recfm: attrs.recfm,
    lrecl: attrs.lrecl,
    blksz: attrs.blksize,
    primary: attrs.primary,
    secondary: attrs.secondary,
    dirblk: attrs.dirblk,
    volser: attrs.vol,
  });
  return {};
};

const createMember: Handler = async (p, { store, systemId }) => {
  // CreateMember just makes an empty member; behave like writeDataset of '' for the
  // member if it doesn't exist.
  const match = /^([^()]+)\(([^)]+)\)$/.exec(p.dsname as string);
  if (!match) throw ZosErrors.internal('createMember requires DSN(member)');
  await store.backend.writeDataset(systemId, match[1], '', match[2]);
  return {};
};

const deleteDataset: Handler = async (p, { store, systemId }) => {
  const match = /^([^()]+)(?:\(([^)]+)\))?$/.exec(p.dsname as string);
  const baseName = match ? match[1] : (p.dsname as string);
  const member = match?.[2] ?? undefined;
  await store.backend.deleteDataset(systemId, baseName, member);
  return {};
};

const renameDataset: Handler = async (p, { store, systemId }) => {
  await store.backend.renameDataset(systemId, p.dsnameBefore as string, p.dsnameAfter as string);
  return {};
};

const renameMember: Handler = async (p, { store, systemId }) => {
  await store.backend.renameDataset(
    systemId,
    p.dsname as string,
    p.dsname as string,
    p.memberBefore as string,
    p.memberAfter as string
  );
  return {};
};

const restoreDataset: Handler = () => ({});

/** ------------------------------------------------------------------ uss.* */

const listFiles: Handler = async (p, { store, systemId }) => {
  const items = await store.backend.listUssFiles(systemId, p.fspath as string, {
    longFormat: true,
    includeHidden: p.all === true,
  });
  return {
    items: items.map(it => ({
      name: it.name,
      size: it.size,
      mtime: it.mtime,
      mode: it.mode,
    })),
    returnedRows: items.length,
  };
};

const readFile: Handler = async (p, ctx) => {
  const result = await ctx.store.backend.readUssFile(ctx.systemId, p.fspath as string);
  return buildReadResponse(result, p, ctx);
};

const writeFile: Handler = async (p, ctx) => {
  const { content, contentLen } = await resolveWriteContent(p, ctx);
  const result = await ctx.store.backend.writeUssFile(
    ctx.systemId,
    p.fspath as string,
    content,
    p.etag as string | undefined
  );
  return { etag: result.etag, contentLen };
};

const createFile: Handler = async (p, { store, systemId }) => {
  await store.backend.createUssFile(systemId, p.fspath as string, {
    isDirectory: p.isDir === true,
    permissions: p.mode as string | undefined,
  });
  return {};
};

const deleteFile: Handler = async (p, { store, systemId }) => {
  await store.backend.deleteUssFile(systemId, p.fspath as string, p.recursive === true);
  return {};
};

const chmodFile: Handler = async (p, { store, systemId }) => {
  await store.backend.chmodUssFile(
    systemId,
    p.fspath as string,
    p.mode as string,
    p.recursive === true
  );
  return {};
};

const chownFile: Handler = async (p, { store, systemId }) => {
  await store.backend.chownUssFile(
    systemId,
    p.fspath as string,
    p.owner as string,
    p.recursive === true
  );
  return {};
};

const chtagFile: Handler = async (p, { store, systemId }) => {
  await store.backend.chtagUssFile(
    systemId,
    p.fspath as string,
    p.tag as string,
    p.recursive === true
  );
  return {};
};

const copyUss: Handler = async (p, { store, systemId }) => {
  // Wire schema: { srcFsPath, dstFsPath, recursive?, followSymlinks?, overwrite? }
  await store.backend.copyUssFile(systemId, p.srcFsPath as string, p.dstFsPath as string, {
    recursive: p.recursive === true,
    force: p.overwrite === true,
  });
  return {};
};

const moveFile: Handler = async (p, { store, systemId }) => {
  // Wire schema: { source, target }
  const src = p.source as string;
  const dst = p.target as string;
  await store.backend.copyUssFile(systemId, src, dst, { recursive: true, force: true });
  await store.backend.deleteUssFile(systemId, src, true);
  return {};
};

const unixCommand: Handler = async (p, { store, systemId, user }) => {
  // Wire schema: { commandText } → { data: string }  (plain, NOT base64)
  const output = await store.backend.runUnixCommand(
    systemId,
    p.commandText as string,
    user.username.toLowerCase()
  );
  return { data: output };
};

/** ------------------------------------------------------------------ jobs.* */

const submitJob: Handler = async (p, { store, systemId, user }) => {
  const dsname = p.dsname as string | undefined;
  if (!dsname) throw ZosErrors.internal('submitJob requires dsname');
  const match = /^([^()]+)(?:\(([^)]+)\))?$/.exec(dsname);
  if (!match) throw ZosErrors.internal('Invalid dsname for submitJob');
  const r = await store.backend.readDataset(systemId, match[1], match[2]);
  const meta = await store.jobs.submit(systemId, r.text, user.username);
  return { jobId: meta.id, jobName: meta.name };
};

const submitJcl: Handler = async (p, { store, systemId, user }) => {
  // The wire RPC sends JCL as base64 in `jcl`.
  const raw = p.jcl as string;
  const text = looksLikeBase64(raw) ? fromB64(raw) : raw;
  const meta = await store.jobs.submit(systemId, text, user.username);
  return { jobId: meta.id, jobName: meta.name };
};

const submitUss: Handler = async (p, { store, systemId, user }) => {
  const r = await store.backend.readUssFile(systemId, p.fspath as string);
  const meta = await store.jobs.submit(systemId, r.text, user.username);
  return { jobId: meta.id, jobName: meta.name };
};

function looksLikeBase64(s: string): boolean {
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && !s.includes('//');
}

const getJobStatus: Handler = async (p, { store, systemId }) => {
  const meta = await store.jobs.getStatus(systemId, p.jobId as string);
  // Response shape extends common.Job (id, name, owner, status, ...). Flatten.
  return jobMetaToWire(meta);
};

const listJobs: Handler = async (p, { store, systemId, user }) => {
  const owner = (p.owner as string) || user.username;
  const items = await store.jobs.list(systemId, {
    owner,
    prefix: p.prefix as string | undefined,
  });
  return { items: items.map(jobMetaToWire), returnedRows: items.length };
};

const listSpools: Handler = async (p, { store, systemId }) => {
  const items = await store.jobs.listSpools(systemId, p.jobId as string);
  return {
    items: items.map(s => ({
      id: s.id,
      ddname: s.ddname,
      stepname: s.stepname,
      procstep: s.procstep,
      dsname: s.dsname,
    })),
    returnedRows: items.length,
  };
};

const readSpool: Handler = async (p, ctx) => {
  const body = await ctx.store.jobs.readSpool(
    ctx.systemId,
    p.jobId as string,
    Number(p.spoolId ?? p.dsnKey ?? 1)
  );
  const bytes = Buffer.byteLength(body, 'utf8');
  if (isStreamRequest(p) && bytes > STREAM_THRESHOLD) {
    const pipePath = nextPipePath();
    registerSend(pipePath, Buffer.from(body, 'utf8'));
    ctx.emit?.('sendStream', { id: ctx.requestId, pipePath, contentLen: bytes });
    return { data: '', contentLen: bytes };
  }
  return { data: b64(body) };
};

const getJcl: Handler = async (p, { store, systemId }) => {
  const jcl = await store.jobs.getJcl(systemId, p.jobId as string);
  // wire schema: { data: string } (plain text, NOT base64) - native-backend prefers
  // response.jcl then falls back to response.data.
  return { data: jcl };
};

const cancelJob: Handler = async (p, { store, systemId }) => {
  await store.jobs.cancel(systemId, p.jobId as string);
  return {};
};

const holdJob: Handler = async (p, { store, systemId }) => {
  await store.jobs.hold(systemId, p.jobId as string);
  return {};
};

const releaseJob: Handler = async (p, { store, systemId }) => {
  await store.jobs.release(systemId, p.jobId as string);
  return {};
};

const deleteJob: Handler = async (p, { store, systemId }) => {
  await store.jobs.deleteJob(systemId, p.jobId as string);
  return {};
};

function jobMetaToWire(meta: import('../jobs.js').JobMeta): object {
  return {
    id: meta.id,
    name: meta.name,
    owner: meta.owner,
    type: meta.type,
    class: meta.class,
    status: meta.status,
    retcode: meta.retcode,
    phase: meta.phase,
    phaseName: meta.phaseName,
  };
}

/** ----------------------------------------------------------- tool / tso / console / core */

const toolSearch: Handler = async (p, { store, systemId }) => {
  // Wire schema: { dsname, string, parms? } → { data: string }  (plain SuperC-style output)
  const result = await store.backend.searchInDataset(systemId, p.dsname as string, {
    string: p.string as string,
    parms: (p.parms as string | undefined) ?? 'ANYC',
  });
  const lines: string[] = [];
  for (const m of result.members) {
    for (const match of m.matches) {
      lines.push(`${m.name}:${match.lineNumber}: ${match.content}`);
    }
  }
  return { data: lines.join('\n') };
};

const tsoCommand: Handler = async (p, { store, systemId, user }) => {
  // Wire schema: { commandText } → { data: string }  (plain)
  const output = await store.backend.runTsoCommand(
    systemId,
    p.commandText as string,
    user.username.toLowerCase()
  );
  return { data: output };
};

const consoleCommand: Handler = async (p, { store, systemId, user }) => {
  // Wire schema: { commandText, consoleName? } → { data: string }  (plain)
  const output = await store.backend.runConsoleCommand(
    systemId,
    p.commandText as string,
    p.consoleName as string | undefined,
    user.username.toLowerCase()
  );
  return { data: output };
};

const getInfo: Handler = () => ({
  zoweVersion: '0.4.0-mock',
  zosVersion: 'OS/390 28.00',
  jesType: 'JES2',
  sysname: 'SY1',
  sysplex: 'SYSPLEX1',
  defaultEncoding: 'IBM-1047',
});

/** Wire-method → handler map. */
export const handlers: Record<string, Handler> = {
  // ds.*
  listDatasets,
  listDsMembers,
  readDataset,
  writeDataset,
  createDataset,
  createMember,
  deleteDataset,
  renameDataset,
  renameMember,
  restoreDataset,
  // uss.*
  listFiles,
  readFile,
  writeFile,
  createFile,
  deleteFile,
  chmodFile,
  chownFile,
  chtagFile,
  copyUss,
  moveFile,
  unixCommand,
  // jobs.*
  submitJob,
  submitJcl,
  submitUss,
  getJobStatus,
  listJobs,
  listSpools,
  readSpool,
  getJcl,
  cancelJob,
  holdJob,
  releaseJob,
  deleteJob,
  // tool / tso / console / core
  toolSearch,
  tsoCommand,
  consoleCommand,
  getInfo,
};
