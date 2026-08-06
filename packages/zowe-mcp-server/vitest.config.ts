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
    // E2E tests drive many tool calls through a spawned server in a single test;
    // under coverage instrumentation on slow CI runners they can exceed 30s.
    testTimeout: 60000,
    // E2E beforeAll hooks spawn the built server (e.g. init-mock data generation);
    // Windows CI runners need well over the 10s default for process spawn + cold load.
    hookTimeout: 60000,
    coverage: {
      // Only active when --coverage is passed (CI does; report-only, no gate).
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**', '**/*.d.ts'],
    },
  },
});
