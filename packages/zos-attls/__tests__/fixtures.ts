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

/** Shared fixtures for the gate and client-guard test suites. */

import type { AtTlsQueryResult } from '../src/index.js';

export interface LogEntry {
  level: string;
  msg: string;
  fields?: Record<string, unknown>;
}

export function makeLog() {
  const entries: LogEntry[] = [];
  return {
    entries,
    log: (level: string, msg: string, fields?: Record<string, unknown>) =>
      entries.push({ level, msg, fields }),
  };
}

/** Canned SIOCTTLSCTL query results, named for the state they represent. */
export const queryResults = {
  secure: {
    policyStatus: 'enabled',
    connStatus: 'secure',
    protocol: 'TLSv1.2',
    protocolCode: 0x0303,
    cipher: '009D',
    securityType: 'client',
  } as AtTlsQueryResult,
  mappedNotStarted: { policyStatus: 'enabled', connStatus: 'notSecure' } as AtTlsQueryResult,
  clearRuleMatched: { policyStatus: 'notEnabled', connStatus: 'notSecure' } as AtTlsQueryResult,
  noPolicy: { policyStatus: 'noPolicy', connStatus: 'notSecure' } as AtTlsQueryResult,
  stackOff: { policyStatus: 'off', connStatus: 'notSecure' } as AtTlsQueryResult,
  applControlled: { policyStatus: 'applControlled', connStatus: 'notSecure' } as AtTlsQueryResult,
  handshake: { policyStatus: 'enabled', connStatus: 'handshakeInProgress' } as AtTlsQueryResult,
};
