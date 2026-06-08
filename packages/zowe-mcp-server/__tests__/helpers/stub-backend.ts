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

import type { ZosBackend } from '../../src/zos/backend.js';

/**
 * A complete {@link ZosBackend} test double. Every method rejects by default;
 * pass `overrides` for the few a test actually exercises. Unspecified methods
 * are auto-stubbed, so this stays a valid `ZosBackend` even as the interface
 * grows — no per-test maintenance when new methods are added.
 */
export function createStubBackend(overrides: Partial<ZosBackend> = {}): ZosBackend {
  return new Proxy(overrides as ZosBackend, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return (): Promise<never> =>
        Promise.reject(new Error(`stub backend: ${String(prop)} not implemented`));
    },
  });
}
