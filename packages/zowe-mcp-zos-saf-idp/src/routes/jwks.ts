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

import { Router } from 'express';
import type { IdpKeyPair } from '../keys.js';

/** `GET /.well-known/jwks.json` -> the single active signing key, in JWK Set form. */
export function createJwksRouter(keyPair: IdpKeyPair): Router {
  const router = Router();
  router.get('/.well-known/jwks.json', (_req, res) => {
    res.json({ keys: [keyPair.publicJwk] });
  });
  return router;
}
