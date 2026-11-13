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
 * Local zowex transport (same-system execution — docs/zos-local-zowex-identity.md).
 *
 * Runs `zowex server` as a direct child of this process, switched to the
 * authenticated user's identity by the program-controlled zowex-launcher
 * (SURROGAT authority), and speaks the same newline-delimited JSON-RPC the SDK
 * speaks over an SSH exec channel. Extends the SDK's {@link RpcClientApi}, so
 * every RPC namespace (`ds`, `uss`, `jobs`, ...) is the upstream one — only the
 * transport differs. Interim shape until zowe-native-proto grows
 * `zowex server --as-user` and an SDK-level local client (stage 5).
 *
 * Identity rules (the security-relevant part):
 * - The target userid crosses to the launcher via **stdin only** — the first
 *   line of the child's stdin, never argv (visible in `ps`) and never env
 *   (inherited by children). Everything after that newline is the JSON-RPC
 *   stream, which the launcher leaves unread for the exec'd zowex.
 * - `_BPX_SHAREAS` is forced off for the spawn: the launcher's own address
 *   space must be clean for program control. The launcher then starts zowex
 *   via an identity spawn (`__spawn2` + SPAWN_SETUSERID), which always gets
 *   a new address space dubbed under the target user's complete security
 *   environment — setuid+exec is NOT used (it leaks the invoker's
 *   supplementary groups; see zos-launcher/README.md, "The groups finding").
 * - The Node process never changes identity; a launcher failure maps to a
 *   distinct operator-actionable error ({@link describeLauncherFailure}).
 */

import { RpcClientApi, type CommandRequest, type CommandResponse } from '@zowe/zowex-for-zowe-sdk';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { getLogger } from '../../server.js';
import { describeLauncherFailure, isValidSafUserid } from './local-system.js';

const log = getLogger().child('native.local');

/** Default seconds to wait for zowex's ready banner before giving up. */
const DEFAULT_STARTUP_TIMEOUT_SEC = 60;

/** Default seconds to wait for each RPC response. */
const DEFAULT_RESPONSE_TIMEOUT_SEC = 60;

export interface LocalClientOptions {
  /**
   * Absolute path of the program-controlled zowex-launcher binary.
   * Omitted for stdio same-user execution (deployment shape 2): zowex is then
   * spawned directly and inherits this process's identity — no switch, no
   * userid preamble on stdin.
   */
  launcherPath?: string;
  /** Absolute path of the zowex binary to run (`zowex server`; via the launcher when set). */
  zowexPath: string;
  /** Canonical uppercase SAF userid zowex runs as (JWT sub, or the invoking user when same-user). */
  userid: string;
  /** Seconds to wait for each RPC response (default 60). */
  responseTimeout?: number;
  /** Seconds to wait for the server's ready banner (default 60). */
  startupTimeout?: number;
  /** Called once when the zowex child ends for any reason (evict the cache entry). */
  onClose?: () => void;
  /** Called for asynchronous transport errors (unparseable output, orphan responses). */
  onError?: (err: Error) => void;
}

/**
 * Environment variables the launcher child inherits. Allowlist, fail-closed:
 * the child is identity-switched to the (untrusted) JWT user, who owns the
 * resulting process and can read its environment — so none of this server's
 * secrets (ZOWE_MCP_PASSWORD_*, tokens) may ride along. Only what zowex and
 * the z/OS runtime need crosses the boundary; HOME/USER/LOGNAME are set by
 * the launcher after the switch. Extend deliberately, never with a spread of
 * process.env.
 */
const LAUNCHER_ENV_ALLOWLIST = [
  'PATH',
  'LIBPATH',
  'NLSPATH',
  'TZ',
  'LANG',
  'LC_ALL',
  'STEPLIB',
  '_BPXK_AUTOCVT',
  '_CEE_RUNOPTS',
  '_TAG_REDIR_IN',
  '_TAG_REDIR_OUT',
  '_TAG_REDIR_ERR',
  // zowex contract: clean up SysV IPC on exit (docs/zos-perf findings).
  '__IPC_CLEANUP',
] as const;

/** Builds the minimal environment for the identity-switched launcher child. */
export function buildLauncherChildEnv(
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const name of LAUNCHER_ENV_ALLOWLIST) {
    const value = env[name];
    if (value !== undefined) child[name] = value;
  }
  // Fresh address space: the launcher's program-control requirement.
  child._BPX_SHAREAS = 'NO';
  return child;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** JSON-RPC response/notification line shapes (same wire format as ZSshClient). */
interface RpcLine {
  id?: number;
  method?: string;
  params?: { id?: number };
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * `zowex server` as a local child under the authenticated user's identity.
 * Duck-typed against `ZSshClient` at the client-cache seam: the backend only
 * uses the {@link RpcClientApi} namespaces plus `dispose()`/`serverVersion`.
 */
export class LocalClient extends RpcClientApi {
  private child!: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly pending = new Map<number, PendingRequest>();
  private requestId = 0;
  private closed = false;
  private closeHandled = false;
  private partialStdout = '';
  private partialStderr = '';
  private serverInfo: { version?: string } | undefined;

  private constructor(private readonly options: LocalClientOptions) {
    super();
  }

  /**
   * Spawns the launcher, sends the userid as the first stdin line, and
   * resolves once zowex prints its ready banner. Rejects with an
   * operator-actionable message when the launcher exits first (unknown user,
   * missing SURROGAT permit, dirty address space, exec failure).
   */
  static async create(options: LocalClientOptions): Promise<LocalClient> {
    if (!isValidSafUserid(options.userid)) {
      // Contract error: callers validate the sub before building a local spec.
      throw new Error(`localUserid "${options.userid}" is not a canonical SAF userid`);
    }
    const client = new LocalClient(options);
    await client.start();
    return client;
  }

  private start(): Promise<void> {
    const { launcherPath, zowexPath, userid } = this.options;
    log.debug(
      launcherPath
        ? 'Local client: spawning launcher'
        : 'Local client: spawning zowex directly (same-user)',
      { launcherPath, zowexPath, user: userid }
    );
    this.child = launcherPath
      ? spawn(launcherPath, [zowexPath, 'server'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          // Allowlisted environment only — the switched-identity child must
          // never see this server's secrets (see buildLauncherChildEnv).
          env: buildLauncherChildEnv(),
        })
      : // Same-user: zowex inherits this process's identity; no launcher
        // constraints apply, so the environment passes through unchanged.
        spawn(zowexPath, ['server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', err => {
      // EPIPE when the child died mid-write; the exit handler owns reporting.
      log.debug('Local client: stdin error', { error: err.message });
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      // Kept separate: the banner is parsed from stdout only. stderr carries
      // launcher diagnostics (a chdir warning for a missing target home is
      // normal and non-fatal) and matters only when startup fails.
      let startupStdout = '';
      let startupStderr = '';
      const startupOutput = (): string => `${startupStderr}${startupStdout}`.trim();
      const startupTimeoutId = setTimeout(
        () => {
          settle(
            new Error(
              `Timed out waiting for the local zowex server to start` +
                (startupOutput() ? ` (output so far: ${startupOutput()})` : '')
            )
          );
          this.child.kill();
        },
        (this.options.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT_SEC) * 1000
      );
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimeoutId);
        this.child.stdout.removeListener('data', onStartupData);
        this.child.stderr.removeListener('data', onStartupError);
        if (err) {
          this.closed = true;
          reject(err);
        } else {
          this.attachRunningHandlers();
          resolve();
        }
      };

      // zowex prints a one-line JSON ready banner on stdout; anything else
      // there is a startup diagnostic. The launcher writes only to stderr.
      const onStartupData = (chunk: string): void => {
        startupStdout += chunk;
        const newlineAt = startupStdout.indexOf('\n');
        if (newlineAt < 0) return;
        const line = startupStdout.slice(0, newlineAt).trim();
        try {
          const banner = JSON.parse(line) as { status?: string; data?: { version?: string } };
          if (banner.status === 'ready') {
            this.serverInfo = banner.data;
            this.partialStdout = startupStdout.slice(newlineAt + 1);
            if (startupStderr.trim()) {
              log.info('Local client: launcher diagnostics during startup', {
                user: userid,
                stderr: startupStderr.trim(),
              });
            }
            log.debug('Local client: zowex server ready', {
              user: userid,
              version: this.serverInfo?.version,
            });
            settle();
            return;
          }
          settle(new Error(`Unexpected first line from the local zowex server: ${line}`));
        } catch {
          settle(new Error(`The local zowex server did not print a ready banner; got: ${line}`));
        }
      };
      const onStartupError = (chunk: string): void => {
        startupStderr += chunk;
      };

      this.child.stdout.on('data', onStartupData);
      this.child.stderr.on('data', onStartupError);
      this.child.on('error', err => {
        settle(
          new Error(
            launcherPath
              ? `Could not spawn the zowex-launcher at ${launcherPath}: ${err.message}`
              : `Could not spawn zowex at ${zowexPath}: ${err.message}`
          )
        );
      });
      // 'close', not 'exit': it fires after the stdio streams end, so the
      // child's stderr diagnostics are fully accumulated in startupOutput.
      this.child.on('close', (code, signal) => {
        // Exit-code mapping is the launcher's contract; a directly-spawned
        // zowex has no such contract, so its exit is reported plainly.
        settle(
          new Error(
            `Local zowex startup as ${userid} failed: ` +
              (launcherPath
                ? describeLauncherFailure(signal !== null ? null : code, startupOutput(), userid)
                : `zowex exited ${signal !== null ? `on signal ${signal}` : `with ${String(code)}`}` +
                  (startupOutput() ? ` (output: ${startupOutput()})` : ''))
          )
        );
      });

      if (launcherPath) {
        // The userid crosses via stdin only (never argv/env) — the launcher's
        // contract. Everything after this newline is the JSON-RPC stream.
        this.child.stdin.write(`${userid}\n`);
      }
    });
  }

  /** Switches from startup parsing to JSON-RPC response handling. */
  private attachRunningHandlers(): void {
    this.child.stdout.on('data', (chunk: string) => {
      this.partialStdout = this.processResponses(this.partialStdout + chunk);
    });
    this.child.stderr.on('data', (chunk: string) => {
      if (this.pending.size === 0) {
        this.reportError(new Error(`Error from local zowex server: ${chunk.toString().trim()}`));
        return;
      }
      // Same contract as the SSH transport: responses may arrive on stderr.
      this.partialStderr = this.processResponses(this.partialStderr + chunk);
    });
    // 'close', not 'exit': any responses still buffered on the pipes are
    // dispatched before pending requests are rejected.
    this.child.on('close', () => {
      this.handleClose('The local zowex server process ended');
    });
  }

  get serverVersion(): string | undefined {
    return this.serverInfo?.version;
  }

  /**
   * Sends one JSON-RPC request over the child's stdin. Same framing and
   * timeout semantics as `ZSshClient.request`; stream transfers (the SDK's
   * `stream` request property) are not supported over the local pipe.
   */
  request<T extends CommandResponse>(
    request: CommandRequest,
    _progressCallback?: (percent: number) => void
  ): Promise<T> {
    if (this.closed || this.child.stdin.writable === false) {
      return Promise.reject(new Error('The local zowex connection is closed'));
    }
    if ('stream' in request && typeof (request as { stream?: unknown }).stream === 'function') {
      return Promise.reject(
        new Error('Stream transfers are not supported over the local zowex transport yet')
      );
    }
    const { command, ...rest } = request;
    const id = ++this.requestId;
    const rpcRequest = { jsonrpc: '2.0', method: command, params: rest, id };
    const responseTimeoutSec = this.options.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT_SEC;
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Request timed out after ${responseTimeoutSec} s`));
        }
      }, responseTimeoutSec * 1000);
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timeoutId });
      this.child.stdin.write(`${JSON.stringify(rpcRequest)}\n`);
    });
  }

  /** Ends the child process and rejects everything still pending. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    log.debug('Local client: dispose', { user: this.options.userid });
    for (const [id, req] of this.pending) {
      clearTimeout(req.timeoutId);
      req.reject(new Error('Shutting down the local zowex server. No action is required.'));
      this.pending.delete(id);
    }
    this.child.kill();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Idempotent child-ended handling: reject pending, notify the cache once. */
  private handleClose(reason: string): void {
    if (this.closeHandled) return;
    this.closeHandled = true;
    this.closed = true;
    log.debug('Local client: closed', { user: this.options.userid, reason });
    for (const [id, req] of this.pending) {
      clearTimeout(req.timeoutId);
      req.reject(new Error(reason));
      this.pending.delete(id);
    }
    try {
      this.options.onClose?.();
    } catch (err) {
      this.reportError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Newline-splits accumulated output and dispatches complete JSON-RPC lines. */
  private processResponses(data: string): string {
    const lines = data.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      let response: RpcLine;
      try {
        response = JSON.parse(line) as RpcLine;
      } catch {
        this.reportError(new Error(`Invalid JSON response from local zowex server: ${line}`));
        continue;
      }
      const responseId = response.id ?? response.params?.id;
      const req = responseId !== undefined ? this.pending.get(responseId) : undefined;
      if (!req || responseId === undefined) {
        this.reportError(
          new Error(`No pending request for local zowex response ID ${responseId}`)
        );
        continue;
      }
      if (response.method !== undefined) {
        // receiveStream/sendStream notifications belong to stream transfers,
        // which request() refuses up front — anything arriving here is unexpected.
        this.pending.delete(responseId);
        clearTimeout(req.timeoutId);
        req.reject(
          new Error(`Unsupported notification from local zowex server: ${response.method}`)
        );
        continue;
      }
      this.pending.delete(responseId);
      clearTimeout(req.timeoutId);
      if (response.error != null) {
        const err = new Error(response.error.message) as Error & {
          code?: string;
          causeErrors?: unknown;
        };
        err.code = String(response.error.code);
        if (response.error.data !== undefined) {
          err.causeErrors = response.error.data;
        }
        req.reject(err);
      } else {
        req.resolve(response.result);
      }
    }
    return lines[lines.length - 1];
  }

  private reportError(err: Error): void {
    log.info('Local client transport error', { user: this.options.userid, error: err.message });
    this.options.onError?.(err);
  }
}
