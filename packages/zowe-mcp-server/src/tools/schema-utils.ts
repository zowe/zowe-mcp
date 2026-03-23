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
 * Shared schema helpers for tool input validation.
 * Used to accept case-insensitive enum values so agents can pass "pds", "fb", etc.
 */

import { z } from 'zod';

/**
 * Allowed dataset type values (tool input; maps to backend PS | PO | PO-E).
 */
const DATASET_TYPE_VALUES = ['PS', 'PO', 'PO-E', 'SEQUENTIAL', 'PDS', 'PDSE', 'LIBRARY'] as const;

/**
 * Case-insensitive schema for dataset type. Normalizes to uppercase and validates.
 */
export const datasetTypeSchema = z
  .string()
  .transform(s => s.trim().toUpperCase())
  .pipe(z.enum(DATASET_TYPE_VALUES));

/**
 * Allowed record format values (backend RecordFormat).
 */
const RECFM_VALUES = ['F', 'FB', 'V', 'VB', 'U', 'FBA', 'VBA'] as const;

/**
 * Case-insensitive schema for record format. Normalizes to uppercase and validates.
 */
export const recfmSchema = z
  .string()
  .transform(s => s.trim().toUpperCase())
  .pipe(z.enum(RECFM_VALUES));

/**
 * Build a case-insensitive enum schema from an array of allowed string literals.
 * Transforms input to lowercase before matching (for camelCase literals like cobolComment).
 *
 * @param allowed - Array of allowed values (e.g. ['asterisk', 'cobolComment']).
 * @returns Zod schema that accepts any case and normalizes to the first matching value.
 */
export function enumInsensitiveLower<T extends string>(allowed: readonly T[]) {
  const allowedArr = allowed as readonly string[];
  return z.string().transform((s): T => {
    const lower = s.trim().toLowerCase();
    const found = allowedArr.find(a => a.toLowerCase() === lower);
    if (found !== undefined) return found as T;
    throw new Error(`Must be one of: ${allowed.join(', ')} (case-insensitive)`);
  });
}
