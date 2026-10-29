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

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Entry point of the server under test for stdio E2E suites.
 *
 * Defaults to the repo build (`dist/index.js`). Set `ZOWE_MCP_E2E_SERVER_PATH`
 * to point a suite at another build instead — for example
 * `node_modules/@zowe/mcp-server/dist/index.js` from an install of the
 * npm-pack tarball, to check the shipped bundle. This is a manual knob:
 * nothing in CI sets it (`npm run test:airgap` has its own, dependency-free
 * stdio check). Empty or whitespace-only values are ignored.
 */
export function resolveE2eServerPath(): string {
  const override = process.env.ZOWE_MCP_E2E_SERVER_PATH?.trim();
  if (override) return override;
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'index.js');
}
