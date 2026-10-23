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
 * TSO command tools for the Zowe MCP Server.
 *
 * runSafeTsoCommand: issue TSO commands with safety checks (dangerous block, safe allow, unknown elicit)
 * and paginated cached output. Requesting the same command without startLine/lineCount re-executes.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ResourceEffect } from '../../capability-level.js';
import type { Logger } from '../../log.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { ResponseCache } from '../../zos/response-cache.js';
import { buildCacheKey, buildScopeSystem, withCache } from '../../zos/response-cache.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { formatBlockedCommandMessage } from '../command-safety.js';
import { createToolProgress, type ToolProgressReporter } from '../progress.js';
import {
  buildContext,
  getReadMessages,
  MAX_READ_LINES,
  PAGINATION_NOTE_LINES,
  sanitizeTextForDisplay,
  SYSTEM_PARAM_DESCRIPTION,
  textToLines,
  windowContent,
  withPaginationNote,
  wrapResponse,
} from '../response.js';
import { ensureContext, errorResult } from '../tool-utils.js';
import { buildTsoQueryCommand, validateTsoCommand } from './tso-command-validation.js';
import { runSafeTsoCommandOutputSchema } from './tso-output-schemas.js';

export interface TsoToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  responseCache?: ResponseCache;
  /** MCP server instance for elicitation (confirm unknown commands). */
  mcpServer: McpServer;
}

export function registerTsoTools(server: McpServer, deps: TsoToolDeps, logger: Logger): void {
  const log = logger.child('tso');

  server.registerTool(
    'runSafeTsoCommand',
    {
      outputSchema: runSafeTsoCommandOutputSchema,
      description: withPaginationNote(
        'Run a TSO command on z/OS. Only allowlisted (safe) commands run automatically; ' +
          'unknown commands require user confirmation via elicitation. ' +
          'Requesting the same command without startLine and lineCount re-executes the command',
        PAGINATION_NOTE_LINES
      ),
      _meta: { resourceEffectLevel: ResourceEffect.EXECUTE },
      inputSchema: {
        commandText: z
          .string()
          .describe(
            "The TSO command to execute (e.g. LISTDS 'USER.DATA', LISTALC, LISTCAT, STATUS)."
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
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
    async ({ commandText, system, startLine, lineCount }, extra) => {
      const maxTitleLen = 50;
      const cmdNorm = commandText.trim().replace(/\s+/g, ' ');
      const cmdPreview =
        cmdNorm.length > maxTitleLen ? cmdNorm.slice(0, maxTitleLen) + '…' : cmdNorm;
      const progress = createToolProgress(extra, `Run TSO command: ${cmdPreview}`);
      await progress.start();
      log.info('runSafeTsoCommand called', { commandText: commandText.slice(0, 80), system });

      try {
        const validation = validateTsoCommand(commandText);
        if (validation.action === 'block') {
          const msg = formatBlockedCommandMessage('TSO', validation.pattern?.message);
          await progress.complete('blocked');
          return errorResult(msg);
        }
        if (validation.action === 'elicit') {
          const elicitMsg =
            validation.pattern?.message ??
            'Command requires user confirmation (unknown TSO command).';
          const caps = deps.mcpServer.server.getClientCapabilities();
          // Per MCP spec, empty elicitation object defaults to form mode
          if (!caps?.elicitation) {
            await progress.complete(
              'Command requires user confirmation; elicitation not available.'
            );
            return errorResult(`${elicitMsg} Elicitation is not available; execution denied.`);
          }
          try {
            let systemLabel: string;
            try {
              const { systemId } = resolveSystemForTool(
                deps.systemRegistry,
                deps.sessionState,
                system
              );
              systemLabel = systemId;
            } catch {
              systemLabel = system != null ? String(system) : 'active system';
            }
            const result = await deps.mcpServer.server.elicitInput({
              mode: 'form',
              message: `${elicitMsg} Command: "${cmdPreview}" on system "${systemLabel}". Do you want to run this TSO command?`,
              requestedSchema: {
                type: 'object',
                properties: {
                  confirm: {
                    type: 'boolean',
                    title: 'Run command',
                    description: `Run: ${cmdNorm}`,
                  },
                },
                required: ['confirm'],
              },
            });
            if (result.action !== 'accept' || result.content?.confirm !== true) {
              const declined =
                result.action === 'decline'
                  ? 'User declined.'
                  : result.action === 'cancel'
                    ? 'Cancelled.'
                    : 'Confirmation required.';
              await progress.complete(declined);
              return errorResult(declined);
            }
          } catch (err) {
            log.debug('Elicitation failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            await progress.complete('User confirmation failed.');
            return errorResult(`${elicitMsg} Elicitation failed; execution denied.`);
          }
        }

        return await executeTsoCommand(
          deps,
          { commandText, system, startLine, lineCount },
          extra,
          progress
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'queryTso',
    {
      outputSchema: runSafeTsoCommandOutputSchema,
      description: withPaginationNote(
        'Run a read-only TSO query command on z/OS, such as LISTUSER, LISTGRP, LISTDSD, RLIST, SEARCH, LISTDS, LISTALC, LISTCAT, LISTBC, STATUS, WHO, TIME, SYSTEM, or HELP. ' +
          'Only these commands are accepted (no confirmation prompts, nothing that changes the system), ' +
          'so it is available to read-only users; use runSafeTsoCommand for anything else. ' +
          'RACF commands list only what the signed-in user is authorized to see',
        PAGINATION_NOTE_LINES
      ),
      _meta: { resourceEffectLevel: ResourceEffect.READ },
      inputSchema: {
        commandText: z
          .string()
          .describe(
            "The TSO query command, e.g. LISTUSER USER01 TSO, LISTGRP SYS1, RLIST FACILITY BPX.SUPERUSER ALL, LISTDS 'USER.DATA'."
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
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
    async ({ commandText, system, startLine, lineCount }, extra) => {
      const progress = createToolProgress(extra, 'Run TSO query');
      await progress.start();
      log.info('queryTso called', { commandText: commandText.slice(0, 80), system });
      try {
        const safeCommand = buildTsoQueryCommand(commandText);
        return await executeTsoCommand(
          deps,
          { commandText: safeCommand, system, startLine, lineCount },
          extra,
          progress
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );
}

/** Runs a validated TSO command (with caching and line windowing) and wraps the response. */
async function executeTsoCommand(
  deps: TsoToolDeps,
  args: { commandText: string; system?: string; startLine?: number; lineCount?: number },
  extra: { _meta?: { progressToken?: string | number } | undefined },
  progress: ToolProgressReporter
) {
  const { commandText, system, startLine, lineCount } = args;
  const { systemId, userId: resolvedUserId } = resolveSystemForTool(
    deps.systemRegistry,
    deps.sessionState,
    system
  );
  await ensureContext(deps, systemId, resolvedUserId);

  const userId = deps.sessionState.getContext(systemId)?.userId;
  const progressCb = extra._meta?.progressToken
    ? (msg: string) => void progress.step(msg)
    : undefined;

  const cacheKey = buildCacheKey('runTsoCommand', {
    systemId,
    commandText,
  });
  const scope = buildScopeSystem(systemId);

  const isPaging = startLine !== undefined || lineCount !== undefined;
  let fullOutput: string;

  const fetchCmd = async () => {
    const out = await deps.backend.runTsoCommand(systemId, commandText, userId, progressCb);
    return { text: out };
  };
  if (!isPaging && deps.responseCache) {
    const result = await fetchCmd();
    deps.responseCache.set(cacheKey, result, [scope]);
    fullOutput = result.text;
  } else {
    fullOutput = (await withCache(deps.responseCache, cacheKey, fetchCmd, [scope])).text;
  }

  const sanitized = sanitizeTextForDisplay(fullOutput);
  const { text, meta, mimeType } = windowContent(
    sanitized,
    startLine ?? 1,
    lineCount ?? (isPaging ? undefined : MAX_READ_LINES)
  );
  const lines = textToLines(text);

  const ctx = buildContext(systemId, {});

  await progress.complete(`${meta.returnedLines} lines`);
  return wrapResponse(ctx, meta, { lines, mimeType }, getReadMessages(meta));
}
