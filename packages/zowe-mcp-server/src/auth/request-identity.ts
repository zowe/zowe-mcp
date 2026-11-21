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

import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantJwtClaims } from './bearer-jwt.js';

export interface VerifiedRequestIdentity {
  claims: TenantJwtClaims;
  /** Validated incoming access token. Request-scoped only; never log, persist, or return it. */
  accessToken: string;
}

const requestIdentity = new AsyncLocalStorage<VerifiedRequestIdentity | undefined>();

/** Called only after HTTP JWT verification and the MCP session's subject binding have passed. */
export function runWithVerifiedRequestIdentity<T>(
  identity: VerifiedRequestIdentity | undefined,
  callback: () => T
): T {
  return requestIdentity.run(identity, callback);
}

export function getVerifiedRequestIdentity(): VerifiedRequestIdentity | undefined {
  return requestIdentity.getStore();
}
