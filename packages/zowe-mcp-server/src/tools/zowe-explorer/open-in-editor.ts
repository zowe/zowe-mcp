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
 * Zowe Explorer integration: open dataset or PDS member in the VS Code editor.
 *
 * When Zowe Explorer is installed, this tool sends an event to the extension
 * to open the given dataset (or member) in Zowe Explorer's editor via the
 * zowe-ds URI scheme.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OpenDatasetInEditorEventData } from '../../events.js';
import type { Logger } from '../../log.js';
import { resolveDsn } from '../../zos/dsn.js';
import type { SessionState } from '../../zos/session.js';
import { createToolProgress } from '../progress.js';

/** Dependencies for the open-in-editor tool. */
export interface OpenInZoweEditorDeps {
  /** Callback to send the open request to the VS Code extension. */
  openInZoweEditor: (payload: OpenDatasetInEditorEventData) => void;
  /** When provided, used as current system id and for connectionKind. */
  sessionState?: SessionState;
  /** When 'native', extension prefers ssh profile when resolving by system. */
  backendKind?: string | null;
}

/**
 * Registers the openDatasetInEditor tool when Zowe Explorer is available.
 */
export function registerZoweExplorerTools(
  server: McpServer,
  deps: OpenInZoweEditorDeps,
  logger: Logger
): void {
  const log = logger.child('zowe-explorer');
  const { openInZoweEditor, sessionState, backendKind } = deps;

  server.registerTool(
    'openDatasetInEditor',
    {
      annotations: { readOnlyHint: true },
      description:
        'Open a sequential dataset or a PDS/PDSE member in the VS Code editor via Zowe Explorer. ' +
        "The dataset opens in Zowe Explorer's editor so the user can view or edit it. " +
        'Requires Zowe Explorer to be installed. The extension resolves the Zowe profile (default or match by system) or prompts to choose one and remembers it for the session.',
      inputSchema: {
        dsn: z
          .string()
          .describe('Fully qualified dataset name (e.g. USER.SRC.COBOL or USER.PDS).'),
        member: z
          .string()
          .optional()
          .describe('Member name for a PDS/PDSE; omit for sequential datasets.'),
        system: z
          .string()
          .optional()
          .describe(
            'MCP system id (e.g. user@host) to match a Zowe profile. Omit to use the current active system.'
          ),
      },
    },
    async ({ dsn, member, system: systemArg }, extra) => {
      const progress = createToolProgress(extra, 'Open dataset in Zowe Explorer');
      await progress.start();

      try {
        const resolved = resolveDsn(dsn, member);
        const currentSystemId = systemArg ?? sessionState?.getActiveSystem() ?? undefined;
        const connectionKind = backendKind === 'native' ? ('native' as const) : ('zosmf' as const);

        openInZoweEditor({
          dsn: resolved.dsn,
          member: resolved.member,
          system: currentSystemId,
          connectionKind,
        });

        await progress.complete('Opening in Zowe Explorer.');
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Opening dataset in Zowe Explorer. The document should appear in your editor shortly.',
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('openDatasetInEditor validation failed', { dsn, member, err });
        await progress.complete(message);
        throw err;
      }
    }
  );
}
