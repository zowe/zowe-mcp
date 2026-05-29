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
 * z/OSMF-style JSON error bodies.
 *
 * Real z/OSMF returns error responses that look like:
 *
 *   { "rc": 8, "reason": 70, "category": 1,
 *     "message": "IZUG1126E: Authentication failed.",
 *     "details": [ "..." ] }
 *
 * The exact `rc` / `reason` / `category` triples vary by error and z/OSMF
 * version. The mock pins plausible values and uses the canonical IBM IZUG /
 * IZUM message-ID prefixes so client-side classifiers see production-like
 * signals. The numeric fields here SHOULD NOT be relied on as authoritative
 * by mock consumers.
 *
 * Sources:
 *   IZUG* — z/OSMF Server messages (authentication, user state)
 *   IZUM* — z/OSMF Web Browser / CSRF messages
 */

import type { Response } from 'express';

export interface ZosmfErrorBody {
  rc: number;
  reason: number;
  category: number;
  message: string;
  details?: string[];
}

/** Catalog of common z/OSMF error bodies. */
export const ZosmfErrors = {
  /** Bad credentials (wrong password or unknown user). */
  badCredentials(): ZosmfErrorBody {
    return {
      rc: 8,
      reason: 70,
      category: 1,
      message: 'IZUG1126E: Authentication failed for the user ID and password provided.',
    };
  },

  /** Password expired — used for the EXPIRED scenario. */
  passwordExpired(user: string): ZosmfErrorBody {
    return {
      rc: 8,
      reason: 71,
      category: 1,
      message: `IZUG1124E: The password for user ID ${user.toUpperCase()} has expired.`,
    };
  },

  /** RACF revoked / locked account — used for the LOCKED scenario. */
  userRevoked(user: string): ZosmfErrorBody {
    return {
      rc: 8,
      reason: 76,
      category: 6,
      message:
        `IZUG1167E: User ID ${user.toUpperCase()} is revoked or has no access to ` +
        `z/OSMF. Contact your security administrator.`,
    };
  },

  /** Missing required X-CSRF-ZOSMF-HEADER on a state-changing request. */
  missingCsrf(): ZosmfErrorBody {
    return {
      rc: 8,
      reason: 12,
      category: 1,
      message:
        'IZUM112E: The required HTTP request header X-CSRF-ZOSMF-HEADER ' +
        'is missing from the request.',
    };
  },

  /** Generic 401 fallback used when no credentials are presented. */
  unauthorized(): ZosmfErrorBody {
    return {
      rc: 4,
      reason: 0,
      category: 1,
      message: 'IZUG1077E: An authenticated session is required for this resource.',
    };
  },

  /**
   * Missing or invalid query parameter (used by `restfiles/ds` when `dslevel`
   * is absent or malformed). Real z/OSMF returns IZUF010E from the data-set
   * REST service for client-side validation failures of this kind.
   */
  invalidQuery(field: string, detail: string): ZosmfErrorBody {
    return {
      rc: 4,
      reason: 0,
      category: 1,
      message: `IZUF010E: Invalid query parameter '${field}': ${detail}`,
    };
  },
};

/** Write a z/OSMF-style JSON error envelope. */
export function sendZosmfError(res: Response, status: number, body: ZosmfErrorBody): void {
  res
    .status(status)
    .set('Content-Type', 'application/json; charset=UTF-8')
    .send(JSON.stringify(body));
}
