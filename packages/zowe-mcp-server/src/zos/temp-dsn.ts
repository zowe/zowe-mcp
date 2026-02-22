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
 * Temporary dataset name generation and cleanup.
 *
 * Provides unique prefix/DSN generation (UUID/timestamp-based) and verification
 * against the backend (listDatasets for prefix, getAttributes for DSN).
 * Works with both mock and native backends via the ZosBackend interface.
 */

import { randomBytes } from 'node:crypto';
import type { ZosBackend } from './backend.js';
import { DsnError, resolvePattern, validateDsn, validateListPattern } from './dsn.js';
import type { SystemId } from './system.js';

/** Maximum length of a fully-qualified dataset name. */
const MAX_DSN_LENGTH = 44;

/** Maximum length of a single qualifier. */
const MAX_QUALIFIER_LENGTH = 8;

/** Default max retries when ensuring unique prefix or DSN. Higher for evals (many runs share mock state). */
const DEFAULT_MAX_RETRIES = 20;

/** Safety: minimum qualifiers required for deleteDatasetsUnderPrefix (e.g. USER.TMP.XXXXXXXX). */
const MIN_QUALIFIERS_FOR_DELETE_PREFIX = 3;

/** Safety: qualifier that must appear in prefix for deleteDatasetsUnderPrefix (e.g. TMP). Exported for tool descriptions. */
export const REQUIRED_SAFETY_QUALIFIER = 'TMP';

// ---------------------------------------------------------------------------
// Unique qualifier generation (UUID / timestamp)
// ---------------------------------------------------------------------------

/**
 * Generate an 8-char DSN-safe qualifier (first char A–Z, rest A–Z0–9).
 * Uses random bytes for uniqueness; no requirement for crypto randomness per plan.
 */
function uniqueQualifier(): string {
  const firstChar = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rest = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(8);
  let result = firstChar[bytes[0] % 26];
  for (let i = 1; i < 8; i++) {
    result += rest[bytes[i] % 36];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pure generation (no backend)
// ---------------------------------------------------------------------------

/**
 * Returns an HLQ suitable for temp datasets (e.g. USER.TMP.A1B2C3D4.E5F6G7H8).
 * Caller must supply prefix (e.g. userId + '.TMP'); no default in this module.
 *
 * @param prefix - High-level qualifier (e.g. USER.TMP).
 * @param suffix - Optional suffix qualifier (last part of the generated prefix).
 * @returns A candidate prefix; not verified against the system.
 * @throws {DsnError} if prefix is empty or result would exceed 44 chars / invalid qualifiers.
 */
export function generateTempDsnPrefix(prefix: string, suffix?: string): string {
  const p = prefix.trim().toUpperCase();
  if (p.length === 0) {
    throw new DsnError('Temp DSN prefix must not be empty');
  }
  const q1 = uniqueQualifier();
  const q2 = uniqueQualifier();
  let result = `${p}.${q1}.${q2}`;
  if (suffix !== undefined && suffix.length > 0) {
    const s = suffix.trim().toUpperCase();
    if (s.length > MAX_QUALIFIER_LENGTH) {
      throw new DsnError(`Suffix qualifier exceeds ${MAX_QUALIFIER_LENGTH} characters: "${s}"`);
    }
    result += `.${s}`;
  }
  if (result.length > MAX_DSN_LENGTH) {
    throw new DsnError(`Generated temp prefix exceeds ${MAX_DSN_LENGTH} characters: "${result}"`);
  }
  validateDsn(result);
  return result;
}

/**
 * Returns one full DSN: prefix + '.' + (qualifier or generated 8-char qualifier).
 *
 * @param prefix - HLQ from generateTempDsnPrefix or ensureUniquePrefix.
 * @param qualifier - Optional last qualifier (1–8 chars); if omitted, a unique qualifier is generated.
 * @returns A candidate DSN; not verified against the system.
 */
export function generateTempDsn(prefix: string, qualifier?: string): string {
  const p = prefix.trim().toUpperCase();
  if (p.length === 0) {
    throw new DsnError('Temp DSN prefix must not be empty');
  }
  const q =
    qualifier !== undefined && qualifier.length > 0
      ? qualifier.trim().toUpperCase()
      : uniqueQualifier();
  if (q.length > MAX_QUALIFIER_LENGTH) {
    throw new DsnError(`Qualifier exceeds ${MAX_QUALIFIER_LENGTH} characters: "${q}"`);
  }
  const result = `${p}.${q}`;
  if (result.length > MAX_DSN_LENGTH) {
    throw new DsnError(`Generated temp DSN exceeds ${MAX_DSN_LENGTH} characters: "${result}"`);
  }
  validateDsn(result);
  return result;
}

// ---------------------------------------------------------------------------
// Ensure unique (backend verification)
// ---------------------------------------------------------------------------

/**
 * Returns a prefix that is verified not to exist on the system (list with prefix.**, retry if non-empty).
 * Works with both mock and native backends.
 *
 * @param backend - ZosBackend (mock or native).
 * @param systemId - Target z/OS system.
 * @param prefix - Base prefix (e.g. USER.TMP).
 * @param userId - Optional user ID for listDatasets.
 * @param maxRetries - Max retries (default 5).
 * @returns A prefix under which no datasets exist.
 */
export async function ensureUniquePrefix(
  backend: ZosBackend,
  systemId: SystemId,
  prefix: string,
  userId?: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<string> {
  const basePrefix = prefix.trim().toUpperCase();
  if (basePrefix.length === 0) {
    throw new DsnError('Temp DSN prefix must not be empty');
  }
  for (let i = 0; i < maxRetries; i++) {
    const candidate = generateTempDsnPrefix(basePrefix);
    const pattern = `${candidate}.**`;
    validateListPattern(candidate);
    const list = await backend.listDatasets(systemId, pattern, undefined, userId, false);
    if (list.length === 0) {
      return candidate;
    }
  }
  throw new DsnError(
    `Could not find an unused temp prefix after ${maxRetries} attempts under ${basePrefix}`
  );
}

/**
 * Returns a DSN that is verified not to exist on the system (getAttributes; if throws "not found", use it).
 * Works with both mock and native backends.
 *
 * @param backend - ZosBackend (mock or native).
 * @param systemId - Target z/OS system.
 * @param prefix - Base prefix (e.g. from ensureUniquePrefix or USER.TMP.xxx.yyy).
 * @param qualifier - Optional last qualifier; if omitted, a new prefix is generated each retry and used with a generated qualifier.
 * @param maxRetries - Max retries (default 5).
 * @returns A DSN that does not exist on the system.
 */
/** Max prefix length such that prefix + "." + two qualifiers + "." + one qualifier still <= 44. */
const MAX_PREFIX_LENGTH_FOR_TWO_QUALIFIERS = 44 - 1 - 8 - 1 - 8 - 1 - 8; // 17

export async function ensureUniqueDsn(
  backend: ZosBackend,
  systemId: SystemId,
  prefix: string,
  qualifier?: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<string> {
  const basePrefix = prefix.trim().toUpperCase();
  if (basePrefix.length === 0) {
    throw new DsnError('Temp DSN prefix must not be empty');
  }
  const usePrefixAsIs = basePrefix.length > MAX_PREFIX_LENGTH_FOR_TWO_QUALIFIERS;
  for (let i = 0; i < maxRetries; i++) {
    const candidatePrefix = usePrefixAsIs ? basePrefix : generateTempDsnPrefix(basePrefix);
    const dsn =
      qualifier !== undefined && qualifier.length > 0
        ? `${candidatePrefix}.${qualifier.trim().toUpperCase()}`
        : usePrefixAsIs
          ? `${candidatePrefix}.${uniqueQualifier()}`
          : generateTempDsn(candidatePrefix);
    try {
      validateDsn(dsn);
    } catch {
      continue;
    }
    try {
      await backend.getAttributes(systemId, dsn);
      // exists — retry
    } catch {
      // "not found" or any error — treat as free (backend throws on not found)
      return dsn;
    }
  }
  throw new DsnError(
    `Could not find an unused temp DSN after ${maxRetries} attempts under ${basePrefix}`
  );
}

// ---------------------------------------------------------------------------
// Cleanup (delete all datasets under a prefix)
// ---------------------------------------------------------------------------

/**
 * Deletes all datasets whose names start with the given prefix (list with prefix.**, then delete each, deepest first).
 * Safety: requires at least 3 qualifiers and that one qualifier is ${REQUIRED_SAFETY_QUALIFIER}.
 *
 * @param backend - ZosBackend (mock or native).
 * @param systemId - Target z/OS system.
 * @param dsnPrefix - Fully qualified prefix (e.g. USER.TMP.A1B2C3D4.E5F6G7H8).
 * @param userId - Optional user ID for listDatasets.
 * @param progress - Optional callback called before each delete (e.g. for MCP progress).
 * @returns List of deleted DSNs.
 */
export async function deleteDatasetsUnderPrefix(
  backend: ZosBackend,
  systemId: SystemId,
  dsnPrefix: string,
  userId?: string,
  progress?: (message: string) => void
): Promise<{ deleted: string[] }> {
  const normalized = resolvePattern(dsnPrefix);
  const qualifiers = normalized.split('.').filter(q => q.length > 0);
  if (qualifiers.length < MIN_QUALIFIERS_FOR_DELETE_PREFIX) {
    throw new DsnError(
      `deleteDatasetsUnderPrefix requires a prefix with at least ${MIN_QUALIFIERS_FOR_DELETE_PREFIX} qualifiers (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}.XXXXXXXX) to avoid accidental mass deletion. Got: "${dsnPrefix}"`
    );
  }
  if (!qualifiers.some(q => q === REQUIRED_SAFETY_QUALIFIER)) {
    throw new DsnError(
      `deleteDatasetsUnderPrefix requires the prefix to contain the qualifier "${REQUIRED_SAFETY_QUALIFIER}" (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}.XXXXXXXX). Got: "${dsnPrefix}"`
    );
  }
  const pattern = `${normalized}.**`;
  validateListPattern(normalized);

  const list = await backend.listDatasets(systemId, pattern, undefined, userId, false);
  // Sort by number of qualifiers descending (deepest first)
  const sorted = [...list].sort((a, b) => {
    const aCount = a.dsn.split('.').length;
    const bCount = b.dsn.split('.').length;
    return bCount - aCount;
  });

  const deleted: string[] = [];
  for (const entry of sorted) {
    progress?.(`Deleting ${entry.dsn}`);
    await backend.deleteDataset(systemId, entry.dsn);
    deleted.push(entry.dsn);
  }
  return { deleted };
}
