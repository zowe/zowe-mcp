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
    const details = err.additionalDetails;
    if (typeof details === 'string' && details.trim().length > 0) {
      return details.trim();
    }
  }
  return undefined;
}

/**
 * Matches the SDK's `esmReturnCode`/`esmReasonCode` JSON keys (quoted, then a colon), so the
 * zowex prose "ESM rc: 8" in the same details is left alone.
 */
const ESM_CODE_KEY = /"esm(Return|Reason)Code"(\s*:)/g;

/**
 * Builds a user-facing error message that includes additionalDetails when available.
 *
 * SAF return codes in the details use the same vendor-neutral `productReturnCode`/
 * `productReasonCode` names as `CertActionResult.safReturnCodes` (#70). Only the returned text is
 * renamed; callers still classify errors on the raw SDK details.
 */
export function formatErrorWithDetails(message: string, details?: string): string {
  if (!details) return message;
  return `${message}\nDetails:\n${details.replace(ESM_CODE_KEY, '"product$1Code"$2')}`;
}
