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
import {
  type CapabilityTier,
  EFFECT_LEVEL_NAME,
  ResourceEffect,
  TIER_TO_MAX_EFFECT,
} from '../../capability-level.js';
import type { Logger } from '../../log.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { EncodingOptions } from '../../zos/encoding.js';
import type { JobCardStore } from '../../zos/job-cards.js';
import { parseConnectionSpec } from '../../zos/native/connection-spec.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import {
  addZosConnectionOutputSchema,
  getContextOutputSchema,
  listSystemsOutputSchema,
  removeZosConnectionOutputSchema,
  setSystemOutputSchema,
} from './context-output-schemas.js';

/** Dependencies injected into context tool registration. */
export interface ContextToolDeps {
  /** Server version string (from package.json). */
  serverVersion: string;
  /** Backend kind when connected (e.g. "mock", "zowex") or null when none. */
  backendKind: string | null;
  /** z/OS system registry. Required for listSystems/setSystem; when absent, only getContext is registered. */
  systemRegistry?: SystemRegistry;
  /** Session state. Required for listSystems/setSystem/getContext z/OS fields. */
  sessionState?: SessionState;
  /** Credential provider. Required for setSystem. */
  credentialProvider?: CredentialProvider;
  /** When provided, getContext includes the job card for the active system (if configured). */
  jobCardStore?: JobCardStore;
  /** When provided, called after setSystem succeeds with the new connection spec (e.g. user@host). */
  onActiveConnectionChanged?: (activeConnection: string) => void;
  /** Server-level default encodings. When provided, getContext includes effective encodings for the active system. */
  encodingOptions?: EncodingOptions;
  /** Active capability tier. When provided, getContext includes it in server info. */
  capabilityTier?: CapabilityTier;
  /**
   * When set (HTTP + JWT + tenant store), registers addZosConnection to append a connection and persist per OIDC sub.
   */
  addTenantNativeConnection?: (spec: string) => Promise<void>;
  /**
   * When set with addTenantNativeConnection, registers removeZosConnection to remove a saved tenant connection.
   */
  removeTenantNativeConnection?: (spec: string) => Promise<void>;
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
    serverVersion,
    backendKind,
    systemRegistry,
    sessionState,
    credentialProvider,
    jobCardStore,
    onActiveConnectionChanged,
    encodingOptions,
    capabilityTier,
    addTenantNativeConnection,
    removeTenantNativeConnection,
  } = deps;

  const hasBackend = !!(systemRegistry && sessionState && credentialProvider);

  const components: string[] = hasBackend
    ? [
        'context',
        ...(addTenantNativeConnection && removeTenantNativeConnection
          ? ['addZosConnection', 'removeZosConnection']
          : []),
        'datasets',
        'uss',
        'tso',
        'jobs',
        'local-files',
      ]
    : ['context'];

  // -----------------------------------------------------------------------
  // addZosConnection / removeZosConnection (HTTP + JWT + tenant store only)
  // -----------------------------------------------------------------------
  if (hasBackend && addTenantNativeConnection && removeTenantNativeConnection) {
    server.registerTool(
      'addZosConnection',
      {
        description:
          'Add a z/OS SSH connection (user@host or user@host:port) for the current signed-in user only. Each OIDC subject has a separate persisted list (no cross-user sharing). Prefer this over baking connection lists into server startup for remote HTTP. After adding, use setSystem with the new host or connection spec. Passwords for this user@host (SSH, Db2, etc.): MCP elicitation when supported, else ZOWE_MCP_PASSWORD_* / ZOWE_MCP_CREDENTIALS.',
        _meta: { resourceEffectLevel: ResourceEffect.NONE },
        outputSchema: addZosConnectionOutputSchema,
        inputSchema: {
          connectionSpec: z
            .string()
            .describe(
              'Connection string: user@host or user@host:port (same format as standalone --zowex --system).'
            ),
        },
      },
      async ({ connectionSpec }, extra) => {
        const progress = createToolProgress(extra, 'Add z/OS connection');
        await progress.start();
        let normalized: string;
        try {
          const parsed = parseConnectionSpec(connectionSpec.trim());
          normalized =
            parsed.port === 22
              ? `${parsed.user}@${parsed.host}`
              : `${parsed.user}@${parsed.host}:${parsed.port}`;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await progress.complete('failed');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
        try {
          await addTenantNativeConnection(normalized);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await progress.complete('failed');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
        const payload = {
          connectionSpec: normalized,
          persisted: true,
          messages: [
            'Connection added for your user only. Use setSystem with this host or connection spec. Password (SSH, Db2, etc.): elicitation when the client supports it, else set ZOWE_MCP_PASSWORD_* or ZOWE_MCP_CREDENTIALS.',
          ],
        };
        await progress.complete('ok');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      }
    );

    server.registerTool(
      'removeZosConnection',
      {
        description:
          'Remove a z/OS SSH connection (user@host or user@host:port) from your per-user saved list (OIDC subject). Only connections previously added with addZosConnection or stored in the tenant file can be removed here. Connections supplied only via server startup (--config/--system) must be changed in server configuration. After removal, pick another system with setSystem if needed.',
        _meta: { resourceEffectLevel: ResourceEffect.NONE },
        outputSchema: removeZosConnectionOutputSchema,
        inputSchema: {
          connectionSpec: z
            .string()
            .describe(
              'Connection string to remove: user@host or user@host:port (same format as addZosConnection).'
            ),
        },
      },
      async ({ connectionSpec }, extra) => {
        const progress = createToolProgress(extra, 'Remove z/OS connection');
        await progress.start();
        let normalized: string;
        try {
          const parsed = parseConnectionSpec(connectionSpec.trim());
          normalized =
            parsed.port === 22
              ? `${parsed.user}@${parsed.host}`
              : `${parsed.user}@${parsed.host}:${parsed.port}`;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await progress.complete('failed');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
        try {
          await removeTenantNativeConnection(normalized);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await progress.complete('failed');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
        const payload = {
          connectionSpec: normalized,
          persisted: true,
          messages: [
            'Connection removed from your saved list. If it was the active connection, call setSystem to switch to another host or connection.',
          ],
        };
        await progress.complete('ok');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      }
    );
  }

  // -----------------------------------------------------------------------
  // listSystems (only when z/OS backend is configured)
  // -----------------------------------------------------------------------
  if (hasBackend)
    server.registerTool(
      'listSystems',
      {
        description:
          'List all z/OS systems you have access to. Each system is a host; multiple configured connections (user@host) to the same host appear as one system with a connections list. ' +
          'Use setSystem to select which system (and optionally which connection) to use.',
        _meta: { resourceEffectLevel: ResourceEffect.NONE },
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

        const payload: Record<string, unknown> = { systems: result };
        await progress.complete(`${result.length} systems`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(payload, null, 2),
            },
          ],
          structuredContent: payload,
        };
      }
    );

  // -----------------------------------------------------------------------
  // setSystem (only when z/OS backend is configured)
  // -----------------------------------------------------------------------
  if (hasBackend)
    server.registerTool(
      'setSystem',
      {
        description:
          'Set the active z/OS system. The system parameter can be a host (e.g. zos.example.com) when only one connection exists for that host, or a connection spec (e.g. USER@zos.example.com) when multiple connections exist for the same host. ' +
          'If you pass only a host and multiple connections exist, the tool fails and lists valid connection values. ' +
          'Optionally set mainframe encodings for this system (data set and USS); omit to leave existing overrides unchanged, or pass null to use MCP server default.',
        _meta: { resourceEffectLevel: ResourceEffect.NONE },
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
        };
        if (messages.length > 0) {
          response.messages = messages;
        }
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
  // getContext (always registered — includes server info)
  // -----------------------------------------------------------------------
  const backendDescription = hasBackend
    ? ''
    : 'When no z/OS backend is configured, only this tool is available. ' +
      'Configure a backend to enable z/OS tools: mock (VS Code "zoweMCP.mockDataDirectory" or standalone --mock / ZOWE_MCP_MOCK_DIR) or Zowe Remote SSH / zowex (VS Code "zoweMCP.zowexConnections" or standalone --zowex --system user@host).';

  server.registerTool(
    'getContext',
    {
      description:
        'Return the Zowe MCP server info (version, backend, components) and the current session context: active system, active connection (user@host), user ID, ' +
        'all known systems (with their connections when multiple exist), and recently used systems (those with saved context). ' +
        backendDescription,
      _meta: { resourceEffectLevel: ResourceEffect.NONE },
      outputSchema: getContextOutputSchema,
    },
    async extra => {
      const progress = createToolProgress(extra, 'Get current session context');
      await progress.start();
      log.debug('getContext called');

      const serverInfo = {
        name: 'Zowe MCP Server',
        version: serverVersion,
        description:
          'MCP server providing tools for z/OS systems including data sets, jobs, and UNIX System Services',
        components,
        backend: backendKind,
        ...(capabilityTier
          ? { maxEffectLevel: EFFECT_LEVEL_NAME[TIER_TO_MAX_EFFECT[capabilityTier]] }
          : {}),
      };

      if (!hasBackend) {
        const messages = [
          'No z/OS backend is configured. Only the "getContext" tool is available. ' +
            'To enable all z/OS tools, configure a backend:\n' +
            '  - Mock: VS Code — run "Zowe MCP: Generate Mock Data" or set "zoweMCP.mockDataDirectory"; ' +
            'Standalone — --mock <dir> or ZOWE_MCP_MOCK_DIR\n' +
            '  - Zowe Remote SSH / zowex: VS Code — set "zoweMCP.zowexConnections" (e.g. ["user@host"]); ' +
            'Standalone — --zowex --system user@host (or --config <path>)',
        ];
        const payload: Record<string, unknown> = {
          server: serverInfo,
          activeSystem: null,
          allSystems: [],
          recentlyUsedSystems: [],
          messages,
        };
        await progress.complete('ready');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(payload, null, 2),
            },
          ],
          structuredContent: payload,
        };
      }

      const activeSystemId = sessionState.getActiveSystem();
      const allConfigured = systemRegistry.listInfo();
      const recentlyUsed = sessionState.getAllContexts();

      let activeSystem: {
        system: string;
        userId: string;
        activeConnection?: string;
        mainframeMvsEncoding?: string | null;
        mainframeUssEncoding?: string | null;
        ussHome?: string;
        ussCwd?: string;
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
          if (encodingOptions) {
            activeSystem.mainframeMvsEncoding =
              ctx.mainframeMvsEncoding ?? encodingOptions.defaultMainframeMvsEncoding;
            activeSystem.mainframeUssEncoding =
              ctx.mainframeUssEncoding ?? encodingOptions.defaultMainframeUssEncoding;
          } else if (
            ctx.mainframeMvsEncoding !== undefined ||
            ctx.mainframeUssEncoding !== undefined
          ) {
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

      const payload: Record<string, unknown> = {
        server: serverInfo,
        activeSystem,
        allSystems,
        recentlyUsedSystems: recentlyUsed,
      };
      await progress.complete('done');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload,
      };
    }
  );
}
