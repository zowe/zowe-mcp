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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TtlPasswordStore } from '../src/zos/native/password-store.js';

describe('TtlPasswordStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires cached passwords after TTL', () => {
    vi.useFakeTimers();
    const store = new TtlPasswordStore(1000);
    store.set('k', 'secret');
    expect(store.get('k')).toBe('secret');
    vi.advanceTimersByTime(1001);
    expect(store.get('k')).toBeUndefined();
  });
});
