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
 *
 * Error messages mirror real z/OS USS output:
 *   - FSUM codes (FSUM6785, FSUM6003, FSUM7351, FSUM6334) for shell/ls/grep/tail/mkdir
 *   - EDC5129I for C-runtime "No such file or directory" (cat, head, wc)
 */

import * as path from 'node:path';
import {
  DEFAULT_MACHINE,
  DEFAULT_NODENAME,
  DEFAULT_RELEASE,
  DEFAULT_SYSNAME,
  DEFAULT_VERSION,
  idLine,
  unameLine,
} from '../realism.js';
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
      stderr: `${argv0}: FSUM7351 not found\n`,
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
 * Format an ISO-8601 date string as the z/OS `ls -l` date column (always 12 chars):
 *   - Recent  (≤ 180 days old): `"Apr 21 10:53"`
 *   - Older:                    `"Nov  5  2024"`
 */
function lsDate(isoDate: string | undefined): string {
  if (!isoDate) return '            '; // 12-char placeholder
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '            ';
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const mon = MONTHS[d.getMonth()];
  const day = String(d.getDate()).padStart(2, ' ');
  const diffMs = Date.now() - d.getTime();
  const diffDays = diffMs / 86_400_000;
  if (diffDays >= 0 && diffDays <= 180) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${mon} ${day} ${hh}:${mm}`; // e.g. "Apr 21 10:53"
  }
  const year = d.getFullYear();
  return `${mon} ${day}  ${year}`; // e.g. "Nov  5  2024"
}

/**
 * Compute disk blocks (512-byte units) for one `ls -l` entry, matching z/OS HFS/zFS
 * allocation behaviour:
 *   - Directories: always 16 blocks (one 8 KiB HFS block = 16 × 512 B)
 *   - Regular files: minimum 8 blocks (one 4 KiB page), rounded up to 512-B boundary
 *   - Named pipes, symlinks and other special files: 0 blocks
 */
function blocksFor(
  isDirectory: boolean | undefined,
  size: number | undefined,
  isSpecial = false
): number {
  if (isSpecial) return 0;
  if (isDirectory) return 16;
  const s = size ?? 0;
  if (s === 0) return 0;
  return Math.max(8, Math.ceil(s / 512));
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

/** Parse `-n N` / `-N` arg style shared by `head` and `tail`. */
function parseNLinesArgs(args: string[]): { n: number; positional: string[] } {
  let n = 10;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && args[i + 1]) {
      n = parseInt(args[++i], 10);
    } else if (/^-\d+$/.test(args[i])) {
      n = parseInt(args[i].slice(1), 10);
    } else if (!args[i].startsWith('-')) {
      positional.push(args[i]);
    }
  }
  return { n, positional };
}

/**
 * Read a list of USS files and apply `sliceFn` to each file's lines.
 * Multiple files get `==> file <==` banners. Returns a `CommandResult`.
 */
async function readLinesFromFiles(
  session: ShellSession,
  files: string[],
  sliceFn: (lines: string[]) => string,
  errFn: (resolvedPath: string) => string
): Promise<CommandResult> {
  let out = '';
  let err = '';
  let code = 0;
  const multi = files.length > 1;
  for (const f of files) {
    const p = resolvePath(session, f);
    try {
      const text = (await session.store.backend.readUssFile(session.systemId, p)).text;
      const lines = text.split('\n');
      if (multi) out += `==> ${f} <==\n`;
      out += sliceFn(lines);
      if (multi) out += '\n';
    } catch {
      err += errFn(p);
      code = 1;
    }
  }
  return { stdout: out, stderr: err, exitCode: code };
}

const builtins: Record<string, Builtin> = {
  pwd: session => ({ stdout: `${session.cwd}\n`, stderr: '', exitCode: 0 }),

  // Real z/OS `echo` does not honour `-n`; it treats it as literal output.
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

  // Supports -s (sysname), -n (nodename), -r (release), -v (version), -m (machine), -a (all).
  uname: (_s, args) => {
    if (args.includes('-a')) {
      return { stdout: `${unameLine()}\n`, stderr: '', exitCode: 0 };
    }
    const parts: string[] = [];
    if (args.length === 0 || args.includes('-s')) parts.push(DEFAULT_SYSNAME);
    if (args.includes('-n')) parts.push(DEFAULT_NODENAME);
    if (args.includes('-r')) parts.push(DEFAULT_RELEASE);
    if (args.includes('-v')) parts.push(DEFAULT_VERSION);
    if (args.includes('-m')) parts.push(DEFAULT_MACHINE);
    if (parts.length === 0) parts.push(DEFAULT_SYSNAME);
    return { stdout: `${parts.join(' ')}\n`, stderr: '', exitCode: 0 };
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
        stderr: `cd: FSUM6785 File or directory "${resolved}" is not found\n`,
        exitCode: 1,
      };
    }
  },

  ls: async (session, args) => {
    // Parse flags (combined or separate, e.g. -la or -l -a)
    const flags = args.filter(a => a.startsWith('-')).join('');
    const longFmt = flags.includes('l');
    const showHidden = flags.includes('a');
    const classify = flags.includes('F'); // append type indicator
    const listDir = flags.includes('d'); // list directory itself, not contents
    const sortByTime = flags.includes('t');
    const targets = args.filter(a => !a.startsWith('-'));
    if (targets.length === 0) targets.push(session.cwd);

    let out = '';
    let err = '';
    let code = 0;
    const multiTarget = targets.length > 1;

    for (const t of targets) {
      const p = resolvePath(session, t);
      try {
        // With -d, list the path itself (stat it, output one line)
        if (listDir) {
          if (longFmt) {
            const owner = session.user.username.toUpperCase();
            const group = primaryGroupForUser(session.user);
            const dateStr = lsDate(new Date().toISOString());
            out += `drwxr-xr-x   2 ${owner.padEnd(8)} ${group.padEnd(8)}     8192 ${dateStr} ${path.posix.basename(p) || p}\n`;
          } else {
            out += `${t}\n`;
          }
          continue;
        }

        const entries = await session.store.backend.listUssFiles(session.systemId, p, {
          longFormat: longFmt,
          includeHidden: showHidden,
        });

        // Optional time sort (descending — newest first, like real ls -t)
        if (sortByTime) {
          entries.sort((a, b) => {
            const ta = a.mtime ? new Date(a.mtime).getTime() : 0;
            const tb = b.mtime ? new Date(b.mtime).getTime() : 0;
            return tb - ta;
          });
        }

        if (multiTarget) {
          out += `${t}:\n`;
        }

        if (!longFmt) {
          // Non-long: one entry per line (z/OS ls without a tty).
          for (const e of entries) {
            let name = e.name;
            if (classify) {
              if (e.isDirectory) name += '/';
              // Named pipes shown with `|` by -F (no pipe type in UssFileEntry, skip)
            }
            out += name + '\n';
          }
        } else {
          // Long format: synthesise `.` and `..` when -a is active.
          const owner = session.user.username.toUpperCase();
          const group = primaryGroupForUser(session.user);

          interface LsEntry {
            name: string;
            type: string; // d, -, l, p, e …
            mode: string; // octal
            nlinks: number;
            owner: string;
            group: string;
            size: number;
            mtime: string | undefined;
          }

          const lsEntries: LsEntry[] = [];

          if (showHidden) {
            // `.` — current dir, link count = number of subdirs + 2
            const numSubdirs = entries.filter(e => e.isDirectory).length;
            lsEntries.push({
              name: '.',
              type: 'd',
              mode: '755',
              nlinks: numSubdirs + 2,
              owner,
              group,
              size: 8192,
              mtime: new Date().toISOString(),
            });
            // `..` — parent dir placeholder
            lsEntries.push({
              name: '..',
              type: 'd',
              mode: '755',
              nlinks: 2,
              owner,
              group,
              size: 8192,
              mtime: undefined,
            });
          }

          for (const e of entries) {
            const isDir = e.isDirectory === true;
            lsEntries.push({
              name: e.name,
              type: isDir ? 'd' : '-',
              mode: e.mode ?? (isDir ? '755' : '644'),
              nlinks: isDir ? 2 : 1,
              owner,
              group,
              size: e.size ?? 0,
              mtime: e.mtime,
            });
          }

          // Compute column widths dynamically (match real z/OS ls -l alignment).
          const maxLinks = lsEntries.reduce((m, e) => Math.max(m, e.nlinks), 1);
          const linkW = String(maxLinks).length + 2; // e.g. max=54 → "  54" width=4
          const maxOwnerLen = lsEntries.reduce((m, e) => Math.max(m, e.owner.length), 1);
          const ownerW = maxOwnerLen + 2; // owner left-aligned, 2 trailing spaces before group
          const maxGroupLen = lsEntries.reduce((m, e) => Math.max(m, e.group.length), 1);
          const groupW = maxGroupLen;
          const maxSize = lsEntries.reduce((m, e) => Math.max(m, e.size), 0);
          const sizeW = Math.max(8, String(maxSize).length);

          // `total` line = sum of 512-byte block allocations for all entries.
          const total = lsEntries.reduce((sum, e) => sum + blocksFor(e.type === 'd', e.size), 0);
          out += `total ${total}\n`;

          for (const e of lsEntries) {
            const perm = `${e.type}${octalToRwx(e.mode)}`;
            const links = String(e.nlinks).padStart(linkW);
            const ownerStr = e.owner.padEnd(ownerW);
            const groupStr = e.group.padEnd(groupW);
            const sizeStr = String(e.size).padStart(sizeW);
            const dateStr = lsDate(e.mtime);
            let name = e.name;
            if (classify && e.type === 'd') name += '/';
            out += `${perm} ${links} ${ownerStr}${groupStr} ${sizeStr} ${dateStr} ${name}\n`;
          }
        }
      } catch {
        err += `ls: FSUM6785 File or directory "${p}" is not found\n`;
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
      } catch {
        err += `cat: ${p}: EDC5129I No such file or directory.\n`;
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
        const msg = (e as Error).message;
        if (recursive && /exists/i.test(msg)) continue;
        if (/exists/i.test(msg)) {
          err += `mkdir: FSUM6334 Directory "${p}" could not be created; file or directory already exists.\n`;
        } else {
          err += `mkdir: FSUM6334 Directory "${p}" could not be created; EDC5129I No such file or directory.\n`;
        }
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
        err += `rm: ${p}: EDC5129I No such file or directory.\n`;
        code = 1;
        void e;
      }
    }
    return { stdout: '', stderr: err, exitCode: code };
  },

  touch: async (session, args) => {
    let err = '';
    let code = 0;
    for (const t of args.filter(a => !a.startsWith('-'))) {
      const p = resolvePath(session, t);
      try {
        await session.store.backend.writeUssFile(session.systemId, p, '');
      } catch (e) {
        err += `touch: FSUM6002 Cannot create "${p}"; ${(e as Error).message}.\n`;
        code = 1;
      }
    }
    return { stdout: '', stderr: err, exitCode: code };
  },

  head: async (session, args, stdin) => {
    const { n, positional } = parseNLinesArgs(args);
    if (positional.length === 0) {
      const lines = stdin.split('\n');
      return {
        stdout: lines.slice(0, n).join('\n') + (lines.length > n ? '\n' : ''),
        stderr: '',
        exitCode: 0,
      };
    }
    // Multiple files get `==> file <==` headers (same as on non-tty).
    return readLinesFromFiles(
      session,
      positional,
      lines => lines.slice(0, n).join('\n') + (lines.length > n ? '\n' : ''),
      p => `head: ${p}: EDC5129I No such file or directory.\n`
    );
  },

  tail: async (session, args, stdin) => {
    const { n, positional } = parseNLinesArgs(args);
    if (positional.length === 0) {
      const lines = stdin.split('\n');
      return { stdout: lines.slice(-n).join('\n'), stderr: '', exitCode: 0 };
    }
    return readLinesFromFiles(
      session,
      positional,
      lines => lines.slice(-n).join('\n'),
      p => `tail: FSUM6003 input file "${p}": EDC5129I No such file or directory.\n`
    );
  },

  wc: async (session, args, stdin) => {
    const showLines = args.includes('-l');
    const showWords = args.includes('-w');
    const showBytes = args.includes('-c');
    const showAll = !showLines && !showWords && !showBytes;
    const positional = args.filter(a => !a.startsWith('-'));

    interface WcResult {
      path: string;
      lines: number;
      words: number;
      bytes: number;
      error?: string;
    }

    function countText(text: string, label: string): WcResult {
      const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
      const words = text.split(/\s+/).filter(Boolean).length;
      const bytes = Buffer.byteLength(text, 'utf8');
      return { path: label, lines, words, bytes };
    }

    const results: WcResult[] = [];
    let hasError = false;

    if (positional.length === 0) {
      results.push(countText(stdin, ''));
    } else {
      for (const f of positional) {
        const p = resolvePath(session, f);
        try {
          const text = (await session.store.backend.readUssFile(session.systemId, p)).text;
          results.push(countText(text, p));
        } catch {
          results.push({
            path: p,
            lines: 0,
            words: 0,
            bytes: 0,
            error: `wc: file "${p}": EDC5129I No such file or directory.`,
          });
          hasError = true;
        }
      }
    }

    let out = '';
    let err = '';

    // Format one wc line: each count right-aligned in 7 chars, 1 space between counts,
    // 4 spaces before filename (matches real z/OS wc output).
    function fmtLine(r: WcResult): string {
      const cols: string[] = [];
      if (showAll || showLines) cols.push(String(r.lines).padStart(7));
      if (showAll || showWords) cols.push(String(r.words).padStart(7));
      if (showAll || showBytes) cols.push(String(r.bytes).padStart(7));
      const counts = cols.join(' ');
      return r.path ? `${counts}    ${r.path}` : counts;
    }

    for (const r of results) {
      if (r.error) {
        err += r.error + '\n';
      } else {
        out += fmtLine(r) + '\n';
      }
    }

    // Total line when multiple non-error files.
    const valid = results.filter(r => !r.error);
    if (valid.length > 1) {
      const totals: WcResult = {
        path: 'total',
        lines: valid.reduce((s, r) => s + r.lines, 0),
        words: valid.reduce((s, r) => s + r.words, 0),
        bytes: valid.reduce((s, r) => s + r.bytes, 0),
      };
      out += fmtLine(totals) + '\n';
    }

    return { stdout: out, stderr: err, exitCode: hasError ? 1 : 0 };
  },

  grep: async (session, args, stdin) => {
    // Flags
    const caseInsensitive = args.includes('-i');
    const invert = args.includes('-v');
    const listFiles = args.includes('-l'); // print only filenames
    const showLineNums = args.includes('-n');
    const countOnly = args.includes('-c');
    // -E enables ERE (already JS regex, so no behaviour change needed)

    const positional = args.filter(a => !a.startsWith('-'));
    if (positional.length === 0) {
      return { stdout: '', stderr: 'grep: option requires an argument -- pattern\n', exitCode: 2 };
    }
    const pattern = positional[0];
    const files = positional.slice(1);

    let re: RegExp;
    try {
      re = new RegExp(pattern, caseInsensitive ? 'i' : '');
    } catch {
      return { stdout: '', stderr: `grep: invalid expression "${pattern}"\n`, exitCode: 2 };
    }

    let out = '';
    let err = '';
    let anyMatch = false;
    let exitCode = 1; // 1 = no match

    function processLines(text: string, label: string | null): void {
      const lines = text.split('\n');
      if (countOnly) {
        let cnt = 0;
        for (const line of lines) {
          const m = re.test(line);
          if (invert ? !m : m) cnt++;
        }
        anyMatch = anyMatch || cnt > 0;
        out += (label ? `${label}:` : '') + `${cnt}\n`;
        return;
      }
      if (listFiles && label) {
        for (const line of lines) {
          const m = re.test(line);
          if (invert ? !m : m) {
            anyMatch = true;
            out += `${label}\n`;
            return;
          }
        }
        return;
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = re.test(line);
        if (invert ? !m : m) {
          anyMatch = true;
          let prefix = label ? `${label}:` : '';
          if (showLineNums) prefix += `${i + 1}:`;
          out += prefix + line + '\n';
        }
      }
    }

    if (files.length === 0) {
      processLines(stdin, null);
    } else {
      for (const f of files) {
        const p = resolvePath(session, f);
        try {
          const text = (await session.store.backend.readUssFile(session.systemId, p)).text;
          processLines(text, files.length > 1 ? p : null);
        } catch {
          err += `grep: FSUM6003 input file "${p}": EDC5129I No such file or directory.\n`;
          exitCode = 2;
        }
      }
    }

    if (exitCode !== 2) exitCode = anyMatch ? 0 : 1;
    return { stdout: out, stderr: err, exitCode };
  },

  sleep: async (_s, args) => {
    const n = parseFloat(args[0] ?? '0');
    await new Promise(r => setTimeout(r, Math.min(n, 5) * 1000));
    return { stdout: '', stderr: '', exitCode: 0 };
  },
};
