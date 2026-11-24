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
import { z } from 'zod';
import { ResourceEffect } from '../../capability-level.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import { getBackendStatusOutputSchema } from './context-output-schemas.js';

/** Non-secret status snapshots for frontend harnesses; no probe or elicitation as a side effect. */
export function registerBackendStatusTools(
  server: McpServer,
  backend: Pick<ZosBackend, 'getConnectionStatuses'>,
  systemRegistry: SystemRegistry
): void {
  if (!backend.getConnectionStatuses) return;
  server.registerTool(
    'getBackendStatus',
    {
      description:
        'Report configured mainframe connections and their observed authentication state. Shows whether frontend OIDC worked, was rejected, or fell back to configured, editor, or elicited credentials. Status inspection never prompts for credentials or contacts z/OS. Unknown or untested is distinct from unsupported; perform the intended read operation to verify a connection. Tokens and passwords are never returned.',
      _meta: { resourceEffectLevel: ResourceEffect.NONE },
      inputSchema: {
        system: z
          .string()
          .optional()
          .describe(
            'Optional hostname or unqualified system name; omit to inspect all configured connections.'
          ),
      },
      outputSchema: getBackendStatusOutputSchema,
    },
    async ({ system }, extra) => {
      const progress = createToolProgress(extra, 'Get backend status');
      await progress.start();
      const resolved = system ? systemRegistry.getOrResolve(system)?.host : undefined;
      if (system && !resolved) {
        await progress.complete('unknown system');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Unknown or ambiguous system: ${system}` }),
            },
          ],
          isError: true,
        };
      }
      const payload = {
        connections: backend.getConnectionStatuses!()
          .filter(item => !resolved || item.system === resolved)
          .map(item => ({ ...item, unsupportedTools: [...item.unsupportedTools] })),
      };
      await progress.complete('done');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }
  );
}
