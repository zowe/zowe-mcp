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

import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

/**
 * Coarse per-IP request cap for the IdP's login and interaction routes.
 *
 * This is a backstop in front of the precise per-(username, IP) `LoginRateLimiter`, which only
 * counts failed SAF verifications. It bounds the cost of everything else on those routes
 * (HTML rendering, session lookups, body parsing). The budget is generous so a person
 * working through the browser flow never reaches it.
 */
export function createRequestLimiter(options?: {
  windowMs?: number;
  limit?: number;
}): RequestHandler {
  return rateLimit({
    windowMs: options?.windowMs ?? 60_000,
    limit: options?.limit ?? 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: req => ipKeyGenerator(req.socket.remoteAddress ?? 'unknown'),
    message: { error: 'too_many_requests' },
  });
}
