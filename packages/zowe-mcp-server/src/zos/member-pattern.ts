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
 * Member name pattern matching for PDS/PDSE listings.
 *
 * Converts a pattern string with wildcards into a case-insensitive RegExp
 * for matching member names (e.g. in listMembers).
 *
 * Wildcards:
 * - `*` — zero or more characters
 * - `%` — exactly one character
 *
 * All other regex metacharacters are escaped so they match literally.
 */

/**
 * Builds a case-insensitive RegExp that matches member names against the given pattern.
 * Pattern wildcards: * (zero or more chars), % (one char).
 *
 * @param pattern - Member name filter pattern (e.g. "ABC*", "A%C").
 * @returns RegExp with ^...$ and 'i' flag, or undefined if pattern is empty/whitespace.
 */
export function memberPatternToRegExp(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined || pattern.trim() === '') {
    return undefined;
  }
  const escaped = pattern.replace(/[\\^$.|?+()[\]{}]/g, '\\$&');
  const re = escaped.replace(/\*/g, '.*').replace(/%/g, '.');
  return new RegExp(`^${re}$`, 'i');
}
