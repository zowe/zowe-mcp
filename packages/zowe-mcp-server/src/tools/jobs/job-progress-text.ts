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
 * Compact MCP progress notification strings for job tools (not part of tool structured output).
 * Uses the same en dash as {@link ../progress.js} (`title – detail`).
 */

import { EN_DASH } from '../progress.js';

/**
 * Appends ` – {retcode}` when retcode is set; otherwise returns `base` unchanged.
 */
export function appendCompactRetcodeForProgress(
  base: string,
  retcode: string | undefined
): string {
  return retcode !== undefined ? `${base} ${EN_DASH} ${retcode}` : base;
}

/**
 * Final line for getJobStatus / submitJob (wait) progress completion.
 */
export function formatJobStatusProgressLine(status: {
  name: string;
  id: string;
  status: string;
  retcode?: string;
}): string {
  const base = `Job ${status.name} (${status.id}): ${status.status}`;
  return appendCompactRetcodeForProgress(base, status.retcode);
}
