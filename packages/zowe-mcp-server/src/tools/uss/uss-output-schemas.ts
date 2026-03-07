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
 * MCP output schemas (Zod) for USS tools.
 *
 * Used as outputSchema in registerTool so tools/list advertises the structure
 * and tool results can return validated structuredContent.
 * Reuses context/result metadata from dataset-output-schemas (same envelope shape).
 */

import { z } from 'zod';
import {
  listResultMetaSchema,
  mutationResultMetaSchema,
  readResultMetaSchema,
  responseContextSchema,
} from '../datasets/dataset-output-schemas.js';

// ---------------------------------------------------------------------------
// Envelope helper
// ---------------------------------------------------------------------------

function envelopeSchema<T extends z.ZodType>(
  dataSchema: T,
  resultSchema?: z.ZodType,
  envelopeDescription?: string
) {
  const base = z
    .object({
      _context: responseContextSchema,
      messages: z
        .array(z.string())
        .optional()
        .describe(
          'Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.'
        ),
      data: dataSchema,
    })
    .describe(
      envelopeDescription ?? 'USS tool response envelope: context, messages, and payload.'
    );
  if (resultSchema) {
    return base.extend({
      _result: resultSchema.describe('Result metadata (pagination, line window, or success).'),
    });
  }
  return base;
}

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

const ussPathDataSchema = z.object({
  path: z.string().describe('USS path (absolute or relative to cwd in display form).'),
});

const ussListEntrySchema = z.object({
  name: z.string().describe('File or directory name.'),
  path: z
    .string()
    .describe(
      'Path in display form: relative if under current working directory, otherwise absolute.'
    ),
  links: z.number().optional().describe('Number of links (long format).'),
  user: z.string().optional().describe('Owner user (long format).'),
  group: z.string().optional().describe('Owner group (long format).'),
  size: z.number().optional().describe('Size in bytes, files only (long format).'),
  filetag: z.string().optional().describe('z/OS file tag / encoding (long format).'),
  mtime: z
    .string()
    .optional()
    .describe('Modification time, ISO 8601 or platform string (long format).'),
  mode: z.string().optional().describe('Permission string, e.g. drwxr-xr-x (long format).'),
  isDirectory: z.boolean().optional().describe('True if this entry is a directory (long format).'),
});

const readUssFileDataSchema = z.object({
  lines: z
    .array(z.string())
    .describe('File content as UTF-8 array of lines; may be a line window.'),
  etag: z.string().describe('Opaque version token for optimistic locking on write.'),
  mimeType: z.string().describe('Inferred content type (e.g. text/plain, text/x-cobol).'),
});

const runSafeUssCommandDataSchema = z.object({
  lines: z.array(z.string()).describe('Command stdout (UTF-8) as array of lines.'),
  mimeType: z.string().describe('Content type (e.g. text/plain).'),
});

const writeUssFileDataSchema = z.object({
  etag: z.string().describe('New ETag after the write.'),
  created: z.boolean().optional().describe('True if the file was created (did not exist before).'),
});

const copyUssFileDataSchema = z.object({
  sourcePath: z.string().describe('Source USS path (display form).'),
  targetPath: z.string().describe('Destination USS path (display form).'),
});

const deleteUssFileDataSchema = z.object({
  deleted: z.string().describe('Path of the deleted file or directory (display form).'),
});

const deleteUssTempUnderDirDataSchema = z.object({
  deleted: z.array(z.string()).describe('List of deleted paths (display form).'),
});

// ---------------------------------------------------------------------------
// Per-tool output schemas
// ---------------------------------------------------------------------------

export const getUssHomeOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'USS home directory path for the active system/user. data.path is the home path.'
);

export const changeUssDirectoryOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Result of changing the USS current working directory. data.path is the new cwd.'
);

export const listUssFilesOutputSchema = envelopeSchema(
  z
    .array(ussListEntrySchema)
    .describe(
      'Array of USS directory entries. Each entry has name, path, and optional long-format fields (links, user, group, size, filetag, mtime, mode, isDirectory).'
    ),
  listResultMetaSchema,
  'Paginated list of USS directory entries. data[] has name and path; _context has currentDirectory and listedDirectory; _result has count, offset, hasMore.'
);

export const readUssFileOutputSchema = envelopeSchema(
  readUssFileDataSchema,
  readResultMetaSchema,
  'Content of a USS file. data has lines, etag, mimeType; _result has line-window metadata (totalLines, startLine, hasMore).'
);

export const runSafeUssCommandOutputSchema = envelopeSchema(
  runSafeUssCommandDataSchema,
  readResultMetaSchema,
  'Output of a safe USS command. data has lines and mimeType; _result has line metadata. Can return error when command is blocked or requires confirmation.'
);

export const writeUssFileOutputSchema = envelopeSchema(
  writeUssFileDataSchema,
  mutationResultMetaSchema,
  'Result of writing a USS file. data has etag and optional created; _result.success is true.'
);

export const createUssFileOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Result of creating a USS file or directory. data.path is the created path.'
);

export const copyUssFileOutputSchema = envelopeSchema(
  copyUssFileDataSchema,
  mutationResultMetaSchema,
  'Result of copying a USS file or directory. data has sourcePath and targetPath.'
);

export const deleteUssFileOutputSchema = envelopeSchema(
  deleteUssFileDataSchema,
  mutationResultMetaSchema,
  'Result of deleting a USS file or directory. data.deleted is the deleted path.'
);

export const chmodUssFileOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Result of changing USS file permissions. data.path is the file path.'
);

export const chownUssFileOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Result of changing USS file owner. data.path is the file path.'
);

export const chtagUssFileOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Result of setting the z/OS file tag (encoding/type). data.path is the file path.'
);

export const getUssTempDirOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Path of a newly created USS temporary directory. data.path is the temp dir path.'
);

export const getUssTempPathOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Path of a unique temporary file or directory under the given dir. data.path is the path.'
);

export const createTempUssDirOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Result of creating a temporary USS directory. data.path is the created path.'
);

export const createTempUssFileOutputSchema = envelopeSchema(
  ussPathDataSchema,
  mutationResultMetaSchema,
  'Result of creating an empty temporary USS file. data.path is the created path.'
);

export const deleteUssTempUnderDirOutputSchema = envelopeSchema(
  deleteUssTempUnderDirDataSchema,
  mutationResultMetaSchema,
  'Result of deleting contents under a temp dir. data.deleted is the list of deleted paths. Can return error when path does not contain "tmp" or has too few segments.'
);
