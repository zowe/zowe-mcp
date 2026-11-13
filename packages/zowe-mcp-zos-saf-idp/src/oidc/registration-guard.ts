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
 * Guard in front of oidc-provider's anonymous `POST /reg` (RFC 7591 DCR):
 * rejects registrations whose `redirect_uris` or `post_logout_redirect_uris`
 * fall outside the redirect policy before they reach the provider, and
 * bounds how many registrations the anonymous endpoint accepts (per source
 * and in total) so DCR spam cannot flush oidc-provider's shared in-memory
 * LRU adapter (evicting live sessions/grants) or grow it unboundedly.
 *
 * oidc-provider's own `features.registration.policies` only run with initial
 * access tokens, so this has to sit at the HTTP layer. The request body must be
 * buffered here to inspect it, which drains the stream — so on acceptance the
 * guard invokes the provider callback itself with a replayed request rather
 * than calling `next()` with a spent stream.
 */

import type { Request, RequestHandler, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { RedirectPolicy } from './redirect-policy.js';
import type { RegistrationLimiter } from './registration-limit.js';

const MAX_BODY_BYTES = 256 * 1024;

export interface RegistrationGuardOptions {
  policy: RedirectPolicy;
  /** Bounds on how many registrations the anonymous endpoint accepts. */
  limiter: RegistrationLimiter;
  /** `provider.callback()` — invoked with the replayed request on acceptance. */
  providerCallback: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  log?: (message: string) => void;
}

/** Builds a Readable that mimics the original request but serves the buffered body. */
function replayRequest(req: Request, body: Buffer): IncomingMessage {
  const replay = Readable.from([body]) as unknown as IncomingMessage;
  for (const prop of [
    'headers',
    'rawHeaders',
    'method',
    'url',
    'socket',
    'httpVersion',
    'httpVersionMajor',
    'httpVersionMinor',
  ] as const) {
    Object.defineProperty(replay, prop, { value: req[prop], configurable: true });
  }
  return replay;
}

export function createRegistrationGuard(options: RegistrationGuardOptions): RequestHandler {
  const { policy, limiter, providerCallback } = options;
  const log =
    options.log ??
    ((): void => {
      /* logging disabled by default */
    });

  return (req: Request, res: Response) => {
    // Registration bounds first, before any body is buffered: /reg is
    // anonymous, so this is the only thing between a scripted client and
    // flushing the provider's shared in-memory LRU (sessions, grants).
    const source = req.socket.remoteAddress ?? 'unknown';
    const limit = limiter.checkAndRecord(source);
    if (!limit.allowed) {
      if (limit.status === 429) {
        log(`DCR rate limit: source ${source} throttled`);
        res
          .status(429)
          .set('Retry-After', String(limit.retryAfterSeconds ?? 1))
          .json({
            error: 'invalid_client_metadata',
            error_description: 'too many registration requests from this source — retry later',
          });
      } else {
        log('DCR registration cap reached: refusing new dynamic registrations');
        res.status(503).json({
          error: 'invalid_client_metadata',
          error_description:
            'dynamic client registration limit reached on this dev IdP — ' +
            'configure a static client or restart the IdP',
        });
      }
      // Stop reading the (possibly still-streaming) request body, but only
      // tear the socket down after the response flushed — destroying on the
      // same tick can turn the 429/Retry-After into a bare connection reset.
      req.pause();
      res.on('finish', () => req.destroy());
      return;
    }
    // Count only registrations the provider actually accepts against the
    // total cap (policy rejections and provider errors don't persist state).
    res.on('finish', () => {
      if (res.statusCode === 201) limiter.recordAccepted();
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        res.status(413).json({
          error: 'invalid_client_metadata',
          error_description: 'registration request body too large',
        });
        // As above: stop reading now, destroy only after the 413 flushed.
        req.pause();
        res.on('finish', () => req.destroy());
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => {
      if (!done) {
        done = true;
        res.destroy();
      }
    });

    req.on('end', () => {
      if (done) return;
      done = true;
      const body = Buffer.concat(chunks);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        // Malformed JSON: let oidc-provider produce its canonical error response.
        void providerCallback(replayRequest(req, body), res);
        return;
      }

      // Every client-controlled redirect surface must satisfy the same trust
      // policy: post_logout_redirect_uris is DCR-settable and rp-initiated
      // logout (/session/end) redirects the browser to it, so leaving it
      // unchecked would turn the IdP into an open redirector.
      for (const field of ['redirect_uris', 'post_logout_redirect_uris'] as const) {
        const uris = (parsed as Record<string, unknown> | null)?.[field];
        if (!Array.isArray(uris)) continue;
        // Client metadata, not a secret — knowing what a client registers is
        // the main debugging signal for broken callback handoffs.
        log(`DCR request ${field}: ${JSON.stringify(uris)}`);
        const rejected = (uris as unknown[]).find(
          uri => typeof uri !== 'string' || !policy.isAllowed(uri)
        );
        if (rejected !== undefined) {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `${field} not allowed by this dev IdP (allowed: ${policy.describe()})`,
          });
          return;
        }
      }

      void providerCallback(replayRequest(req, body), res);
    });
  };
}
