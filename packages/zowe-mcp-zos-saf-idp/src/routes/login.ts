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

import express, { Router, type Request, type Response } from 'express';
import { attemptSafLogin } from '../auth-attempt.js';
import { mintAccessToken } from '../jwt-sign.js';
import type { IdpKeyPair } from '../keys.js';
import type { LoginRateLimiter } from '../rate-limit.js';
import { toSafUserid } from '../saf-userid.js';
import type { SafVerifier } from '../saf-verify.js';

export interface LoginRouteConfig {
  issuer: string;
  keyPair: IdpKeyPair;
  rateLimiter: LoginRateLimiter;
  verifier: SafVerifier;
  /**
   * MCP resource the minted tokens are bound to (RFC 8707; the token `aud`),
   * matching the OIDC-flow tokens so both mint paths agree with the resource
   * server's mandatory audience validation.
   */
  mcpResource: string;
  /** Access-token lifetime in seconds. Defaults to 300 (5 min) — see mintAccessToken. */
  tokenTtlSeconds?: number;
  log?: (message: string) => void;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * `POST /login { username, password }` -> `{ access_token, token_type, expires_in }`.
 *
 * Bound to loopback only, with no exception — even if the surrounding server is
 * started on a non-loopback `--host`, this route rejects any connection whose
 * remote address is not 127.0.0.1/::1.
 */
export function createLoginRouter(config: LoginRouteConfig): Router {
  const router = Router();

  // Scoped here, NOT app-wide: a global express.json() would drain request
  // bodies before oidc-provider's own body parser sees them, silently
  // breaking /token and /reg.
  router.post('/login', express.json(), async (req: Request, res: Response) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username : undefined;
    const password = typeof body.password === 'string' ? body.password : undefined;
    if (!username || !password) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const attempt = await attemptSafLogin({
      username,
      password,
      remoteAddress: req.socket.remoteAddress,
      rateLimiter: config.rateLimiter,
      verifier: config.verifier,
    });
    if (attempt.outcome === 'rate_limited') {
      res.setHeader('Retry-After', String(attempt.retryAfterSeconds));
      res.status(429).json({ error: 'too_many_attempts' });
      return;
    }
    if (attempt.outcome === 'invalid_credentials') {
      // Generic 401 — never distinguish "no such user" from "bad password".
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    if (attempt.outcome === 'expired_password') {
      // The password was correct — disclosing expiry is not a guessing oracle.
      res.status(401).json({ error: 'password_expired' });
      return;
    }
    if (attempt.outcome === 'unavailable') {
      config.log?.(`/login SAF check unavailable: ${attempt.detail}`);
      res.status(503).json({ error: 'temporarily_unavailable' });
      return;
    }

    const ttlSeconds = config.tokenTtlSeconds ?? 300;
    const accessToken = mintAccessToken({
      // Canonical SAF userid, not the typed form: `sub` is used downstream
      // as a z/OS userid (docs/zos-local-zowex-identity.md).
      username: toSafUserid(username),
      issuer: config.issuer,
      audience: config.mcpResource,
      kid: config.keyPair.kid,
      privateKey: config.keyPair.privateKey,
      ttlSeconds,
    });
    res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: ttlSeconds });
  });

  return router;
}
