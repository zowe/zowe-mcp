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
 * Hand-rolled RS256 JWT signing, mirroring the verification logic in
 * `@zowe/mcp-server`'s `src/auth/bearer-jwt.ts` (no extra JWT-library dependency).
 */

import { createSign, type KeyObject } from 'node:crypto';

function base64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface MintAccessTokenOptions {
  /** SAF-verified username; becomes the token's `sub`. */
  username: string;
  issuer: string;
  /**
   * MCP resource the token is bound to (RFC 8707); becomes the `aud` claim.
   * Required: the resource server always validates audience, and a token
   * without one is a bearer credential for every relying party of this issuer.
   */
  audience: string;
  kid: string;
  privateKey: KeyObject;
  /** Token lifetime in seconds. Default 300s (5 min) — there is no refresh endpoint. */
  ttlSeconds?: number;
}

/** Signs a short-lived RS256 access token for a SAF-authenticated user. */
export function mintAccessToken(options: MintAccessTokenOptions): string {
  const { username, issuer, audience, kid, privateKey, ttlSeconds = 300 } = options;
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid };
  const payload = {
    iss: issuer,
    sub: username,
    aud: audience,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const h = base64Url(JSON.stringify(header));
  const p = base64Url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  signer.end();
  const signature = base64Url(signer.sign(privateKey));
  return `${h}.${p}.${signature}`;
}
