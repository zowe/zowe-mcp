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
 * Doctor-grade addon check (docs/zos-attls-aware-mode.md § 6): loads the
 * addon and runs query() against the accepted side of a scratch loopback
 * self-connection. ANY decodable status is a pass — this validates the addon
 * and the fd plumbing, not the policy: an ephemeral scratch port's policy
 * answer is meaningless (AT-TLS rules are port-scoped), and the live port's
 * policy is checked by the gate's startup self-probe instead.
 */

import * as net from 'node:net';
import { socketFd } from './attls-gate.js';
import {
  loadAtTlsModule,
  type AtTlsConnStatus,
  type AtTlsPolicyStatus,
  type AtTlsQueryResult,
} from './attls-load.js';

/** What the scratch query decoded — reported verbatim by doctor output. */
export interface AtTlsProbeResult {
  policyStatus: AtTlsPolicyStatus;
  connStatus: AtTlsConnStatus;
}

export interface AtTlsProbeOptions {
  /** ZOWE_MCP_ATTLS_MODULE — explicit addon path for out-of-tree builds. */
  modulePath?: string;
  /** Injected for tests; when absent the native addon is loaded. */
  queryFn?: (fd: number) => AtTlsQueryResult;
}

/**
 * Throws on any failure — addon load (with the loader's actionable message),
 * missing fd on the accepted socket, or a query error — so callers can render
 * the failure with build instructions. Resolves with the decoded statuses.
 */
export async function probeAtTlsAddon(options: AtTlsProbeOptions = {}): Promise<AtTlsProbeResult> {
  let queryFn = options.queryFn;
  if (!queryFn) {
    const addon = loadAtTlsModule(options.modulePath);
    queryFn = fd => addon.query(fd);
  }

  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;

  let client: net.Socket | undefined;
  try {
    const accepted = await new Promise<net.Socket>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('scratch loopback self-connection timed out'));
      }, 2000);
      timer.unref();
      server.once('connection', socket => {
        clearTimeout(timer);
        resolve(socket);
      });
      client = net.connect({ host: '127.0.0.1', port });
      client.once('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const fd = socketFd(accepted);
    if (fd === undefined) {
      throw new Error('accepted scratch socket has no file descriptor (socket._handle.fd)');
    }
    const query = queryFn(fd);
    return { policyStatus: query.policyStatus, connStatus: query.connStatus };
  } finally {
    client?.destroy();
    server.close();
  }
}
