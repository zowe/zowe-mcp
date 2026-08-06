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
  listResultMetaSchema,
  readResultMetaSchema,
  sharedEnvelopeSchema,
} from '../datasets/dataset-output-schemas.js';

// ---------------------------------------------------------------------------
// Envelope helper (delegates to the shared shape so families cannot diverge)
// ---------------------------------------------------------------------------

function envelopeSchema<T extends z.ZodType>(
  dataSchema: T,
  resultSchema: z.ZodType,
  resultDescription: string,
  envelopeDescription: string
) {
  return sharedEnvelopeSchema(dataSchema, {
    resultSchema,
    resultDescription,
    description: envelopeDescription,
    messagesDescription:
      'Operational messages (e.g. pagination/line-window hints). Omitted when empty.',
  });
}

// ---------------------------------------------------------------------------
// listApf
// ---------------------------------------------------------------------------

const apfDatasetSchema = z.object({
  dsn: z.string().describe('APF-authorized data set name.'),
  volser: z.string().describe('Volume serial (empty when SMS-managed / dynamic).'),
});

export const listApfLibrariesOutputSchema = envelopeSchema(
  z.array(apfDatasetSchema).describe('APF-authorized data sets for this page.'),
  listResultMetaSchema,
  'Pagination metadata: count, totalAvailable, offset, hasMore.',
  'APF-authorized library list. data[] has one entry per data set (dsn, volser); _result has pagination metadata.'
);

// ---------------------------------------------------------------------------
// listProclib
// ---------------------------------------------------------------------------

const proclibDatasetSchema = z.object({
  dsn: z.string().describe('PROCLIB data set name.'),
});

export const listProclibOutputSchema = envelopeSchema(
  z
    .array(proclibDatasetSchema)
    .describe('PROCLIB data sets (in concatenation order) for this page.'),
  listResultMetaSchema,
  'Pagination metadata: count, totalAvailable, offset, hasMore.',
  'PROCLIB concatenation list. data[] has one entry per data set (dsn); _result has pagination metadata.'
);

// ---------------------------------------------------------------------------
// listLinklist
// ---------------------------------------------------------------------------

const linklistDatasetSchema = z.object({
  dsn: z.string().describe('Link list data set name.'),
  volser: z.string().describe('Volume serial (empty when SMS-managed / dynamic).'),
  apfAuthorized: z.boolean().describe('Whether the data set is APF-authorized.'),
});

export const listLinklistOutputSchema = envelopeSchema(
  z
    .array(linklistDatasetSchema)
    .describe('Link list (LNKLST) data sets (in concatenation order) for this page.'),
  listResultMetaSchema,
  'Pagination metadata: count, totalAvailable, offset, hasMore.',
  'Link list concatenation list. data[] has one entry per data set (dsn, volser, apfAuthorized); _result has pagination metadata.'
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
