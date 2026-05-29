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
 * In-memory pipe registry for the zowex RPC streaming protocol.
 *
 * zowex client behaviour (see RpcStreamManager in zowex-sdk):
 *
 *   GET (server → client):
 *     1. RPC handler stages bytes via `registerSend(pipePath, buffer)`.
 *     2. Dispatcher emits notification {method:"sendStream", params:{id,pipePath,contentLen}}.
 *     3. Client opens exec channel `cat <pipePath>` and reads base64 from stdout.
 *     4. Stream channel decodes? No — the client wraps with base64.Decode itself.
 *        We just write **base64** bytes on the exec stdout.
 *
 *   PUT (client → server):
 *     1. RPC handler calls `awaitReceive(pipePath)` returning a Promise.
 *     2. Dispatcher emits notification {method:"receiveStream", params:{id,pipePath}}.
 *     3. Client opens exec channel `cat > <pipePath>` and writes base64 to stdin.
 *     4. Stream channel collects base64 chunks; on channel close, decodes and resolves.
 *
 * The two execs run concurrently with the original RPC channel on the same SSH
 * connection — ssh2 multiplexes them.
 */

let pipeCounter = 0;

export function nextPipePath(): string {
  pipeCounter += 1;
  return `/tmp/zrs-pipe-${process.pid}-${pipeCounter}`;
}

interface ReceiveEntry {
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
  // Buffer of base64 bytes received so far (we collect raw and decode on close).
  chunks: Buffer[];
}

const pendingReceive = new Map<string, ReceiveEntry>();
const pendingSend = new Map<string, Buffer>();

/** RPC handler: register that a stream of bytes will be received from the client. */
export function awaitReceive(pipePath: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    pendingReceive.set(pipePath, { resolve, reject, chunks: [] });
  });
}

/** RPC handler: stage bytes to be sent to the client when it opens `cat <pipePath>`. */
export function registerSend(pipePath: string, body: Buffer): void {
  pendingSend.set(pipePath, body);
}

/** Stream channel: a `cat > pipePath` exec opened by the client. */
export function isReceiveChannel(pipePath: string): boolean {
  return pendingReceive.has(pipePath);
}

/** Stream channel: a `cat pipePath` exec opened by the client. */
export function isSendChannel(pipePath: string): boolean {
  return pendingSend.has(pipePath);
}

/** Append chunk for a PUT (client → server) pipe. */
export function appendReceiveChunk(pipePath: string, chunk: Buffer): void {
  const entry = pendingReceive.get(pipePath);
  if (!entry) return;
  entry.chunks.push(chunk);
}

/** Finalize a PUT pipe — decode base64 and resolve the awaiting handler. */
export function finishReceive(pipePath: string): void {
  const entry = pendingReceive.get(pipePath);
  if (!entry) return;
  pendingReceive.delete(pipePath);
  try {
    const merged = Buffer.concat(entry.chunks);
    const decoded = Buffer.from(merged.toString('ascii'), 'base64');
    entry.resolve(decoded);
  } catch (err) {
    entry.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Reject a pending receive (channel closed prematurely). */
export function failReceive(pipePath: string, err: Error): void {
  const entry = pendingReceive.get(pipePath);
  if (!entry) return;
  pendingReceive.delete(pipePath);
  entry.reject(err);
}

/** Consume staged bytes for a GET pipe — caller writes them to the exec channel as base64. */
export function takeSendBuffer(pipePath: string): Buffer | undefined {
  const buf = pendingSend.get(pipePath);
  pendingSend.delete(pipePath);
  return buf;
}
