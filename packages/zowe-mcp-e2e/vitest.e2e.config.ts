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
 * Separate vitest config for the Copilot Chat BYOK e2e scenarios
 * (`__tests__/e2e/*.e2e.test.ts`), used only by the "e2e"/"e2e:ollama"
 * package.json scripts. Kept apart from `vitest.config.ts` (which excludes
 * this directory) because vitest's `test.exclude` applies even to
 * explicitly-named file arguments — a single shared config can't both keep
 * `npm test`/`test:watch` fast/e2e-free AND let `npm run e2e` target these
 * files directly.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Sequential by design: only one VS Code instance should be driven at a time.
    fileParallelism: false,
  },
});
