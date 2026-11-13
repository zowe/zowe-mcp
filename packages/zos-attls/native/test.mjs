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

/*
 * On-platform contract tests for the zos-attls addon (node:test — vitest
 * cannot run on z/OS). Run on the LPAR after build.sh:
 *
 *   node --test test.mjs                # addon from this directory
 *   ZOWE_MCP_ATTLS_MODULE=/path node --test test.mjs
 *
 * Covers docs/zos-attls-aware-mode.md § 8.2 (1)-(4): load, error contract on
 * a non-socket fd, the socket._handle.fd assumption, and decoded statuses on
 * a live stack (an ephemeral-port self-connection has no TTLS rule, so the
 * expected result is policyStatus=noPolicy + connStatus=notSecure).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const onZos = process.platform === 'os390';
const skipOffZos = { skip: onZos ? false : 'requires z/OS (SIOCTTLSCTL)' };

const require = createRequire(import.meta.url);

function loadAddon() {
  const modulePath =
    process.env.ZOWE_MCP_ATTLS_MODULE ?? path.dirname(fileURLToPath(import.meta.url));
  return require(modulePath);
}

/** Loopback server + connected client; returns the accepted (server-side) socket. */
async function acceptedSocketPair() {
  const server = net.createServer();
  const accepted = new Promise(resolve => server.once('connection', resolve));
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = server.address().port;
  const client = net.connect({ host: '127.0.0.1', port });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
  const serverSocket = await accepted;
  const close = () => {
    client.destroy();
    serverSocket.destroy();
    server.close();
  };
  return { serverSocket, clientSocket: client, close };
}

test('addon loads and exposes query()', skipOffZos, () => {
  const addon = loadAddon();
  assert.equal(typeof addon.query, 'function');
});

test('query() on a non-socket fd throws an errno-style error', skipOffZos, () => {
  const addon = loadAddon();
  const fd = fs.openSync(os.devNull, 'r');
  try {
    assert.throws(
      () => addon.query(fd),
      err => {
        assert.ok(err instanceof Error);
        assert.equal(typeof err.code, 'string', 'error carries an errno name in code');
        assert.equal(typeof err.errno, 'number', 'error carries a numeric errno');
        // The real ioctl may return any errno for a non-socket fd (observed
        // on Host-A: ENOSYS for /dev/null) — but it must be the real ioctl,
        // not the off-z/OS stub (a mis-copied binary).
        assert.ok(!err.message.includes('not z/OS'), 'must not be the off-z/OS stub');
        return true;
      }
    );
  } finally {
    fs.closeSync(fd);
  }
});

test(
  'an accepted socket exposes _handle.fd (gate fd-extraction assumption)',
  skipOffZos,
  async () => {
    const { serverSocket, close } = await acceptedSocketPair();
    try {
      const fd = serverSocket._handle?.fd;
      assert.equal(typeof fd, 'number');
      assert.ok(fd >= 0);
    } finally {
      close();
    }
  }
);

test('ephemeral-port self-connection decodes as noPolicy/notSecure', skipOffZos, async () => {
  const addon = loadAddon();
  const { serverSocket, close } = await acceptedSocketPair();
  try {
    const result = addon.query(serverSocket._handle.fd);
    assert.equal(result.connStatus, 'notSecure');
    assert.equal(result.policyStatus, 'noPolicy');
    assert.equal(result.protocol, undefined, 'no protocol fields on a not-secure connection');
  } finally {
    close();
  }
});

test(
  'query works on the OUTBOUND (client) socket too — the aware-client assumption',
  skipOffZos,
  async () => {
    // The client guard (src/attls-client.ts) queries the connecting side
    // before its first write; an unruled loopback pair must decode as the
    // fail-open signature there as well. Full outbound coverage (rules,
    // HostReferenceIdDNS) lives in deploy/attls-client-probe.mjs.
    const addon = loadAddon();
    const { clientSocket, close } = await acceptedSocketPair();
    try {
      const result = addon.query(clientSocket._handle.fd);
      assert.equal(result.connStatus, 'notSecure');
      assert.equal(result.policyStatus, 'noPolicy');
    } finally {
      close();
    }
  }
);
