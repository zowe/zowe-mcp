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

import { describe, expect, it } from 'vitest';
import { isLoopbackHttpUrl } from '../src/zos/native/password-elicitation.js';

describe('isLoopbackHttpUrl (cleartext elicitation guard)', () => {
  it('accepts loopback http URLs', () => {
    expect(isLoopbackHttpUrl('http://127.0.0.1:7542')).toBe(true);
    expect(isLoopbackHttpUrl('http://localhost:7542')).toBe(true);
    expect(isLoopbackHttpUrl('http://[::1]:7542')).toBe(true);
    expect(isLoopbackHttpUrl('http://127.1.2.3:8080')).toBe(true);
  });

  it('rejects non-loopback http URLs', () => {
    expect(isLoopbackHttpUrl('http://mcp.example.com')).toBe(false);
    expect(isLoopbackHttpUrl('http://10.1.2.3:7542')).toBe(false);
    expect(isLoopbackHttpUrl('http://192.168.0.10')).toBe(false);
  });

  it('rejects unparseable URLs', () => {
    expect(isLoopbackHttpUrl('not a url')).toBe(false);
  });
});
