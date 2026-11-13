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

import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';

export interface IdpKeyPair {
  kid: string;
  privateKey: KeyObject;
  /** RFC 7517 JWK for the public half, ready to serve from `/.well-known/jwks.json`. */
  publicJwk: Record<string, unknown>;
}

/**
 * Generates a fresh RSA keypair. Never persisted to disk in v1 — a restart
 * invalidates every outstanding token, which is an accepted tradeoff (see
 * docs/zos-saf-idp.md) that also sidesteps the on-disk fs.readFileSync
 * EBCDIC-corruption bug found on z/OS USS, since there is no key file to read.
 */
export function generateIdpKeyPair(): IdpKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return {
    kid,
    privateKey,
    publicJwk: { ...jwk, kid, alg: 'RS256', use: 'sig' },
  };
}
