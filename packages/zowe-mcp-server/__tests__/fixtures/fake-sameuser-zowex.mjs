#!/usr/bin/env node
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
 * Direct-spawn stand-in for `zowex server` (stdio same-user transport tests):
 * prints the ready banner immediately — there is no launcher and no userid
 * preamble in this mode. A first stdin line that is NOT JSON-RPC (a
 * launcher-style userid preamble) is a contract violation: exit 99, so the
 * test's next RPC fails loudly if LocalClient ever sends one.
 */

import { createInterface } from 'node:readline';

process.stdout.write(
  `${JSON.stringify({ status: 'ready', data: { version: '0.0.0-sameuser' } })}\n`
);

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.stderr.write(`unexpected non-JSON line (userid preamble?): ${line}\n`);
    process.exit(99);
  }
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { items: [{ name: 'SAMEUSER.TEST.PDS' }] },
    })}\n`
  );
});
