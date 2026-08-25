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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ResourceEffect } from '../../capability-level.js';
import type { Logger } from '../../log.js';
import { resolveAsset } from '../../runtime/asset-root.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import {
  evaluateCommandSafety,
  formatBlockedCommandMessage,
  type CommandPatterns,
} from '../command-safety.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  getReadMessages,
  SYSTEM_PARAM_DESCRIPTION,
  textToLines,
  windowContent,
  wrapResponse,
} from '../response.js';
import { ensureContext, errorResult } from '../tool-utils.js';
import { runConsoleCommandOutputSchema } from './console-output-schemas.js';

let cachedPatterns: CommandPatterns | undefined;

function getPatterns(): CommandPatterns {
  if (!cachedPatterns) {
    const patternsPath = resolveAsset(
      import.meta.url,
      ['console-command-patterns.json'],
      ['tools', 'console', 'console-command-patterns.json']
    );
    cachedPatterns = JSON.parse(readFileSync(patternsPath, 'utf-8')) as CommandPatterns;
  }
  return cachedPatterns;
}

export interface ConsoleToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  mcpServer: McpServer;
}

export function registerConsoleTools(
  server: McpServer,
  deps: ConsoleToolDeps,
  logger: Logger
): void {
  const log = logger.child('console');

  server.registerTool(
    'runConsoleCommand',
    {
      _meta: { resourceEffectLevel: ResourceEffect.EXECUTE },
      description:
        'Run a z/OS operator console command (e.g. DISPLAY T, DISPLAY A). ' +
        'System-shutdown commands (HALT, SHUTDOWN, QUIESCE, Z EOD) are blocked. ' +
        'Other non-display commands (SET, VARY, CANCEL, FORCE, START, STOP, MODIFY) require user approval. ' +
        'Unknown commands also require user approval.',
      outputSchema: runConsoleCommandOutputSchema,
      inputSchema: {
        commandText: z
          .string()
          .describe('Console command to execute (e.g. "D T", "D A,L", "DISPLAY IPLINFO").'),
        consoleName: z.string().optional().describe('Console name (optional).'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based start line for paginating a previous result.'),
        lineCount: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Number of lines to return from startLine.'),
      },
    },
    async ({ commandText, consoleName, system, startLine, lineCount }, extra) => {
      const progress = createToolProgress(extra, `Console: ${commandText.slice(0, 40)}`);
      await progress.start();
      log.info('runConsoleCommand called', { commandText: commandText.slice(0, 80), system });

      try {
        const validation = evaluateCommandSafety(commandText, getPatterns());
        if (validation.action === 'block') {
          const msg = formatBlockedCommandMessage('console', validation.pattern?.message);
          await progress.complete('blocked');
          return errorResult(msg);
        }

        if (validation.action === 'elicit') {
          const reason =
            validation.pattern?.message ?? 'Unknown console command — requires user approval';
          const caps = deps.mcpServer.server.getClientCapabilities();
          // Per MCP spec, empty elicitation object defaults to form mode
          if (!caps?.elicitation) {
            await progress.complete('elicitation unavailable');
            return errorResult(
              `Console command "${commandText.trim()}" requires user approval but elicitation is not available. Only safe DISPLAY commands can run without approval.`
            );
          }
          try {
            const elicitResult = await deps.mcpServer.server.elicitInput({
              mode: 'form',
              message: `Console command requires approval: ${commandText}\nReason: ${reason}`,
              requestedSchema: {
                type: 'object' as const,
                properties: {
                  confirm: {
                    type: 'boolean' as const,
                    title: 'Run command',
                    description: commandText.trim(),
                  },
                },
                required: ['confirm'],
              },
            });
            if (elicitResult.action !== 'accept' || elicitResult.content?.confirm !== true) {
              const declined =
                elicitResult.action === 'decline'
                  ? 'Console command declined by user.'
                  : elicitResult.action === 'cancel'
                    ? 'Console command cancelled by user.'
                    : 'Console command requires confirmation; not confirmed.';
              await progress.complete('declined');
              return errorResult(declined);
            }
          } catch {
            await progress.complete('elicitation failed');
            return errorResult(
              `Console command "${commandText.trim()}" requires user approval but elicitation failed; execution denied.`
            );
          }
        }

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const ctx = deps.sessionState.getContext(systemId);
        const userId = ctx?.userId;

        const fullOutput = await deps.backend.runConsoleCommand(
          systemId,
          commandText,
          consoleName,
          userId
        );

        const {
          text: windowedText,
          meta,
          mimeType,
        } = windowContent(fullOutput, startLine, lineCount);
        const lines = textToLines(windowedText);
        const messages = getReadMessages(meta);
        const responseCtx = buildContext(systemId, {});
        await progress.complete('done');
        return wrapResponse(responseCtx, meta, { lines, mimeType }, messages);
      } catch (err) {
        const message = (err as Error).message;
        await progress.complete(message);
        return errorResult(decorateConsoleError(message));
      }
    }
  );
}

/**
 * Maps known console failure classes to actionable guidance. The raw message
 * is always preserved; this only appends what to do about it.
 */
export function decorateConsoleError(message: string): string {
  if (/unrecognized command|-32601/i.test(message)) {
    return (
      `${message}\nThe z/OS server does not support console commands (needs zowex 0.9.0 or later). ` +
      'It is normally updated automatically on the next connection; reconnect and retry.'
    );
  }
  if (/command not found|permission denied.*zoweax|zoweax.*command not found/i.test(message)) {
    return (
      `${message}\nConsole commands run through the separately installed APF-authorized zoweax binary, ` +
      'which was not found or is not executable on the host. A system programmer must install it — ' +
      'see doc/zoweax-security.md in the zowe/zowex repository.'
    );
  }
  if (/not authorized/i.test(message)) {
    return (
      `${message}\nEither the zoweax binary is not APF-authorized (extattr +ap, set by a system programmer) ` +
      'or the ESM denied the console activation/command (OPERCMDS class). ' +
      'See doc/zoweax-security.md in the zowe/zowex repository. Do not retry until access is granted.'
    );
  }
  return message;
}
