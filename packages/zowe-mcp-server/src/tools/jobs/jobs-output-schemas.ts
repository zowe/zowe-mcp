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
 * MCP output schemas (Zod) for job tools.
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
        .describe('Operational messages: pagination hints, job card notice, or other notes.'),
      data: dataSchema,
    })
    .describe(
      envelopeDescription ?? 'Job tool response envelope: context, messages, and payload.'
    );
  if (resultSchema) {
    return base.extend({
      _result: resultSchema.describe('Result metadata (pagination or success).'),
    });
  }
  return base;
}

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

const submitJobBaseDataSchema = z.object({
  jobId: z.string().describe('Job ID assigned by JES (e.g. JOB00123).'),
  jobName: z.string().describe('Job name from the JOB statement.'),
  jobCardAddedLines: z
    .array(z.string())
    .optional()
    .describe('Job card lines that were prepended when JCL had no job card.'),
});

const jobStatusResultSchema = z.object({
  id: z.string().describe('Job ID.'),
  name: z.string().describe('Job name.'),
  owner: z.string().describe('Job owner.'),
  status: z.string().describe('Status: INPUT, ACTIVE, or OUTPUT.'),
  type: z.string().describe('Job type: JOB, STC, TSU.'),
  class: z.string().describe('Execution class.'),
  retcode: z.string().optional().describe('Return code when complete (e.g. 0000).'),
  subsystem: z.string().optional().describe('Subsystem.'),
  phase: z.number().describe('Phase number.'),
  phaseName: z.string().describe('Phase name.'),
  correlator: z.string().optional().describe('Correlator (JES3).'),
});

const failedStepJobFilesSchema = z
  .array(
    z.object({
      id: z.number(),
      ddname: z.string().optional(),
      stepname: z.string().optional(),
      dsname: z.string().optional(),
      procstep: z.string().optional(),
    })
  )
  .optional()
  .describe('Job file entries for failed steps when retcode is non-zero.');

const submitJobDataSchema = submitJobBaseDataSchema.merge(
  jobStatusResultSchema.partial().extend({
    timedOut: z
      .boolean()
      .optional()
      .describe('True if wait for OUTPUT timed out; job continues on z/OS.'),
    failedStepJobFiles: failedStepJobFilesSchema,
  })
);

const jobFileEntrySchema = z.object({
  id: z.number().describe('Job file (spool) ID.'),
  ddname: z.string().optional().describe('DD name (e.g. SYSOUT, JESJCL).'),
  stepname: z.string().optional().describe('Step name.'),
  dsname: z.string().optional().describe('Data set name when applicable.'),
  procstep: z.string().optional().describe('Procedure step name.'),
});

const readJobFileDataSchema = z.object({
  lines: z
    .array(z.string())
    .describe(
      'File content as array of lines; may be a line window when _result.hasMore is true.'
    ),
  totalLines: z.number().describe('Total lines in the full file.'),
  startLine: z.number().describe('1-based first line in this window.'),
  returnedLines: z.number().describe('Number of lines returned.'),
  hasMore: z.boolean().describe('True if more lines exist.'),
  mimeType: z.string().describe('Content type (e.g. text/plain, text/x-jcl).'),
});

const getJobOutputFileEntrySchema = z.object({
  jobFileId: z.number().describe('Job file (spool) ID.'),
  ddname: z.string().optional().describe('DD name.'),
  stepname: z.string().optional().describe('Step name.'),
  lines: z.array(z.string()).describe('Full content of this job file as array of lines.'),
  lineCount: z.number().describe('Number of lines.'),
});

const getJobOutputDataSchema = z.object({
  jobId: z.string().describe('Job ID.'),
  status: z.string().describe('Job status (e.g. OUTPUT).'),
  retcode: z.string().optional().describe('Job return code when complete.'),
  files: z.array(getJobOutputFileEntrySchema).describe('Output from job files in this page.'),
});

const searchJobOutputMatchSchema = z.object({
  jobFileId: z.number().describe('Job file (spool) ID where the match was found.'),
  ddname: z.string().optional().describe('DD name.'),
  stepname: z.string().optional().describe('Step name.'),
  lineNumber: z.number().describe('1-based line number.'),
  lineText: z.string().describe('The line content.'),
});

const getJclDataSchema = z.object({
  lines: z.array(z.string()).describe('JCL for the job as array of lines.'),
});

const jobControlDataSchema = z.object({
  success: z.literal(true).describe('Operation completed successfully.'),
});

const submitJobFromSourceDataSchema = z.object({
  jobId: z.string().describe('Job ID assigned by JES.'),
  jobName: z.string().describe('Job name from the JOB statement.'),
});

/** Submit-from-source (dataset/USS) result; when wait=true also has status, timedOut, failedStepJobFiles. */
const submitJobFromSourceWithWaitDataSchema = submitJobFromSourceDataSchema.merge(
  jobStatusResultSchema.partial().extend({
    timedOut: z
      .boolean()
      .optional()
      .describe('True if wait for OUTPUT timed out; job continues on z/OS.'),
    failedStepJobFiles: failedStepJobFilesSchema,
  })
);

// ---------------------------------------------------------------------------
// Per-tool output schemas
// ---------------------------------------------------------------------------

export const submitJobOutputSchema = envelopeSchema(
  submitJobDataSchema,
  mutationResultMetaSchema,
  'Result of submitting JCL. data has jobId, jobName, optional jobCardAddedLines; when wait=true also has status, timedOut, failedStepJobFiles; _result.success is true.'
);

export const getJobStatusOutputSchema = envelopeSchema(
  jobStatusResultSchema,
  undefined,
  'Job status. data has id, name, owner, status, type, class, retcode (when complete), phase, phaseName.'
);

export const listJobFilesOutputSchema = envelopeSchema(
  z
    .array(jobFileEntrySchema)
    .describe(
      'Array of job file (spool) entries. Each entry has id, optional ddname, stepname, dsname, procstep.'
    ),
  listResultMetaSchema,
  'Paginated list of job output files (spools). data[] has id, ddname, stepname; _result has count, offset, hasMore.'
);

export const readJobFileOutputSchema = envelopeSchema(
  readJobFileDataSchema,
  readResultMetaSchema,
  'Content of one job file. data has lines, totalLines, startLine, returnedLines, hasMore, mimeType; _result has line-window metadata.'
);

export const getJobOutputOutputSchema = envelopeSchema(
  getJobOutputDataSchema,
  listResultMetaSchema,
  'Aggregated output from job files. data has jobId, status, retcode, files[]; _result has pagination.'
);

export const searchJobOutputOutputSchema = envelopeSchema(
  z
    .array(searchJobOutputMatchSchema)
    .describe(
      'Array of search matches in job output. Each entry has jobFileId, ddname, stepname, lineNumber, lineText.'
    ),
  listResultMetaSchema,
  'Search matches in job output. data[] has jobFileId, ddname, stepname, lineNumber, lineText; _result has count, offset, hasMore.'
);

export const listJobsOutputSchema = envelopeSchema(
  z
    .array(jobStatusResultSchema)
    .describe(
      'Array of job status entries. Each entry has id, name, owner, status, type, class, retcode, phase, phaseName.'
    ),
  listResultMetaSchema,
  'Paginated list of jobs. data[] has job status fields; _result has count, offset, hasMore.'
);

export const getJclOutputSchema = envelopeSchema(
  getJclDataSchema,
  undefined,
  'JCL for a job. data.lines is the full JCL as array of lines.'
);

export const cancelJobOutputSchema = envelopeSchema(
  jobControlDataSchema,
  mutationResultMetaSchema,
  'Result of canceling a job. data.success and _result.success are true.'
);

export const holdJobOutputSchema = envelopeSchema(
  jobControlDataSchema,
  mutationResultMetaSchema,
  'Result of holding a job. data.success and _result.success are true.'
);

export const releaseJobOutputSchema = envelopeSchema(
  jobControlDataSchema,
  mutationResultMetaSchema,
  'Result of releasing a held job. data.success and _result.success are true.'
);

export const deleteJobOutputSchema = envelopeSchema(
  jobControlDataSchema,
  mutationResultMetaSchema,
  'Result of deleting a job from the output queue. data.success and _result.success are true.'
);

export const submitJobFromDatasetOutputSchema = envelopeSchema(
  submitJobFromSourceWithWaitDataSchema,
  mutationResultMetaSchema,
  'Result of submitting a job from a data set. data has jobId, jobName; when wait=true also has status, timedOut, failedStepJobFiles; _result.success is true.'
);

export const submitJobFromUssOutputSchema = envelopeSchema(
  submitJobFromSourceWithWaitDataSchema,
  mutationResultMetaSchema,
  'Result of submitting a job from a USS file. data has jobId, jobName; when wait=true also has status, timedOut, failedStepJobFiles; _result.success is true.'
);
