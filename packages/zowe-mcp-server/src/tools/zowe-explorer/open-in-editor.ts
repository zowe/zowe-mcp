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
 * Zowe Explorer integration: open data set or PDS member in the VS Code editor.
 *
 * When Zowe Explorer is installed, this tool sends an event to the extension
 * to open the given data set (or member) in Zowe Explorer's editor via the
 * zowe-ds URI scheme.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  OpenDatasetInEditorEventData,
  OpenJobInEditorEventData,
  OpenUssFileInEditorEventData,
} from '../../events.js';
import type { Logger } from '../../log.js';
import { resolveDsn } from '../../zos/dsn.js';
import type { SessionState } from '../../zos/session.js';
import { createToolProgress } from '../progress.js';

/** Dependencies for the open-in-editor tools. */
export interface OpenInZoweEditorDeps {
  /** Callback to open a data set or member in Zowe Explorer. */
  openInZoweEditor?: (payload: OpenDatasetInEditorEventData) => void;
  /** Callback to open a USS file in Zowe Explorer. */
  openUssFileInZoweEditor?: (payload: OpenUssFileInEditorEventData) => void;
  /** Callback to open a job or job spool in Zowe Explorer. */
  openJobInZoweEditor?: (payload: OpenJobInEditorEventData) => void;
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
  const {
    openInZoweEditor,
    openUssFileInZoweEditor,
    openJobInZoweEditor,
    sessionState,
    backendKind,
  } = deps;
  const connectionKind = backendKind === 'native' ? ('native' as const) : ('zosmf' as const);

  if (openInZoweEditor) {
    server.registerTool(
      'openDatasetInEditor',
      {
        annotations: { readOnlyHint: true },
        description:
          'Open a sequential data set or a PDS/PDSE member in the VS Code editor via Zowe Explorer. ' +
          "The data set opens in Zowe Explorer's editor so the user can view or edit it. " +
          'Requires Zowe Explorer to be installed. The extension resolves the Zowe profile (default or match by system) or prompts to choose one and remembers it for the session.',
        inputSchema: {
          dsn: z
            .string()
            .describe('Fully qualified data set name (e.g. USER.SRC.COBOL or USER.PDS).'),
          member: z
            .string()
            .optional()
            .describe('Member name for a PDS/PDSE; omit for sequential data sets.'),
          system: z
            .string()
            .optional()
            .describe(
              'MCP system id (e.g. user@host) to match a Zowe profile. Omit to use the current active system.'
            ),
        },
      },
      async ({ dsn, member, system: systemArg }, extra) => {
        const progress = createToolProgress(extra, 'Open data set in Zowe Explorer');
        await progress.start();

        try {
          const resolved = resolveDsn(dsn, member);
          const currentSystemId = systemArg ?? sessionState?.getActiveSystem() ?? undefined;
          const connectionKind =
            backendKind === 'native' ? ('native' as const) : ('zosmf' as const);

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
                text: 'Opening data set in Zowe Explorer. The document should appear in your editor shortly.',
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

  if (openUssFileInZoweEditor) {
    server.registerTool(
      'openUssFileInEditor',
      {
        annotations: { readOnlyHint: true },
        description:
          'Open a USS (Unix System Services) file or directory in the VS Code editor via Zowe Explorer. ' +
          "The file opens in Zowe Explorer's editor. Requires Zowe Explorer to be installed. " +
          'The extension resolves the Zowe profile (default or match by system) or prompts to choose one and remembers it for the session.',
        inputSchema: {
          path: z
            .string()
            .describe(
              'USS path: absolute (e.g. /u/users/me/file.txt) or relative to current working directory.'
            ),
          system: z
            .string()
            .optional()
            .describe(
              'MCP system id (e.g. user@host) to match a Zowe profile. Omit to use the current active system.'
            ),
        },
      },
      async ({ path: pathArg, system: systemArg }, extra) => {
        const progress = createToolProgress(extra, 'Open USS file in Zowe Explorer');
        await progress.start();
        try {
          const currentSystemId = systemArg ?? sessionState?.getActiveSystem() ?? undefined;
          openUssFileInZoweEditor({
            path: pathArg.trim(),
            system: currentSystemId,
            connectionKind,
          });
          await progress.complete('Opening in Zowe Explorer.');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Opening USS file in Zowe Explorer. The document should appear in your editor shortly.',
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.debug('openUssFileInEditor failed', { path: pathArg, err });
          await progress.complete(message);
          throw err;
        }
      }
    );
  }

  if (openJobInZoweEditor) {
    server.registerTool(
      'openJobInEditor',
      {
        annotations: { readOnlyHint: true },
        description:
          'Open a z/OS job or a job spool file in the VS Code editor via Zowe Explorer. ' +
          'Requires Zowe Explorer to be installed. Use jobFileId from listJobFiles to open a specific spool; omit to open the job node. ' +
          'The extension resolves the Zowe profile (default or match by system) or prompts to choose one and remembers it for the session.',
        inputSchema: {
          jobId: z.string().describe('Job ID (e.g. JOB00123 or J0nnnnnn).'),
          jobFileId: z
            .number()
            .int()
            .optional()
            .describe(
              'Job file (spool) ID from listJobFiles. Omit to open the job (overview); provide to open a specific spool file.'
            ),
          system: z
            .string()
            .optional()
            .describe(
              'MCP system id (e.g. user@host) to match a Zowe profile. Omit to use the current active system.'
            ),
        },
      },
      async ({ jobId, jobFileId, system: systemArg }, extra) => {
        const progress = createToolProgress(extra, 'Open job in Zowe Explorer');
        await progress.start();
        try {
          const currentSystemId = systemArg ?? sessionState?.getActiveSystem() ?? undefined;
          openJobInZoweEditor({
            jobId: jobId.trim(),
            jobFileId,
            system: currentSystemId,
            connectionKind,
          });
          await progress.complete('Opening in Zowe Explorer.');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Opening job in Zowe Explorer. The document should appear in your editor shortly.',
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.debug('openJobInEditor failed', { jobId, err });
          await progress.complete(message);
          throw err;
        }
      }
    );
  }
}
