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
 * Shared request-context plumbing for the z/OSMF HTTP routes.
 *
 * - `ZosmfAuthCtx`: the resolved `{username, systemId, user}` triple after auth.
 *   Attached to `req` (via cast) so downstream handlers and the access-log
 *   middleware can read it.
 * - `resolveAuthForRequest(req, deps)`: factored from the previous inlined
 *   cookie-or-Basic resolver. Used by both `routes/info.ts` and the new
 *   `routes/restfiles-ds.ts` so a single code path decides auth.
 */

import type { Request } from 'express';
import { authenticateUser } from '../auth.js';
import type { MockUser } from '../users.js';
import { parseBasicAuth, parseLtpaCookie } from './middleware/auth.js';
import type { TokenStore } from './token-store.js';

export interface ZosmfAuthCtx {
  user: MockUser;
  username: string;
  /** Effective system id — `user.systemId` if set, else the daemon's default. */
  systemId: string;
}

/**
 * Express's Request type doesn't carry our custom property, so we accept a
 * `Request`-like at the type level and read/write via this tiny helper. Keeps
 * the augmentation explicit and avoids global `declare module` magic.
 */
interface RequestWithAuth extends Request {
  zosmfAuth?: ZosmfAuthCtx;
}

export interface ResolveAuthDeps {
  users: MockUser[];
  tokens: TokenStore;
  defaultSystemId: string;
}

/**
 * Resolve auth via either an active `LtpaToken2` cookie or `Authorization:
 * Basic ...`. Returns the context on success and stamps it onto `req.zosmfAuth`
 * for downstream consumers (notably the access-log middleware). Returns
 * `undefined` when neither method succeeds; callers should respond 401.
 */
export function resolveAuthForRequest(
  req: Request,
  deps: ResolveAuthDeps
): ZosmfAuthCtx | undefined {
  // Token / cookie auth first — clients that have already logged in will
  // typically present a cookie and skip Basic.
  const token = parseLtpaCookie(req);
  if (token) {
    const entry = deps.tokens.resolve(token);
    if (entry) {
      const user = findUserByName(deps.users, entry.username);
      if (user)
        return attach(req, { user, username: user.username, systemId: systemIdFor(user, deps) });
    }
  }

  const basic = parseBasicAuth(req);
  if (basic) {
    const result = authenticateUser(deps.users, basic.username, basic.password);
    if (result.ok) {
      return attach(req, {
        user: result.user,
        username: result.user.username,
        systemId: systemIdFor(result.user, deps),
      });
    }
  }

  return undefined;
}

/** Read the cached auth context that `resolveAuthForRequest` stamped on the request. */
export function getRequestAuth(req: Request): ZosmfAuthCtx | undefined {
  return (req as RequestWithAuth).zosmfAuth;
}

function attach(req: Request, ctx: ZosmfAuthCtx): ZosmfAuthCtx {
  (req as RequestWithAuth).zosmfAuth = ctx;
  return ctx;
}

function systemIdFor(user: MockUser, deps: ResolveAuthDeps): string {
  return user.systemId ?? deps.defaultSystemId;
}

function findUserByName(users: MockUser[], name: string): MockUser | undefined {
  const target = name.toUpperCase();
  return users.find(u => u.username.toUpperCase() === target);
}
