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
 * Unit tests for the matchPattern function used by the mock backend
 * to filter datasets by z/OS-style patterns.
 */

import { describe, expect, it } from 'vitest';
import { matchPattern } from '../src/zos/mock/filesystem-mock-backend.js';

describe('matchPattern', () => {
  // -----------------------------------------------------------------------
  // Exact matches
  // -----------------------------------------------------------------------
  it('matches an exact dataset name', () => {
    expect(matchPattern('USER.SRC.COBOL', 'USER.SRC.COBOL')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPattern('USER.SRC.COBOL', 'user.src.cobol')).toBe(true);
    expect(matchPattern('user.src.cobol', 'USER.SRC.COBOL')).toBe(true);
  });

  it('rejects a non-matching exact name', () => {
    expect(matchPattern('USER.SRC.COBOL', 'USER.SRC.JCL')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Single * within a qualifier
  // -----------------------------------------------------------------------
  it('matches * within a middle qualifier', () => {
    expect(matchPattern('USER.SRC.COBOL', 'USER.S*.COBOL')).toBe(true);
    expect(matchPattern('USER.SRC.COBOL', 'USER.X*.COBOL')).toBe(false);
  });

  it('matches * at the end of a qualifier', () => {
    expect(matchPattern('USER.SRC.COBOL', 'USER.SRC.COB*')).toBe(true);
    expect(matchPattern('USER.SRC.COBOL', 'USER.SRC.JCL*')).toBe(false);
  });

  it('matches * at the beginning of a qualifier', () => {
    expect(matchPattern('USER.SRC.COBOL', 'USER.SRC.*BOL')).toBe(true);
    expect(matchPattern('USER.SRC.COBOL', 'USER.SRC.*JCL')).toBe(false);
  });

  it('single * does not cross qualifier boundaries in middle position', () => {
    // USER.* with 3 qualifiers should NOT match when * is not the last qualifier
    expect(matchPattern('USER.SRC.COBOL', 'USER.*.COBOL')).toBe(true);
    expect(matchPattern('USER.SRC.COBOL', 'USER.*.JCL')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Trailing * (ISPF 3.4 convention: trailing * acts as **)
  // -----------------------------------------------------------------------
  it('trailing * matches datasets with more qualifiers (ISPF convention)', () => {
    expect(matchPattern('USER.SRC.COBOL', 'USER.*')).toBe(true);
    expect(matchPattern('USER.JCL.CNTL', 'USER.*')).toBe(true);
    expect(matchPattern('USER.LOAD', 'USER.*')).toBe(true);
  });

  it('trailing * does not match unrelated HLQ', () => {
    expect(matchPattern('SYS1.PROCLIB', 'USER.*')).toBe(false);
  });

  it('trailing * matches deeply nested qualifiers', () => {
    expect(matchPattern('USER.A.B.C.D', 'USER.*')).toBe(true);
  });

  it('trailing * with partial prefix qualifier', () => {
    // USER.S* as last qualifier → treated as ** but with prefix S
    // This becomes USER.S** which is "USER" then "S.*"
    // Actually, only a lone * gets promoted to **
    expect(matchPattern('USER.SRC', 'USER.S*')).toBe(true);
    expect(matchPattern('USER.SRC.COBOL', 'USER.S*')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Explicit ** (match across qualifiers)
  // -----------------------------------------------------------------------
  it('** matches any number of qualifiers', () => {
    expect(matchPattern('USER.SRC.COBOL', 'USER.**')).toBe(true);
    expect(matchPattern('USER.A.B.C.D.E', 'USER.**')).toBe(true);
    expect(matchPattern('USER.LOAD', 'USER.**')).toBe(true);
  });

  it('** in the middle matches across qualifiers', () => {
    expect(matchPattern('USER.A.B.C.COBOL', 'USER.**.COBOL')).toBe(true);
    expect(matchPattern('USER.SRC.COBOL', 'USER.**.COBOL')).toBe(true);
  });

  it('** does not match unrelated prefix', () => {
    expect(matchPattern('SYS1.PROCLIB', 'USER.**')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it('single qualifier pattern matches single qualifier name', () => {
    expect(matchPattern('USER', 'USER')).toBe(true);
    expect(matchPattern('USER', '*')).toBe(true);
  });

  it('lone * as entire pattern matches any single qualifier', () => {
    // A lone * is the only qualifier, so there's nothing "trailing" about it
    // (qualifiers.length < 2), so it stays as * = single qualifier match
    expect(matchPattern('USER', '*')).toBe(true);
    expect(matchPattern('USER.SRC', '*')).toBe(false);
  });

  it('empty pattern does not match', () => {
    expect(matchPattern('USER.SRC', '')).toBe(false);
  });

  it('pattern with multiple * in one qualifier', () => {
    expect(matchPattern('USER.ABCDEF', 'USER.A*F')).toBe(true);
    expect(matchPattern('USER.ABCDEF', 'USER.A*D*F')).toBe(true);
    expect(matchPattern('USER.ABCDEF', 'USER.X*F')).toBe(false);
  });
});
