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
 * z/OSMF Data Sets REST — read / list endpoints.
 *
 * Three URL shapes, all matching what Zowe Explorer and the Zowe Z/OS Files
 * SDK actually send:
 *
 *   GET /zosmf/restfiles/ds/<dsname>                  → read sequential data set
 *   GET /zosmf/restfiles/ds/<dsname>(<member>)        → read PDS member (parens form, IBM-canonical)
 *   GET /zosmf/restfiles/ds/<dsname>/member           → list members of a PDS / PDS-E
 *
 * The original `/<dsname>/<membername>` slash form is also accepted for tools
 * that send the path that way — but Zowe Explorer always uses the parenthesised
 * form for reads and the literal `/member` keyword for the listing.
 *
 * Response shapes:
 *   - Read: 200 + body bytes, `ETag: "<md5>"`. The mock stores UTF-8; binary
 *     mode (`X-IBM-Data-Type: binary`) just flips `Content-Type` to
 *     `application/octet-stream` without re-encoding.
 *   - Member list: 200 + `{items:[{member:"X"},…], returnedRows, JSONversion:1}`.
 *
 * Errors:
 *   - 401 + IZUG1077E   — no credentials
 *   - 403 + IZUM112E    — missing CSRF
 *   - 404 + IZUF013E    — dataset / member / non-PDS not found
 *   - 400 + IZUF010E    — malformed dataset / member name
 *   - 500 + IZUF002E    — backend error
 */

import { Router, type Request, type Response } from 'express';
import type { MockHostStore } from '../../store.js';
import type { MockUser } from '../../users.js';
import { ZosmfErrors, sendZosmfError } from '../errors.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { resolveAuthForRequest } from '../request.js';
import { buildMemberListResponse } from '../response.js';
import type { TokenStore } from '../token-store.js';

export interface RestfilesDsReadRouteDeps {
  users: MockUser[];
  tokens: TokenStore;
  store: MockHostStore;
  defaultSystemId: string;
  log: (lvl: 'info' | 'warn' | 'debug', msg: string) => void;
}

// Conservative DSN syntax: HLQ.QUAL[.QUAL…], each qualifier 1-8 chars,
// uppercase letters / digits / national characters, must start with a letter
// or national character. Mirrors the real z/OS naming rules so the mock
// rejects garbage before it hits the backend.
const DSN_RE = /^[A-Z@#$][A-Z0-9@#$]{0,7}(?:\.[A-Z@#$][A-Z0-9@#$]{0,7})*$/i;
// Member names: 1-8 chars, same alphabet as the leading qualifier.
const MEMBER_RE = /^[A-Z@#$][A-Z0-9@#$]{0,7}$/i;
// `DSNAME(MEMBER)` — Zowe Explorer's URL form for reads, after URL decoding.
const DSN_WITH_MEMBER_RE =
  /^([A-Z@#$][A-Z0-9@#$]{0,7}(?:\.[A-Z@#$][A-Z0-9@#$]{0,7})*)\(([A-Z@#$][A-Z0-9@#$]{0,7})\)$/i;

export function registerRestfilesDsReadRoute(deps: RestfilesDsReadRouteDeps): Router {
  const router = Router();

  // Express matches routes in registration order; we put the more specific
  // `/member` and `/:member` patterns ahead of the bare `/:dsname` so the
  // member-list endpoint wins over the parenthesised-form parser.
  router.get('/zosmf/restfiles/ds/:dsname/member', requireCsrfHeader, (req, res) => {
    void handleListMembers(req, res, deps);
  });
  router.get('/zosmf/restfiles/ds/:dsname/:member', requireCsrfHeader, (req, res) => {
    void handleRead(req, res, deps);
  });
  router.get('/zosmf/restfiles/ds/:dsname', requireCsrfHeader, (req, res) => {
    void handleRead(req, res, deps);
  });

  return router;
}

// ─── Read sequential / member content ────────────────────────────────────────

async function handleRead(
  req: Request,
  res: Response,
  deps: RestfilesDsReadRouteDeps
): Promise<void> {
  // 1. Auth.
  const auth = resolveAuthForRequest(req, deps);
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
    sendZosmfError(res, 401, ZosmfErrors.unauthorized());
    return;
  }

  // 2. Parse the dataset name. Three accepted shapes:
  //      a)  /ds/USER1.SAMPLE.COBOL                       → sequential dataset
  //      b)  /ds/USER1.SAMPLE.COBOL(HELLO)                → parens form for member (IBM-canonical)
  //      c)  /ds/USER1.SAMPLE.COBOL/HELLO                 → slash form (tolerant alternative)
  // For (b) the `(HELLO)` arrives inside :dsname after URL decoding.
  let dsname = String(req.params.dsname ?? '').trim();
  let member: string | undefined = req.params.member
    ? String(req.params.member).trim()
    : undefined;

  // Try parens form first — only if the slash form didn't already split out a member.
  if (member === undefined) {
    const parens = DSN_WITH_MEMBER_RE.exec(dsname);
    if (parens) {
      dsname = parens[1];
      member = parens[2];
    }
  }

  if (!dsname || !DSN_RE.test(dsname)) {
    deps.log(
      'info',
      `restfiles/ds read rejected: invalid dsname '${dsname}' (user=${auth.username})`
    );
    sendZosmfError(
      res,
      400,
      ZosmfErrors.invalidQuery('dsname', `'${dsname}' is not a valid z/OS data set name.`)
    );
    return;
  }
  if (member !== undefined && !MEMBER_RE.test(member)) {
    deps.log(
      'info',
      `restfiles/ds read rejected: invalid member '${member}' (user=${auth.username})`
    );
    sendZosmfError(
      res,
      400,
      ZosmfErrors.invalidQuery('member', `'${member}' is not a valid PDS member name.`)
    );
    return;
  }

  // 3. Read body. `X-IBM-Data-Type: binary` flips the response Content-Type to
  // application/octet-stream so clients that pass binary mode (Zowe Explorer
  // never does for text editors, but other tools do) don't try to decode it.
  const dataType = (req.header('x-ibm-data-type') ?? 'text').toLowerCase();
  const binaryMode = dataType === 'binary';

  try {
    const result = await deps.store.backend.readDataset(
      auth.systemId,
      dsname.toUpperCase(),
      member?.toUpperCase()
    );

    // 4. ETag handling — strong comparison. If the client already has this
    // content, return 304 with no body.
    const etag = result.etag;
    const ifNoneMatch = req.header('if-none-match');
    if (ifNoneMatch?.replace(/^W\//, '').replace(/^"|"$/g, '') === etag) {
      res.setHeader('ETag', `"${etag}"`);
      res.status(304).end();
      deps.log(
        'debug',
        `restfiles/ds read 304 dsn=${dsname}${member ? '(' + member + ')' : ''} user=${auth.username}`
      );
      return;
    }

    res.setHeader('ETag', `"${etag}"`);
    res.setHeader('X-IBM-Data-Type', binaryMode ? 'binary' : 'text');
    res
      .status(200)
      .type(binaryMode ? 'application/octet-stream' : 'text/plain')
      .send(result.text);

    deps.log(
      'debug',
      `restfiles/ds read 200 dsn=${dsname}${member ? '(' + member + ')' : ''} ` +
        `bytes=${Buffer.byteLength(result.text, 'utf8')} user=${auth.username}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The backend uses Error message text to indicate "not found"; map that
    // to z/OSMF's IZUF013E (resource not found) rather than IZUF002E.
    if (/not found/i.test(msg)) {
      deps.log(
        'info',
        `restfiles/ds read 404 dsn=${dsname}${member ? '(' + member + ')' : ''} ` +
          `user=${auth.username}: ${msg}`
      );
      sendZosmfError(res, 404, {
        rc: 4,
        reason: 0,
        category: 1,
        message:
          member !== undefined
            ? `IZUF013E: Member '${member.toUpperCase()}' was not found in data set ` +
              `'${dsname.toUpperCase()}'.`
            : `IZUF013E: Data set '${dsname.toUpperCase()}' was not found.`,
      });
      return;
    }
    deps.log(
      'warn',
      `restfiles/ds read backend error dsn=${dsname} user=${auth.username}: ${msg}`
    );
    sendZosmfError(res, 500, {
      rc: 16,
      reason: 0,
      category: 1,
      message: `IZUF002E: Backend error reading data set: ${msg}`,
    });
  }
}

// ─── List members of a PDS / PDS-E ───────────────────────────────────────────

async function handleListMembers(
  req: Request,
  res: Response,
  deps: RestfilesDsReadRouteDeps
): Promise<void> {
  const auth = resolveAuthForRequest(req, deps);
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
    sendZosmfError(res, 401, ZosmfErrors.unauthorized());
    return;
  }

  const dsname = String(req.params.dsname ?? '').trim();
  if (!dsname || !DSN_RE.test(dsname)) {
    deps.log(
      'info',
      `restfiles/ds member-list rejected: invalid dsname '${dsname}' (user=${auth.username})`
    );
    sendZosmfError(
      res,
      400,
      ZosmfErrors.invalidQuery('dsname', `'${dsname}' is not a valid z/OS data set name.`)
    );
    return;
  }

  // Optional member-name pattern (e.g. `?pattern=HE*`). Passed through to the
  // backend's existing matcher.
  const pattern = typeof req.query.pattern === 'string' ? req.query.pattern : undefined;

  // X-IBM-Max-Items — same semantics as the dslevel listing.
  const maxItemsHeader = req.header('x-ibm-max-items');
  let maxItems: number | undefined;
  if (maxItemsHeader) {
    const parsed = Number.parseInt(maxItemsHeader, 10);
    if (Number.isFinite(parsed) && parsed > 0) maxItems = parsed;
  }

  try {
    const members = await deps.store.backend.listMembers(
      auth.systemId,
      dsname.toUpperCase(),
      pattern
    );
    let names = members.map(m => m.name);
    if (maxItems !== undefined && names.length > maxItems) {
      names = names.slice(0, maxItems);
    }
    const body = buildMemberListResponse(names);
    deps.log(
      'debug',
      `restfiles/ds member-list dsn=${dsname} user=${auth.username} returned=${body.returnedRows}`
    );
    res.status(200).type('application/json').send(JSON.stringify(body));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // listMembers throws when the dataset isn't a PDS / PDS-E or doesn't
    // exist — both map to 404 with IZUF013E.
    if (/not a PDS|not exist|not found/i.test(msg)) {
      deps.log('info', `restfiles/ds member-list 404 dsn=${dsname} user=${auth.username}: ${msg}`);
      sendZosmfError(res, 404, {
        rc: 4,
        reason: 0,
        category: 1,
        message: `IZUF013E: Data set '${dsname.toUpperCase()}' is not a PDS / PDS-E, or was not found.`,
      });
      return;
    }
    deps.log(
      'warn',
      `restfiles/ds member-list backend error dsn=${dsname} user=${auth.username}: ${msg}`
    );
    sendZosmfError(res, 500, {
      rc: 16,
      reason: 0,
      category: 1,
      message: `IZUF002E: Backend error listing members: ${msg}`,
    });
  }
}
