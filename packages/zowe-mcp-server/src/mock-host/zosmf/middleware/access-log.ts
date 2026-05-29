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
 * Per-request access logging for the z/OSMF mock.
 *
 * Two emissions per request, both fired on `res.on('finish')`:
 *
 *   1. One line to stderr — nginx **combined** log format with a request-time
 *      suffix, e.g.:
 *
 *        127.0.0.1 - USER1 [29/May/2026:23:06:41 +0000] "GET /zosmf/info HTTP/1.1" \
 *          200 421 "-" "Zowe-Explorer/3.0.0" 12ms
 *
 *      The `[mock-zosmf]` subsystem tag is prepended by the daemon's central
 *      logger so a default `mock-zos start` shows traffic at the `info` level.
 *
 *   2. A structured record appended to `<mockDir>/_ssh/last_http.json` (ring
 *      buffer, last 100 entries) so vitest suites can assert "this request
 *      happened" without scraping stderr.
 *
 * The username is read from `req.zosmfAuth` (set by `resolveAuthForRequest`).
 * For requests that never authenticated (login failures, missing CSRF), the
 * field shows `-` (the nginx convention for missing `$remote_user`).
 *
 * When `verbose` is on, additionally emit a request/response trace before and
 * after the per-line summary: full request headers (Authorization / Cookie
 * values redacted), request body, response headers, response body (truncated
 * past 4 KiB to keep the terminal readable). Useful for debugging Zowe
 * Explorer / Zowe SDK exchanges against the mock without resorting to mitm.
 */

import type { NextFunction, Request, Response } from 'express';
import { recordHttpAccess } from '../../audit.js';
import { getRequestAuth } from '../request.js';

export type AccessLogger = (
  lvl: 'error' | 'warn' | 'info' | 'debug' | 'trace',
  msg: string
) => void;

export interface AccessLogOptions {
  /** When true, dump full request + response details (headers, bodies). */
  verbose?: boolean;
  /** Body truncation cap, bytes. Default 4096. */
  bodyLimit?: number;
}

/**
 * Build the access-log middleware. Mount it BEFORE the route handlers so it
 * sees auth context that handlers stamp onto `req.zosmfAuth`.
 */
export function accessLog(mockDir: string, log: AccessLogger, opts: AccessLogOptions = {}) {
  const verbose = opts.verbose ?? false;
  const bodyLimit = opts.bodyLimit ?? 4096;

  return function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const method = req.method;
    const reqPath = req.path;
    const url = req.originalUrl ?? req.url;
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : undefined;
    const httpVersion = `HTTP/${req.httpVersion ?? '1.1'}`;
    const remoteAddr = clientAddress(req);
    const referer = req.header('referer') ?? '-';
    const userAgent = req.header('user-agent') ?? '-';

    // Capture response body for verbose dumps. We tee through res.write / res.end
    // because Express's res.send eventually calls one of them. Up to bodyLimit
    // bytes are retained; the rest is dropped to keep memory bounded.
    let captured: Buffer[] | undefined;
    let capturedLen = 0;
    if (verbose) {
      captured = [];
      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);
      const capture = (chunk: unknown): void => {
        if (!chunk || !captured || capturedLen >= bodyLimit) return;
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === 'string'
            ? Buffer.from(chunk)
            : undefined;
        if (!buf) return;
        const room = bodyLimit - capturedLen;
        captured.push(buf.length > room ? buf.subarray(0, room) : buf);
        capturedLen += Math.min(buf.length, room);
      };
      (res as unknown as { write: typeof res.write }).write = ((
        chunk: unknown,
        ...rest: unknown[]
      ) => {
        capture(chunk);
        return (origWrite as unknown as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof res.write;
      (res as unknown as { end: typeof res.end }).end = ((chunk: unknown, ...rest: unknown[]) => {
        capture(chunk);
        return (origEnd as unknown as (...a: unknown[]) => Response)(chunk, ...rest);
      }) as typeof res.end;

      // Log the request immediately — same severity as the eventual response
      // line is still unknown, so use `info` (verbose mode is itself opt-in).
      logRequestTrace(log, req, method, url, httpVersion);
    }

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const status = res.statusCode;
      const username = getRequestAuth(req)?.username;
      const remoteUser = username ?? '-';
      const bodyBytes = bytesSent(res);

      // Severity bumps so 4xx/5xx are visible at default `info` log level
      // even when the operator doesn't want raw debug noise:
      //   2xx/3xx → info     (happy path)
      //   4xx     → warn     (client error — bad query, missing CSRF/auth)
      //   5xx     → error    (server fault — unhandled exception)
      const severity: Parameters<AccessLogger>[0] =
        status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

      // nginx "combined" log format with an extra request-time field at the
      // tail. Quoting follows nginx conventions: spaces inside `"…"` only.
      log(
        severity,
        `${remoteAddr} - ${remoteUser} [${nginxTimestamp(new Date())}] ` +
          `"${method} ${url} ${httpVersion}" ${status} ${bodyBytes} ` +
          `"${referer}" "${userAgent}" ${durationMs}ms`
      );

      if (verbose) {
        logResponseTrace(log, res, captured ?? [], capturedLen, bodyLimit);
      }

      // Fire-and-forget — persistence errors are tolerated.
      void recordHttpAccess(mockDir, {
        method,
        path: reqPath,
        query,
        status,
        username,
        durationMs,
      });
    });

    next();
  };
}

// ─── Verbose-mode request / response dumps ───────────────────────────────────

/** Headers whose value should NEVER appear in logs. */
const REDACT_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-csrf-zosmf-header']);

function maskHeaderValue(name: string, value: string | string[] | undefined): string {
  if (value === undefined) return '';
  const flat = Array.isArray(value) ? value.join(', ') : value;
  if (REDACT_HEADERS.has(name.toLowerCase())) {
    // Show length + a few characters so operators can confirm "yes, a token
    // was sent" without revealing it.
    const len = flat.length;
    return `<redacted: ${len} chars>`;
  }
  return flat;
}

function logRequestTrace(
  log: AccessLogger,
  req: Request,
  method: string,
  url: string,
  httpVersion: string
): void {
  log('info', `--> ${method} ${url} ${httpVersion}`);
  for (const [k, v] of Object.entries(req.headers)) {
    log('info', `    > ${k}: ${maskHeaderValue(k, v)}`);
  }
  // `req.body` is populated only if body-parsing middleware ran before this.
  // Currently the JSON parser is mounted after the access log; bodies for
  // POST authenticate will therefore be absent here. That's fine — the
  // sensitive auth body (Basic credentials) lives in `Authorization` which we
  // already redact.
  const body: unknown = (req as Request & { body?: unknown }).body;
  if (body !== undefined && body !== null) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    if (text && text !== '{}') {
      log('info', `    > body: ${truncate(text, 4096)}`);
    }
  }
}

function logResponseTrace(
  log: AccessLogger,
  res: Response,
  chunks: Buffer[],
  totalLen: number,
  limit: number
): void {
  log('info', `<-- ${res.statusCode} ${res.statusMessage ?? ''}`.trimEnd());
  for (const [k, v] of Object.entries(res.getHeaders())) {
    const flat = Array.isArray(v) ? v.join(', ') : String(v);
    log('info', `    < ${k}: ${maskHeaderValue(k, flat)}`);
  }
  if (chunks.length > 0) {
    const buf = Buffer.concat(chunks);
    const text = isProbablyText(res, buf) ? buf.toString('utf8') : `<binary, ${totalLen} bytes>`;
    const more = totalLen >= limit ? ` ... (truncated at ${limit} bytes)` : '';
    log('info', `    < body: ${text}${more}`);
  }
}

function isProbablyText(res: Response, sample: Buffer): boolean {
  const ct = String(res.getHeader('content-type') ?? '').toLowerCase();
  if (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml')) return true;
  if (ct === '') {
    // Fall back to checking the buffer for NUL bytes.
    for (const b of sample.subarray(0, Math.min(sample.length, 256))) {
      if (b === 0) return false;
    }
    return true;
  }
  return false;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}... (truncated at ${max} chars)`;
}

/**
 * Resolve the client's display IP. Honors `X-Forwarded-For` (first hop) when
 * present, falls back to the socket's remoteAddress. Loopback IPv6 (`::1`,
 * `::ffff:127.0.0.1`) is normalized to `127.0.0.1` so test snapshots stay
 * stable across operator platforms.
 */
function clientAddress(req: Request): string {
  const fwd = req.header('x-forwarded-for');
  const raw = fwd ? fwd.split(',')[0]?.trim() : req.socket.remoteAddress;
  if (!raw) return '-';
  if (raw === '::1' || raw === '::ffff:127.0.0.1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  return raw;
}

/** Number of body bytes sent. `-` (nginx convention) when unknown. */
function bytesSent(res: Response): string {
  const hdr = res.getHeader('content-length');
  if (typeof hdr === 'string' && hdr) return hdr;
  if (typeof hdr === 'number') return String(hdr);
  return '-';
}

/**
 * Format a Date as nginx's `$time_local`: `dd/Mon/YYYY:HH:MM:SS +ZZZZ`.
 * Always in the daemon's local timezone (same as nginx default).
 */
function nginxTimestamp(d: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const offAbs = Math.abs(offMin);
  const offH = String(Math.floor(offAbs / 60)).padStart(2, '0');
  const offM = String(offAbs % 60).padStart(2, '0');
  return `${dd}/${mon}/${yyyy}:${hh}:${mm}:${ss} ${sign}${offH}${offM}`;
}
