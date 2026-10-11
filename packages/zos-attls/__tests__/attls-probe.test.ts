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

import { describe, expect, it } from 'vitest';
import { probeAtTlsAddon, type AtTlsQueryResult } from '../src/index.js';

describe('probeAtTlsAddon', () => {
  it('queries the accepted side of a scratch loopback connection with a real fd', async () => {
    const seenFds: number[] = [];
    const result = await probeAtTlsAddon({
      queryFn: (fd): AtTlsQueryResult => {
        seenFds.push(fd);
        return { policyStatus: 'noPolicy', connStatus: 'notSecure' };
      },
    });
    expect(result).toEqual({ policyStatus: 'noPolicy', connStatus: 'notSecure' });
    // The fd extraction (socket._handle.fd) works on any POSIX libuv platform.
    expect(seenFds).toHaveLength(1);
    expect(seenFds[0]).toBeGreaterThanOrEqual(0);
  });

  it('propagates a query error (the doctor renders it with build instructions)', async () => {
    await expect(
      probeAtTlsAddon({
        queryFn: () => {
          throw Object.assign(new Error('EPROTOTYPE: wrong socket type'), { code: 'EPROTOTYPE' });
        },
      })
    ).rejects.toThrow(/EPROTOTYPE/);
  });

  it('propagates the loader failure when no addon is available (off z/OS)', async () => {
    await expect(probeAtTlsAddon()).rejects.toThrow(/ZOWE_MCP_ATTLS_MODULE|query\(\)/);
  });
});
