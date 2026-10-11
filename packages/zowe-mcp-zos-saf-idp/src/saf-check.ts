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

import { Client } from 'ssh2';

export interface SafCheckOptions {
  host?: string;
  port?: number;
  readyTimeoutMs?: number;
}

/**
 * Result of one SSH credential probe. `denied` is a real SAF rejection of the
 * credentials; `unavailable` is a backend failure (sshd down, unreachable
 * host, timeout) that says nothing about the credentials — the caller must
 * surface it as a 503, never as a 401, and never count it against a user's
 * rate-limit budget.
 */
export type SshSafCheckResult =
  | { outcome: 'authenticated' }
  | { outcome: 'denied' }
  | { outcome: 'unavailable'; detail: string };

/**
 * Verifies a z/OS username+password by attempting a real SSH login to the target
 * host (loopback by default) and treating the SSH auth success/failure as the SAF
 * verdict. Connect-only: never runs a command, never touches zowex.
 *
 * Never rejects. ssh2 tags errors with a `level`: 'client-authentication' is the
 * server rejecting the credentials; anything else (socket, timeout, protocol) is
 * the backend being unavailable. Never logs the password or the raw ssh2 error
 * object; `detail` carries only the error level/code, operator-facing.
 */
export function verifySafCredential(
  username: string,
  password: string,
  options: SafCheckOptions = {}
): Promise<SshSafCheckResult> {
  const { host = '127.0.0.1', port = 22, readyTimeoutMs = 5000 } = options;
  return new Promise(resolve => {
    const client = new Client();
    let settled = false;
    const finish = (result: SshSafCheckResult): void => {
      if (settled) return;
      settled = true;
      client.end();
      resolve(result);
    };
    // Guarded by `settled` rather than removeAllListeners(): an EventEmitter throws
    // if 'error' is emitted with zero listeners left, and ssh2 may still emit one
    // while/after end() tears the connection down.
    client.on('ready', () => finish({ outcome: 'authenticated' }));
    client.on('error', (err: Error & { level?: string; code?: string }) => {
      if (err.level === 'client-authentication') {
        finish({ outcome: 'denied' });
      } else {
        finish({
          outcome: 'unavailable',
          detail: `SSH SAF probe to ${host}:${String(port)} failed (${err.level ?? err.code ?? 'error'})`,
        });
      }
    });
    try {
      client.connect({ host, port, username, password, readyTimeout: readyTimeoutMs });
    } catch {
      finish({
        outcome: 'unavailable',
        detail: `SSH SAF probe to ${host}:${String(port)} could not start`,
      });
    }
  });
}
