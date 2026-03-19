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
 * Zod output schemas for local file upload/download tools.
 */

import { z } from 'zod';
import { baseContextSchema } from '../datasets/dataset-output-schemas.js';

const localFileContextSchema = baseContextSchema
  .extend({
    resolvedLocalPath: z.string().describe('Absolute local filesystem path written or read.'),
    rootUri: z.string().describe('file:// URI of the workspace root that contained the path.'),
    rootsSource: z
      .enum(['mcp', 'fallback'])
      .describe('Whether paths came from MCP roots/list or env/CLI fallback.'),
  })
  .describe('Context for local file transfer tools.');

const localFileTransferDataSchema = z.object({
  bytesWritten: z.number().optional().describe('Bytes written to local disk (UTF-8 encoding).'),
  bytesRead: z.number().optional().describe('Bytes read from local disk (UTF-8 encoding).'),
  etag: z.string().optional().describe('z/OS ETag after read or write when applicable.'),
});

export const downloadDatasetToFileOutputSchema = z.object({
  _context: localFileContextSchema,
  data: localFileTransferDataSchema.extend({
    dsn: z.string().describe('Fully qualified data set name.'),
    member: z.string().optional().describe('Member name when applicable.'),
  }),
});

export const uploadFileToDatasetOutputSchema = z.object({
  _context: localFileContextSchema,
  data: localFileTransferDataSchema.extend({
    dsn: z.string(),
    member: z.string().optional(),
  }),
});

export const downloadUssFileToFileOutputSchema = z.object({
  _context: localFileContextSchema,
  data: localFileTransferDataSchema.extend({
    ussPath: z.string().describe('Resolved USS path on z/OS.'),
  }),
});

export const uploadFileToUssFileOutputSchema = z.object({
  _context: localFileContextSchema,
  data: localFileTransferDataSchema.extend({
    ussPath: z.string(),
  }),
});

export const downloadJobFileToFileOutputSchema = z.object({
  _context: localFileContextSchema,
  data: localFileTransferDataSchema.extend({
    jobId: z.string(),
    jobFileId: z.number().int(),
  }),
});
