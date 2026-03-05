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
import type { JobCardStore } from '../../zos/job-cards.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import {
  getContextOutputSchema,
  listSystemsOutputSchema,
  setSystemOutputSchema,
} from './context-output-schemas.js';

/** Dependencies injected into context tool registration. */
export interface ContextToolDeps {
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  /** When provided, getContext includes the job card for the active system (if configured). */
  jobCardStore?: JobCardStore;
  /** When provided, called after setSystem succeeds with the new connection spec (e.g. user@host). */
  onActiveConnectionChanged?: (activeConnection: string) => void;
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
  const {
    systemRegistry,
    sessionState,
    credentialProvider,
    jobCardStore,
    onActiveConnectionChanged,
  } = deps;

  // -----------------------------------------------------------------------
  // listSystems
  // -----------------------------------------------------------------------
  server.registerTool(
    'listSystems',
    {
      description:
        'List all z/OS systems you have access to. Each system is a host; multiple configured connections (user@host) to the same host appear as one system with a connections list. ' +
        'Use setSystem to select which system (and optionally which connection) to use.',
      annotations: { readOnlyHint: true },
      outputSchema: listSystemsOutputSchema,
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

      const payload = { systems: result, messages: [] as string[] };
      await progress.complete(`${result.length} systems`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload as Record<string, unknown>,
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
        'Set the active z/OS system. The system parameter can be a host (e.g. zos.example.com) when only one connection exists for that host, or a connection spec (e.g. USER@zos.example.com) when multiple connections exist for the same host. ' +
        'If you pass only a host and multiple connections exist, the tool fails and lists valid connection values. ' +
        'Optionally set mainframe encodings for this system (data set and USS); omit to leave existing overrides unchanged, or pass null to use MCP server default.',
      outputSchema: setSystemOutputSchema,
      inputSchema: {
        system: z
          .string()
          .describe(
            'Hostname of the z/OS system to activate (e.g. sys1.example.com or sys1 when unambiguous), or connection spec (user@host) when multiple connections exist for that host.'
          ),
        mainframeMvsEncoding: z
          .union([z.string(), z.null()])
          .optional()
          .describe(
            'MVS/data set encoding (EBCDIC) for this system. Omit to leave unchanged; pass null to use MCP server default.'
          ),
        mainframeUssEncoding: z
          .union([z.string(), z.null()])
          .optional()
          .describe(
            'Mainframe USS encoding (EBCDIC) for this system. Omit to leave unchanged; pass null to use MCP server default.'
          ),
      },
    },
    async ({ system, mainframeMvsEncoding, mainframeUssEncoding }, extra) => {
      const title = `Set active system to ${system}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('setSystem called', { system, mainframeMvsEncoding, mainframeUssEncoding });

      let resolvedSystemId: string;
      let resolvedUserId: string | undefined;
      try {
        const resolved = resolveSystemForTool(systemRegistry, sessionState, system);
        resolvedSystemId = resolved.systemId;
        resolvedUserId = resolved.userId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await progress.complete('failed');
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }

      const sysInfo = systemRegistry.get(resolvedSystemId);
      const resolvedFromShortName =
        system.trim() !== resolvedSystemId &&
        !system.includes('@') &&
        system.toLowerCase() !== resolvedSystemId.toLowerCase();
      const messages = resolvedFromShortName
        ? [`System resolved from unqualified name '${system}'.`]
        : [];

      const credentials = await credentialProvider.getCredentials(
        resolvedSystemId,
        resolvedUserId,
        { progress: msg => void progress.step(msg) }
      );
      const encodingOverrides =
        mainframeMvsEncoding !== undefined || mainframeUssEncoding !== undefined
          ? { mainframeMvsEncoding, mainframeUssEncoding }
          : undefined;
      const ctx = sessionState.setActiveSystem(
        resolvedSystemId,
        credentials.user,
        encodingOverrides
      );

      const connectionSpec = `${ctx.userId}@${resolvedSystemId}`;
      onActiveConnectionChanged?.(connectionSpec);

      const response: Record<string, unknown> = {
        activeSystem: resolvedSystemId,
        userId: ctx.userId,
        description: sysInfo?.description,
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
        structuredContent: response,
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
        'Return the current session context: active system, active connection (user@host), user ID, ' +
        'all known systems (with their connections when multiple exist), and recently used systems (those with saved context).',
      annotations: { readOnlyHint: true },
      outputSchema: getContextOutputSchema,
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
        /** Active connection spec (user@host) for this system. */
        activeConnection?: string;
        mainframeMvsEncoding?: string | null;
        mainframeUssEncoding?: string | null;
        ussHome?: string;
        ussCwd?: string;
        /** Job card for this connection (when configured). Used by submitJob when JCL has no job card. */
        jobCard?: string;
      } | null = null;
      if (activeSystemId) {
        const ctx = sessionState.getContext(activeSystemId);
        if (ctx) {
          activeSystem = {
            system: activeSystemId,
            userId: ctx.userId,
            activeConnection: `${ctx.userId}@${activeSystemId}`,
          };
          if (ctx.mainframeMvsEncoding !== undefined || ctx.mainframeUssEncoding !== undefined) {
            activeSystem.mainframeMvsEncoding = ctx.mainframeMvsEncoding ?? null;
            activeSystem.mainframeUssEncoding = ctx.mainframeUssEncoding ?? null;
          }
          if (ctx.ussHome !== undefined) {
            activeSystem.ussHome = ctx.ussHome;
          }
          activeSystem.ussCwd = ctx.ussCwd ?? ctx.ussHome ?? undefined;
          if (jobCardStore) {
            const connectionSpec = `${ctx.userId}@${activeSystemId}`;
            const card = jobCardStore.get(connectionSpec);
            if (card) {
              activeSystem.jobCard = card;
            }
          }
        }
      }

      const allSystems = allConfigured.map(s => ({
        host: s.host,
        description: s.description,
        ...(s.connections && s.connections.length > 0 ? { connections: s.connections } : {}),
        active: s.host === activeSystemId,
      }));

      const payload = {
        activeSystem,
        allSystems,
        recentlyUsedSystems: recentlyUsed,
        messages: [] as string[],
      };
      await progress.complete('done');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload as Record<string, unknown>,
      };
    }
  );
}
