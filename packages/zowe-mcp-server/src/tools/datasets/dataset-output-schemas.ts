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
 * MCP output schemas (Zod) for dataset tools.
 *
 * Used as outputSchema in registerTool so tools/list advertises the structure
 * and tool results can return validated structuredContent.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared: context and result metadata
// ---------------------------------------------------------------------------

/** Base context: only the system field. Used by jobs, TSO, and console tools. */
export const baseContextSchema = z
  .object({
    system: z.string().describe('Resolved z/OS system hostname (target of the operation).'),
  })
  .describe('Resolution context: target z/OS system.');

/** Dataset-scoped context with DSN/pattern resolution fields. */
export const datasetContextSchema = baseContextSchema
  .extend({
    resolvedPattern: z
      .string()
      .optional()
      .describe(
        'Normalized list pattern (uppercase, no quotes). Present only when input was quoted or lowercase.'
      ),
    resolvedDsn: z
      .string()
      .optional()
      .describe(
        'Normalized data set name (uppercase, no quotes). Present only when input was quoted or lowercase.'
      ),
    resolvedTargetDsn: z
      .string()
      .optional()
      .describe(
        'Normalized target data set name for copy/rename. Present only when input differed from resolved value.'
      ),
  })
  .describe('Resolution context: system and optional normalized data set names/patterns.');

/** USS-scoped context with path and directory resolution fields. */
export const ussContextSchema = baseContextSchema
  .extend({
    resolvedPath: z
      .string()
      .optional()
      .describe('Resolved USS path when normalization changed the input.'),
    currentDirectory: z
      .string()
      .optional()
      .describe('USS current working directory in display form.'),
    listedDirectory: z
      .string()
      .optional()
      .describe('USS directory that was listed (listUssFiles).'),
  })
  .describe('Resolution context: system and optional normalized USS paths.');

/**
 * @deprecated Use the scoped schemas instead: {@link baseContextSchema},
 * {@link datasetContextSchema}, or {@link ussContextSchema}.
 */
export const responseContextSchema = baseContextSchema
  .extend({
    resolvedPattern: z
      .string()
      .optional()
      .describe(
        'Normalized list pattern (uppercase, no quotes). Present only when input was quoted or lowercase.'
      ),
    resolvedDsn: z
      .string()
      .optional()
      .describe(
        'Normalized data set name (uppercase, no quotes). Present only when input was quoted or lowercase.'
      ),
    resolvedTargetDsn: z
      .string()
      .optional()
      .describe(
        'Normalized target data set name for copy/rename. Present only when input differed from resolved value.'
      ),
    resolvedPath: z
      .string()
      .optional()
      .describe('Resolved USS path when normalization changed the input (USS tools).'),
    currentDirectory: z
      .string()
      .optional()
      .describe('USS current working directory in display form (USS list tools).'),
    listedDirectory: z
      .string()
      .optional()
      .describe('USS directory that was listed (listUssFiles).'),
  })
  .describe('Resolution context: system and optional normalized names/paths.');

export const listResultMetaSchema = z
  .object({
    count: z.number().describe('Number of items returned in this page.'),
    totalAvailable: z.number().describe('Total matching items before pagination.'),
    offset: z.number().describe('0-based offset of the first item in this page.'),
    hasMore: z
      .boolean()
      .describe(
        'True if more items exist. Call the tool again with offset = offset + count and the same limit to fetch the next page.'
      ),
  })
  .describe('Pagination metadata for list operations.');

export const readResultMetaSchema = z
  .object({
    totalLines: z.number().describe('Total number of lines in the full content.'),
    startLine: z
      .number()
      .describe('1-based line number of the first line returned in this window.'),
    returnedLines: z.number().describe('Number of lines in the returned window.'),
    contentLength: z.number().describe('Character count of the returned text.'),
    mimeType: z
      .string()
      .describe(
        'Inferred content type (e.g. text/plain, text/x-cobol, text/x-jcl). Used for display or syntax highlighting.'
      ),
    hasMore: z
      .boolean()
      .describe(
        'True if more lines exist. Call the tool again with startLine and lineCount to fetch the next window.'
      ),
  })
  .describe('Line-window metadata for read operations.');

export const searchResultMetaSchema = z
  .object({
    count: z.number().describe('Number of members returned in this page.'),
    totalAvailable: z.number().describe('Total members with matches (before pagination).'),
    offset: z.number().describe('0-based offset of the first member in this page.'),
    hasMore: z
      .boolean()
      .describe(
        'True if more members exist. Call again with offset and limit to fetch the next page.'
      ),
    linesFound: z
      .number()
      .describe('Total lines that matched the search string across all members.'),
    linesProcessed: z.number().describe('Total lines read across all members during the search.'),
    membersWithLines: z
      .number()
      .describe('Number of members that had at least one matching line.'),
    membersWithoutLines: z
      .number()
      .describe('Number of members with no matches (PDS or PDS/E only).'),
    searchPattern: z.string().describe('The literal search string that was used.'),
    processOptions: z
      .string()
      .describe(
        'SuperC process options applied (e.g. ANYC for case-insensitive, COBOL for column 7–72).'
      ),
  })
  .describe('Search pagination and summary counts.');

export const mutationResultMetaSchema = z
  .object({
    success: z.boolean().describe('True when the operation completed successfully.'),
  })
  .describe('Result of a mutation (write, create, delete, copy, rename).');

// ---------------------------------------------------------------------------
// Data shapes per tool
// ---------------------------------------------------------------------------

const datasetListEntrySchema = z.object({
  dsn: z.string().describe('Fully qualified data set name (uppercase, no quotes).'),
  resourceLink: z
    .string()
    .optional()
    .describe(
      'Resource URI (zos-ds://system/dsn) for this data set. Only present at detail level full.'
    ),
  dsorg: z
    .string()
    .optional()
    .describe(
      'Data set organization: PS (sequential), PO (PDS), PO-E (PDS/E), VS, DA. Present at all detail levels.'
    ),
  recfm: z.string().optional().describe('Record format: F, FB, V, VB, U, FBA, VBA.'),
  lrecl: z.number().optional().describe('Logical record length in bytes.'),
  blksz: z.number().optional().describe('Block size in bytes.'),
  volser: z
    .string()
    .optional()
    .describe(
      'Volume serial where the data set resides. Omitted for VSAM data sets (use dsorg VS to identify VSAM).'
    ),
  creationDate: z.string().optional().describe('Creation date (YYYY-MM-DD).'),
  referenceDate: z.string().optional().describe('Last referenced date (YYYY-MM-DD).'),
  expirationDate: z.string().optional().describe('Expiration date (YYYY-MM-DD).'),
  multivolume: z.boolean().optional().describe('True if data set spans multiple volumes.'),
  migrated: z.boolean().optional().describe('True if data set is migrated (HSM).'),
  encrypted: z.boolean().optional().describe('True if data set is encrypted.'),
  dsntype: z.string().optional().describe('Data set name type (e.g. PDS, LIBRARY).'),
  dataclass: z.string().optional().describe('SMS data class.'),
  mgmtclass: z.string().optional().describe('SMS management class.'),
  storclass: z.string().optional().describe('SMS storage class.'),
  spaceUnits: z.string().optional().describe('Space unit type (TRACKS, CYLINDERS, etc.).'),
  usedPercent: z.number().optional().describe('Used space percentage.'),
  usedExtents: z.number().optional().describe('Used extents count.'),
  primary: z.number().optional().describe('Primary allocation units.'),
  secondary: z.number().optional().describe('Secondary allocation units.'),
  devtype: z.string().optional().describe('Device type.'),
  volsers: z.array(z.string()).optional().describe('Multi-volume serial list.'),
});

const memberEntrySchema = z.object({
  member: z.string().describe('PDS or PDS/E member name (up to 8 characters, uppercase).'),
});

const readDatasetDataSchema = z.object({
  lines: z
    .array(z.string())
    .describe(
      'Content as array of lines (UTF-8). When _result.hasMore is true, call again with startLine/lineCount to get more.'
    ),
  etag: z
    .string()
    .describe(
      'Opaque version token. Pass to writeDataset for optimistic locking so the write fails if the data set changed since the read.'
    ),
  encoding: z
    .string()
    .describe('Mainframe (EBCDIC) encoding used to convert to UTF-8 (e.g. IBM-037, IBM-1047).'),
});

const searchMatchSchema = z.object({
  lineNumber: z.number().describe('1-based line number where the match was found.'),
  content: z
    .string()
    .describe('The full line content (UTF-8); unprintable characters may be replaced with a dot.'),
  beforeContext: z
    .array(z.string())
    .optional()
    .describe(
      'Lines before the match (up to 6). Present only when includeContextLines is true and the Zowe Remote SSH (zowex) backend is used with LPSF.'
    ),
  afterContext: z
    .array(z.string())
    .optional()
    .describe(
      'Lines after the match (up to 6). Present only when includeContextLines is true and the Zowe Remote SSH (zowex) backend is used with LPSF.'
    ),
});

const searchMemberSchema = z.object({
  name: z.string().describe('Member name (or synthetic name for a sequential data set).'),
  matches: z
    .array(searchMatchSchema)
    .describe('Matching lines in this member with line numbers and content.'),
});

const searchSummarySchema = z.object({
  linesFound: z.number().describe('Total lines that matched the search string.'),
  linesProcessed: z.number().describe('Total lines read across all members.'),
  membersWithLines: z.number().describe('Number of members with at least one match.'),
  membersWithoutLines: z
    .number()
    .describe('Number of members with no matches (PDS or PDS/E only).'),
  searchPattern: z.string().describe('The literal search string used.'),
  processOptions: z.string().describe('SuperC process options (e.g. ANYC, COBOL).'),
});

const searchDataSchema = z.object({
  dataset: z.string().describe('Fully qualified data set name that was searched.'),
  members: z.array(searchMemberSchema).describe('Members in this page with their matching lines.'),
  summary: searchSummarySchema.describe('Aggregate counts and options for the search.'),
});

const getDatasetAttributesDataSchema = z.object({
  dsn: z.string().describe('Fully qualified data set name.'),
  type: z.string().describe('Data set organization (DSORG): PS, PO, PO-E, VS, DA.'),
  recfm: z.string().optional().describe('Record format (F, FB, V, VB, U, etc.).'),
  lrecl: z.number().optional().describe('Logical record length.'),
  blksz: z.number().optional().describe('Block size.'),
  volser: z.string().optional().describe('Volume serial.'),
  creationDate: z.string().optional().describe('Creation date (YYYY-MM-DD).'),
  referenceDate: z.string().optional().describe('Last reference date (YYYY-MM-DD).'),
  expirationDate: z.string().optional().describe('Expiration date (YYYY-MM-DD).'),
  smsClass: z.string().optional().describe('SMS storage/management class (when SMS managed).'),
  usedTracks: z.number().optional().describe('Number of tracks used.'),
  usedExtents: z.number().optional().describe('Number of extents used.'),
  multivolume: z.boolean().optional().describe('True if data set spans multiple volumes.'),
  migrated: z.boolean().optional().describe('True if data set is migrated (HSM).'),
  encrypted: z.boolean().optional().describe('True if data set is encrypted.'),
  dsntype: z.string().optional().describe('Data set name type (e.g. PDS, LIBRARY).'),
  dataclass: z.string().optional().describe('SMS data class.'),
  mgmtclass: z.string().optional().describe('SMS management class.'),
  storclass: z.string().optional().describe('SMS storage class.'),
  spaceUnits: z.string().optional().describe('Space unit type (TRACKS, CYLINDERS, etc.).'),
  usedPercent: z.number().optional().describe('Used space percentage.'),
  primary: z.number().optional().describe('Primary allocation units.'),
  secondary: z.number().optional().describe('Secondary allocation units.'),
  devtype: z.string().optional().describe('Device type.'),
  volsers: z.array(z.string()).optional().describe('Multi-volume serial list.'),
});

const writeDatasetDataSchema = z.object({
  etag: z
    .string()
    .describe(
      'New ETag after the write. Use this for a subsequent read or write to detect concurrent changes.'
    ),
});

const createDatasetDataSchema = z.object({
  dsn: z.string().describe('Fully qualified name of the created data set.'),
  type: z.string().describe('Data set type created: PS (sequential), PO (PDS), PO-E (PDS/E).'),
  allocation: z
    .object({
      applied: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Attributes actually applied (dsorg, recfm, lrecl, blksz, volser, etc.); may differ from request due to defaults or SMS.'
        ),
      messages: z
        .array(z.string())
        .optional()
        .describe('Messages from allocation (defaults used, SMS decisions).'),
    })
    .optional()
    .describe('Allocation result when the backend returns it.'),
});

const deleteDatasetDataSchema = z.object({
  deletedDsn: z
    .string()
    .describe(
      'Fully qualified name of the deleted data set or member (e.g. USER.PDS(MEM) for a member).'
    ),
});

const copyDatasetDataSchema = z.object({
  sourceDsn: z.string().describe('Fully qualified source data set (or member) that was copied.'),
  targetDsn: z.string().describe('Fully qualified target data set (or member) after the copy.'),
});

const restoreDatasetDataSchema = z.object({
  dsn: z.string().describe('Fully qualified data set name that was restored (recalled).'),
});

const renameDatasetDataSchema = z.object({
  oldName: z.string().describe('Fully qualified name before the rename (data set or member).'),
  newName: z.string().describe('Fully qualified name after the rename.'),
});

const tempPrefixDataSchema = z.object({
  tempDsnPrefix: z
    .string()
    .describe(
      'Unique HLQ prefix under which to create temporary data sets (e.g. USER.TMP.XXXXXXXX.YYYYYYYY). Verified not to exist on the system.'
    ),
});

const tempDsnDataSchema = z.object({
  tempDsn: z
    .string()
    .describe(
      'Unique full temporary data set name. Verified not to exist on the system; use for a single createDataset call.'
    ),
});

const deleteDatasetsUnderPrefixDataSchema = z.object({
  deleted: z
    .array(z.string())
    .describe('List of fully qualified data set names that were deleted.'),
  count: z.number().describe('Number of data sets deleted.'),
});

// ---------------------------------------------------------------------------
// Envelope helpers: _context, messages, data, optional _result
// ---------------------------------------------------------------------------

function envelopeSchema<T extends z.ZodType>(
  dataSchema: T,
  resultSchema?: z.ZodType,
  envelopeDescription?: string
) {
  const base = z
    .object({
      _context: datasetContextSchema,
      messages: z
        .array(z.string())
        .optional()
        .describe(
          'Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty.'
        ),
      data: dataSchema,
    })
    .describe(
      envelopeDescription ?? 'Tool response envelope: context, optional messages, and payload.'
    );
  if (resultSchema) {
    return base.extend({
      _result: resultSchema.describe('Result metadata (pagination, line window, or success).'),
    });
  }
  return base;
}

// ---------------------------------------------------------------------------
// Per-tool output schemas (for registerTool outputSchema)
// ---------------------------------------------------------------------------

export const listDatasetsOutputSchema = envelopeSchema(
  z
    .array(datasetListEntrySchema)
    .describe(
      'Array of data set entries. Fields depend on detail: minimal (dsn, dsorg, dsntype; migrated/encrypted only when true; volser for non-SMS), basic (adds recfm, lrecl, blksz, space; volser for non-SMS, no volsers), full (all attributes including resourceLink, dates, SMS classes).'
    ),
  listResultMetaSchema,
  'Paginated list of data sets matching a pattern. data[] has one entry per data set; _result has count, offset, hasMore. Fields depend on the detail parameter.'
);

export const listMembersOutputSchema = envelopeSchema(
  z
    .array(memberEntrySchema)
    .describe(
      'Array of PDS or PDS/E member entries. Each entry has the member name (up to 8 characters, uppercase).'
    ),
  listResultMetaSchema,
  'Paginated list of PDS or PDS/E members. data[] has one entry per member; _result has count, offset, hasMore.'
);

export const searchInDatasetOutputSchema = envelopeSchema(
  searchDataSchema,
  searchResultMetaSchema,
  'Search results: data.dataset is the DSN searched, data.members are members (in this page) with matching lines, data.summary has counts; _result has pagination.'
);

export const readDatasetOutputSchema = envelopeSchema(
  readDatasetDataSchema,
  readResultMetaSchema,
  'Content of a data set or member. data has lines (array of UTF-8 lines), etag, encoding; _result has totalLines, startLine, returnedLines, hasMore for line windowing.'
);

export const getDatasetAttributesOutputSchema = envelopeSchema(
  getDatasetAttributesDataSchema,
  undefined,
  'Attributes of a single data set (no _result). data has dsn, type, recfm, lrecl, blksz, volser, and optional dates/SMS fields.'
);

export const writeDatasetOutputSchema = envelopeSchema(
  writeDatasetDataSchema,
  mutationResultMetaSchema,
  'Result of a write. data.etag is the new version token; _result.success is true.'
);

export const createDatasetOutputSchema = envelopeSchema(
  createDatasetDataSchema,
  mutationResultMetaSchema,
  'Result of creating a data set. data has dsn, type, and optional allocation (applied attributes and messages).'
);

export const createTempDatasetOutputSchema = envelopeSchema(
  createDatasetDataSchema,
  mutationResultMetaSchema,
  'Result of creating a temporary data set; same shape as createDataset.'
);

export const deleteDatasetOutputSchema = envelopeSchema(
  deleteDatasetDataSchema,
  mutationResultMetaSchema,
  'Result of deleting a data set or member. data.deletedDsn is the name that was deleted.'
);

export const deleteDatasetsUnderPrefixOutputSchema = envelopeSchema(
  deleteDatasetsUnderPrefixDataSchema,
  mutationResultMetaSchema,
  'Result of deleting all data sets under a prefix. data.deleted is the list of deleted DSNs; data.count is how many.'
);

export const copyDatasetOutputSchema = envelopeSchema(
  copyDatasetDataSchema,
  mutationResultMetaSchema,
  'Result of copying a data set or member. data has sourceDsn and targetDsn.'
);

export const restoreDatasetOutputSchema = envelopeSchema(
  restoreDatasetDataSchema,
  mutationResultMetaSchema,
  'Result of restoring (recalling) a migrated data set. data.dsn is the recalled data set name.'
);

export const renameDatasetOutputSchema = envelopeSchema(
  renameDatasetDataSchema,
  mutationResultMetaSchema,
  'Result of renaming a data set or member. data has oldName and newName.'
);

export const getTempDatasetPrefixOutputSchema = envelopeSchema(
  tempPrefixDataSchema,
  mutationResultMetaSchema,
  'Temporary data set prefix (HLQ) for the active system. Use as parent for createDataset under that prefix.'
);

export const getTempDatasetNameOutputSchema = envelopeSchema(
  tempDsnDataSchema,
  mutationResultMetaSchema,
  'Unique full temporary data set name. Use for a single createDataset call.'
);
