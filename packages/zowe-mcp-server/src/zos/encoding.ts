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
 * Mainframe encoding options and resolution for dataset and USS operations.
 *
 * All data in the MCP server is UTF-8. The "mainframe encoding" is the EBCDIC
 * encoding used for conversion when reading from or writing to the mainframe.
 *
 * Encoding names are normalized so that IBM-N and IBM-NN are zero-padded to
 * IBM-NNN (e.g. IBM-37 → IBM-037) for compatibility with Zowe Remote SSH / zowex-sdk (ZNP).
 */

/** Default mainframe encoding for MVS datasets (e.g. IBM-037 for US EBCDIC). */
export const DEFAULT_MAINFRAME_MVS_ENCODING = 'IBM-037';

/** Default mainframe encoding for USS files (e.g. IBM-1047). */
export const DEFAULT_MAINFRAME_USS_ENCODING = 'IBM-1047';

/**
 * Normalize mainframe encoding for ZNP compatibility.
 * IBM-N or IBM-NN (1–2 digit code page) is zero-padded to IBM-NNN (e.g. IBM-37 → IBM-037).
 * Other values (e.g. IBM-1047, ISO8859-1) are returned unchanged.
 */
export function normalizeMainframeEncoding(encoding: string): string {
  const match = /^IBM-(\d+)$/i.exec(encoding.trim());
  if (!match) {
    return encoding;
  }
  const num = match[1];
  const padded = num.length <= 2 ? num.padStart(3, '0') : num;
  return `IBM-${padded}`;
}

/**
 * Server-level default encodings. Used when no per-system override and no
 * per-operation parameter is provided.
 */
export interface EncodingOptions {
  /** Default mainframe encoding for dataset read/write. */
  defaultMainframeMvsEncoding: string;
  /** Default mainframe encoding for USS file operations (reserved for future). */
  defaultMainframeUssEncoding: string;
}

/**
 * Resolve the mainframe encoding for a dataset operation.
 * Order: operation param → system override → server default.
 *
 * @param operationParam - Encoding passed to the tool (optional).
 * @param systemOverride - Per-system encoding from SystemContext (null/undefined = use server default).
 * @param serverDefault - Server default (e.g. defaultMainframeMvsEncoding).
 */
export function resolveDatasetEncoding(
  operationParam: string | undefined,
  systemOverride: string | null | undefined,
  serverDefault: string
): string {
  let chosen: string;
  if (operationParam !== undefined && operationParam !== '') {
    chosen = operationParam;
  } else if (systemOverride !== undefined && systemOverride !== null && systemOverride !== '') {
    chosen = systemOverride;
  } else {
    chosen = serverDefault;
  }
  return normalizeMainframeEncoding(chosen);
}
