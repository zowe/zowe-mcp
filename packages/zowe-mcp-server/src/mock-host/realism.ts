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
 * z/OS OpenSSH protocol-layer realism strings.
 *
 * Pinned values match what a real IBM z/OS host emits, so MCP server log-scrubbers,
 * error classifiers, and credential UX paths are exercised against true-to-life data.
 */

/** SSH protocol identification string (sent before key exchange). */
export const DEFAULT_SSH_IDENT = 'SSH-2.0-OpenSSH_7.6p1';

/**
 * Default pre-auth banner — z/OS-flavoured box, no IBM-copyrighted text.
 *
 * Override per-host by editing `<mockDir>/_ssh/banner.txt` (the daemon reads it
 * at startup) or with `mock-zos start --banner /path/to/file`.
 */
export const DEFAULT_PRE_AUTH_BANNER = [
  '*****************************************************************',
  '*                  Zowe Mock z/OS SSH Host                      *',
  '*                       https://zowe.org                        *',
  '*                                                               *',
  '*  Open source under the Eclipse Public License v2.0.           *',
  '*  For development and testing only. Not for production use.    *',
  '*  Unauthorized access prohibited.                              *',
  '*****************************************************************',
  '',
].join('\r\n');

/**
 * Default post-auth MOTD — short Zowe notice in z/OS style.
 *
 * Override via `<mockDir>/_ssh/motd.txt` or `mock-zos start --motd /path/to/file`.
 */
export const DEFAULT_MOTD =
  'ZWE0000I Welcome to the Zowe mock z/OS host. This system is for development only.';

/**
 * Default sysname/release fields surfaced by `uname -a`. The format mirrors what
 * `uname -a` produces on a real z/OS USS shell (5 fields):
 *   OS/390 SY1 28.00 03 8561
 *   sysname=OS/390, nodename=SY1, release=28.00, version=03, machine=8561
 */
export const DEFAULT_SYSNAME = 'OS/390';
export const DEFAULT_NODENAME = 'SY1';
export const DEFAULT_RELEASE = '28.00';
export const DEFAULT_VERSION = '03';
export const DEFAULT_MACHINE = '8561';

/** Compose a z/OS-style `uname -a` line (5 fields: sysname nodename release version machine). */
export function unameLine(): string {
  return `${DEFAULT_SYSNAME} ${DEFAULT_NODENAME} ${DEFAULT_RELEASE} ${DEFAULT_VERSION} ${DEFAULT_MACHINE}`;
}

/** Default `id` output for a user. */
export function idLine(
  user: string,
  uid: number,
  gid: number,
  primaryGroup: string,
  groups: string[] = []
): string {
  const allGroups = [primaryGroup, ...groups];
  const groupClause = allGroups.map((g, i) => `${i === 0 ? gid : 20 + i}(${g})`).join(',');
  return `uid=${uid}(${user.toUpperCase()}) gid=${gid}(${primaryGroup}) groups=${groupClause}`;
}

/** Last-login lines printed at the top of a shell session. */
export function lastLoginLines(
  user: string,
  successAt: Date,
  fromHost: string,
  unsuccessfulAt?: Date
): string {
  const fmt = (d: Date) =>
    d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      year: 'numeric',
    });
  const lines = [
    `Last successful login for ${user.toUpperCase()}: ${fmt(successAt)} from ${fromHost}`,
  ];
  if (unsuccessfulAt) {
    lines.push(
      `Last unsuccessful login for ${user.toUpperCase()}: ${fmt(unsuccessfulAt)} from ${fromHost}`
    );
  }
  return lines.join('\r\n');
}

/** Default PATH on z/OS USS. */
export const DEFAULT_PATH = '/bin:/usr/bin:/usr/sbin:/usr/lpp/java/J17.0_64/bin';
