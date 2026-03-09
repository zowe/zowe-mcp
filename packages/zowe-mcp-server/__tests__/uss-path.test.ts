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
 * Unit tests for USS path utilities (uss-path.ts).
 *
 * Covers resolveUssPath (absolute and relative with cwd) and relativizeForDisplay.
 */

import { describe, expect, it } from 'vitest';
import {
  relativizeForDisplay,
  resolveUssPath,
  resolvedPathOnlyIfDifferent,
} from '../src/zos/uss-path.js';

describe('resolveUssPath', () => {
  describe('absolute paths (no cwd required)', () => {
    it('normalizes slashes and . segments', () => {
      expect(resolveUssPath('/a/b/c')).toBe('/a/b/c');
      expect(resolveUssPath('/a//b/c')).toBe('/a/b/c');
      expect(resolveUssPath('/a/./b/.')).toBe('/a/b');
    });

    it('resolves .. segments', () => {
      expect(resolveUssPath('/a/b/../c')).toBe('/a/c');
      expect(resolveUssPath('/a/b/c/../../d')).toBe('/a/d');
    });

    it('trims whitespace', () => {
      expect(resolveUssPath('  /a/b  ')).toBe('/a/b');
    });

    it('returns empty for empty input', () => {
      expect(resolveUssPath('')).toBe('');
      expect(resolveUssPath('   ')).toBe('');
    });
  });

  describe('relative paths with cwd', () => {
    const cwd = '/u/myuser';

    it('prepends cwd and normalizes', () => {
      expect(resolveUssPath('file.txt', cwd)).toBe('/u/myuser/file.txt');
      expect(resolveUssPath('subdir/file.txt', cwd)).toBe('/u/myuser/subdir/file.txt');
    });

    it('resolves . and .. within relative path', () => {
      expect(resolveUssPath('./a', cwd)).toBe('/u/myuser/a');
      expect(resolveUssPath('a/../b', cwd)).toBe('/u/myuser/b');
      expect(resolveUssPath('a/../../b', cwd)).toBe('/u/b');
    });

    it('throws when relative and cwd is undefined', () => {
      expect(() => resolveUssPath('file.txt')).toThrow(
        'Relative USS path requires a current working directory'
      );
    });

    it('throws when relative and cwd is empty', () => {
      expect(() => resolveUssPath('file.txt', '')).toThrow(
        'Relative USS path requires a current working directory'
      );
    });
  });
});

describe('relativizeForDisplay', () => {
  it('returns path when cwd is undefined or empty', () => {
    expect(relativizeForDisplay('/a/b', undefined)).toBe('/a/b');
    expect(relativizeForDisplay('/a/b', '')).toBe('/a/b');
  });

  it('returns "." when path equals cwd', () => {
    expect(relativizeForDisplay('/u/myuser', '/u/myuser')).toBe('.');
    expect(relativizeForDisplay('/u/myuser', '/u/myuser/')).toBe('.');
  });

  it('returns relative path when path is under cwd', () => {
    expect(relativizeForDisplay('/u/myuser/file.txt', '/u/myuser')).toBe('file.txt');
    expect(relativizeForDisplay('/u/myuser/subdir/file.txt', '/u/myuser')).toBe('subdir/file.txt');
  });

  it('returns absolute path when path is not under cwd', () => {
    expect(relativizeForDisplay('/tmp/x', '/u/myuser')).toBe('/tmp/x');
    expect(relativizeForDisplay('/u/other', '/u/myuser')).toBe('/u/other');
  });
});

describe('resolvedPathOnlyIfDifferent', () => {
  it('returns undefined when resolved equals raw', () => {
    expect(resolvedPathOnlyIfDifferent('/a/b', '/a/b')).toBeUndefined();
    expect(resolvedPathOnlyIfDifferent('/a/b', '  /a/b  ')).toBeUndefined();
  });

  it('returns resolved when different from raw (after trim and slash collapse)', () => {
    expect(resolvedPathOnlyIfDifferent('/a/b', '/a//b')).toBeUndefined();
    expect(resolvedPathOnlyIfDifferent('/a/c', '/a/b/../c')).toBe('/a/c');
  });
});
