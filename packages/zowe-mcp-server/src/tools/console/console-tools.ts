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
import { createRequire } from 'node:module';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  getReadMessages,
  textToLines,
  windowContent,
  wrapResponse,
} from '../response.js';
import { runConsoleCommandOutputSchema } from './console-output-schemas.js';

const require = createRequire(import.meta.url);

interface PatternEntry {
  pattern: string;
  description: string;
}

interface ConsolePatterns {
  dangerous: PatternEntry[];
  elicit: PatternEntry[];
  safe: PatternEntry[];
}

let cachedPatterns: ConsolePatterns | undefined;

function getPatterns(): ConsolePatterns {
  if (cachedPatterns) return cachedPatterns;
  cachedPatterns = require('./console-command-patterns.json') as ConsolePatterns;
  return cachedPatterns;
}

interface ConsoleCommandValidationResult {
  action: 'allow' | 'block' | 'elicit';
  reason?: string;
}

function validateConsoleCommand(commandText: string): ConsoleCommandValidationResult {
  const normalized = commandText.trim().replace(/\s+/g, ' ').toUpperCase();
  const { dangerous, elicit, safe } = getPatterns();

  for (const entry of dangerous) {
    if (new RegExp(entry.pattern, 'i').test(normalized)) {
      return { action: 'block', reason: entry.description };
    }
  }
  for (const entry of safe) {
    if (new RegExp(entry.pattern, 'i').test(normalized)) {
      return { action: 'allow' };
    }
  }
  for (const entry of elicit) {
    if (new RegExp(entry.pattern, 'i').test(normalized)) {
      return { action: 'elicit', reason: entry.description };
    }
  }
  return { action: 'elicit', reason: 'Unknown console command — requires user approval' };
}

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
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.'
          ),
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
        const validation = validateConsoleCommand(commandText);
        if (validation.action === 'block') {
          await progress.complete('blocked');
          return errorResult(
            `Console command blocked: ${validation.reason}. This command is too dangerous to run via AI.`
          );
        }

        if (validation.action === 'elicit') {
          try {
            const elicitResult = await deps.mcpServer.server.elicitInput({
              message: `Console command requires approval: ${commandText}\nReason: ${validation.reason}`,
              requestedSchema: {
                type: 'object' as const,
                properties: {
                  confirm: {
                    type: 'string' as const,
                    title: 'Run command',
                    description: commandText.trim(),
                  },
                },
              },
            });
            if (elicitResult.action !== 'accept') {
              await progress.complete('declined');
              return errorResult('Console command declined by user.');
            }
          } catch {
            await progress.complete('elicitation unavailable');
            return errorResult(
              `Console command "${commandText.trim()}" requires user approval but elicitation is not available. Only safe DISPLAY commands can run without approval.`
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
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );
}
