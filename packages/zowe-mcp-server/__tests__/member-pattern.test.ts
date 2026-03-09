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
 * Unit tests for memberPatternToRegExp (member name filter wildcards).
 */

import { describe, expect, it } from 'vitest';
import { memberPatternToRegExp } from '../src/zos/member-pattern.js';

function match(pattern: string | undefined, name: string): boolean {
  const re = memberPatternToRegExp(pattern);
  if (!re) return true;
  return re.test(name);
}

describe('memberPatternToRegExp', () => {
  it('returns undefined for undefined pattern', () => {
    expect(memberPatternToRegExp(undefined)).toBeUndefined();
  });

  it('returns undefined for empty or whitespace-only pattern', () => {
    expect(memberPatternToRegExp('')).toBeUndefined();
    expect(memberPatternToRegExp('   ')).toBeUndefined();
  });

  it('* matches zero or more characters', () => {
    expect(match('A*', 'A')).toBe(true);
    expect(match('A*', 'AB')).toBe(true);
    expect(match('A*', 'ALPHA')).toBe(true);
    expect(match('A*', 'BETA')).toBe(false);
    expect(match('*', 'ANY')).toBe(true);
    expect(match('*', '')).toBe(true);
  });

  it('% matches exactly one character', () => {
    expect(match('A%', 'AB')).toBe(true);
    expect(match('A%', 'AX')).toBe(true);
    expect(match('A%', 'A')).toBe(false);
    expect(match('A%', 'ALPHA')).toBe(false);
    expect(match('A%', 'BETA')).toBe(false);
    expect(match('%B', 'AB')).toBe(true);
    expect(match('%B', 'XB')).toBe(true);
    expect(match('%B', 'B')).toBe(false);
  });

  it('combines * and % in same pattern', () => {
    expect(match('A%*', 'AB')).toBe(true);
    expect(match('A%*', 'ALPHA')).toBe(true);
    expect(match('A%*', 'A')).toBe(false);
    expect(match('*%X', 'AX')).toBe(true);
    expect(match('*%X', 'ABX')).toBe(true);
    expect(match('*%X', 'X')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(match('abc*', 'ABCD')).toBe(true);
    expect(match('A*', 'alpha')).toBe(true);
    expect(match('a%c', 'ABC')).toBe(true);
  });

  it('escapes regex metacharacters so they match literally', () => {
    expect(match('A.B', 'A.B')).toBe(true);
    expect(match('A.B', 'AXB')).toBe(false);
    expect(match('(X)', '(X)')).toBe(true);
    expect(match('a+b', 'a+b')).toBe(true);
    expect(match('a+b', 'ab')).toBe(false);
  });
});
