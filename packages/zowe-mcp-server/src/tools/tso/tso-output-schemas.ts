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
 * MCP output schemas (Zod) for TSO tools.
 *
 * Used as outputSchema in registerTool so tools/list advertises the structure
 * and tool results can return validated structuredContent.
 * Reuses context/result metadata from dataset-output-schemas (same envelope shape).
 */

import { z } from 'zod';
import { baseContextSchema, readResultMetaSchema } from '../datasets/dataset-output-schemas.js';

// ---------------------------------------------------------------------------
// Envelope helper
// ---------------------------------------------------------------------------

function envelopeSchema<T extends z.ZodType>(
  dataSchema: T,
  resultSchema: z.ZodType,
  envelopeDescription: string
) {
  return z
    .object({
      _context: baseContextSchema,
      messages: z
        .array(z.string())
        .optional()
        .describe(
          'Operational messages: line-window hints (e.g. call again with startLine/lineCount). Omitted when empty.'
        ),
      data: dataSchema,
      _result: resultSchema.describe('Line-window metadata for TSO output.'),
    })
    .describe(envelopeDescription);
}

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

const runSafeTsoCommandDataSchema = z.object({
  lines: z
    .array(z.string())
    .describe('TSO command output (UTF-8) as array of lines; may be a line window.'),
  mimeType: z.string().describe('Content type (e.g. text/plain, text/x-jcl).'),
});

// ---------------------------------------------------------------------------
// Per-tool output schemas
// ---------------------------------------------------------------------------

export const runSafeTsoCommandOutputSchema = envelopeSchema(
  runSafeTsoCommandDataSchema,
  readResultMetaSchema,
  'TSO command output. data has lines and mimeType; _result has totalLines, startLine, returnedLines, hasMore. Can return tool execution error when command is blocked or requires confirmation.'
);
