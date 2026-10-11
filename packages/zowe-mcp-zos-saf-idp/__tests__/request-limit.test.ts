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

import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createRequestLimiter } from '../src/request-limit.js';

describe('createRequestLimiter', () => {
  it('answers 429 with Retry-After once the per-IP budget is spent', async () => {
    const app = express();
    app.use(createRequestLimiter({ limit: 2 }));
    app.get('/x', (_req, res) => {
      res.json({ ok: true });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/x`;
      const codes: number[] = [];
      let last: Response | undefined;
      for (let i = 0; i < 3; i++) {
        last = await fetch(url);
        codes.push(last.status);
      }
      expect(codes).toEqual([200, 200, 429]);
      expect(last?.headers.get('retry-after')).not.toBeNull();
      expect(await last?.json()).toEqual({ error: 'too_many_requests' });
    } finally {
      server.close();
    }
  });
});
