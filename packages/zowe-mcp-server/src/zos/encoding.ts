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
 */

/** Default mainframe encoding for MVS datasets (e.g. IBM-37 for US EBCDIC). */
export const DEFAULT_MAINFRAME_MVS_ENCODING = 'IBM-37';

/** Default mainframe encoding for USS files (e.g. IBM-1047). */
export const DEFAULT_MAINFRAME_USS_ENCODING = 'IBM-1047';

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
  if (operationParam !== undefined && operationParam !== '') {
    return operationParam;
  }
  if (systemOverride !== undefined && systemOverride !== null && systemOverride !== '') {
    return systemOverride;
  }
  return serverDefault;
}
