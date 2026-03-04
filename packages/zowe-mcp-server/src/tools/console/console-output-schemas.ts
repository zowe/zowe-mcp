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

import { z } from 'zod';
import {
  readResultMetaSchema,
  responseContextSchema,
} from '../datasets/dataset-output-schemas.js';

const consoleCommandDataSchema = z.object({
  lines: z.array(z.string()).describe('Console command output as array of lines.'),
  mimeType: z.string().describe('Content type (text/plain).'),
});

export const runConsoleCommandOutputSchema = z
  .object({
    _context: responseContextSchema,
    messages: z
      .array(z.string())
      .describe('Operational messages: pagination hints, resolution notes.'),
    data: consoleCommandDataSchema,
    _result: readResultMetaSchema.describe('Result metadata (line window).'),
  })
  .describe(
    'Output of a z/OS console command. data has lines and mimeType; _result has line metadata.'
  );
