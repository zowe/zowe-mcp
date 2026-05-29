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
 * Shared logger primitives for the mock daemon's SSH + z/OSMF subsystems.
 *
 * Both layers wrap the daemon's central stderr logger with a `[mock-ssh]` /
 * `[mock-zosmf]` tag so operators can grep by transport. Severity follows the
 * usual hierarchy: `error` → 5xx / unhandled exceptions, `warn` → 4xx / auth
 * failures, `info` → normal operations (visible by default), `debug`/`trace`
 * → noisier internals (only when `--log-level debug`+ is set).
 *
 * Output is colorized automatically when stderr is a TTY and the `NO_COLOR`
 * env var (https://no-color.org) is not set. Colors are scoped to the
 * `[level]` tag and an optional secondary tag (`[mock-ssh]` / `[mock-zosmf]`)
 * so the bulk of the message stays terminal-default and tools that strip
 * ANSI (less, file pipes) still get readable output.
 */
export type MockLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type MockLogger = (lvl: MockLogLevel, msg: string) => void;

export const LOG_LEVELS: readonly MockLogLevel[] = [
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;

// ANSI escape codes. Kept private; consumers go through {@link colorize}.
const ANSI = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
} as const;

const LEVEL_COLORS: Record<MockLogLevel, string> = {
  error: ANSI.red,
  warn: ANSI.yellow,
  info: ANSI.green,
  debug: ANSI.cyan,
  trace: ANSI.gray,
};

/** Whether stderr supports color. False under `NO_COLOR=1` or when piped. */
export function colorEnabled(): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== '') return false;
  return Boolean(process.stderr.isTTY);
}

export function colorize(text: string, color: keyof typeof ANSI): string {
  if (!colorEnabled()) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

/**
 * Build the daemon's central stderr logger.
 *
 * Each line looks like `[<level>] <message>` (with ANSI on the bracketed tag
 * when stderr is a TTY). Sub-tags such as `[mock-ssh]` / `[mock-zosmf]` are
 * already embedded in `message` by the caller — we colorize them here too,
 * cheaply, by regex.
 */
export function makeLogger(level: MockLogLevel): MockLogger {
  const threshold = LOG_LEVELS.indexOf(level);
  const useColor = colorEnabled();
  return (lvl: MockLogLevel, msg: string) => {
    if (LOG_LEVELS.indexOf(lvl) > threshold) return;
    const tag = useColor ? `${LEVEL_COLORS[lvl]}[${lvl}]${ANSI.reset}` : `[${lvl}]`;
    // Subtle accent on the subsystem tag so eyes can find it in mixed traffic.
    const body = useColor
      ? msg.replace(/^\[(mock-ssh|mock-zosmf)\]/, `${ANSI.bold}[$1]${ANSI.reset}`)
      : msg;
    process.stderr.write(`${tag} ${body}\n`);
  };
}
