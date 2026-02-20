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
 * Build SuperC process-options (parms) string from natural search options.
 * Used for cache keys and for future ZNP tool.search; the listMembers+readDataset
 * runner interprets the same options where applicable.
 */

/** Comment types for doNotProcessComments (map to SuperC DP* options). */
export const SEARCH_COMMENT_TYPES = [
  'asterisk',
  'cobolComment',
  'fortran',
  'cpp',
  'pli',
  'pascal',
  'pcAssembly',
  'ada',
] as const;

export type SearchCommentType = (typeof SEARCH_COMMENT_TYPES)[number];

const COMMENT_TO_PARMS: Record<SearchCommentType, string> = {
  asterisk: 'DPACMT',
  cobolComment: 'DPCBCMT',
  fortran: 'DPFTCMT',
  cpp: 'DPCPCMT',
  pli: 'DPPLCMT',
  pascal: 'DPPSCMT',
  pcAssembly: 'DPMACMT',
  ada: 'DPADCMT',
};

export interface SearchOptionsInput {
  /** When false (default), add ANYC for case-insensitive search. */
  caseSensitive?: boolean;
  /** When true, add COBOL (ignore cols 1–6). */
  cobol?: boolean;
  /** When true (default), add SEQ; when false, add NOSEQ. */
  ignoreSequenceNumbers?: boolean;
  /** Comment types to exclude from search (each adds one SuperC option). */
  doNotProcessComments?: SearchCommentType[];
}

/**
 * Build a stable SuperC parms string from structured search options.
 * Order: ANYC, COBOL, SEQ/NOSEQ, then comment options (fixed order) for stable cache keys.
 */
export function buildParmsFromOptions(options: SearchOptionsInput = {}): string {
  const parts: string[] = [];

  if (options.caseSensitive !== true) {
    parts.push('ANYC');
  }
  if (options.cobol === true) {
    parts.push('COBOL');
  }
  if (options.ignoreSequenceNumbers !== false) {
    parts.push('SEQ');
  } else {
    parts.push('NOSEQ');
  }

  const commentTypes = options.doNotProcessComments ?? [];
  for (const t of SEARCH_COMMENT_TYPES) {
    if (commentTypes.includes(t)) {
      parts.push(COMMENT_TO_PARMS[t]);
    }
  }

  return parts.join(' ');
}
