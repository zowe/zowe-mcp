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
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.SRC.COBOL')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPattern('IBMUSER.SRC.COBOL', 'ibmuser.src.cobol')).toBe(true);
    expect(matchPattern('ibmuser.src.cobol', 'IBMUSER.SRC.COBOL')).toBe(true);
  });

  it('rejects a non-matching exact name', () => {
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.SRC.JCL')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Single * within a qualifier
  // -----------------------------------------------------------------------
  it('matches * within a middle qualifier', () => {
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.S*.COBOL')).toBe(true);
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.X*.COBOL')).toBe(false);
  });

  it('matches * at the end of a qualifier', () => {
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.SRC.COB*')).toBe(true);
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.SRC.JCL*')).toBe(false);
  });

  it('matches * at the beginning of a qualifier', () => {
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.SRC.*BOL')).toBe(true);
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.SRC.*JCL')).toBe(false);
  });

  it('single * does not cross qualifier boundaries in middle position', () => {
    // IBMUSER.* with 3 qualifiers should NOT match when * is not the last qualifier
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.*.COBOL')).toBe(true);
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.*.JCL')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Trailing * (ISPF 3.4 convention: trailing * acts as **)
  // -----------------------------------------------------------------------
  it('trailing * matches datasets with more qualifiers (ISPF convention)', () => {
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.*')).toBe(true);
    expect(matchPattern('IBMUSER.JCL.CNTL', 'IBMUSER.*')).toBe(true);
    expect(matchPattern('IBMUSER.LOAD', 'IBMUSER.*')).toBe(true);
  });

  it('trailing * does not match unrelated HLQ', () => {
    expect(matchPattern('SYS1.PROCLIB', 'IBMUSER.*')).toBe(false);
  });

  it('trailing * matches deeply nested qualifiers', () => {
    expect(matchPattern('IBMUSER.A.B.C.D', 'IBMUSER.*')).toBe(true);
  });

  it('trailing * with partial prefix qualifier', () => {
    // IBMUSER.S* as last qualifier → treated as ** but with prefix S
    // This becomes IBMUSER.S** which is "IBMUSER" then "S.*"
    // Actually, only a lone * gets promoted to **
    expect(matchPattern('IBMUSER.SRC', 'IBMUSER.S*')).toBe(true);
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.S*')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Explicit ** (match across qualifiers)
  // -----------------------------------------------------------------------
  it('** matches any number of qualifiers', () => {
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.**')).toBe(true);
    expect(matchPattern('IBMUSER.A.B.C.D.E', 'IBMUSER.**')).toBe(true);
    expect(matchPattern('IBMUSER.LOAD', 'IBMUSER.**')).toBe(true);
  });

  it('** in the middle matches across qualifiers', () => {
    expect(matchPattern('IBMUSER.A.B.C.COBOL', 'IBMUSER.**.COBOL')).toBe(true);
    expect(matchPattern('IBMUSER.SRC.COBOL', 'IBMUSER.**.COBOL')).toBe(true);
  });

  it('** does not match unrelated prefix', () => {
    expect(matchPattern('SYS1.PROCLIB', 'IBMUSER.**')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it('single qualifier pattern matches single qualifier name', () => {
    expect(matchPattern('IBMUSER', 'IBMUSER')).toBe(true);
    expect(matchPattern('IBMUSER', '*')).toBe(true);
  });

  it('lone * as entire pattern matches any single qualifier', () => {
    // A lone * is the only qualifier, so there's nothing "trailing" about it
    // (qualifiers.length < 2), so it stays as * = single qualifier match
    expect(matchPattern('IBMUSER', '*')).toBe(true);
    expect(matchPattern('IBMUSER.SRC', '*')).toBe(false);
  });

  it('empty pattern does not match', () => {
    expect(matchPattern('IBMUSER.SRC', '')).toBe(false);
  });

  it('pattern with multiple * in one qualifier', () => {
    expect(matchPattern('IBMUSER.ABCDEF', 'IBMUSER.A*F')).toBe(true);
    expect(matchPattern('IBMUSER.ABCDEF', 'IBMUSER.A*D*F')).toBe(true);
    expect(matchPattern('IBMUSER.ABCDEF', 'IBMUSER.X*F')).toBe(false);
  });
});
