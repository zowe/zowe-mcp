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
 * setting the DSN prefix, and inspecting the current session context.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';

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
  // list_systems
  // -----------------------------------------------------------------------
  server.registerTool(
    'list_systems',
    {
      description:
        'List all configured z/OS systems with their descriptions. ' +
        'Use this to discover available systems before connecting with set_system.',
      annotations: { readOnlyHint: true },
    },
    () => {
      log.debug('list_systems called');
      const systems = systemRegistry.listInfo();
      const activeSystem = sessionState.getActiveSystem();

      const result = systems.map(s => ({
        ...s,
        active: s.host === activeSystem,
      }));

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
  // set_system
  // -----------------------------------------------------------------------
  server.registerTool(
    'set_system',
    {
      description:
        'Set the active z/OS system. This restores the per-system context ' +
        '(DSN prefix, user ID) if the system was previously used. ' +
        'On first connection, the DSN prefix defaults to the user ID. ' +
        'Hostname can be fully qualified (e.g. sys1.example.com) or unqualified when unambiguous (e.g. sys1, SYS1).',
      inputSchema: {
        system: z
          .string()
          .describe(
            'Hostname of the z/OS system to activate (e.g. "sys1.example.com" or "sys1" when unambiguous).'
          ),
      },
    },
    async ({ system }) => {
      log.info('set_system called', { system });

      const sysInfo = systemRegistry.getOrResolve(system);
      if (!sysInfo) {
        const available = systemRegistry.list().join(', ');
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `System '${system}' not found. Available systems: ${available}. ` +
                'Use list_systems to see all configured systems.',
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

      const creds = await credentialProvider.getCredentials(resolvedHost);
      const ctx = sessionState.setActiveSystem(resolvedHost, creds.user);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                activeSystem: resolvedHost,
                userId: ctx.userId,
                dsnPrefix: ctx.dsnPrefix,
                description: sysInfo.description,
                messages,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // set_dsn_prefix
  // -----------------------------------------------------------------------
  server.registerTool(
    'set_dsn_prefix',
    {
      description:
        'Set the DSN prefix for the current active z/OS system. ' +
        'The prefix is one or more full DSN segments (e.g. "IBMUSER" or "IBMUSER.SRC"). ' +
        'Relative dataset names are resolved against it. If the prefix ends with a dot, ' +
        'the dot is removed and a message is returned.',
      inputSchema: {
        prefix: z.string().describe('DSN prefix to set (e.g. "IBMUSER" or "IBMUSER.SRC")'),
      },
    },
    ({ prefix }) => {
      log.info('set_dsn_prefix called', { prefix });

      try {
        let normalized = prefix.trim();
        const hadTrailingDot = normalized.endsWith('.');
        if (hadTrailingDot) {
          normalized = normalized.slice(0, -1);
        }
        const ctx = sessionState.setDsnPrefix(normalized);
        const activeSystem = sessionState.getActiveSystem();
        const messages = hadTrailingDot
          ? ['Trailing dot removed from DSN prefix. DSN prefix can be only full DSN segments.']
          : [];

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  activeSystem,
                  userId: ctx.userId,
                  dsnPrefix: ctx.dsnPrefix,
                  messages,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: (err as Error).message,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // get_context
  // -----------------------------------------------------------------------
  server.registerTool(
    'get_context',
    {
      description:
        'Return the current session context: active system, DSN prefix, ' +
        'user ID, all known systems, and recently used systems (those with saved context).',
      annotations: { readOnlyHint: true },
    },
    () => {
      log.debug('get_context called');

      const activeSystemId = sessionState.getActiveSystem();
      const allConfigured = systemRegistry.listInfo();
      const recentlyUsed = sessionState.getAllContexts();

      let activeSystem = null;
      if (activeSystemId) {
        const ctx = sessionState.getContext(activeSystemId);
        if (ctx) {
          activeSystem = {
            system: activeSystemId,
            userId: ctx.userId,
            dsnPrefix: ctx.dsnPrefix,
          };
        }
      }

      const allSystems = allConfigured.map(s => ({
        host: s.host,
        description: s.description,
        active: s.host === activeSystemId,
      }));

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
