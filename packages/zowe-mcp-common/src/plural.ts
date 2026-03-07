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
 * Returns the singular or plural form of a word based on count.
 * Use when the count is known so messages use correct grammar (e.g. "1 job" vs "2 jobs").
 *
 * @param count - The number of items.
 * @param singular - The singular form (e.g. "job", "job file").
 * @param pluralForm - Optional plural form; if omitted, appends "s" to singular.
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? singular + 's');
}
