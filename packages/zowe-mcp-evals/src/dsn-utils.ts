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

const MAX_MEMBER_LENGTH = 8;
const MEMBER_CHARS = /^[A-Z0-9#@$]+$/;
const QUALIFIER_FIRST_CHAR = /^[A-Z#@$]/;

/**
 * Normalize a DSN or pattern string: trim, strip optional surrounding
 * single quotes, uppercase. Mirrors the server's `resolvePattern()`.
 */
export function normalizeDsnOrPattern(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).toUpperCase();
  }
  return trimmed.toUpperCase();
}

/**
 * Parse a string that may be in the form `DSN(MEMBER)` into base DSN and member.
 * If the input has a trailing parenthesized suffix with a valid member name,
 * returns `{ dsn, member }`. Otherwise returns `{ dsn: input }`.
 * Mirrors the server's `parseDsnAndMember()`.
 */
export function parseDsnAndMember(input: string): { dsn: string; member?: string } {
  const trimmed = input.trim();
  const match = /^(.+?)\(([^)]+)\)$/.exec(trimmed);
  if (!match) {
    return { dsn: trimmed };
  }
  const baseDsn = match[1].trim();
  const memberPart = match[2].trim().toUpperCase();
  if (
    memberPart.length === 0 ||
    memberPart.length > MAX_MEMBER_LENGTH ||
    !QUALIFIER_FIRST_CHAR.test(memberPart[0]) ||
    !MEMBER_CHARS.test(memberPart)
  ) {
    return { dsn: trimmed };
  }
  return { dsn: baseDsn, member: memberPart };
}
