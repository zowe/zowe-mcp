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
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { JobCardStore } from '../../zos/job-cards.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import { buildContext, wrapResponse } from '../response.js';

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

async function ensureContext(deps: JobToolDeps, systemId: string): Promise<{ userId: string }> {
  const ctx = deps.sessionState.getContext(systemId);
  if (ctx) return { userId: ctx.userId };
  const credentials = await deps.credentialProvider.getCredentials(systemId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
  return { userId: credentials.user };
}

/** Derive connection spec for job card lookup (user@host; port not in systemId so use default key). */
function connectionSpecFor(systemId: string, userId: string): string {
  return `${userId}@${systemId}`;
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
        'Submit JCL to the current (or specified) z/OS system. If the JCL does not contain a job card, the server adds one for this connection (see getContext for the configured job card). Only include a job card in JCL when you have complete JCL that already starts with a JOB statement. Submitting a job runs work on z/OS and may consume resources; use with care.',
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

        const systemId = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId);
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
          extra._meta?.progressToken ? progress.step : undefined
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

        const systemId = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          parsed.system
        );
        await ensureContext(deps, systemId);

        const status = await deps.backend.getJobStatus(
          systemId,
          parsed.jobId,
          extra._meta?.progressToken ? progress.step : undefined
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

  log.debug('Job tools registered: submitJob, getJobStatus');
}
