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
 * `GET /zosmf/restfiles/ds` — list z/OS data sets matching a DSLEVEL pattern.
 *
 * Used by Zowe Explorer's Data Sets panel and the Zowe SDK's
 * `zos-files list ds` command. Delegates the actual lookup to
 * {@link MockHostStore.backend.listDatasets} so the same on-disk fixtures gate
 * both the SSH/zowex transport and this HTTP transport.
 *
 * Spec notes:
 *   - `dslevel` (query) is required. Wildcards: `*` = one qualifier,
 *     `**` = zero or more qualifiers. We delegate to the backend's existing
 *     pattern matcher, which also treats a trailing `*` as `**` per ISPF 3.4
 *     convention.
 *   - `volser` and `start` are optional filters / pagination cursor.
 *   - `X-IBM-Max-Items` caps the result count.
 *   - `X-IBM-Attributes: base|csi|vol` is accepted but not differentiated —
 *     we always return the rich attribute set; clients tolerate extra fields.
 *   - `X-CSRF-ZOSMF-HEADER` is required (real z/OSMF enforces this on the
 *     `/restfiles/*` family even for GETs).
 */

import { Router, type Request, type Response } from 'express';
import type { MockHostStore } from '../../store.js';
import type { MockUser } from '../../users.js';
import { ZosmfErrors, sendZosmfError } from '../errors.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { resolveAuthForRequest } from '../request.js';
import { buildDatasetListResponse } from '../response.js';
import type { TokenStore } from '../token-store.js';

export interface RestfilesDsRouteDeps {
  users: MockUser[];
  tokens: TokenStore;
  store: MockHostStore;
  defaultSystemId: string;
  log: (lvl: 'info' | 'warn' | 'debug', msg: string) => void;
}

export function registerRestfilesDsRoute(deps: RestfilesDsRouteDeps): Router {
  const router = Router();
  router.get('/zosmf/restfiles/ds', requireCsrfHeader, (req, res) => {
    void handleListDs(req, res, deps);
  });
  return router;
}

async function handleListDs(
  req: Request,
  res: Response,
  deps: RestfilesDsRouteDeps
): Promise<void> {
  // 1. Auth — same cookie-or-Basic resolution as /zosmf/info.
  const auth = resolveAuthForRequest(req, deps);
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
    sendZosmfError(res, 401, ZosmfErrors.unauthorized());
    return;
  }

  // 2. dslevel must be present and non-empty.
  const dslevelRaw = req.query.dslevel;
  if (typeof dslevelRaw !== 'string' || dslevelRaw.trim() === '') {
    deps.log('info', `restfiles/ds rejected: missing dslevel (user=${auth.username})`);
    sendZosmfError(
      res,
      400,
      ZosmfErrors.invalidQuery('dslevel', 'The dslevel query parameter is required.')
    );
    return;
  }
  // Normalize the dslevel so it matches real z/OSMF / ISPF 3.4 semantics:
  // a bare HLQ (e.g. `USER1`) means "all DSNs under USER1", equivalent to
  // `USER1.**`. The mock's underlying `matchPattern` only auto-promotes a
  // trailing lone `*`, so we expand bare HLQs here at the route boundary
  // (keeping the backend's strict semantics intact for callers that need them).
  let dslevel = dslevelRaw.trim();
  const expanded = /^[A-Z0-9@#$]{1,8}$/i.test(dslevel) ? `${dslevel}.**` : dslevel;
  if (expanded !== dslevel) {
    deps.log('debug', `dslevel '${dslevel}' expanded to '${expanded}' (bare HLQ semantics)`);
    dslevel = expanded;
  }
  const volser = typeof req.query.volser === 'string' ? req.query.volser : undefined;
  const start = typeof req.query.start === 'string' ? req.query.start.toUpperCase() : undefined;

  // 3. X-IBM-Max-Items header (optional).
  const maxItemsHeader = req.header('x-ibm-max-items');
  let maxItems: number | undefined;
  if (maxItemsHeader) {
    const parsed = Number.parseInt(maxItemsHeader, 10);
    if (Number.isFinite(parsed) && parsed > 0) maxItems = parsed;
  }

  // 4. X-IBM-Attributes — accepted, not differentiated. Note for debug visibility.
  const attrHeader = req.header('x-ibm-attributes');
  if (attrHeader && attrHeader !== 'base') {
    deps.log(
      'debug',
      `X-IBM-Attributes=${attrHeader} requested; mock always returns the rich attribute set`
    );
  }

  // 5. Delegate to the backend.
  try {
    let entries = await deps.store.backend.listDatasets(
      auth.systemId,
      dslevel,
      volser,
      undefined,
      true
    );

    // 6. Apply `start` cursor (skip entries whose DSN sorts strictly before `start`).
    if (start) {
      entries = entries.filter(e => e.dsn.toUpperCase() >= start);
    }
    // 7. Cap by max-items.
    if (maxItems !== undefined && entries.length > maxItems) {
      entries = entries.slice(0, maxItems);
    }

    const body = buildDatasetListResponse(entries);
    deps.log(
      'debug',
      `restfiles/ds dslevel=${dslevel} user=${auth.username} returned=${body.returnedRows}`
    );
    res.status(200).type('application/json').send(JSON.stringify(body));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log('warn', `restfiles/ds backend error: ${msg}`);
    sendZosmfError(res, 500, {
      rc: 16,
      reason: 0,
      category: 1,
      message: `IZUF002E: Backend error listing data sets: ${msg}`,
    });
  }
}
