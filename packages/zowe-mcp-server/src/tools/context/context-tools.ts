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
 * Context management tools for the Zowe MCP Server.
 *
 * Provides tools for listing z/OS systems, switching the active system,
 * and inspecting the current session context.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';

/** Zod schema for optional string or null (null = use server default). */
const optionalEncoding = z
  .union([z.string(), z.null()])
  .optional()
  .describe(
    'Mainframe encoding (EBCDIC) for this system. Omit to leave unchanged; pass null to use MCP server default.'
  );

/** Dependencies injected into context tool registration. */
export interface ContextToolDeps {
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
}

/**
 * Registers context management tools on the given MCP server.
 */
export function registerContextTools(
  server: McpServer,
  deps: ContextToolDeps,
  logger: Logger
): void {
  const log = logger.child('context');
  const { systemRegistry, sessionState, credentialProvider } = deps;

  // -----------------------------------------------------------------------
  // listSystems
  // -----------------------------------------------------------------------
  server.registerTool(
    'listSystems',
    {
      description:
        'List all configured z/OS systems with their descriptions. ' +
        'Use this to discover available systems before connecting with setSystem.',
      annotations: { readOnlyHint: true },
    },
    async extra => {
      const progress = createToolProgress(extra, 'List configured systems');
      await progress.start();
      log.debug('listSystems called');
      const systems = systemRegistry.listInfo();
      const activeSystem = sessionState.getActiveSystem();

      const result = systems.map(s => ({
        ...s,
        active: s.host === activeSystem,
      }));

      await progress.complete(`${result.length} systems`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ systems: result, messages: [] as string[] }, null, 2),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // setSystem
  // -----------------------------------------------------------------------
  server.registerTool(
    'setSystem',
    {
      description:
        'Set the active z/OS system. This restores the per-system context (user ID, encoding overrides) if the system was previously used. ' +
        'Hostname can be fully qualified (e.g. sys1.example.com) or unqualified when unambiguous (e.g. sys1, SYS1). ' +
        'Optionally set mainframe encodings for this system (dataset and USS); omit to leave existing overrides unchanged, or pass null to use MCP server default.',
      inputSchema: {
        system: z
          .string()
          .describe(
            'Hostname of the z/OS system to activate (e.g. "sys1.example.com" or "sys1" when unambiguous).'
          ),
        mainframeMvsEncoding: optionalEncoding,
        mainframeUssEncoding: optionalEncoding,
      },
    },
    async ({ system, mainframeMvsEncoding, mainframeUssEncoding }, extra) => {
      const title = `Set active system to ${system}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('setSystem called', { system, mainframeMvsEncoding, mainframeUssEncoding });

      const sysInfo = systemRegistry.getOrResolve(system);
      if (!sysInfo) {
        const available = systemRegistry.list().join(', ');
        await progress.complete(`system not found`);
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `System '${system}' not found. Available systems: ${available}. ` +
                'Use listSystems to see all configured systems.',
            },
          ],
          isError: true,
        };
      }

      const resolvedHost = sysInfo.host;
      const resolvedFromShortName = resolvedHost.toLowerCase() !== system.toLowerCase();
      const messages = resolvedFromShortName
        ? [`System resolved from unqualified name '${system}'.`]
        : [];

      const credentials = await credentialProvider.getCredentials(resolvedHost, undefined, {
        progress: msg => progress.step(msg),
      });
      const encodingOverrides =
        mainframeMvsEncoding !== undefined || mainframeUssEncoding !== undefined
          ? { mainframeMvsEncoding, mainframeUssEncoding }
          : undefined;
      const ctx = sessionState.setActiveSystem(resolvedHost, credentials.user, encodingOverrides);

      const response: Record<string, unknown> = {
        activeSystem: resolvedHost,
        userId: ctx.userId,
        description: sysInfo.description,
        messages,
      };
      if (ctx.mainframeMvsEncoding !== undefined || ctx.mainframeUssEncoding !== undefined) {
        response.mainframeMvsEncoding = ctx.mainframeMvsEncoding ?? null;
        response.mainframeUssEncoding = ctx.mainframeUssEncoding ?? null;
      }

      await progress.complete('connected');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // getContext
  // -----------------------------------------------------------------------
  server.registerTool(
    'getContext',
    {
      description:
        'Return the current session context: active system, user ID, ' +
        'all known systems, and recently used systems (those with saved context).',
      annotations: { readOnlyHint: true },
    },
    async extra => {
      const progress = createToolProgress(extra, 'Get current session context');
      await progress.start();
      log.debug('getContext called');

      const activeSystemId = sessionState.getActiveSystem();
      const allConfigured = systemRegistry.listInfo();
      const recentlyUsed = sessionState.getAllContexts();

      let activeSystem: {
        system: string;
        userId: string;
        mainframeMvsEncoding?: string | null;
        mainframeUssEncoding?: string | null;
      } | null = null;
      if (activeSystemId) {
        const ctx = sessionState.getContext(activeSystemId);
        if (ctx) {
          activeSystem = {
            system: activeSystemId,
            userId: ctx.userId,
          };
          if (ctx.mainframeMvsEncoding !== undefined || ctx.mainframeUssEncoding !== undefined) {
            activeSystem.mainframeMvsEncoding = ctx.mainframeMvsEncoding ?? null;
            activeSystem.mainframeUssEncoding = ctx.mainframeUssEncoding ?? null;
          }
        }
      }

      const allSystems = allConfigured.map(s => ({
        host: s.host,
        description: s.description,
        active: s.host === activeSystemId,
      }));

      await progress.complete('done');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                activeSystem,
                allSystems,
                recentlyUsedSystems: recentlyUsed,
                messages: [] as string[],
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
