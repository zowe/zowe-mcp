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
 * Drives `code chat` headlessly against an already-activated portable
 * profile, and parses the resulting session file from
 * `<portable>/user-data/User/globalStorage/emptyWindowChatSessions/<uuid>.jsonl`.
 *
 * Session file format (reverse-engineered empirically — VS Code 1.126):
 *   - Each line is a JSON object `{ kind: 0 | 1 | 2, ... }`.
 *   - `kind: 0` is a full snapshot: `{ kind: 0, v: <ChatSessionState> }`.
 *   - `kind: 1` is an incremental patch: `{ kind: 1, k: (string|number)[], v: unknown }`,
 *     meaning "set the value at this key-path (relative to the kind:0 base
 *     object) to `v`". Intermediate containers are created as objects unless
 *     the next path segment is a number, in which case an array is created.
 *   - A session file normally starts with exactly one `kind: 0` line
 *     followed by zero or more `kind: 1` patch lines appended as the chat
 *     turn streams in.
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PortableProfile } from './portable-profile.js';

export type PatchPath = (string | number)[];

/** Applies one `{k, v}` patch (see module docs) onto `base` in place. */
export function applyPatch(base: Record<string, unknown>, k: PatchPath, v: unknown): void {
  if (k.length === 0) return;
  let cur = base as Record<string | number, unknown>;
  for (let i = 0; i < k.length - 1; i += 1) {
    const key = k[i];
    const nextKey = k[i + 1];
    cur[key] ??= typeof nextKey === 'number' ? [] : {};
    cur = cur[key] as Record<string | number, unknown>;
  }
  cur[k[k.length - 1]] = v;
}

/** A single response "part" as stored in `requests[].response[]`. Shape varies by kind; kept loose deliberately. */
export interface ChatResponsePart {
  kind?: string;
  value?: unknown;
  toolId?: string;
  toolCallId?: string;
  toolName?: string;
  [key: string]: unknown;
}

export interface ChatRequestRecord {
  requestId?: string;
  modelId?: string;
  messageText?: string;
  response: ChatResponsePart[];
  /** Concatenation of every response part's string `value`, in order. */
  responseText: string;
  /** Response parts that look like a tool invocation (kind mentions "tool"). */
  toolInvocationParts: ChatResponsePart[];
  raw: Record<string, unknown>;
}

export interface ParsedChatSession {
  filePath: string;
  sessionId?: string;
  requests: ChatRequestRecord[];
  raw: Record<string, unknown>;
}

function extractResponseText(parts: ChatResponsePart[]): string {
  return parts
    .map(p => (typeof p.value === 'string' ? p.value : ''))
    .filter(Boolean)
    .join('');
}

function looksLikeToolPart(part: ChatResponsePart): boolean {
  const kind = typeof part.kind === 'string' ? part.kind.toLowerCase() : '';
  return kind.includes('tool');
}

/** Reads and fully parses a chat session `.jsonl` file (applies all patches on top of the kind:0 base). */
export function parseSessionFile(filePath: string): ParsedChatSession {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  let base: Record<string, unknown> | undefined;
  for (const line of lines) {
    let entry: { kind?: number; k?: PatchPath; v?: unknown };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue; // tolerate a partially-flushed trailing line while VS Code is still writing
    }
    if (entry.kind === 0) {
      base = entry.v as Record<string, unknown>;
    } else if ((entry.kind === 1 || entry.kind === 2) && base && entry.k) {
      // kind:1 and kind:2 both carry { k: path, v: value } set-style patches
      // (kind:2 observed on Linux carrying full-array replacements, e.g. the
      // final requests[0].response array including the tool invocation).
      applyPatch(base, entry.k, entry.v);
    }
  }
  if (!base) {
    throw new Error(`No kind:0 snapshot line found in ${filePath}`);
  }
  const rawRequests = Array.isArray(base.requests)
    ? (base.requests as Record<string, unknown>[])
    : [];
  const requests: ChatRequestRecord[] = rawRequests.map(r => {
    const response = Array.isArray(r.response) ? (r.response as ChatResponsePart[]) : [];
    return {
      requestId: typeof r.requestId === 'string' ? r.requestId : undefined,
      modelId: typeof r.modelId === 'string' ? r.modelId : undefined,
      messageText:
        typeof r.message === 'object' && r.message !== null
          ? ((r.message as Record<string, unknown>).text as string | undefined)
          : undefined,
      response,
      responseText: extractResponseText(response),
      toolInvocationParts: response.filter(looksLikeToolPart),
      raw: r,
    };
  });
  return {
    filePath,
    sessionId: typeof base.sessionId === 'string' ? base.sessionId : undefined,
    requests,
    raw: base,
  };
}

export interface RunChatOptions {
  /** 'ask' or 'agent'. */
  mode: 'ask' | 'agent';
  prompt: string;
  /** Extra env vars merged on top of profile.env for this invocation only. */
  extraEnv?: Record<string, string>;
  /** Max time to wait for `code chat` itself to return, ms. */
  spawnTimeoutMs?: number;
  /**
   * Pass `-r` (reuse the last active window) instead of `-n` (new window).
   * Use when a Playwright-launched VS Code instance for this profile is
   * still running: the prompt lands in that window, so the caller can
   * screenshot the rendered response, and the CLI wrapper returns quickly
   * instead of becoming the app process (Linux cold-start behavior).
   */
  reuseWindow?: boolean;
}

/**
 * Lists PIDs of currently-running `code chat` CLI worker processes (matched
 * by command line, case-insensitive). Used to diff before/after a
 * `runChatPrompt` call — see {@link killChatCliProcesses} for why this is
 * necessary at all.
 */
function listChatCliPids(): number[] {
  const result = spawnSync('pgrep', ['-if', 'Code chat -m'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => Number.isFinite(n));
}

/**
 * Kills detached `code chat` CLI worker processes (see `detachedPids` on
 * {@link runChatPrompt}'s result). This MUST be called during test cleanup,
 * in addition to `cleanupPortableProfile`/`killProfileProcesses`:
 *
 * VS Code's `code` CLI wrapper (`ELECTRON_RUN_AS_NODE=1 Electron cli.js
 * chat ...`) internally forks a worker that gets reparented to PID 1 (the
 * `spawn()`ed process we get back from Node exits almost immediately with
 * code 0 once the handoff is done). That worker's own argv is just
 * `Code chat -m <mode> -n <prompt>` — it does NOT include
 * `VSCODE_PORTABLE`/`--user-data-dir`, so `killProfileProcesses`'s
 * profile-directory pattern match can never find it. Left alone it sits in
 * a loop continuously re-forking Chrome helper (network/gpu) subprocesses
 * forever, which is also why those *helper* subprocesses (which DO carry
 * `--user-data-dir` and so die to `killProfileProcesses`) keep reappearing
 * with new PIDs if only that cleanup path is used.
 */
export function killChatCliProcesses(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** Spawns `code chat -m <mode> -n "<prompt>"` against the profile. Resolves once the CLI wrapper's immediate process exits (see `killChatCliProcesses` docs for what happens after that). */
export async function runChatPrompt(
  profile: PortableProfile,
  options: RunChatOptions
): Promise<{ stdout: string; stderr: string; code: number | null; detachedPids: number[] }> {
  const codeBin = process.env.VSCODE_E2E_CLI ?? 'code';
  const env = { ...profile.env, ...(options.extraEnv ?? {}) };
  const beforePids = new Set(listChatCliPids());

  let lingeringPid: number | undefined;
  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const windowFlag = options.reuseWindow ? '-r' : '-n';
      const child = spawn(codeBin, ['chat', '-m', options.mode, windowFlag, options.prompt], {
        env,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
      const timeout = setTimeout(() => {
        // Platform difference: on macOS the CLI wrapper forwards the prompt and
        // exits quickly, but on a cold start (notably Linux) the wrapper *is*
        // the Electron app process and stays alive until the window closes.
        // The prompt has been submitted either way, so a still-running child is
        // not a failure — leave it alive to answer the prompt (the session-file
        // poll decides success) and let cleanup kill it by pid.
        lingeringPid = child.pid;
        resolve({ stdout, stderr, code: null });
      }, options.spawnTimeoutMs ?? 30_000);
      child.on('exit', code => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, code });
      });
      child.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    }
  );

  // Give the internally-detached worker a moment to actually spawn before diffing.
  await new Promise(r => setTimeout(r, 500));
  const afterPids = listChatCliPids();
  const detachedPids = afterPids.filter(p => !beforePids.has(p));
  if (lingeringPid !== undefined && !detachedPids.includes(lingeringPid)) {
    detachedPids.push(lingeringPid);
  }
  return { ...result, detachedPids };
}

export interface WaitForSessionOptions {
  /** Only consider files whose mtime is >= this Date (typically "just before" runChatPrompt was called). */
  newerThan: Date;
  /** Plain substring the *raw file contents* must contain (fast, format-agnostic check) before we try to parse it. */
  containsText: string;
  /** Total time to poll, ms. */
  timeoutMs?: number;
  /** Poll interval, ms. */
  intervalMs?: number;
}

/**
 * Polls `<profile>/user-data/User/globalStorage/emptyWindowChatSessions/` for
 * a `.jsonl` file newer than `newerThan` whose raw contents contain
 * `containsText`, then parses and returns it. Polling on raw text first
 * (rather than parsing on every tick) keeps this robust to the exact
 * session-format details changing across VS Code versions.
 */
export async function waitForChatSession(
  profile: PortableProfile,
  options: WaitForSessionOptions
): Promise<ParsedChatSession> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 1500;
  const deadline = Date.now() + timeoutMs;
  const dir = profile.sessionsDir;

  let lastSeenFiles: string[] = [];
  while (Date.now() < deadline) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    } catch {
      entries = [];
    }
    lastSeenFiles = entries;
    for (const name of entries) {
      const full = path.join(dir, name);
      let fd: number | undefined;
      try {
        fd = fs.openSync(full, 'r');
        const stat = fs.fstatSync(fd);
        if (stat.mtime < options.newerThan) continue;
        const content = fs.readFileSync(fd, 'utf8');
        if (content.includes(options.containsText)) {
          return parseSessionFile(full);
        }
      } catch {
        continue;
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timed out after ${String(timeoutMs)}ms waiting for a chat session in ${dir} ` +
      `newer than ${options.newerThan.toISOString()} containing ${JSON.stringify(options.containsText)}. ` +
      `Files seen: ${JSON.stringify(lastSeenFiles)}`
  );
}
