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
 *   - Read: 200 + body bytes, `ETag: <md5>` (unquoted, matching real z/OSMF).
 *     The mock stores UTF-8; binary mode (`X-IBM-Data-Type: binary`) just flips
 *     `Content-Type` to `application/octet-stream` without re-encoding.
 *   - Member list: 200 + `{items:[{member:"X"},…], returnedRows, JSONversion:1}`.
 *
 * Supported read modifiers (from z/OSMF 5.30 spec and confirmed on a real z/OS system):
 *   - `X-IBM-Record-Range: start-end`  — return only lines [start..end] (0-based inclusive)
 *   - `X-IBM-Return-Etag: true/false`  — control ETag in response (default: return ETag)
 *   - `X-IBM-Return-FilePos: true`     — requires X-IBM-Record-Range; returns next line position
 *   - `?search=<string>`               — find first line containing string; return from there
 *   - `?research=<regex>`              — like search= but with a regex
 *   - `?insensitive=<true|false>`      — case sensitivity for search/research (default: true)
 *   - `?maxreturnsize=<n>`             — max records to return with search/research (default 100)
 *
 * Mutual exclusions (confirmed on a real z/OS system):
 *   - X-IBM-Return-Etag:true + X-IBM-Record-Range  → 400
 *   - X-IBM-Return-Etag:true + search=/research=   → 400
 *   - X-IBM-Return-FilePos:true without X-IBM-Record-Range → 400
 *
 * Errors:
 *   - 401 + IZUG1077E   — no credentials
 *   - 403 + IZUM112E    — missing CSRF
 *   - 404 + IZUF013E    — dataset / member / non-PDS not found
 *   - 400 + IZUF010E    — malformed dataset / member name or invalid parameter combination
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse `X-IBM-Record-Range: start-end` (0-based inclusive line indices).
 * Returns null when the header value does not match the expected format.
 */
function parseRecordRange(raw: string): { start: number; end: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(raw.trim());
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
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

  // 3. Parse request modifiers.
  const dataType = (req.header('x-ibm-data-type') ?? 'text').toLowerCase();
  const binaryMode = dataType === 'binary';

  // X-IBM-Return-Etag: true/false  (default: return ETag on normal reads)
  const returnEtagHeader = req.header('x-ibm-return-etag');
  const suppressEtag = returnEtagHeader === 'false';
  const explicitlyRequestEtag = returnEtagHeader === 'true';

  // X-IBM-Record-Range: start-end
  const recordRangeRaw = req.header('x-ibm-record-range');

  // X-IBM-Return-FilePos: true
  const returnFilePos = req.header('x-ibm-return-filepos') === 'true';

  // ?search= / ?research= / ?insensitive= / ?maxreturnsize=
  const searchStr = typeof req.query.search === 'string' ? req.query.search : undefined;
  const researchStr = typeof req.query.research === 'string' ? req.query.research : undefined;
  const hasSearch = Boolean(searchStr ?? researchStr);
  const caseInsensitive = req.query.insensitive !== 'false';
  const maxReturnSizeRaw =
    typeof req.query.maxreturnsize === 'string'
      ? Number.parseInt(req.query.maxreturnsize, 10)
      : NaN;
  const maxReturnSize =
    Number.isFinite(maxReturnSizeRaw) && maxReturnSizeRaw > 0
      ? Math.min(maxReturnSizeRaw, 1000)
      : 100;

  // 4. Validate mutual exclusions (before hitting the backend).
  if (explicitlyRequestEtag && (recordRangeRaw !== undefined || hasSearch)) {
    sendZosmfError(res, 400, {
      rc: 4,
      reason: 12,
      category: 1,
      message:
        'IZUF010E: X-IBM-Return-Etag=true may not be specified with X-IBM-Record-Range and/or search/research.',
      details: ['true'],
    });
    return;
  }
  if (returnFilePos && !recordRangeRaw) {
    sendZosmfError(res, 400, {
      rc: 4,
      reason: 13,
      category: 1,
      message: 'IZUF010E: X-IBM-Return-FilePos=true requires X-IBM-Record-Range.',
      details: ['true'],
    });
    return;
  }

  // 5. Read from backend.
  try {
    const result = await deps.store.backend.readDataset(
      auth.systemId,
      dsname.toUpperCase(),
      member?.toUpperCase()
    );

    // 6. search= / research= — find first matching line; return from there
    // up to maxReturnSize lines; set X-IBM-Record-Range response header; no ETag.
    if (hasSearch) {
      const lines = result.text.split('\n');
      let matchLine = -1;
      if (searchStr) {
        const needle = caseInsensitive ? searchStr.toLowerCase() : searchStr;
        matchLine = lines.findIndex(l => (caseInsensitive ? l.toLowerCase() : l).includes(needle));
      } else if (researchStr) {
        try {
          const re = new RegExp(researchStr, caseInsensitive ? 'i' : '');
          matchLine = lines.findIndex(l => re.test(l));
        } catch {
          sendZosmfError(
            res,
            400,
            ZosmfErrors.invalidQuery(
              'research',
              `'${researchStr}' is not a valid regular expression.`
            )
          );
          return;
        }
      }
      if (matchLine === -1) {
        // No match — z/OSMF returns an empty body with 200.
        res.status(200).set('Content-Type', 'text/plain; charset=UTF-8').send('');
        deps.log('debug', `restfiles/ds read search no-match dsn=${dsname} user=${auth.username}`);
        return;
      }
      const returnedLines = lines.slice(matchLine, matchLine + maxReturnSize);
      res.setHeader('X-IBM-Record-Range', `${matchLine},${maxReturnSize}`);
      res.setHeader('X-IBM-Data-Type', 'text');
      res
        .status(200)
        .set('Content-Type', 'text/plain; charset=UTF-8')
        .send(returnedLines.join('\n'));
      deps.log(
        'debug',
        `restfiles/ds read search match=${matchLine} dsn=${dsname} user=${auth.username}`
      );
      return;
    }

    // 7. X-IBM-Record-Range — return only the requested line window; no ETag.
    if (recordRangeRaw) {
      const range = parseRecordRange(recordRangeRaw);
      if (!range) {
        sendZosmfError(
          res,
          400,
          ZosmfErrors.invalidQuery(
            'X-IBM-Record-Range',
            `'${recordRangeRaw}' is not a valid record range (expected start-end, both 0-based).`
          )
        );
        return;
      }
      const lines = result.text.split('\n');
      const sliced = lines.slice(range.start, range.end + 1);
      res.setHeader('X-IBM-Data-Type', binaryMode ? 'binary' : 'text');
      // X-IBM-Return-FilePos:true → return position of next record after range.
      if (returnFilePos) {
        res.setHeader('X-IBM-FilePos', String(range.end + 1));
      }
      res
        .status(200)
        .set('Content-Type', binaryMode ? 'application/octet-stream' : 'text/plain; charset=UTF-8')
        .send(sliced.join('\n'));
      deps.log(
        'debug',
        `restfiles/ds read range=${range.start}-${range.end} dsn=${dsname} user=${auth.username}`
      );
      return;
    }

    // 8. Normal full read — ETag handling. z/OSMF returns an unquoted MD5 hex
    // ETag on all successful reads (confirmed format on a real z/OS system: no surrounding quotes).
    const etag = result.etag;
    const includeEtag = !suppressEtag;

    if (includeEtag) {
      // Strong comparison — strip W/" prefix and any surrounding quotes the
      // client may have added (following HTTP spec rather than IBM convention).
      const ifNoneMatch = req.header('if-none-match');
      if (ifNoneMatch?.replace(/^W\//, '').replace(/^"|"$/g, '') === etag) {
        res.setHeader('ETag', etag);
        res.status(304).end();
        deps.log(
          'debug',
          `restfiles/ds read 304 dsn=${dsname}${member ? '(' + member + ')' : ''} user=${auth.username}`
        );
        return;
      }
      res.setHeader('ETag', etag);
    }

    res.setHeader('X-IBM-Data-Type', binaryMode ? 'binary' : 'text');
    res
      .status(200)
      .set('Content-Type', binaryMode ? 'application/octet-stream' : 'text/plain; charset=UTF-8')
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

  // Optional start cursor: skip members whose name sorts before `start`
  // (same semantics as `start` on the dslevel listing, per z/OSMF spec).
  const start = typeof req.query.start === 'string' ? req.query.start.toUpperCase() : undefined;

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
    // Apply start cursor before capping
    if (start) {
      names = names.filter(n => n.toUpperCase() >= start);
    }
    let truncated = false;
    if (maxItems !== undefined && names.length > maxItems) {
      names = names.slice(0, maxItems);
      truncated = true;
    }
    const body = buildMemberListResponse(names, truncated);
    deps.log(
      'debug',
      `restfiles/ds member-list dsn=${dsname} user=${auth.username} returned=${body.returnedRows}`
    );
    res
      .status(200)
      .set('Content-Type', 'application/json; charset=UTF-8')
      .send(JSON.stringify(body));
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
