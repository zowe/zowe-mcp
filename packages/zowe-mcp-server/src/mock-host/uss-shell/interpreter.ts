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
 * Minimal POSIX-flavoured shell interpreter backed by {@link MockHostStore.backend}.
 *
 * Scope: line-oriented USS commands sufficient to support interactive `ssh` sessions
 * and one-shot `ssh ... <cmd>` invocations against the mock host. The interpreter is
 * intentionally not bash — no subshells, no functions, no background jobs. It DOES
 * support: pipes, `>`, `>>`, `<`, `&&`, `||`, `$VAR` expansion, simple quoting.
 */

import * as path from 'node:path';
import { idLine, unameLine } from '../realism.js';
import type { MockHostStore } from '../store.js';
import type { MockUser } from '../users.js';
import { homeForUser, primaryGroupForUser } from '../users.js';

export interface ShellSession {
  store: MockHostStore;
  user: MockUser;
  systemId: string;
  cwd: string;
  env: Record<string, string>;
}

export function newShellSession(
  store: MockHostStore,
  user: MockUser,
  systemId: string
): ShellSession {
  const home = homeForUser(user);
  return {
    store,
    user,
    systemId,
    cwd: home,
    env: {
      USER: user.username.toUpperCase(),
      LOGNAME: user.username.toUpperCase(),
      HOME: home,
      PATH: '/bin:/usr/bin:/usr/sbin:/usr/lpp/java/J17.0_64/bin',
      SHELL: '/bin/sh',
      MAIL: `/usr/mail/${user.username.toUpperCase()}`,
      TZ: 'EST5EDT',
      _BPX_SHAREAS: 'YES',
      STEPLIB: 'NONE',
    },
  };
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Execute one input line. Supports `;` separator and `&&`/`||` sequencing. */
export async function runLine(session: ShellSession, line: string): Promise<CommandResult> {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  return runSequence(session, trimmed);
}

async function runSequence(session: ShellSession, src: string): Promise<CommandResult> {
  const parts = splitOnTopLevel(src, /;|&&|\|\|/g);
  let last: CommandResult = { stdout: '', stderr: '', exitCode: 0 };
  let out = '';
  let err = '';
  for (const { text, sep } of parts) {
    if (sep === '&&' && last.exitCode !== 0) continue;
    if (sep === '||' && last.exitCode === 0) continue;
    const res = await runPipeline(session, text.trim());
    out += res.stdout;
    err += res.stderr;
    last = res;
  }
  return { stdout: out, stderr: err, exitCode: last.exitCode };
}

async function runPipeline(session: ShellSession, src: string): Promise<CommandResult> {
  // Pipe support: each segment's stdout becomes the next segment's stdin.
  const segments = splitOnTopLevel(src, /\|/g)
    .map(p => p.text.trim())
    .filter(Boolean);
  let stdin = '';
  let stderr = '';
  let exitCode = 0;
  for (let i = 0; i < segments.length; i++) {
    const res = await runRedirected(session, segments[i], stdin);
    stdin = res.stdout;
    stderr += res.stderr;
    exitCode = res.exitCode;
    if (i < segments.length - 1 && exitCode !== 0) break;
  }
  return { stdout: stdin, stderr, exitCode };
}

interface Redir {
  src?: string;
  stdoutFile?: { path: string; append: boolean };
}

async function runRedirected(
  session: ShellSession,
  cmdLine: string,
  pipedStdin: string
): Promise<CommandResult> {
  const { command, redir } = extractRedirections(cmdLine);
  let stdin = pipedStdin;
  if (redir.src) {
    try {
      const f = await session.store.backend.readUssFile(
        session.systemId,
        resolvePath(session, redir.src)
      );
      stdin = f.text;
    } catch (e) {
      return { stdout: '', stderr: `cat: ${redir.src}: ${(e as Error).message}\n`, exitCode: 1 };
    }
  }
  const tokens = tokenize(command, session.env);
  if (tokens.length === 0) return { stdout: '', stderr: '', exitCode: 0 };
  const argv0 = tokens[0];
  const argv = tokens.slice(1);
  const builtin = builtins[argv0];
  let res: CommandResult;
  if (builtin) {
    res = await builtin(session, argv, stdin);
  } else {
    res = {
      stdout: '',
      stderr: `${argv0}: not found\n`,
      exitCode: 127,
    };
  }
  if (redir.stdoutFile && res.stdout) {
    const p = resolvePath(session, redir.stdoutFile.path);
    try {
      let body = res.stdout;
      if (redir.stdoutFile.append) {
        try {
          const existing = await session.store.backend.readUssFile(session.systemId, p);
          body = existing.text + body;
        } catch {
          /* new file */
        }
      }
      await session.store.backend.writeUssFile(session.systemId, p, body);
      res = { ...res, stdout: '' };
    } catch (e) {
      return {
        stdout: '',
        stderr: `${argv0}: ${redir.stdoutFile.path}: ${(e as Error).message}\n`,
        exitCode: 1,
      };
    }
  }
  return res;
}

function extractRedirections(cmd: string): { command: string; redir: Redir } {
  const redir: Redir = {};
  let out = cmd;
  const outMatch = /\s(>>|>)\s*(\S+)/.exec(out);
  if (outMatch) {
    redir.stdoutFile = { path: outMatch[2], append: outMatch[1] === '>>' };
    out = out.slice(0, outMatch.index);
  }
  const inMatch = /\s<\s*(\S+)/.exec(out);
  if (inMatch) {
    redir.src = inMatch[1];
    out = out.slice(0, inMatch.index);
  }
  return { command: out.trim(), redir };
}

function tokenize(line: string, env: Record<string, string>): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    let buf = '';
    while (i < line.length && !/\s/.test(line[i])) {
      const c = line[i];
      if (c === "'") {
        i++;
        while (i < line.length && line[i] !== "'") {
          buf += line[i++];
        }
        if (i < line.length) i++; // closing quote
      } else if (c === '"') {
        i++;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '$') {
            const [val, used] = expandVar(line, i, env);
            buf += val;
            i += used;
          } else {
            buf += line[i++];
          }
        }
        if (i < line.length) i++; // closing quote
      } else if (c === '$') {
        const [val, used] = expandVar(line, i, env);
        buf += val;
        i += used;
      } else if (c === '\\' && i + 1 < line.length) {
        buf += line[i + 1];
        i += 2;
      } else {
        buf += c;
        i++;
      }
    }
    tokens.push(buf);
  }
  return tokens;
}

function expandVar(s: string, i: number, env: Record<string, string>): [string, number] {
  // s[i] === '$'
  let j = i + 1;
  let name = '';
  if (s[j] === '{') {
    j++;
    while (j < s.length && s[j] !== '}') name += s[j++];
    if (s[j] === '}') j++;
  } else {
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) name += s[j++];
  }
  return [env[name] ?? '', j - i];
}

function splitOnTopLevel(s: string, re: RegExp): { text: string; sep?: string }[] {
  // Simple split — we don't currently honor quotes/parentheses for the separator scan,
  // good enough for our shell scope.
  const out: { text: string; sep?: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  re = new RegExp(re.source, 'g');
  while ((m = re.exec(s)) !== null) {
    out.push({ text: s.slice(last, m.index), sep: out.length === 0 ? undefined : undefined });
    if (out.length > 0) out[out.length - 1] = { text: out[out.length - 1].text, sep: undefined };
    out.push({ text: '', sep: m[0] });
    last = m.index + m[0].length;
  }
  out.push({ text: s.slice(last), sep: undefined });
  // Compact: merge into pairs (text, sep) where sep is the prefix joining to the prior text.
  const compact: { text: string; sep?: string }[] = [];
  let pendingSep: string | undefined;
  for (const part of out) {
    if (part.sep) {
      pendingSep = part.sep;
      continue;
    }
    compact.push({ text: part.text, sep: pendingSep });
    pendingSep = undefined;
  }
  return compact;
}

/** Translate a 3- or 4-digit octal mode like "755" or "0644" into "rwxr-xr-x". */
function octalToRwx(modeOctal: string): string {
  const m = /[0-7]{3}$/.exec(modeOctal);
  const digits = m ? m[0] : '644';
  const triplet = (d: number) => `${d & 4 ? 'r' : '-'}${d & 2 ? 'w' : '-'}${d & 1 ? 'x' : '-'}`;
  return (
    triplet(parseInt(digits[0], 10)) +
    triplet(parseInt(digits[1], 10)) +
    triplet(parseInt(digits[2], 10))
  );
}

export function resolvePath(session: ShellSession, p: string): string {
  if (p.startsWith('/')) return path.posix.normalize(p);
  return path.posix.normalize(path.posix.join(session.cwd, p));
}

/**
 * Builtin signature. Allow both sync and async returns so the trivial commands
 * (pwd, echo, env, ...) don't need `async` boilerplate just to satisfy the type.
 */
type Builtin = (
  session: ShellSession,
  args: string[],
  stdin: string
) => CommandResult | Promise<CommandResult>;

const builtins: Record<string, Builtin> = {
  pwd: session => ({ stdout: `${session.cwd}\n`, stderr: '', exitCode: 0 }),

  echo: (_s, args) => ({ stdout: `${args.join(' ')}\n`, stderr: '', exitCode: 0 }),

  whoami: session => ({
    stdout: `${session.user.username.toUpperCase()}\n`,
    stderr: '',
    exitCode: 0,
  }),

  id: session => ({
    stdout:
      idLine(
        session.user.username,
        session.user.uid ?? 12345,
        session.user.gid ?? 10,
        primaryGroupForUser(session.user),
        session.user.groups ?? []
      ) + '\n',
    stderr: '',
    exitCode: 0,
  }),

  uname: (_s, args) => {
    if (args.includes('-a')) {
      return { stdout: `${unameLine()}\n`, stderr: '', exitCode: 0 };
    }
    return { stdout: 'OS/390\n', stderr: '', exitCode: 0 };
  },

  env: session => {
    const lines = Object.entries(session.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    return { stdout: lines + '\n', stderr: '', exitCode: 0 };
  },

  exit: () => ({ stdout: '', stderr: '__EXIT__\n', exitCode: 0 }),

  cd: async (session, args) => {
    const target = args[0] ?? session.env.HOME;
    const resolved = resolvePath(session, target);
    try {
      await session.store.backend.listUssFiles(session.systemId, resolved);
      session.cwd = resolved;
      return { stdout: '', stderr: '', exitCode: 0 };
    } catch {
      return {
        stdout: '',
        stderr: `cd: ${target}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  },

  ls: async (session, args) => {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const longFmt = flags.includes('l');
    const showHidden = flags.includes('a');
    const targets = args.filter(a => !a.startsWith('-'));
    if (targets.length === 0) targets.push(session.cwd);
    let out = '';
    let err = '';
    let code = 0;
    for (const t of targets) {
      const p = resolvePath(session, t);
      try {
        const entries = await session.store.backend.listUssFiles(session.systemId, p, {
          longFormat: longFmt,
          includeHidden: showHidden,
        });
        if (longFmt) {
          for (const e of entries) {
            const isDir = e.isDirectory === true;
            const mode = e.mode ?? (isDir ? '755' : '644');
            const type = isDir ? 'd' : '-';
            const perms = octalToRwx(mode);
            const owner = session.user.username.toUpperCase();
            const group = primaryGroupForUser(session.user);
            const size = String(e.size ?? 0).padStart(8, ' ');
            const mtime = e.mtime ?? '';
            out += `${type}${perms} ${owner.padEnd(8)} ${group.padEnd(8)} ${size} ${mtime} ${e.name}\n`;
          }
        } else {
          out += entries.map(e => e.name).join('  ') + '\n';
        }
      } catch (e) {
        err += `ls: ${t}: ${(e as Error).message}\n`;
        code = 1;
      }
    }
    return { stdout: out, stderr: err, exitCode: code };
  },

  cat: async (session, args, stdin) => {
    if (args.length === 0) {
      return { stdout: stdin, stderr: '', exitCode: 0 };
    }
    let out = '';
    let err = '';
    let code = 0;
    for (const a of args) {
      const p = resolvePath(session, a);
      try {
        const f = await session.store.backend.readUssFile(session.systemId, p);
        out += f.text;
      } catch (e) {
        err += `cat: ${a}: ${(e as Error).message}\n`;
        code = 1;
      }
    }
    return { stdout: out, stderr: err, exitCode: code };
  },

  mkdir: async (session, args) => {
    const recursive = args.includes('-p');
    const targets = args.filter(a => !a.startsWith('-'));
    let err = '';
    let code = 0;
    for (const t of targets) {
      const p = resolvePath(session, t);
      try {
        await session.store.backend.createUssFile(session.systemId, p, { isDirectory: true });
      } catch (e) {
        if (recursive && /exists/i.test((e as Error).message)) continue;
        err += `mkdir: ${t}: ${(e as Error).message}\n`;
        code = 1;
      }
    }
    return { stdout: '', stderr: err, exitCode: code };
  },

  rm: async (session, args) => {
    const recursive = args.includes('-r') || args.includes('-rf') || args.includes('-fr');
    const targets = args.filter(a => !a.startsWith('-'));
    let err = '';
    let code = 0;
    for (const t of targets) {
      const p = resolvePath(session, t);
      try {
        await session.store.backend.deleteUssFile(session.systemId, p, recursive);
      } catch (e) {
        err += `rm: ${t}: ${(e as Error).message}\n`;
        code = 1;
      }
    }
    return { stdout: '', stderr: err, exitCode: code };
  },

  touch: async (session, args) => {
    let err = '';
    let code = 0;
    for (const t of args) {
      const p = resolvePath(session, t);
      try {
        await session.store.backend.writeUssFile(session.systemId, p, '');
      } catch (e) {
        err += `touch: ${t}: ${(e as Error).message}\n`;
        code = 1;
      }
    }
    return { stdout: '', stderr: err, exitCode: code };
  },

  head: async (session, args, stdin) => {
    let n = 10;
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        n = parseInt(args[++i], 10);
      } else if (/^-\d+$/.test(args[i])) {
        n = parseInt(args[i].slice(1), 10);
      } else {
        positional.push(args[i]);
      }
    }
    let text = stdin;
    if (positional.length > 0) {
      const p = resolvePath(session, positional[0]);
      text = (await session.store.backend.readUssFile(session.systemId, p)).text;
    }
    const lines = text.split('\n');
    return {
      stdout: lines.slice(0, n).join('\n') + (lines.length > n ? '\n' : ''),
      stderr: '',
      exitCode: 0,
    };
  },

  tail: async (session, args, stdin) => {
    let n = 10;
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        n = parseInt(args[++i], 10);
      } else if (/^-\d+$/.test(args[i])) {
        n = parseInt(args[i].slice(1), 10);
      } else {
        positional.push(args[i]);
      }
    }
    let text = stdin;
    if (positional.length > 0) {
      const p = resolvePath(session, positional[0]);
      text = (await session.store.backend.readUssFile(session.systemId, p)).text;
    }
    const lines = text.split('\n');
    return { stdout: lines.slice(-n).join('\n'), stderr: '', exitCode: 0 };
  },

  wc: async (session, args, stdin) => {
    const showLines = args.includes('-l');
    const showWords = args.includes('-w');
    const showBytes = args.includes('-c');
    const positional = args.filter(a => !a.startsWith('-'));
    let text = stdin;
    if (positional[0]) {
      const p = resolvePath(session, positional[0]);
      text = (await session.store.backend.readUssFile(session.systemId, p)).text;
    }
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const words = text.split(/\s+/).filter(Boolean).length;
    const bytes = Buffer.byteLength(text, 'utf8');
    const showAll = !showLines && !showWords && !showBytes;
    const parts: string[] = [];
    if (showAll || showLines) parts.push(String(lines).padStart(7, ' '));
    if (showAll || showWords) parts.push(String(words).padStart(7, ' '));
    if (showAll || showBytes) parts.push(String(bytes).padStart(7, ' '));
    if (positional[0]) parts.push(positional[0]);
    return { stdout: parts.join(' ') + '\n', stderr: '', exitCode: 0 };
  },

  grep: async (session, args, stdin) => {
    const caseInsensitive = args.includes('-i');
    const flags = args.filter(a => a.startsWith('-'));
    void flags;
    const positional = args.filter(a => !a.startsWith('-'));
    if (positional.length === 0) {
      return { stdout: '', stderr: 'grep: missing pattern\n', exitCode: 2 };
    }
    const pattern = positional[0];
    const files = positional.slice(1);
    const re = new RegExp(pattern, caseInsensitive ? 'i' : '');
    let out = '';
    if (files.length === 0) {
      for (const line of stdin.split('\n')) {
        if (re.test(line)) out += line + '\n';
      }
    } else {
      for (const f of files) {
        try {
          const p = resolvePath(session, f);
          const text = (await session.store.backend.readUssFile(session.systemId, p)).text;
          for (const line of text.split('\n')) {
            if (re.test(line)) {
              out += files.length > 1 ? `${f}:${line}\n` : `${line}\n`;
            }
          }
        } catch {
          /* skip */
        }
      }
    }
    return { stdout: out, stderr: '', exitCode: out ? 0 : 1 };
  },

  sleep: async (_s, args) => {
    const n = parseFloat(args[0] ?? '0');
    await new Promise(r => setTimeout(r, Math.min(n, 5) * 1000));
    return { stdout: '', stderr: '', exitCode: 0 };
  },

  which: (_s, args) => {
    const known = new Set([
      'pwd',
      'echo',
      'whoami',
      'id',
      'uname',
      'env',
      'cd',
      'ls',
      'cat',
      'mkdir',
      'rm',
      'touch',
      'head',
      'tail',
      'wc',
      'grep',
      'sleep',
    ]);
    let out = '';
    for (const a of args) {
      out += known.has(a) ? `/bin/${a}\n` : `${a}: not found\n`;
    }
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};
