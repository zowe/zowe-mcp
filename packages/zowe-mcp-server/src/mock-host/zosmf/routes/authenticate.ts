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
 * `POST /zosmf/services/authenticate` — login.
 * `DELETE /zosmf/services/authenticate` — logout.
 *
 * Login expects `Authorization: Basic <base64>` + `X-CSRF-ZOSMF-HEADER`.
 * Success → 200 with `Set-Cookie: LtpaToken2=<64-hex>; Path=/; HttpOnly; SameSite=Strict`.
 * Logout accepts either the cookie or Basic auth, and revokes the cookie if
 * present.
 *
 * The mock returns 204 on DELETE rather than the real z/OSMF 200 because the
 * response body is empty anyway; this is documented in docs/mock-zos-host.md.
 */

import { Router, type Request, type Response } from 'express';
import { recordAuthOutcome } from '../../audit.js';
import { authenticateUser, type AuthResult } from '../../auth.js';
import type { MockUser } from '../../users.js';
import { ZosmfErrors, sendZosmfError } from '../errors.js';
import { parseBasicAuth, parseLtpaCookie } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import type { ZosmfAuthCtx } from '../request.js';
import type { TokenStore } from '../token-store.js';

/** Stamp the auth context onto `req` so the access-log middleware picks up the user. */
function stampAuth(req: Request, ctx: ZosmfAuthCtx): void {
  (req as Request & { zosmfAuth?: ZosmfAuthCtx }).zosmfAuth = ctx;
}

export interface AuthenticateRouteDeps {
  users: MockUser[];
  tokens: TokenStore;
  mockDir: string;
  log: (lvl: 'info' | 'warn' | 'debug', msg: string) => void;
}

/** Build the LtpaToken2 Set-Cookie value used on successful login. */
function buildSetCookie(token: string): string {
  return `LtpaToken2=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

/** Set-Cookie value used on DELETE / logout to expire the cookie client-side. */
const CLEAR_COOKIE = 'LtpaToken2=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict';

/**
 * Apply scenario delays before responding. Mirrors the SSH side which uses
 * `setTimeout(proceed, scenarioValue)` for the `authDelay` user.
 */
async function applyAuthDelay(user: MockUser | undefined): Promise<void> {
  if (user?.scenario === 'authDelay' && user.scenarioValue) {
    await new Promise<void>(r => setTimeout(r, user.scenarioValue));
  }
}

export function registerAuthenticateRoute(deps: AuthenticateRouteDeps): Router {
  const router = Router();

  router.post('/zosmf/services/authenticate', requireCsrfHeader, (req, res) => {
    void handleLogin(req, res, deps);
  });

  router.delete('/zosmf/services/authenticate', requireCsrfHeader, (req, res) => {
    handleLogout(req, res, deps);
  });

  return router;
}

async function handleLogin(
  req: Request,
  res: Response,
  deps: AuthenticateRouteDeps
): Promise<void> {
  const creds = parseBasicAuth(req);
  if (!creds) {
    res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
    sendZosmfError(res, 401, ZosmfErrors.unauthorized());
    return;
  }

  // Compute the decision FIRST so we know whether to delay (delay only applies
  // when the user matches a delay scenario, even on bad password).
  const result: AuthResult = authenticateUser(deps.users, creds.username, creds.password);
  const userForDelay = result.ok
    ? result.user
    : deps.users.find(u => u.username.toUpperCase() === creds.username.toUpperCase());
  await applyAuthDelay(userForDelay);

  if (!result.ok) {
    switch (result.reason) {
      case 'racfRevoked':
        deps.log('info', `LOCKED: refusing ${creds.username}`);
        void recordAuthOutcome(deps.mockDir, creds.username, 'racfRevoked');
        sendZosmfError(res, 403, ZosmfErrors.userRevoked(creds.username));
        return;
      case 'passwordExpired':
        deps.log('info', `EXPIRED: refusing ${creds.username}`);
        void recordAuthOutcome(deps.mockDir, creds.username, 'passwordExpired');
        res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
        sendZosmfError(res, 401, ZosmfErrors.passwordExpired(creds.username));
        return;
      case 'wrongPassword':
      case 'unknownUser':
      default:
        deps.log('info', `auth failure (${result.reason}) for ${creds.username}`);
        void recordAuthOutcome(deps.mockDir, creds.username, 'wrongPassword');
        res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
        sendZosmfError(res, 401, ZosmfErrors.badCredentials());
        return;
    }
  }

  // Success: mint a fresh token. The WARNING scenario adds an advisory header
  // that real z/OSMF doesn't ship; we expose it so test fixtures can assert
  // the expiry warning surfaces through HTTP analogously to the SSH banner.
  const info = deps.tokens.mint(result.user);
  stampAuth(req, {
    user: result.user,
    username: result.user.username,
    systemId: result.user.systemId ?? '',
  });
  res.setHeader('Set-Cookie', buildSetCookie(info.token));
  if (result.warning?.kind === 'passwordExpiresInDays') {
    res.setHeader('X-Password-Expiry-Days', String(result.warning.days));
  }
  deps.log(
    'info',
    `login OK: ${result.user.username} (token expires ${new Date(info.expiresAt).toISOString()})`
  );
  void recordAuthOutcome(deps.mockDir, result.user.username, 'tokenIssued');
  // Real z/OSMF returns a JSON-like body as text/plain with ISO-8859-1 charset.
  res
    .status(200)
    .set('Content-Type', 'text/plain;charset=ISO-8859-1')
    .send('{"returnCode":0,"reasonCode":0,"message":"Success."}');
}

function handleLogout(req: Request, res: Response, deps: AuthenticateRouteDeps): void {
  const token = parseLtpaCookie(req);
  const basic = parseBasicAuth(req);

  if (token) {
    const entry = deps.tokens.resolve(token);
    if (entry) {
      stampAuth(req, {
        user: { username: entry.username, systemId: '' } as MockUser,
        username: entry.username,
        systemId: '',
      });
      deps.tokens.revoke(token);
      deps.log('info', `logout: revoked token for ${entry.username}`);
      void recordAuthOutcome(deps.mockDir, entry.username, 'tokenRevoked');
    }
    res.setHeader('Set-Cookie', CLEAR_COOKIE);
    res.status(204).end();
    return;
  }

  if (basic) {
    // No cookie was presented but the caller is authorized; nothing to revoke.
    res.status(204).end();
    return;
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="z/OSMF"');
  sendZosmfError(res, 401, ZosmfErrors.unauthorized());
}
