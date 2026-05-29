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
 * Enforce the `X-CSRF-ZOSMF-HEADER` request header.
 *
 * Real z/OSMF rejects state-changing requests (POST / PUT / DELETE) that lack
 * this header. The actual value is not validated server-side — z/OSMF only
 * cares that some non-empty value is present, which is enough to confirm the
 * request did not originate from a cross-site form post (CSRF protection
 * relies on browsers refusing to set custom headers for cross-origin requests
 * without a preflight).
 */

import type { NextFunction, Request, Response } from 'express';
import { ZosmfErrors, sendZosmfError } from '../errors.js';

/** Strict middleware — rejects with 403 + IZUM112E if the header is missing or empty. */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  const v = req.header('x-csrf-zosmf-header');
  if (!v?.trim()) {
    sendZosmfError(res, 403, ZosmfErrors.missingCsrf());
    return;
  }
  next();
}
