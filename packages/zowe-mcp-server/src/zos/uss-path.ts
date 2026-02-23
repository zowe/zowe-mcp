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
 * USS path normalization and validation.
 *
 * Used by USS tools to produce a canonical path for backend calls and
 * to populate ResponseContext.resolvedPath when normalization changed the input.
 */

/**
 * Normalize a path string: trim, collapse repeated slashes, resolve . and ..
 * segments. Does not touch the filesystem. Used internally by resolveUssPath.
 */
function normalizePathSegments(input: string): { segments: string[]; absolute: boolean } {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { segments: [], absolute: false };
  }
  const collapsed = trimmed.replace(/\/+/g, '/');
  const segments = collapsed.split('/').filter(s => s.length > 0);
  const result: string[] = [];
  for (const seg of segments) {
    if (seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (result.length > 0) {
        result.pop();
      }
      continue;
    }
    result.push(seg);
  }
  const absolute = collapsed.startsWith('/');
  return { segments: result, absolute };
}

/**
 * Resolve a USS path: accept absolute (leading /) or relative to cwd.
 * Normalizes: trim, collapse slashes, resolve . and .. segments.
 *
 * @param input - Raw path from the user (e.g. /u/myuser/file, or subdir/file).
 * @param cwd - Current working directory (required when input is relative). Omit for absolute-only behavior.
 * @returns Absolute normalized path.
 * @throws {Error} when input is relative and cwd is undefined or empty.
 */
export function resolveUssPath(input: string, cwd?: string): string {
  const trimmed = input.trim();
  if (trimmed === '') {
    return '';
  }
  const isAbsolute = trimmed.startsWith('/');
  if (isAbsolute) {
    const { segments, absolute } = normalizePathSegments(trimmed);
    const joined = segments.join('/');
    return absolute ? '/' + joined : joined;
  }
  if (!cwd || cwd.trim() === '') {
    throw new Error(
      'Relative USS path requires a current working directory. Call getUssHome or changeUssDirectory first.'
    );
  }
  const cwdNorm = cwd.replace(/\/+$/, '');
  const combined = cwdNorm + '/' + trimmed;
  const { segments, absolute } = normalizePathSegments(combined);
  const joined = segments.join('/');
  return absolute ? '/' + joined : joined;
}

/**
 * Return a path in display form: relative to cwd when under cwd (forward-only, no ..), otherwise absolute.
 *
 * @param absolutePath - Resolved absolute path.
 * @param cwd - Current working directory (effective cwd). When undefined, returns absolutePath.
 * @returns Relative path (e.g. "." or "foo/bar") when under cwd, otherwise absolutePath.
 */
export function relativizeForDisplay(absolutePath: string, cwd: string | undefined): string {
  if (!cwd || cwd.trim() === '') {
    return absolutePath;
  }
  const cwdNorm = cwd.replace(/\/+$/, '');
  if (absolutePath === cwdNorm) {
    return '.';
  }
  const prefix = cwdNorm + '/';
  if (absolutePath.startsWith(prefix)) {
    return absolutePath.slice(prefix.length);
  }
  return absolutePath;
}

/**
 * Return the resolved path for context only when resolution actually changed
 * the input. Use when building ResponseContext for USS tools.
 *
 * @param resolved - Normalized path from resolveUssPath.
 * @param rawInput - Raw input string from the user (will be trimmed for comparison).
 * @returns Resolved path to include in context, or undefined to omit.
 */
export function resolvedPathOnlyIfDifferent(
  resolved: string,
  rawInput: string
): string | undefined {
  const rawTrimmed = rawInput.trim();
  if (resolved === rawTrimmed) return undefined;
  const rawCollapsed = rawTrimmed.replace(/\/+/g, '/');
  if (resolved === rawCollapsed) return undefined;
  return resolved;
}
