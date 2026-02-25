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
import type { Logger } from '../../log.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { ResponseCache } from '../../zos/response-cache.js';
import { buildCacheKey, buildScopeSystem } from '../../zos/response-cache.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  getReadMessages,
  MAX_READ_LINES,
  sanitizeTextForDisplay,
  windowContent,
  wrapResponse,
} from '../response.js';
import { validateTsoCommand } from './tso-command-validation.js';
import { runSafeTsoCommandOutputSchema } from './tso-output-schemas.js';

async function ensureContext(
  deps: { sessionState: SessionState; credentialProvider: CredentialProvider },
  systemId: string,
  userId?: string
): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const credentials = await deps.credentialProvider.getCredentials(systemId, userId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
}

function errorResult(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

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
      description:
        'Run a TSO command on z/OS. Only allowlisted (safe) commands run automatically. ' +
        'Unknown commands require user confirmation (elicitation); if the client does not support elicitation, execution is denied. ' +
        'Output is paginated by line; when _result.hasMore is true, call again with startLine and lineCount to get the next lines. ' +
        'Requesting the same command without startLine and lineCount re-executes the command.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        commandText: z
          .string()
          .describe(
            "The TSO command to execute (e.g. LISTDS 'USER.DATA', LISTALC, LISTCAT, STATUS)."
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
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
          const msg =
            validation.pattern?.message ?? 'This TSO command is not allowed for security reasons.';
          await progress.complete(msg);
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
            const result = await deps.mcpServer.server.elicitInput({
              mode: 'form',
              message: `${elicitMsg} Do you want to run this TSO command?`,
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

        if (!isPaging) {
          fullOutput = await deps.backend.runTsoCommand(systemId, commandText, userId, progressCb);
          if (deps.responseCache) {
            deps.responseCache.set(cacheKey, { text: fullOutput }, [scope]);
          }
        } else {
          if (deps.responseCache) {
            const cached = await deps.responseCache.getOrFetch(cacheKey, async () => {
              const out = await deps.backend.runTsoCommand(
                systemId,
                commandText,
                userId,
                progressCb
              );
              return { text: out };
            }, [scope]);
            fullOutput = cached.text;
          } else {
            fullOutput = await deps.backend.runTsoCommand(
              systemId,
              commandText,
              userId,
              progressCb
            );
          }
        }

        const sanitized = sanitizeTextForDisplay(fullOutput);
        const { text, meta, mimeType } = windowContent(
          sanitized,
          startLine ?? 1,
          lineCount ?? (isPaging ? undefined : MAX_READ_LINES)
        );

        const ctx = buildContext(systemId, {});

        await progress.complete(`${meta.returnedLines} lines`);
        return wrapResponse(ctx, meta, { text, mimeType }, getReadMessages(meta));
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );
}
