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
 * Jobs tools for the Zowe MCP Server.
 *
 * Provides submitJob and getJobStatus. Job cards (JOB statement) can be
 * configured per connection in the config file (jobCards section) or VS Code
 * settings; when JCL is submitted without a job card, the server prepends
 * the configured card for the current connection.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import { plural } from '../../plural.js';
import type { JobFileEntry, JobStatusResult, ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { JobCardStore } from '../../zos/job-cards.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  DEFAULT_LIST_LIMIT,
  getListMessages,
  getReadMessages,
  MAX_LIST_LIMIT,
  paginateList,
  sanitizeTextForDisplay,
  windowContent,
  wrapResponse,
} from '../response.js';

/** Default wait for job to reach OUTPUT (seconds). */
const DEFAULT_EXECUTE_JOB_TIMEOUT_SECONDS = 300;
/** Initial poll interval (seconds). */
const EXECUTE_JOB_POLL_INITIAL_SEC = 2;
/** Poll interval increment (seconds). */
const EXECUTE_JOB_POLL_INCREMENT_SEC = 1;
/** Maximum poll interval (seconds). */
const EXECUTE_JOB_POLL_MAX_SEC = 15;
/** Default and max limit for searchJobOutput match pagination. */
const SEARCH_JOB_OUTPUT_DEFAULT_LIMIT = 100;
const SEARCH_JOB_OUTPUT_MAX_LIMIT = 500;

/** JOB statement detection: first non-empty line starts with //, then optional blanks, name, blanks, JOB. */
const JOB_CARD_REGEX = /^\/\/\s*\S+\s+JOB\s/i;

function hasJobCardInJcl(jcl: string): boolean {
  const trimmed = jcl.trim();
  if (!trimmed) return false;
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? '';
  return JOB_CARD_REGEX.test(firstLine);
}

/** Dependencies for job tool registration. */
export interface JobToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  jobCardStore: JobCardStore;
}

async function ensureContext(
  deps: JobToolDeps,
  systemId: string,
  userId?: string
): Promise<{ userId: string }> {
  const ctx = deps.sessionState.getContext(systemId);
  if (ctx) return { userId: ctx.userId };
  const credentials = await deps.credentialProvider.getCredentials(systemId, userId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
  return { userId: credentials.user };
}

/** Derive connection spec for job card lookup (user@host; port not in systemId so use default key). */
function connectionSpecFor(systemId: string, userId: string): string {
  return `${userId}@${systemId}`;
}

/**
 * Poll getJobStatus until job reaches OUTPUT or has retcode, or timeout.
 * Uses adaptive polling: start at EXECUTE_JOB_POLL_INITIAL_SEC, increase by EXECUTE_JOB_POLL_INCREMENT_SEC each poll, cap at EXECUTE_JOB_POLL_MAX_SEC.
 */
async function executeJobPollUntilDone(
  backend: ZosBackend,
  systemId: string,
  jobId: string,
  timeoutSeconds: number,
  progressStep?: (msg: string) => void
): Promise<{ status: JobStatusResult; timedOut: boolean }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let pollIntervalSec = EXECUTE_JOB_POLL_INITIAL_SEC;
  let lastStatus: JobStatusResult | undefined;
  for (;;) {
    const status = await backend.getJobStatus(
      systemId,
      jobId,
      progressStep ? (msg: string) => void progressStep(msg) : undefined
    );
    lastStatus = status;
    if (status.status === 'OUTPUT' || status.retcode !== undefined) {
      return { status, timedOut: false };
    }
    if (Date.now() >= deadline) {
      return { status: lastStatus, timedOut: true };
    }
    const delayMs = Math.min(pollIntervalSec * 1000, deadline - Date.now());
    if (delayMs <= 0) {
      return { status: lastStatus, timedOut: true };
    }
    await new Promise(r => setTimeout(r, delayMs));
    pollIntervalSec = Math.min(
      pollIntervalSec + EXECUTE_JOB_POLL_INCREMENT_SEC,
      EXECUTE_JOB_POLL_MAX_SEC
    );
  }
}

/** JCL job name max length (one qualifier). */
const JOB_NAME_MAX_LEN = 8;
/** Programmer name max length in JOB statement (IBM: 20 chars including quotes; we use 19 for value). */
const PROGRAMMER_MAX_LEN = 19;

/**
 * Maximum length of a JCL statement line (columns 1–71). Columns 72–80 are continuation/sequence;
 * content there is not part of the statement and can cause HASP110/HASP105 errors.
 */
const JCL_MAX_STATEMENT_LENGTH = 71;

/**
 * Substitute {jobname} and {programmer} in a job card template.
 * jobName defaults to userId + 'A' (truncated to 8 chars). programmer defaults to '' (max 19 chars).
 */
function applyJobCardTemplate(
  template: string,
  options: { userId: string; jobName?: string; programmer?: string }
): string {
  const jobName = (options.jobName ?? options.userId + 'A').slice(0, JOB_NAME_MAX_LEN);
  const programmer = (options.programmer ?? '').slice(0, PROGRAMMER_MAX_LEN);
  return template.replace(/\{jobname\}/gi, jobName).replace(/\{programmer\}/g, programmer);
}

/**
 * Apply job card template and ensure the first line (JOB statement) does not exceed JCL max length.
 * If the first line would exceed JCL_MAX_STATEMENT_LENGTH, trims the programmer value and re-applies until it fits.
 * Returns the final job card and the programmer value used (possibly trimmed).
 */
function applyJobCardTemplateWithLengthCheck(
  template: string,
  options: { userId: string; jobName?: string; programmer?: string },
  log: {
    debug: (msg: string, data?: unknown) => void;
    warning: (msg: string, data?: unknown) => void;
  }
): { jobCard: string; programmerUsed: string; programmerTrimmed: boolean } {
  let programmer = (options.programmer ?? '').slice(0, PROGRAMMER_MAX_LEN);
  let jobCard = applyJobCardTemplate(template, { ...options, programmer });
  const lines = jobCard.trimEnd().split(/\r?\n/);
  const firstLine = lines[0] ?? '';
  let programmerTrimmed = false;

  if (firstLine.length > JCL_MAX_STATEMENT_LENGTH) {
    const excess = firstLine.length - JCL_MAX_STATEMENT_LENGTH;
    const maxProgrammerLen = Math.max(0, programmer.length - excess);
    const trimmedProgrammer = programmer.slice(0, maxProgrammerLen);
    log.warning('Job card first line exceeds JCL max length; trimming programmer field', {
      maxLength: JCL_MAX_STATEMENT_LENGTH,
      firstLineLength: firstLine.length,
      programmerOriginal: programmer,
      programmerTrimmed: trimmedProgrammer,
    });
    programmer = trimmedProgrammer;
    jobCard = applyJobCardTemplate(template, { ...options, programmer });
    programmerTrimmed = true;
  }

  return {
    jobCard: jobCard.trimEnd(),
    programmerUsed: programmer,
    programmerTrimmed,
  };
}

/**
 * Registers job tools (submitJob, getJobStatus) on the given MCP server.
 */
export function registerJobTools(server: McpServer, deps: JobToolDeps, logger: Logger): void {
  const log = logger.child('jobs');

  server.registerTool(
    'submitJob',
    {
      description:
        'Submit JCL to the current (or specified) z/OS system. A job card is added from config when JCL has none; include a job card only when your JCL already has a full JOB statement. Submitting runs work on z/OS—use with care.',
      annotations: { destructiveHint: true },
      inputSchema: {
        jcl: z
          .string()
          .describe(
            'JCL to submit. Omit the job card to use the one configured for this connection; include it only when your JCL already has a full JOB statement.'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
        jobName: z
          .string()
          .optional()
          .describe(
            'Job name for the JOB statement when using a template (max 8 chars). Default: user ID + "A". Ignored if JCL already contains a job card.'
          ),
        programmer: z
          .string()
          .optional()
          .describe(
            'Programmer field in the JOB statement when using a template (max 19 chars). Typically describes what the job does. Default: empty. Ignored if JCL already contains a job card.'
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Submit job');
      await progress.start();
      try {
        const parsed = z
          .object({
            jcl: z.string(),
            system: z.string().optional(),
            jobName: z.string().optional(),
            programmer: z.string().optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const ctx = deps.sessionState.getContext(systemId);
        const userId = ctx?.userId ?? '';
        const connectionSpec = connectionSpecFor(systemId, userId);

        const messages: string[] = [];
        let jclToSubmit = parsed.jcl.trim();
        let addedJobCard: string | undefined;
        if (!hasJobCardInJcl(jclToSubmit)) {
          const template = deps.jobCardStore.get(connectionSpec);
          if (!template) {
            await progress.complete(
              `No job card configured for ${connectionSpec}. Add a "jobCards" entry for this connection in your config file (--config) or set zoweMCP.jobCards in VS Code settings.`
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    isError: true,
                    message: `No job card configured for ${connectionSpec}. Add a "jobCards" entry for this connection in your config file (--config) or set zoweMCP.jobCards in VS Code settings.`,
                  }),
                },
              ],
              isError: true,
            };
          }
          const {
            jobCard: jobCardResult,
            programmerUsed,
            programmerTrimmed,
          } = applyJobCardTemplateWithLengthCheck(
            template,
            {
              userId,
              jobName: parsed.jobName,
              programmer: parsed.programmer,
            },
            log
          );
          addedJobCard = jobCardResult;
          const jobNameUsed = (parsed.jobName ?? userId + 'A').slice(0, JOB_NAME_MAX_LEN);
          const jobCardLines = addedJobCard.split(/\r?\n/);
          const firstLineLen = jobCardLines[0]?.length ?? 0;
          log.debug('submitJob: prepending job card', {
            connectionSpec,
            jobName: jobNameUsed,
            programmer: programmerUsed,
            lineCount: jobCardLines.length,
            firstLineLength: firstLineLen,
            withinJclLimit: firstLineLen <= JCL_MAX_STATEMENT_LENGTH,
            lines: jobCardLines,
          });
          jclToSubmit = addedJobCard + '\n' + jclToSubmit;
          if (programmerTrimmed) {
            messages.push(
              `Job card first line exceeded JCL limit of ${JCL_MAX_STATEMENT_LENGTH} characters; programmer field was trimmed so the JOB statement fits.`
            );
          }
        }

        const result = await deps.backend.submitJob(
          systemId,
          jclToSubmit,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        await progress.complete(`Job ${result.jobName} (${result.jobId}) submitted`);
        const responseCtx = buildContext(systemId, {});
        if (addedJobCard) {
          messages.push('Job card added (prepended to JCL):\n' + addedJobCard);
        }
        const data: { jobId: string; jobName: string; jobCardAdded?: string } = {
          jobId: result.jobId,
          jobName: result.jobName,
        };
        if (addedJobCard) {
          data.jobCardAdded = addedJobCard;
        }
        return wrapResponse(responseCtx, { success: true }, data, messages);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('submitJob error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                isError: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'getJobStatus',
    {
      description:
        'Get the current status of a z/OS job (e.g. INPUT, ACTIVE, OUTPUT) and its return code when complete.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Get job status');
      await progress.start();
      try {
        const parsed = z
          .object({
            jobId: z.string(),
            system: z.string().optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const status = await deps.backend.getJobStatus(
          systemId,
          parsed.jobId,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        await progress.complete(`Job ${status.name} (${status.id}): ${status.status}`);
        const responseCtx = buildContext(systemId, {});
        return wrapResponse(responseCtx, undefined, status, []);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('getJobStatus error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                isError: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'executeJob',
    {
      description:
        'Submit JCL and wait for the job to reach OUTPUT (or timeout). Default timeout 5 minutes; after timeout the job keeps running on z/OS—use getJobStatus or getJobOutput next. May include failed-step output when the job completes with a non-zero return code.',
      annotations: { destructiveHint: true },
      inputSchema: {
        jcl: z
          .string()
          .describe(
            'JCL to submit. Omit the job card to use the one configured for this connection; include it only when your JCL already has a full JOB statement.'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            `How long to wait for the job to reach OUTPUT (seconds). Default ${DEFAULT_EXECUTE_JOB_TIMEOUT_SECONDS} (5 minutes). The job keeps running on z/OS after timeout.`
          ),
        jobName: z
          .string()
          .optional()
          .describe(
            'Job name for the JOB statement when using a template (max 8 chars). Ignored if JCL already contains a job card.'
          ),
        programmer: z
          .string()
          .optional()
          .describe(
            'Programmer field in the JOB statement when using a template. Ignored if JCL already contains a job card.'
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Execute job');
      await progress.start();
      try {
        const parsed = z
          .object({
            jcl: z.string(),
            system: z.string().optional(),
            timeoutSeconds: z.number().int().min(1).optional(),
            jobName: z.string().optional(),
            programmer: z.string().optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const ctx = deps.sessionState.getContext(systemId);
        const userId = ctx?.userId ?? '';
        const connectionSpec = connectionSpecFor(systemId, userId);

        let jclToSubmit = parsed.jcl.trim();
        if (!hasJobCardInJcl(jclToSubmit)) {
          const template = deps.jobCardStore.get(connectionSpec);
          if (!template) {
            await progress.complete(
              `No job card configured for ${connectionSpec}. Add a "jobCards" entry in config or VS Code settings.`
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    isError: true,
                    message: `No job card configured for ${connectionSpec}. Add a "jobCards" entry in config or VS Code settings.`,
                  }),
                },
              ],
              isError: true,
            };
          }
          const { jobCard } = applyJobCardTemplateWithLengthCheck(
            template,
            {
              userId,
              jobName: parsed.jobName,
              programmer: parsed.programmer,
            },
            log
          );
          jclToSubmit = jobCard + '\n' + jclToSubmit;
        }

        await progress.step('Submitting job...');
        const submitResult = await deps.backend.submitJob(
          systemId,
          jclToSubmit,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        const timeoutSec = parsed.timeoutSeconds ?? DEFAULT_EXECUTE_JOB_TIMEOUT_SECONDS;
        await progress.step('Waiting for job to complete...');
        const { status, timedOut } = await executeJobPollUntilDone(
          deps.backend,
          systemId,
          submitResult.jobId,
          timeoutSec,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        if (timedOut) {
          await progress.complete('Timeout waiting for job (job continues on z/OS)');
        } else {
          await progress.complete(`Job ${status.name} (${status.id}): ${status.status}`);
        }

        const responseCtx = buildContext(systemId, {});
        const data: JobStatusResult & { timedOut?: boolean; jobId?: string; jobName?: string } = {
          ...status,
        };
        if (timedOut) {
          data.timedOut = true;
        }
        data.jobId = status.id;
        data.jobName = status.name;

        let failedStepJobFiles: JobFileEntry[] | undefined;
        if (!timedOut && status.retcode !== undefined && status.retcode !== '0000') {
          try {
            failedStepJobFiles = await deps.backend.listJobFiles(systemId, status.id, undefined);
          } catch {
            // optional: ignore if listJobFiles not supported or fails
          }
        }
        if (failedStepJobFiles !== undefined && failedStepJobFiles.length > 0) {
          (data as { failedStepJobFiles?: JobFileEntry[] }).failedStepJobFiles =
            failedStepJobFiles;
        }

        return wrapResponse(responseCtx, undefined, data, []);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('executeJob error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                isError: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'listJobFiles',
    {
      description:
        'List output files (spools) for a z/OS job. The job must be in OUTPUT status. Use getJobStatus to check status first.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based offset for pagination (default 0).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(
            `Number of job files to return (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}).`
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'List job files');
      await progress.start();
      try {
        const parsed = z
          .object({
            jobId: z.string(),
            system: z.string().optional(),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const allFiles = await deps.backend.listJobFiles(
          systemId,
          parsed.jobId,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        const offset = parsed.offset ?? 0;
        const limit = parsed.limit ?? DEFAULT_LIST_LIMIT;
        const { data, meta } = paginateList(allFiles, offset, limit);

        await progress.complete(
          `Listed ${data.length} ${plural(data.length, 'job file', 'job files')} for job ${parsed.jobId} (${meta.totalAvailable} total)`
        );
        const responseCtx = buildContext(systemId, {});
        const messages = getListMessages(meta);
        return wrapResponse(responseCtx, meta, data, messages);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('listJobFiles error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                isError: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'readJobFile',
    {
      description:
        'Read the content of one job output file (spool). Use listJobFiles to get job file IDs. Optional startLine and lineCount for partial reads.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
        jobFileId: z.number().int().describe('Job file (spool) ID from listJobFiles.'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based first line to return (default 1).'),
        lineCount: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Number of lines to return (default: all).'),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Read job file');
      await progress.start();
      try {
        const parsed = z
          .object({
            jobId: z.string(),
            jobFileId: z.number().int(),
            system: z.string().optional(),
            startLine: z.number().int().min(1).optional(),
            lineCount: z.number().int().min(1).optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const result = await deps.backend.readJobFile(
          systemId,
          parsed.jobId,
          parsed.jobFileId,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        const sanitized = sanitizeTextForDisplay(result.text);
        const { text, meta, mimeType } = windowContent(
          sanitized,
          parsed.startLine,
          parsed.lineCount
        );

        await progress.complete(
          `Read job file ${parsed.jobFileId} (lines ${meta.startLine}–${meta.startLine + meta.returnedLines - 1} of ${meta.totalLines})`
        );
        const responseCtx = buildContext(systemId, {});
        const messages = getReadMessages(meta);
        const data = {
          text,
          totalLines: meta.totalLines,
          startLine: meta.startLine,
          returnedLines: meta.returnedLines,
          hasMore: meta.hasMore,
          mimeType,
        };
        return wrapResponse(responseCtx, meta, data, messages);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('readJobFile error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                isError: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'getJobOutput',
    {
      description:
        'Get aggregated output from job files for a completed job. By default returns output from failed steps only when the job has a non-zero return code. Optional jobFileIds to limit to specific files.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
        failedStepsOnly: z
          .boolean()
          .optional()
          .describe(
            'When true (default), only include output from steps that failed (when job retcode is non-zero). When false, include all job files.'
          ),
        jobFileIds: z
          .array(z.number().int())
          .optional()
          .describe(
            'Optional list of job file (spool) IDs to include. When provided, only these files are read; failedStepsOnly is ignored.'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based offset for pagination over job files (default 0).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(
            `Number of job files to return (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}).`
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Get job output');
      await progress.start();
      try {
        const parsed = z
          .object({
            jobId: z.string(),
            system: z.string().optional(),
            failedStepsOnly: z.boolean().optional(),
            jobFileIds: z.array(z.number().int()).optional(),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const status = await deps.backend.getJobStatus(
          systemId,
          parsed.jobId,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        let files: JobFileEntry[];
        if (parsed.jobFileIds !== undefined && parsed.jobFileIds.length > 0) {
          const allFiles = await deps.backend.listJobFiles(systemId, parsed.jobId, undefined);
          const idSet = new Set(parsed.jobFileIds);
          files = allFiles.filter(f => idSet.has(f.id));
        } else {
          files = await deps.backend.listJobFiles(
            systemId,
            parsed.jobId,
            extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
          );
          const failedOnly =
            parsed.failedStepsOnly !== false &&
            status.retcode !== undefined &&
            status.retcode !== '0000';
          if (failedOnly && files.length > 0) {
            const sysoutOrErr = files.filter(
              f =>
                f.ddname === 'SYSOUT' ||
                f.ddname === 'SYSPRINT' ||
                f.ddname === 'SYSERR' ||
                (f.ddname?.toUpperCase().includes('ERR') ?? false)
            );
            if (sysoutOrErr.length > 0) {
              files = sysoutOrErr;
            }
          }
        }

        const offset = parsed.offset ?? 0;
        const limit = parsed.limit ?? DEFAULT_LIST_LIMIT;
        const { data: pageFiles, meta } = paginateList(files, offset, limit);

        const outputEntries: {
          jobFileId: number;
          ddname?: string;
          stepname?: string;
          text: string;
          lineCount: number;
        }[] = [];

        for (const file of pageFiles) {
          const result = await deps.backend.readJobFile(
            systemId,
            parsed.jobId,
            file.id,
            undefined
          );
          const sanitized = sanitizeTextForDisplay(result.text);
          const lines = sanitized.split(/\n/);
          outputEntries.push({
            jobFileId: file.id,
            ddname: file.ddname,
            stepname: file.stepname,
            text: sanitized,
            lineCount: lines.length,
          });
        }

        await progress.complete(
          `Returned ${outputEntries.length} ${plural(outputEntries.length, 'job file', 'job files')} for job ${parsed.jobId} (${meta.totalAvailable} total)`
        );
        const responseCtx = buildContext(systemId, {});
        const messages = getListMessages(meta);
        const data = {
          jobId: parsed.jobId,
          status: status.status,
          retcode: status.retcode,
          files: outputEntries,
        };
        return wrapResponse(responseCtx, meta, data, messages);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('getJobOutput error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                isError: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'searchJobOutput',
    {
      description:
        "Search for a substring in a job's output files (all files or one by jobFileId). Returns matching lines with location and text. Use offset/limit to page results.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
        searchString: z.string().min(1).describe('Substring to search for (literal, not regex).'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
        jobFileId: z
          .number()
          .int()
          .optional()
          .describe(
            'If provided, search only this job file (spool ID from listJobFiles). Otherwise search all job files.'
          ),
        caseSensitive: z
          .boolean()
          .optional()
          .describe('When true, match case exactly. Default false.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based offset for pagination over matches (default 0).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(SEARCH_JOB_OUTPUT_MAX_LIMIT)
          .optional()
          .describe(
            `Number of matches to return (default ${SEARCH_JOB_OUTPUT_DEFAULT_LIMIT}, max ${SEARCH_JOB_OUTPUT_MAX_LIMIT}).`
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Search job output');
      await progress.start();
      try {
        const parsed = z
          .object({
            jobId: z.string(),
            searchString: z.string().min(1),
            system: z.string().optional(),
            jobFileId: z.number().int().optional(),
            caseSensitive: z.boolean().optional(),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(SEARCH_JOB_OUTPUT_MAX_LIMIT).optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const allFiles = await deps.backend.listJobFiles(
          systemId,
          parsed.jobId,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        let filesToSearch: JobFileEntry[];
        if (parsed.jobFileId !== undefined) {
          const match = allFiles.find(f => f.id === parsed.jobFileId);
          filesToSearch = match ? [match] : [];
        } else {
          filesToSearch = allFiles;
        }

        const searchStr = parsed.searchString;
        const caseSensitive = parsed.caseSensitive === true;
        const matches: {
          jobFileId: number;
          ddname?: string;
          stepname?: string;
          lineNumber: number;
          lineText: string;
        }[] = [];

        for (const file of filesToSearch) {
          const result = await deps.backend.readJobFile(
            systemId,
            parsed.jobId,
            file.id,
            undefined
          );
          const sanitized = sanitizeTextForDisplay(result.text);
          const lines = sanitized.split(/\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const contains = caseSensitive
              ? line.includes(searchStr)
              : line.toLowerCase().includes(searchStr.toLowerCase());
            if (contains) {
              matches.push({
                jobFileId: file.id,
                ddname: file.ddname,
                stepname: file.stepname,
                lineNumber: i + 1,
                lineText: line,
              });
            }
          }
        }

        const offset = parsed.offset ?? 0;
        const limit = parsed.limit ?? SEARCH_JOB_OUTPUT_DEFAULT_LIMIT;
        const { data: pageMatches, meta } = paginateList(matches, offset, limit);

        await progress.complete(
          `Found ${matches.length} match(es) for "${searchStr}" in job ${parsed.jobId} (returning ${pageMatches.length})`
        );
        const responseCtx = buildContext(systemId, {});
        const messages = getListMessages(meta);
        return wrapResponse(responseCtx, meta, pageMatches, messages);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('searchJobOutput error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                isError: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  const LIST_JOBS_DEFAULT_LIMIT = 100;

  server.registerTool(
    'listJobs',
    {
      description:
        'List jobs on the z/OS system with optional filters (owner, prefix, status). Use offset/limit to page results.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
        owner: z.string().optional().describe('Filter by job owner.'),
        prefix: z.string().optional().describe('Filter by job name prefix.'),
        status: z.string().optional().describe('Filter by status: INPUT, ACTIVE, or OUTPUT.'),
        offset: z.number().int().min(0).optional().describe('0-based offset (default 0).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(
            `Number of jobs to return (default ${LIST_JOBS_DEFAULT_LIMIT}, max ${MAX_LIST_LIMIT}).`
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'List jobs');
      await progress.start();
      try {
        const parsed = z
          .object({
            system: z.string().optional(),
            owner: z.string().optional(),
            prefix: z.string().optional(),
            status: z.string().optional(),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
          })
          .parse(args);

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const allJobs = await deps.backend.listJobs(
          systemId,
          {
            owner: parsed.owner,
            prefix: parsed.prefix,
            status: parsed.status,
            maxItems: 10_000,
          },
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );

        const offset = parsed.offset ?? 0;
        const limit = parsed.limit ?? LIST_JOBS_DEFAULT_LIMIT;
        const { data, meta } = paginateList(allJobs, offset, limit);

        await progress.complete(
          `Listed ${data.length} ${plural(data.length, 'job', 'jobs')} (${meta.totalAvailable} total)`
        );
        const responseCtx = buildContext(systemId, {});
        const messages = getListMessages(meta);
        return wrapResponse(responseCtx, meta, data, messages);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('listJobs error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ isError: true, message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'getJcl',
    {
      description: 'Get the JCL for a job.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Get JCL');
      await progress.start();
      try {
        const parsed = z.object({ jobId: z.string(), system: z.string().optional() }).parse(args);
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const jcl = await deps.backend.getJcl(
          systemId,
          parsed.jobId,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );
        await progress.complete(`Retrieved JCL for job ${parsed.jobId}`);
        const responseCtx = buildContext(systemId, {});
        return wrapResponse(responseCtx, undefined, { jcl }, []);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('getJcl error', { error: message });
        await progress.complete(message);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ isError: true, message }) }],
          isError: true,
        };
      }
    }
  );

  function registerJobControlTool(
    name: string,
    description: string,
    destructive: boolean,
    backendMethod: (
      systemId: string,
      jobId: string,
      progress?: (msg: string) => void
    ) => Promise<void>
  ): void {
    server.registerTool(
      name,
      {
        description,
        annotations: destructive ? { destructiveHint: true } : {},
        inputSchema: {
          jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
          system: z
            .string()
            .optional()
            .describe(
              'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
            ),
        },
      },
      async (args, extra) => {
        const progress = createToolProgress(extra, name);
        await progress.start();
        try {
          const parsed = z
            .object({ jobId: z.string(), system: z.string().optional() })
            .parse(args);
          const { systemId, userId: resolvedUserId } = resolveSystemForTool(
            deps.systemRegistry,
            deps.sessionState,
            parsed.system
          );
          await ensureContext(deps, systemId, resolvedUserId);
          await backendMethod(
            systemId,
            parsed.jobId,
            extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
          );
          await progress.complete(`${name} completed for job ${parsed.jobId}`);
          const responseCtx = buildContext(systemId, {});
          return wrapResponse(responseCtx, { success: true }, { success: true }, []);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.debug(`${name} error`, { error: message });
          await progress.complete(message);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ isError: true, message }),
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  registerJobControlTool(
    'cancelJob',
    'Cancel a job on the z/OS system.',
    true,
    (systemId, jobId, progress) => deps.backend.cancelJob(systemId, jobId, progress)
  );
  registerJobControlTool(
    'holdJob',
    'Hold a job on the z/OS system.',
    true,
    (systemId, jobId, progress) => deps.backend.holdJob(systemId, jobId, progress)
  );
  registerJobControlTool(
    'releaseJob',
    'Release a held job on the z/OS system.',
    false,
    (systemId, jobId, progress) => deps.backend.releaseJob(systemId, jobId, progress)
  );
  registerJobControlTool(
    'deleteJob',
    'Delete a job from the output queue.',
    true,
    (systemId, jobId, progress) => deps.backend.deleteJob(systemId, jobId, progress)
  );

  server.registerTool(
    'submitJobFromDataset',
    {
      description:
        'Submit a job from a data set (e.g. a PDS/PDSE member containing JCL). The data set must contain valid JCL including a job card.',
      annotations: { destructiveHint: true },
      inputSchema: {
        dsn: z
          .string()
          .describe(
            'Fully-qualified data set name, optionally with member in parentheses (e.g. USER.JCL.CNTL(MYJOB)).'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Submit job from data set');
      await progress.start();
      try {
        const parsed = z.object({ dsn: z.string(), system: z.string().optional() }).parse(args);
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const result = await deps.backend.submitJobFromDataset(
          systemId,
          parsed.dsn,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );
        await progress.complete(`Job ${result.jobName} (${result.jobId}) submitted from data set`);
        const responseCtx = buildContext(systemId, {});
        return wrapResponse(responseCtx, { success: true }, result, []);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('submitJobFromDataset error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ isError: true, message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'submitJobFromUss',
    {
      description:
        'Submit a job from a USS file path. The file must contain valid JCL including a job card.',
      annotations: { destructiveHint: true },
      inputSchema: {
        path: z.string().describe('USS path to the JCL file (e.g. /u/myuser/job.jcl).'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional z/OS system (hostname). If omitted, the active system from setSystem is used.'
          ),
      },
    },
    async (args, extra) => {
      const progress = createToolProgress(extra, 'Submit job from USS');
      await progress.start();
      try {
        const parsed = z.object({ path: z.string(), system: z.string().optional() }).parse(args);
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const result = await deps.backend.submitJobFromUss(
          systemId,
          parsed.path,
          extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
        );
        await progress.complete(`Job ${result.jobName} (${result.jobId}) submitted from USS`);
        const responseCtx = buildContext(systemId, {});
        return wrapResponse(responseCtx, { success: true }, result, []);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('submitJobFromUss error', { error: message });
        await progress.complete(message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ isError: true, message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  log.debug(
    'Job tools registered: submitJob, getJobStatus, executeJob, getJobOutput, listJobFiles, readJobFile, searchJobOutput, listJobs, getJcl, cancelJob, holdJob, releaseJob, deleteJob, submitJobFromDataset, submitJobFromUss'
  );
}
