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
 * MCP output schemas (Zod) for z/OS system information tools.
 *
 * Used as outputSchema in registerTool so tools/list advertises the structure
 * and tool results can return validated structuredContent.
 * Reuses the envelope context/result metadata from dataset-output-schemas.
 */

import { z } from 'zod';
import {
  baseContextSchema,
  listResultMetaSchema,
  readResultMetaSchema,
} from '../datasets/dataset-output-schemas.js';

// ---------------------------------------------------------------------------
// Envelope helper
// ---------------------------------------------------------------------------

function envelopeSchema<T extends z.ZodType>(
  dataSchema: T,
  resultSchema: z.ZodType,
  resultDescription: string,
  envelopeDescription: string
) {
  return z
    .object({
      _context: baseContextSchema,
      messages: z
        .array(z.string())
        .optional()
        .describe('Operational messages (e.g. pagination/line-window hints). Omitted when empty.'),
      data: dataSchema,
      _result: resultSchema.describe(resultDescription),
    })
    .describe(envelopeDescription);
}

// ---------------------------------------------------------------------------
// listApf
// ---------------------------------------------------------------------------

const apfDatasetSchema = z.object({
  dsname: z.string().describe('APF-authorized data set name.'),
  volume: z.string().describe('Volume serial (empty when SMS-managed / dynamic).'),
});

const listApfDataSchema = z.object({
  items: z.array(apfDatasetSchema).describe('APF-authorized data sets for this page.'),
});

export const listApfOutputSchema = envelopeSchema(
  listApfDataSchema,
  listResultMetaSchema,
  'Pagination metadata: count, totalAvailable, offset, hasMore.',
  'APF-authorized data set list. data.items has dsname and volume; _result has pagination metadata.'
);

// ---------------------------------------------------------------------------
// listProclib
// ---------------------------------------------------------------------------

const listProclibDataSchema = z.object({
  items: z
    .array(z.string())
    .describe('PROCLIB data set names (in concatenation order) for this page.'),
});

export const listProclibOutputSchema = envelopeSchema(
  listProclibDataSchema,
  listResultMetaSchema,
  'Pagination metadata: count, totalAvailable, offset, hasMore.',
  'PROCLIB concatenation list. data.items has data set names; _result has pagination metadata.'
);

// ---------------------------------------------------------------------------
// viewSyslog
// ---------------------------------------------------------------------------

const viewSyslogDataSchema = z.object({
  lines: z
    .array(z.string())
    .describe('SYSLOG text (UTF-8) as an array of lines; may be a line window.'),
  mimeType: z.string().describe('Content type (e.g. text/plain).'),
  startDate: z.string().optional().describe('Actual start date used for the read (yyyy-mm-dd).'),
  startTime: z.string().optional().describe('Actual start time used for the read (hh:mm:ss).'),
  endDate: z.string().optional().describe('Date of the last record returned (yyyy-mm-dd).'),
  endTime: z.string().optional().describe('Time of the last record returned (hh:mm:ss).'),
});

export const viewSyslogOutputSchema = envelopeSchema(
  viewSyslogDataSchema,
  readResultMetaSchema,
  'Line-window metadata: totalLines, startLine, returnedLines, hasMore.',
  'z/OS SYSLOG output. data has lines, mimeType, and the start/end window; _result has line-window metadata.'
);
