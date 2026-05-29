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
 * z/OS error catalog used by the mock host.
 *
 * Messages mirror real IBM message IDs so the MCP server's `classifyNativeError`
 * and `getAdditionalDetails` machinery sees production-like signals. The exact text
 * does not need to be byte-perfect — the message ID prefix is what client-side
 * pattern matching keys on.
 *
 * Sources:
 *   IDC*  - z/OS DFSMS Access Method Services Commands (IDCAMS)
 *   BPXFX - z/OS UNIX System Services Messages (BPX File eXtensions, from zowex)
 *   IGD/IEF - z/OS MVS System Messages Vol. 5/8
 *   ICH   - z/OS Security Server RACF Messages
 *   EDC   - z/OS UNIX System Services Messages and Codes
 *   IEFC  - z/OS JES2 Messages
 *   HASP  - z/OS JES2 Messages
 *   IKJ   - z/OS TSO/E Messages
 *   IEE   - z/OS MVS System Messages Vol. 6
 *   FOTS  - z/OS OpenSSH Messages
 */

export interface ZosErrorOptions {
  /** Additional context appended after the canonical message. */
  detail?: string;
  /** Arbitrary data carried through to the JSON-RPC error envelope's `data` field. */
  data?: unknown;
}

export class ZosError extends Error {
  public readonly messageId: string;
  public readonly data?: unknown;

  constructor(messageId: string, message: string, opts: ZosErrorOptions = {}) {
    const full = opts.detail
      ? `${messageId} ${message} ${opts.detail}`
      : `${messageId} ${message}`;
    super(full);
    this.name = 'ZosError';
    this.messageId = messageId;
    this.data = opts.data;
  }
}

export const ZosErrors = {
  /** Data set not cataloged or not found. */
  dsNotFound(dsn: string): ZosError {
    return new ZosError('IDC3012I', `ENTRY ${dsn.toUpperCase()} NOT FOUND`);
  },
  /** Member missing from a PDS/PDS-E. zowex itself emits BPXFX440I-style strings. */
  memberNotFound(dsn: string, member: string): ZosError {
    return new ZosError(
      'BPXFX440I',
      `MEMBER ${member.toUpperCase()} NOT FOUND IN ${dsn.toUpperCase()}`
    );
  },
  /** Data set already exists. */
  dsAlreadyExists(dsn: string): ZosError {
    return new ZosError('IGD17501I', `DATA SET ${dsn.toUpperCase()} ALREADY EXISTS`);
  },
  /** RACF — insufficient access authority. */
  racfNoAccess(user: string, dsn: string): ZosError {
    return new ZosError(
      'ICH408I',
      `USER(${user.toUpperCase()}) GROUP(STCGROUP) NAME(...) ${dsn.toUpperCase()} CL(DATASET) INSUFFICIENT ACCESS AUTHORITY`
    );
  },
  /** USS file does not exist. */
  ussNoEntry(p: string): ZosError {
    return new ZosError('EDC5129I', `No such file or directory.`, { detail: `(${p})` });
  },
  /** USS permission denied. */
  ussNoPermission(p: string): ZosError {
    return new ZosError('EDC5111I', `Permission denied.`, { detail: `(${p})` });
  },
  /** USS file/directory already exists. */
  ussExists(p: string): ZosError {
    return new ZosError('EDC5117I', `File exists.`, { detail: `(${p})` });
  },
  /** USS path is not a directory. */
  ussNotADirectory(p: string): ZosError {
    return new ZosError('EDC5120I', `Not a directory.`, { detail: `(${p})` });
  },
  /** USS path is a directory. */
  ussIsADirectory(p: string): ZosError {
    return new ZosError('EDC5121I', `Is a directory.`, { detail: `(${p})` });
  },
  /** Job not found in JES queues. */
  jobNotFound(jobIdOrName: string): ZosError {
    return new ZosError('IEFC452I', `${jobIdOrName.toUpperCase()} - JOB NOT FOUND`);
  },
  /** Job not in OUTPUT queue. */
  jobNotInOutput(jobIdOrName: string): ZosError {
    return new ZosError('HASP890', `JOB ${jobIdOrName.toUpperCase()} NOT IN OUTPUT QUEUE`);
  },
  /** TSO command unknown. */
  tsoUnknownCmd(cmd: string): ZosError {
    return new ZosError('IKJ56500I', `COMMAND ${cmd.toUpperCase()} NOT FOUND`);
  },
  /** Console command rejected. */
  consoleInvalid(cmd: string): ZosError {
    return new ZosError('IEE305I', `${cmd.toUpperCase()} COMMAND INVALID`);
  },
  /** ETag mismatch on optimistic-locking write. */
  etagMismatch(name: string): ZosError {
    return new ZosError(
      'BPXFX441I',
      `ETag mismatch writing ${name}; resource changed since last read`
    );
  },
  /** Generic fallback. */
  internal(message: string): ZosError {
    return new ZosError('ZRSE0001E', message);
  },
};

/**
 * Auth-layer failure strings emitted on disconnect for realistic z/OS OpenSSH (FOTS)
 * and RACF (ICH) signals.
 */
export const AuthMessages = {
  wrongPassword(user: string): string {
    return `FOTS1373 USER ${user.toUpperCase()} - WRONG PASSWORD`;
  },
  passwordExpired(user: string): string {
    return `FOTS1668 PASSWORD EXPIRED FOR ${user.toUpperCase()}`;
  },
  racfRevoked(user: string): string {
    const date = new Date();
    const dateStr = `${date
      .toLocaleString('en-US', { month: 'short' })
      .toUpperCase()} ${date.getDate()},${date.getFullYear()}`;
    return (
      `ICH70001I ${user.toUpperCase()} LAST ACCESS AT 00:00:00 ON ${dateStr}\n` +
      `ICH408I USER(${user.toUpperCase()}) GROUP(STCGROUP) NAME(...) LOGON/JOB INITIATION - REVOKED`
    );
  },
  tooManyAttempts(user: string): string {
    return `FOTS0830 Too many authentication failures for ${user.toUpperCase()}`;
  },
  passwordExpiresInDays(days: number): string {
    return `WARNING: Your password will expire in ${days} day${days === 1 ? '' : 's'}.`;
  },
};
