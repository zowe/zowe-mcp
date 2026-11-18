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

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Fresh localhost TLS material; generated private keys never outlive this function on disk. */
export function generateHttpsTestCertificate(): { key: Buffer; cert: Buffer } {
  const directory = mkdtempSync(join(tmpdir(), 'zowe-mcp-https-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        'key.pem',
        '-out',
        'cert.pem',
      ],
      {
        cwd: directory,
        // Git for Windows must not rewrite /CN=localhost into a filesystem path.
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
        windowsHide: true,
        stdio: 'ignore',
      }
    );
    return {
      key: readFileSync(join(directory, 'key.pem')),
      cert: readFileSync(join(directory, 'cert.pem')),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
