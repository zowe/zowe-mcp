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
 * Newline-delimited JSON-RPC 2.0 dispatcher for the mock zowex server.
 *
 * Wire framing (matches ZSshClient + RpcClientApi in zowex-sdk):
 *   Request:  {jsonrpc:"2.0",id:N,method:<command>,params:{...}}\n
 *   Response: {jsonrpc:"2.0",id:N,result:{...}}\n        (success)
 *             {jsonrpc:"2.0",id:N,error:{code,message,data}}\n  (failure)
 *   Notification (for streaming):
 *             {jsonrpc:"2.0",method:"sendStream",params:{id,pipePath,contentLen}}\n
 *             {jsonrpc:"2.0",method:"receiveStream",params:{id,pipePath}}\n
 *
 * The client treats `method` as the zowex command name (createDataset, listFiles,
 * submitJob, etc.); `params` carries the rest of the typed request shape.
 */

import { ZosError } from '../errors.js';
import type { MockLogger } from '../log.js';
import type { RpcHandlerContext } from './handlers.js';
import { handlers } from './handlers.js';

interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface DispatcherIo {
  /** Write one line (excluding the trailing \n) to the channel's stdout. */
  writeLine(line: string): void;
  /** Optional leveled logger. When omitted, the dispatcher is silent. */
  log?: MockLogger;
}

export type EmitNotification = (method: string, params: unknown) => void;

export interface DispatcherCtx extends RpcHandlerContext {
  emit: EmitNotification;
}

/**
 * Build a stdin handler for one client connection. The returned function ingests
 * incoming buffers, splits them on `\n`, parses each JSON-RPC frame, and dispatches.
 */
export function createDispatcher(
  io: DispatcherIo,
  ctx: RpcHandlerContext
): (chunk: Buffer) => void {
  let buffer = '';

  const emitNotification: EmitNotification = (method, params) => {
    io.writeLine(JSON.stringify({ jsonrpc: '2.0', method, params }));
  };
  const dispatchCtx: DispatcherCtx = { ...ctx, emit: emitNotification };

  return (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let nlIdx = buffer.indexOf('\n');
    while (nlIdx !== -1) {
      const line = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 1);
      nlIdx = buffer.indexOf('\n');
      if (line.length === 0) continue;
      let req: RpcRequest | undefined;
      try {
        req = JSON.parse(line) as RpcRequest;
      } catch {
        // Parse error — best-effort response with null id (we can't recover it).
        io.writeLine(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32700, message: 'Parse error' },
          })
        );
        continue;
      }
      void handleRequest(req, io, dispatchCtx);
    }
  };
}

async function handleRequest(
  req: RpcRequest,
  io: DispatcherIo,
  ctx: DispatcherCtx
): Promise<void> {
  const id = req.id;
  const params = req.params ?? {};
  const start = Date.now();

  // Per-method visibility — one info-level line per call with user + duration
  // emitted on completion. The verbose request/response bodies stay at debug.
  io.log?.('debug', `<-- ${req.method} id=${id} params=${summarizeParams(params)}`);

  // The zowex client uses the typed-request's `.command` field as the wire `method`.
  // It also wraps the rest of the request fields into `params`. zowex-sdk
  // additionally puts a numeric `stream: <requestId>` into params when streaming.
  const handler = handlers[req.method];
  let response: RpcResponse;
  let outcome: 'OK' | 'METHOD_NOT_FOUND' | 'ZOS_ERROR' | 'INTERNAL_ERROR' = 'OK';
  let errSummary: string | undefined;

  if (!handler) {
    outcome = 'METHOD_NOT_FOUND';
    errSummary = `method '${req.method}' not registered`;
    response = {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    };
  } else {
    try {
      const result = await handler(params, { ...ctx, requestId: id });
      response = { jsonrpc: '2.0', id, result: { success: true, ...result } };
    } catch (err) {
      if (err instanceof ZosError) {
        outcome = 'ZOS_ERROR';
        errSummary = err.messageId;
        response = {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32001,
            message: err.message,
            data: { messageId: err.messageId, ...(err.data as object | undefined) },
          },
        };
      } else {
        outcome = 'INTERNAL_ERROR';
        const e = err instanceof Error ? err : new Error(String(err));
        errSummary = e.message;
        response = {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: e.message },
        };
        io.log?.('error', `!!! internal error in ${req.method}: ${e.stack ?? e.message}`);
      }
    }
  }

  const duration = Date.now() - start;
  const lvl: Parameters<NonNullable<DispatcherIo['log']>>[0] =
    outcome === 'OK' ? 'info' : outcome === 'INTERNAL_ERROR' ? 'error' : 'warn';
  io.log?.(
    lvl,
    `${req.method} id=${id} user=${ctx.user.username} ${outcome}${
      errSummary ? ` (${errSummary})` : ''
    } ${duration}ms`
  );
  io.writeLine(JSON.stringify(response));
}

/**
 * Produce a compact, non-secret-leaking summary of RPC params for debug logs.
 * Truncates long strings and elides `data:` (which is a base64 payload in the
 * stream RPCs and is enormous in the debug stream).
 */
function summarizeParams(params: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'data' && typeof v === 'string') {
      out[k] = `<${v.length} chars>`;
    } else if (typeof v === 'string' && v.length > 80) {
      out[k] = v.slice(0, 80) + '…';
    } else {
      out[k] = v;
    }
  }
  return JSON.stringify(out);
}
