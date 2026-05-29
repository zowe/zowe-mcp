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
 * `GET /zosmf/info` — token / Basic verification + return system metadata.
 *
 * Real z/OSMF requires `X-CSRF-ZOSMF-HEADER` on /info as well. The mock is
 * lenient: we log a warning when the header is missing, but still respond
 * normally. This matches the user-specified "lenient for the mock" behavior
 * and helps integrate clients that don't bother sending CSRF on read-only
 * endpoints.
 */

import { Router } from 'express';
import type { MockUser } from '../../users.js';
import { ZosmfErrors, sendZosmfError } from '../errors.js';
import { DEFAULT_ZOSMF_INFO, type ZosmfInfoPayload } from '../info-payload.js';
import { resolveAuthForRequest } from '../request.js';
import type { TokenStore } from '../token-store.js';

export interface InfoRouteDeps {
  users: MockUser[];
  tokens: TokenStore;
  defaultSystemId: string;
  payload?: ZosmfInfoPayload;
  log: (lvl: 'info' | 'warn' | 'debug', msg: string) => void;
}

export function registerInfoRoute(deps: InfoRouteDeps): Router {
  const router = Router();
  const body = deps.payload ?? DEFAULT_ZOSMF_INFO;

  router.get('/zosmf/info', (req, res) => {
    if (!req.header('x-csrf-zosmf-header')) {
      deps.log('warn', 'GET /zosmf/info called without X-CSRF-ZOSMF-HEADER (lenient — accepting)');
    }
    const auth = resolveAuthForRequest(req, deps);
    if (!auth) {
      res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
      sendZosmfError(res, 401, ZosmfErrors.unauthorized());
      return;
    }
    res
      .status(200)
      .set('Content-Type', 'application/json; charset=UTF-8')
      .send(JSON.stringify(body));
  });

  return router;
}
