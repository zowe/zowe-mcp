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
 * Unit tests for progress title range formatters (formatListProgressRange, formatReadProgressRange).
 */

import { describe, expect, it } from 'vitest';
import { formatListProgressRange, formatReadProgressRange } from '../src/tools/progress.js';

const DEFAULT_LIMIT = 500;

describe('formatListProgressRange', () => {
  it('returns empty string for default first page (offset 0, default limit)', () => {
    expect(formatListProgressRange(0, DEFAULT_LIMIT, DEFAULT_LIMIT)).toBe('');
    expect(formatListProgressRange(undefined, undefined, DEFAULT_LIMIT)).toBe('');
    expect(formatListProgressRange(undefined, 500, DEFAULT_LIMIT)).toBe('');
    expect(formatListProgressRange(0, undefined, DEFAULT_LIMIT)).toBe('');
  });

  it('returns empty string when limit equals default and offset is 0', () => {
    expect(formatListProgressRange(0, 500, 500)).toBe('');
  });

  it('returns range when offset > 0', () => {
    expect(formatListProgressRange(500, 500, DEFAULT_LIMIT)).toBe('(501-1000)');
    expect(formatListProgressRange(1, 500, DEFAULT_LIMIT)).toBe('(2-501)');
    expect(formatListProgressRange(1000, 500, DEFAULT_LIMIT)).toBe('(1001-1500)');
  });

  it('returns range when limit differs from default', () => {
    expect(formatListProgressRange(0, 100, DEFAULT_LIMIT)).toBe('(1-100)');
    expect(formatListProgressRange(0, 1000, DEFAULT_LIMIT)).toBe('(1-1000)');
    expect(formatListProgressRange(0, 1, DEFAULT_LIMIT)).toBe('(1-1)');
  });

  it('returns range for non-first page with custom limit', () => {
    expect(formatListProgressRange(100, 100, DEFAULT_LIMIT)).toBe('(101-200)');
    expect(formatListProgressRange(250, 250, 250)).toBe('(251-500)');
  });

  it('uses default limit 500 when defaultLimit not passed', () => {
    expect(formatListProgressRange(0, undefined)).toBe('');
    expect(formatListProgressRange(0, 500)).toBe('');
    expect(formatListProgressRange(500, 500)).toBe('(501-1000)');
  });

  it('uses custom defaultLimit when provided', () => {
    expect(formatListProgressRange(0, 250, 250)).toBe('');
    expect(formatListProgressRange(0, 500, 250)).toBe('(1-500)');
    expect(formatListProgressRange(250, 250, 250)).toBe('(251-500)');
  });
});

describe('formatReadProgressRange', () => {
  it('returns empty string when neither startLine nor lineCount is set', () => {
    expect(formatReadProgressRange(undefined, undefined)).toBe('');
  });

  it('returns (start-end) range when both startLine and lineCount are set', () => {
    expect(formatReadProgressRange(1, 100)).toBe('(1-100)');
    expect(formatReadProgressRange(1, 1)).toBe('(1-1)');
    expect(formatReadProgressRange(101, 500)).toBe('(101-600)');
  });

  it('returns "from record N" when only startLine is set', () => {
    expect(formatReadProgressRange(1, undefined)).toBe('(from record 1)');
    expect(formatReadProgressRange(100, undefined)).toBe('(from record 100)');
  });

  it('returns empty string when only lineCount is set (startLine undefined)', () => {
    expect(formatReadProgressRange(undefined, 100)).toBe('');
  });
});
