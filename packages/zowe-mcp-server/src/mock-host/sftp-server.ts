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
 * Minimal SFTP subsystem implementation — just enough for zowex-sdk's
 * `ZSshUtils.installServer()` to succeed.
 *
 * It handles:
 *   - OPEN / WRITE / CLOSE on `server.pax.Z` (bytes are checksummed and discarded)
 *   - STAT / LSTAT on the open handle (size = bytes received)
 *   - UNLINK / REALPATH / REMOVE / MKDIR / OPENDIR / READDIR (no-ops or minimal)
 *
 * Anything else returns OP_UNSUPPORTED. The daemon intentionally does NOT serve
 * the real USS namespace over SFTP — that's outside scope.
 *
 * Note on typing: the @types/ssh2 declarations type SFTPWrapper as a generic
 * EventEmitter, so the server-side handler signatures
 * (OPEN/WRITE/CLOSE/STAT/etc.) come through as `(...args: unknown[]) => void`.
 * We narrow the args at the top of each handler with explicit typed wrappers
 * so the implementations stay readable and type-safe.
 */

import { createHash, type Hash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ssh2 from 'ssh2';
import type { MockLogger } from './log.js';

const STATUS_CODE = ssh2.utils.sftp.STATUS_CODE;

interface OpenHandle {
  filename: string;
  size: number;
  hash: Hash;
}

/**
 * Wrap a strongly-typed SFTP server handler in the loose EventEmitter signature
 * that @types/ssh2 advertises. Keeps each handler body type-checked.
 */
function on<T extends (...args: never[]) => void>(
  sftp: ssh2.SFTPWrapper,
  event: string,
  handler: T
): void {
  (sftp as unknown as { on: (e: string, fn: (...a: unknown[]) => void) => void }).on(
    event,
    handler as unknown as (...a: unknown[]) => void
  );
}

export function attachSftpServer(
  accept: () => ssh2.SFTPWrapper,
  reject: () => boolean,
  log: MockLogger,
  mockDir: string
): void {
  const sftp = accept();
  if (!sftp) {
    reject();
    return;
  }
  log('info', 'SFTP subsystem opened');

  const handles = new Map<string, OpenHandle>();
  let nextHandle = 1;

  function makeHandle(filename: string): Buffer {
    const id = String(nextHandle++);
    handles.set(id, { filename, size: 0, hash: createHash('sha256') });
    return Buffer.from(id);
  }

  on(sftp, 'OPEN', (reqid: number, filename: string) => {
    log('debug', `SFTP OPEN ${filename}`);
    const h = makeHandle(filename);
    sftp.handle(reqid, h);
  });

  on(sftp, 'WRITE', (reqid: number, handle: Buffer, _offset: number, data: Buffer) => {
    const id = handle.toString();
    const h = handles.get(id);
    if (!h) {
      sftp.status(reqid, STATUS_CODE.FAILURE);
      return;
    }
    h.size += data.length;
    h.hash.update(data);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  on(sftp, 'CLOSE', (reqid: number, handle: Buffer) => {
    const id = handle.toString();
    const h = handles.get(id);
    if (!h) {
      sftp.status(reqid, STATUS_CODE.OK);
      return;
    }
    handles.delete(id);
    // Operation-level info: the zowex install dance uploads `server.pax.Z` here.
    const isInstall = h.filename.endsWith('server.pax.Z');
    log(
      'info',
      `SFTP CLOSE ${h.filename} ${h.size} bytes${isInstall ? ' (zowex install upload)' : ''}`
    );
    if (!isInstall) {
      sftp.status(reqid, STATUS_CODE.OK);
      return;
    }
    // Record the upload for tests, then ack the close.
    const record = async () => {
      try {
        await fs.mkdir(path.join(mockDir, '_ssh'), { recursive: true });
        await fs.writeFile(
          path.join(mockDir, '_ssh', 'last_upload.json'),
          JSON.stringify(
            {
              filename: h.filename,
              sizeBytes: h.size,
              sha256: h.hash.digest('hex'),
              receivedAt: new Date().toISOString(),
            },
            null,
            2
          )
        );
      } catch (e) {
        log('warn', `SFTP recording failed: ${(e as Error).message}`);
      }
    };
    void record().finally(() => sftp.status(reqid, STATUS_CODE.OK));
  });

  on(sftp, 'STAT', (reqid: number, _p: string) => {
    sftp.attrs(reqid, fakeAttrs(0));
  });
  on(sftp, 'LSTAT', (reqid: number, _p: string) => {
    sftp.attrs(reqid, fakeAttrs(0));
  });
  on(sftp, 'FSTAT', (reqid: number, handle: Buffer) => {
    const h = handles.get(handle.toString());
    sftp.attrs(reqid, fakeAttrs(h?.size ?? 0));
  });

  on(sftp, 'UNLINK', (reqid: number, _p: string) => sftp.status(reqid, STATUS_CODE.OK));
  on(sftp, 'REMOVE', (reqid: number, _p: string) => sftp.status(reqid, STATUS_CODE.OK));
  on(sftp, 'RMDIR', (reqid: number, _p: string) => sftp.status(reqid, STATUS_CODE.OK));
  on(sftp, 'MKDIR', (reqid: number, _p: string) => sftp.status(reqid, STATUS_CODE.OK));

  on(sftp, 'REALPATH', (reqid: number, p: string) => {
    const resolved = p || '/u/user1';
    sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: fakeAttrs(0) }]);
  });

  on(sftp, 'OPENDIR', (reqid: number, _p: string) => {
    const h = makeHandle('<dir>');
    sftp.handle(reqid, h);
  });
  on(sftp, 'READDIR', (reqid: number, _handle: Buffer) => sftp.status(reqid, STATUS_CODE.EOF));

  on(sftp, 'SETSTAT', (reqid: number, _p: string, _attrs: ssh2.Attributes) =>
    sftp.status(reqid, STATUS_CODE.OK)
  );
  on(sftp, 'FSETSTAT', (reqid: number, _handle: Buffer, _attrs: ssh2.Attributes) =>
    sftp.status(reqid, STATUS_CODE.OK)
  );
  on(sftp, 'RENAME', (reqid: number, _old: string, _new: string) =>
    sftp.status(reqid, STATUS_CODE.OK)
  );

  function fakeAttrs(size: number): ssh2.Attributes {
    const now = Math.floor(Date.now() / 1000);
    return {
      mode: 0o100644,
      uid: 12345,
      gid: 10,
      size,
      atime: now,
      mtime: now,
    };
  }
}
