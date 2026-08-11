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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // The Copilot Chat e2e scenarios (__tests__/e2e/*.e2e.test.ts) drive a
    // real, from-scratch VS Code install and take minutes to run — they
    // must never be picked up by a bare `vitest run`/`npm test` (used for
    // the fast fake-model-server unit tests). Run them explicitly via the
    // "e2e"/"e2e:ollama" package.json scripts, which pass the exact file
    // path and so bypass this exclude.
    exclude: ['**/node_modules/**', '**/dist/**', '__tests__/e2e/**'],
  },
});
