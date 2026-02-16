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
 * z/OS dataset name resolution utilities.
 *
 * Implements the z/OS single-quote convention for absolute vs. relative
 * dataset names, case normalization, and validation rules.
 *
 * - A name **without** single quotes is relative — the current DSN prefix
 *   is prepended (e.g. `"JCL.CNTL"` with prefix `"USER"` → `"USER.JCL.CNTL"`).
 * - A name **wrapped in single quotes** is fully qualified (absolute) —
 *   used as-is with quotes stripped (e.g. `"'SYS1.PROCLIB'"` → `"SYS1.PROCLIB"`).
 * - All names are normalized to uppercase.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum length of a fully-qualified dataset name. */
const MAX_DSN_LENGTH = 44;

/** Maximum length of a single qualifier. */
const MAX_QUALIFIER_LENGTH = 8;

/** Maximum length of a member name. */
const MAX_MEMBER_LENGTH = 8;

/**
 * Valid characters for the first character of a qualifier:
 * alphabetic (A-Z) or national (#, @, $).
 */
const QUALIFIER_FIRST_CHAR = /^[A-Z#@$]/;

/**
 * Valid characters for a qualifier (after the first):
 * alphanumeric, national (#, @, $), or hyphen.
 */
const QUALIFIER_CHARS = /^[A-Z0-9#@$-]+$/;

/** Valid member name characters (same rules as qualifier). */
const MEMBER_CHARS = /^[A-Z0-9#@$]+$/;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result of resolving a dataset name from agent input. */
export interface ResolvedDsn {
  /** Fully-qualified dataset name (uppercase, no quotes). */
  dsn: string;
  /** Member name if provided (uppercase). */
  member?: string;
  /** Whether the original input was absolute (single-quoted). */
  wasAbsolute: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Result of resolveWithPrefix (no validation; usable for patterns). */
export interface ResolvedWithPrefix {
  resolved: string;
  wasAbsolute: boolean;
}

/**
 * Resolve a dataset name or pattern using the z/OS single-quote convention.
 * Does not validate the result (so patterns like USER.* are allowed).
 * Use this for listDatasets pattern resolution; use resolveDsn for full DSN validation.
 *
 * @param input - Dataset name or pattern as provided by the agent.
 * @param prefix - The current DSN prefix (required when input is relative).
 * @returns The resolved string and whether the input was absolute.
 * @throws {DsnError} if input is empty or relative and prefix is undefined.
 */
export function resolveWithPrefix(input: string, prefix: string | undefined): ResolvedWithPrefix {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new DsnError('Dataset name must not be empty');
  }

  // Single-quote convention: 'FULLY.QUALIFIED.NAME' is absolute
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return {
      resolved: trimmed.slice(1, -1).toUpperCase(),
      wasAbsolute: true,
    };
  }

  // Relative — prefix is required
  if (prefix === undefined || prefix === '') {
    throw new DsnError(
      'No DSN prefix set; relative name or pattern requires a prefix. Use setSystem or setDsnPrefix first, or use an absolute name in single quotes.'
    );
  }

  const upper = trimmed.toUpperCase();
  return {
    resolved: `${prefix.toUpperCase()}.${upper}`,
    wasAbsolute: false,
  };
}

/**
 * Resolve a dataset name from agent input using the z/OS single-quote
 * convention.
 *
 * @param input - The dataset name as provided by the agent.
 * @param prefix - The current DSN prefix (may be `undefined` if not set).
 * @param member - Optional member name.
 * @returns The resolved, validated, uppercase dataset name.
 * @throws {DsnError} if the name is invalid.
 */
export function resolveDsn(
  input: string,
  prefix: string | undefined,
  member?: string
): ResolvedDsn {
  const { resolved: dsn, wasAbsolute } = resolveWithPrefix(input, prefix);
  validateDsn(dsn);

  const resolvedMember = member?.trim().toUpperCase();
  if (resolvedMember !== undefined && resolvedMember.length > 0) {
    validateMember(resolvedMember);
  }

  return {
    dsn,
    member: resolvedMember && resolvedMember.length > 0 ? resolvedMember : undefined,
    wasAbsolute,
  };
}

/**
 * Validate a fully-qualified dataset name.
 *
 * Rules:
 * - Maximum 44 characters total.
 * - Dot-separated qualifiers, each 1–8 characters.
 * - First character of each qualifier: A-Z, #, @, $.
 * - Remaining characters: A-Z, 0-9, #, @, $, -.
 * - At least one qualifier.
 * - Cannot start or end with a dot, no consecutive dots.
 */
export function validateDsn(dsn: string): void {
  if (dsn.length === 0) {
    throw new DsnError('Dataset name must not be empty');
  }
  if (dsn.length > MAX_DSN_LENGTH) {
    throw new DsnError(
      `Dataset name exceeds ${MAX_DSN_LENGTH} characters: "${dsn}" (${dsn.length} chars)`
    );
  }
  if (dsn.startsWith('.') || dsn.endsWith('.')) {
    throw new DsnError(`Dataset name must not start or end with a dot: "${dsn}"`);
  }
  if (dsn.includes('..')) {
    throw new DsnError(`Dataset name must not contain consecutive dots: "${dsn}"`);
  }

  const qualifiers = dsn.split('.');
  for (const q of qualifiers) {
    validateQualifier(q, dsn);
  }
}

/**
 * Validate a single dataset name qualifier.
 */
function validateQualifier(qualifier: string, fullName: string): void {
  if (qualifier.length === 0) {
    throw new DsnError(`Empty qualifier in dataset name: "${fullName}"`);
  }
  if (qualifier.length > MAX_QUALIFIER_LENGTH) {
    throw new DsnError(
      `Qualifier "${qualifier}" exceeds ${MAX_QUALIFIER_LENGTH} characters in: "${fullName}"`
    );
  }
  if (!QUALIFIER_FIRST_CHAR.test(qualifier[0])) {
    throw new DsnError(
      `Qualifier "${qualifier}" must start with A-Z, #, @, or $ in: "${fullName}"`
    );
  }
  if (!QUALIFIER_CHARS.test(qualifier)) {
    throw new DsnError(
      `Qualifier "${qualifier}" contains invalid characters in: "${fullName}". ` +
        'Allowed: A-Z, 0-9, #, @, $, -'
    );
  }
}

/**
 * Validate a PDS/PDSE member name.
 *
 * Rules:
 * - 1–8 characters.
 * - First character: A-Z, #, @, $.
 * - Remaining: A-Z, 0-9, #, @, $.
 */
export function validateMember(member: string): void {
  if (member.length === 0) {
    throw new DsnError('Member name must not be empty');
  }
  if (member.length > MAX_MEMBER_LENGTH) {
    throw new DsnError(`Member name exceeds ${MAX_MEMBER_LENGTH} characters: "${member}"`);
  }
  if (!QUALIFIER_FIRST_CHAR.test(member[0])) {
    throw new DsnError(`Member name "${member}" must start with A-Z, #, @, or $`);
  }
  if (!MEMBER_CHARS.test(member)) {
    throw new DsnError(
      `Member name "${member}" contains invalid characters. Allowed: A-Z, 0-9, #, @, $`
    );
  }
}

/**
 * Build a `zos-ds://` URI for a dataset (optionally with member and volser).
 */
export function buildDsUri(system: string, dsn: string, member?: string, volser?: string): string {
  let uri = `zos-ds://${system}/${dsn}`;
  if (member) {
    uri += `(${member})`;
  }
  if (volser) {
    uri += `?volser=${volser}`;
  }
  return uri;
}

/**
 * Infer a MIME type from dataset content by examining structural patterns.
 *
 * Detection heuristics (checked against the first portion of text):
 * - **JCL**: Lines starting with `//` (JCL statement indicator)
 * - **COBOL**: Lines with content in columns 7–72 and COBOL division/verb
 *   keywords (`IDENTIFICATION DIVISION`, `DATA DIVISION`, `PROCEDURE`,
 *   `WORKING-STORAGE`, `PERFORM`, `MOVE`, `01 `, `05 `, `COPY `, etc.)
 * - **REXX**: Starts with a REXX comment (`/*` on first line) or contains
 *   `REXX` in the first line, or uses REXX-specific keywords (`SAY `,
 *   `PARSE `, `ARG `, `PULL `)
 * - **Assembler**: Lines with assembler opcodes in the operation field
 *   (`CSECT`, `DSECT`, `USING`, `BALR`, `DC `, `DS `, `MVC `, `LA `)
 *
 * Returns `text/plain` if no specific type can be determined.
 *
 * @param content - The text content to analyze.
 */
export function inferMimeType(content: string): string {
  // Examine only the first ~2000 chars for performance
  const sample = content.slice(0, 2000);
  const lines = sample.split('\n').map(l => l.trimEnd());

  // --- JCL detection ---
  // JCL lines start with // (not a comment like //*) or a /* delimiter
  const jclLines = lines.filter(l => /^\/\/[^ ]/.test(l) || l.startsWith('//*'));
  if (jclLines.length >= 2) {
    return 'text/x-jcl';
  }

  // --- REXX detection ---
  const firstLine = lines[0]?.trim() ?? '';
  if (/^\/\*\s*REXX/i.test(firstLine) || /REXX/i.test(firstLine)) {
    return 'text/x-rexx';
  }
  const rexxKeywords = /\b(SAY|PARSE\s+(UPPER\s+)?ARG|PARSE\s+VAR|PULL|SIGNAL|INTERPRET)\b/i;
  if (lines.some(l => rexxKeywords.test(l))) {
    return 'text/x-rexx';
  }

  // --- Assembler detection (before COBOL — asm keywords are more specific) ---
  // Two groups: standalone keywords (matched with \b on both sides) and
  // instruction mnemonics that need a trailing space (matched with \b only at start).
  const asmKeywords =
    /\b(CSECT|DSECT|USING|BALR|BASR|BCR|MVC|MVI|CLC|CLI|MACRO|MEND)\b|\b(LA|LR|SR|ST|DC|DS|EQU)\s/;
  const asmLines = lines.filter(l => asmKeywords.test(l));
  if (asmLines.length >= 3) {
    return 'text/x-asm';
  }

  // --- COBOL detection ---
  const cobolKeywords =
    /\b(IDENTIFICATION\s+DIVISION|ENVIRONMENT\s+DIVISION|DATA\s+DIVISION|PROCEDURE\s+DIVISION|WORKING-STORAGE\s+SECTION|LINKAGE\s+SECTION|PERFORM|MOVE|DISPLAY|ACCEPT|EVALUATE|EXEC\s+SQL|COPY\s+[A-Z])/i;
  const cobolLines = lines.filter(l => cobolKeywords.test(l));
  if (cobolLines.length >= 2) {
    return 'text/x-cobol';
  }
  // COBOL fixed-format: column 7 is indicator area (space, *, /, -)
  const fixedFormatLines = lines.filter(
    l => l.length >= 7 && /^.{6}[* /\-]/.test(l) && l.length <= 80
  );
  if (fixedFormatLines.length > lines.length * 0.5 && lines.length >= 5) {
    return 'text/x-cobol';
  }

  return 'text/plain';
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/** Error thrown when a dataset name or member name is invalid. */
export class DsnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DsnError';
  }
}
