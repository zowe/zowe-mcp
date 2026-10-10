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
 * Scripted stand-in for `zowex-launcher <zowex> server` in LocalClient unit
 * tests: consumes the first stdin line (the userid — the launcher's contract),
 * then behaves per that userid so tests can drive every startup and protocol
 * path without a z/OS system:
 *
 *   EXIT5    — launcher denied the switch: EPERM hint on stderr, exit 5
 *   EXIT4    — unknown user: exit 4
 *   NOBANNER — prints a non-JSON first line (LE diagnostic shape)
 *   SILENT   — never prints the ready banner (startup timeout)
 *   anything else — prints the ready banner, then answers JSON-RPC requests:
 *     params.dsname 'FAIL' → JSON-RPC error; 'HANG' → no response;
 *     'DIE' → exits mid-flight; otherwise a canned listDatasets-shaped result.
 */

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
let userid;

rl.on('line', line => {
  if (userid === undefined) {
    userid = line.trim();
    switch (userid) {
      case 'EXIT5':
        process.stderr.write('zowex-launcher: error: setuid: EDC5139I Operation not permitted.\n');
        process.exit(5);
        break;
      case 'EXIT4':
        process.stderr.write(
          `zowex-launcher: error: unknown user or no OMVS segment: ${userid}\n`
        );
        process.exit(4);
        break;
      case 'NOBANNER':
        process.stdout.write('CEE3501S The module zowex was not found.\n');
        break;
      case 'SILENT':
        break;
      case 'WARNHOME':
        // The launcher's non-fatal path: a chdir warning on stderr, then the
        // banner on stdout — the two streams must not be conflated at startup.
        process.stderr.write(
          'zowex-launcher: warning: chdir to target home (continuing): EDC5129I No such file or directory.\n'
        );
        process.stdout.write(
          `${JSON.stringify({ status: 'ready', data: { version: '0.0.0-test' } })}\n`
        );
        break;
      default:
        process.stdout.write(
          `${JSON.stringify({ status: 'ready', data: { version: '0.0.0-test' } })}\n`
        );
    }
    return;
  }
  const request = JSON.parse(line);
  const dsname = request.params?.pattern ?? request.params?.dsname;
  if (dsname === 'HANG') {
    return;
  }
  if (dsname === 'DIE') {
    process.exit(1);
  }
  if (dsname === 'FAIL') {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: 'scripted failure', data: 'RC=8' },
      })}\n`
    );
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { items: [{ name: `${userid}.TEST.PDS` }] },
    })}\n`
  );
});
