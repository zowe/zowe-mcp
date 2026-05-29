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
 * HTTP-level authentication helpers for the z/OSMF mock.
 *
 * We avoid `cookie-parser` and similar dependencies — the parse logic is
 * trivial and confined to one file.
 */

import type { Request } from 'express';

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

/**
 * Parse an `Authorization: Basic ...` header. Returns undefined if the header
 * is missing, not Basic, or malformed.
 */
export function parseBasicAuth(req: Request): BasicAuthCredentials | undefined {
  const header = req.header('authorization');
  if (!header) return undefined;
  const match = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!match) return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return undefined;
  }
  const colonIdx = decoded.indexOf(':');
  if (colonIdx < 0) return undefined;
  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);
  if (!username) return undefined;
  return { username, password };
}

/**
 * Extract the LtpaToken2 cookie value from the `Cookie` request header.
 * Returns undefined if no cookie matches.
 */
export function parseLtpaCookie(req: Request): string | undefined {
  const header = req.header('cookie');
  if (!header) return undefined;
  for (const piece of header.split(';')) {
    const trimmed = piece.trim();
    if (trimmed.startsWith('LtpaToken2=')) {
      return trimmed.slice('LtpaToken2='.length);
    }
  }
  return undefined;
}
