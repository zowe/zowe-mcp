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
 * z/OS system information tools for the Zowe MCP Server.
 *
 * Read-only operations that gather configuration and operational data about the
 * z/OS system itself (not the MCP server's session):
 * - listApf: APF-authorized data sets
 * - listProclib: PROCLIB concatenation
 * - viewSyslog: the operations SYSLOG
 *
 * Backed by the Zowe Remote SSH SDK `client.system` RPCs (SDK 0.6.0+).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ResourceEffect } from '../../capability-level.js';
import type { Logger } from '../../log.js';
import type { ViewSyslogOptions, ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { ResponseCache } from '../../zos/response-cache.js';
import { buildCacheKey, buildScopeSystem, withCache } from '../../zos/response-cache.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  DEFAULT_LIST_LIMIT,
  getListMessages,
  getReadMessages,
  MAX_LIST_LIMIT,
  MAX_READ_LINES,
  paginateList,
  PAGINATION_NOTE_LINES,
  PAGINATION_NOTE_LIST,
  sanitizeTextForDisplay,
  SYSTEM_PARAM_DESCRIPTION,
  textToLines,
  windowContent,
  withPaginationNote,
  wrapResponse,
} from '../response.js';
import { ensureContext, errorResult } from '../tool-utils.js';
import {
  listApfOutputSchema,
  listProclibOutputSchema,
  viewSyslogOutputSchema,
} from './system-output-schemas.js';

export interface SystemToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  responseCache?: ResponseCache;
}

const offsetParam = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('0-based index of the first item to return. Default: 0.');

const limitParam = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIST_LIMIT)
  .optional()
  .describe(`Maximum items to return. Default: ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}.`);

export function registerSystemTools(
  server: McpServer,
  deps: SystemToolDeps,
  logger: Logger
): void {
  const log = logger.child('system');

  /** Resolve the active/target system and ensure its context is initialised. */
  async function resolveAndEnsure(
    system: string | undefined
  ): Promise<{ systemId: string; userId?: string }> {
    const { systemId, userId: resolvedUserId } = resolveSystemForTool(
      deps.systemRegistry,
      deps.sessionState,
      system
    );
    await ensureContext(deps, systemId, resolvedUserId);
    return { systemId, userId: deps.sessionState.getContext(systemId)?.userId };
  }

  // -----------------------------------------------------------------------
  // listApf
  // -----------------------------------------------------------------------
  server.registerTool(
    'listApf',
    {
      outputSchema: listApfOutputSchema,
      description: withPaginationNote(
        'List the APF-authorized (Authorized Program Facility) data sets on the z/OS system, each with its volume serial. ' +
          'Use this to audit which load libraries are authorized to run privileged code.',
        PAGINATION_NOTE_LIST
      ),
      _meta: { resourceEffectLevel: ResourceEffect.READ },
      inputSchema: {
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        offset: offsetParam,
        limit: limitParam,
      },
    },
    async ({ system, offset, limit }, extra) => {
      const progress = createToolProgress(extra, 'List APF-authorized data sets');
      await progress.start();
      log.info('listApf called', { system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const cacheKey = buildCacheKey('listApf', { systemId });
        const scope = buildScopeSystem(systemId);
        const result = await withCache(
          deps.responseCache,
          cacheKey,
          () => deps.backend.listApf(systemId, userId, progressCb),
          [scope]
        );
        const { data: page, meta } = paginateList(
          result.items,
          offset ?? 0,
          limit ?? DEFAULT_LIST_LIMIT
        );
        const ctx = buildContext(systemId, {});
        await progress.complete(`${meta.count} of ${meta.totalAvailable}`);
        return wrapResponse(ctx, meta, { items: page }, getListMessages(meta));
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // listProclib
  // -----------------------------------------------------------------------
  server.registerTool(
    'listProclib',
    {
      outputSchema: listProclibOutputSchema,
      description: withPaginationNote(
        'List the PROCLIB concatenation on the z/OS system (the data sets searched for JCL procedures, in order). ' +
          'Use this to find where cataloged procedures and started-task JCL live.',
        PAGINATION_NOTE_LIST
      ),
      _meta: { resourceEffectLevel: ResourceEffect.READ },
      inputSchema: {
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        offset: offsetParam,
        limit: limitParam,
      },
    },
    async ({ system, offset, limit }, extra) => {
      const progress = createToolProgress(extra, 'List PROCLIB concatenation');
      await progress.start();
      log.info('listProclib called', { system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const cacheKey = buildCacheKey('listProclib', { systemId });
        const scope = buildScopeSystem(systemId);
        const result = await withCache(
          deps.responseCache,
          cacheKey,
          () => deps.backend.listProclib(systemId, userId, progressCb),
          [scope]
        );
        const { data: page, meta } = paginateList(
          result.items,
          offset ?? 0,
          limit ?? DEFAULT_LIST_LIMIT
        );
        const ctx = buildContext(systemId, {});
        await progress.complete(`${meta.count} of ${meta.totalAvailable}`);
        return wrapResponse(ctx, meta, { items: page }, getListMessages(meta));
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // viewSyslog
  // -----------------------------------------------------------------------
  server.registerTool(
    'viewSyslog',
    {
      outputSchema: viewSyslogOutputSchema,
      description: withPaginationNote(
        'View the z/OS SYSLOG (the system operations log). ' +
          'Optionally start from a date and time, or from a relative offset (secondsAgo); limit how much the host reads with maxLines. ' +
          'Requesting the same window again without startLine and lineCount re-reads from the host.',
        PAGINATION_NOTE_LINES
      ),
      _meta: { resourceEffectLevel: ResourceEffect.READ },
      inputSchema: {
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        date: z
          .string()
          .optional()
          .describe('Start date in yyyy-mm-dd. Mutually exclusive with secondsAgo.'),
        time: z
          .string()
          .optional()
          .describe('Start time in hh:mm:ss. Use with date. Mutually exclusive with secondsAgo.'),
        secondsAgo: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Start from (now - secondsAgo) on z/OS. Mutually exclusive with date/time.'),
        maxLines: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Maximum syslog lines for the host to read.'),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based first line of output to return. Default: 1.'),
        lineCount: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Number of lines to return. Omit for default window size.'),
      },
    },
    async ({ system, date, time, secondsAgo, maxLines, startLine, lineCount }, extra) => {
      const progress = createToolProgress(extra, 'View z/OS SYSLOG');
      await progress.start();
      log.info('viewSyslog called', { system, date, time, secondsAgo, maxLines });
      try {
        if (secondsAgo !== undefined && (date !== undefined || time !== undefined)) {
          const msg = 'Provide either date/time or secondsAgo, not both.';
          await progress.complete(msg);
          return errorResult(msg);
        }
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const options: ViewSyslogOptions = { date, time, secondsAgo, maxLines };
        const cacheKey = buildCacheKey('viewSyslog', {
          systemId,
          date: date ?? '',
          time: time ?? '',
          secondsAgo: secondsAgo?.toString() ?? '',
          maxLines: maxLines?.toString() ?? '',
        });
        const scope = buildScopeSystem(systemId);

        const isPaging = startLine !== undefined || lineCount !== undefined;
        const fetchSyslog = () => deps.backend.viewSyslog(systemId, options, userId, progressCb);
        let full;
        if (!isPaging && deps.responseCache) {
          full = await fetchSyslog();
          deps.responseCache.set(cacheKey, full, [scope]);
        } else {
          full = await withCache(deps.responseCache, cacheKey, fetchSyslog, [scope]);
        }

        const sanitized = sanitizeTextForDisplay(full.text);
        const { text, meta, mimeType } = windowContent(
          sanitized,
          startLine ?? 1,
          lineCount ?? (isPaging ? undefined : MAX_READ_LINES)
        );
        const lines = textToLines(text);
        const ctx = buildContext(systemId, {});
        const data = {
          lines,
          mimeType,
          ...(full.startDate !== undefined ? { startDate: full.startDate } : {}),
          ...(full.startTime !== undefined ? { startTime: full.startTime } : {}),
          ...(full.endDate !== undefined ? { endDate: full.endDate } : {}),
          ...(full.endTime !== undefined ? { endTime: full.endTime } : {}),
        };
        await progress.complete(`${meta.returnedLines} lines`);
        return wrapResponse(ctx, meta, data, getReadMessages(meta));
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );
}
