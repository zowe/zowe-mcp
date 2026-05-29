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
 * Interactive shell channel — drives the USS shell interpreter from line input.
 * Writes a z/OS-style prompt and z/OS-realistic MOTD on session start.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ssh2 from 'ssh2';
import { lastLoginLines } from '../realism.js';
import type { MockHostStore } from '../store.js';
import type { MockUser } from '../users.js';
import { newShellSession, runLine, type ShellSession } from '../uss-shell/interpreter.js';

import type { MockLogger } from '../log.js';

export interface ShellChannelCtx {
  store: MockHostStore;
  user: MockUser;
  systemId: string;
  mockDir: string;
  clientIp: string;
  log: MockLogger;
}

export async function startShellChannel(
  channel: ssh2.ServerChannel,
  ctx: ShellChannelCtx
): Promise<void> {
  const session = newShellSession(ctx.store, ctx.user, ctx.systemId);

  // MOTD: last-login banner + /etc/motd contents
  const now = new Date();
  const motdPath = path.join(ctx.mockDir, '_ssh', 'motd.txt');
  let motd = '';
  try {
    motd = await fs.readFile(motdPath, 'utf-8');
  } catch {
    /* optional */
  }
  await persistLastLogin(ctx.mockDir, ctx.user.username, now, ctx.clientIp);
  ctx.log('info', `SHELL opened user=${ctx.user.username} from=${ctx.clientIp}`);
  channel.write(lastLoginLines(ctx.user.username, now, ctx.clientIp) + '\r\n');
  if (motd) {
    channel.write(motd.replace(/\n/g, '\r\n'));
    if (!motd.endsWith('\n')) channel.write('\r\n');
  }
  writePrompt(channel, session);

  let buffer = '';
  // The 'data' event handler returns a Promise (we await runOneLine inside).
  // EventEmitter wants void-returning listeners, so wrap with `void`.
  channel.on('data', (chunk: Buffer) => {
    void onData(chunk);
  });
  async function onData(chunk: Buffer): Promise<void> {
    const s = chunk.toString('utf8');
    for (const c of s) {
      const code = c.charCodeAt(0);
      if (code === 0x04) {
        // Ctrl-D — close
        channel.write('\r\nlogout\r\n');
        channel.exit(0);
        channel.end();
        return;
      }
      if (c === '\r' || c === '\n') {
        channel.write('\r\n');
        const line = buffer;
        buffer = '';
        if (line.trim() === 'exit' || line.trim() === 'logout') {
          ctx.log('info', `SHELL exit user=${ctx.user.username}`);
          channel.write('logout\r\n');
          channel.exit(0);
          channel.end();
          return;
        }
        if (line.trim()) {
          await runOneLine(channel, session, line, ctx);
        }
        writePrompt(channel, session);
      } else if (code === 0x7f || code === 0x08) {
        // Backspace
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          channel.write('\b \b');
        }
      } else if (code >= 0x20 && code < 0x7f) {
        buffer += c;
        channel.write(c);
      } else if (code === 0x03) {
        // Ctrl-C — discard line, new prompt
        buffer = '';
        channel.write('^C\r\n');
        writePrompt(channel, session);
      }
    }
  }

  channel.on('end', () => {
    ctx.log('info', `SHELL closed user=${ctx.user.username}`);
  });
}

async function runOneLine(
  channel: ssh2.ServerChannel,
  session: ShellSession,
  line: string,
  ctx: ShellChannelCtx
): Promise<void> {
  const start = Date.now();
  try {
    const res = await runLine(session, line);
    if (res.stdout) channel.write(toCrlf(res.stdout));
    if (res.stderr) channel.stderr.write(toCrlf(res.stderr));
    const lvl = res.exitCode === 0 ? 'info' : 'warn';
    ctx.log(
      lvl,
      `SHELL cmd user=${ctx.user.username} cwd=${session.cwd} input='${line.trim()}' rc=${res.exitCode} ${Date.now() - start}ms`
    );
  } catch (e) {
    ctx.log(
      'error',
      `SHELL error user=${ctx.user.username} input='${line.trim()}': ${(e as Error).message}`
    );
    channel.stderr.write(`mock: ${(e as Error).message}\r\n`);
  }
}

function writePrompt(channel: ssh2.ServerChannel, session: ShellSession): void {
  channel.write(`${session.user.username.toUpperCase()}:${session.cwd}> `);
}

function toCrlf(s: string): string {
  return s.replace(/\r?\n/g, '\r\n');
}

async function persistLastLogin(
  mockDir: string,
  user: string,
  at: Date,
  from: string
): Promise<void> {
  const dir = path.join(mockDir, '_ssh', 'lastlog');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${user.toUpperCase()}.json`);
  interface LastLog {
    lastSuccess?: string;
    lastSuccessFrom?: string;
    previousSuccess?: string;
  }
  let prev: LastLog = {};
  try {
    prev = JSON.parse(await fs.readFile(file, 'utf-8')) as LastLog;
  } catch {
    /* first login */
  }
  await fs.writeFile(
    file,
    JSON.stringify(
      { lastSuccess: at.toISOString(), lastSuccessFrom: from, previousSuccess: prev.lastSuccess },
      null,
      2
    )
  );
}
