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
 * Express middleware that sets `X-IBM-Txid` on every HTTP response.
 *
 * Real z/OSMF 5.30 returns this header on all responses. The format is
 * `tx` followed by 16 zero-padded lower-case hex digits representing a
 * monotonically increasing per-request transaction counter:
 *
 *   x-ibm-txid: tx000000000008ee4c
 *
 * The mock uses a per-process counter starting at 1 so test assertions get
 * predictable values and integration tests can verify the header is present.
 */

import type { NextFunction, Request, Response } from 'express';

let txCounter = 0;

export function txidMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-IBM-Txid', 'tx' + (++txCounter).toString(16).padStart(16, '0'));
  next();
}
