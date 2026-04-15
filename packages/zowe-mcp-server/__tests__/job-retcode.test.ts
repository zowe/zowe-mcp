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
import { isZeroCompletionRetcode } from '../src/tools/jobs/job-retcode.js';

describe('isZeroCompletionRetcode', () => {
  it('returns false for undefined', () => {
    expect(isZeroCompletionRetcode(undefined)).toBe(false);
  });

  it('treats mock-style 0000 as success', () => {
    expect(isZeroCompletionRetcode('0000')).toBe(true);
  });

  it('treats JES-style CC 0000 as success (ZNP on z/OS)', () => {
    expect(isZeroCompletionRetcode('CC 0000')).toBe(true);
    expect(isZeroCompletionRetcode('  CC 0000  ')).toBe(true);
  });

  it('returns false for non-zero condition codes and abends', () => {
    expect(isZeroCompletionRetcode('CC 0012')).toBe(false);
    expect(isZeroCompletionRetcode('ABEND 0C7')).toBe(false);
  });
});
