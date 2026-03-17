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
 * Extracts `additionalDetails` from an SDK ImperativeError (or any error with that property).
 * Returns undefined when not present or empty.
 */
export function getAdditionalDetails(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'additionalDetails' in err) {
    const details = (err as { additionalDetails: unknown }).additionalDetails;
    if (typeof details === 'string' && details.trim().length > 0) {
      return details.trim();
    }
  }
  return undefined;
}

/**
 * Builds a user-facing error message that includes additionalDetails when available.
 */
export function formatErrorWithDetails(message: string, details?: string): string {
  if (!details) return message;
  return `${message}\nDetails:\n${details}`;
}
