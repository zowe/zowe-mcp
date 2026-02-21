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
 * Core tools for the Zowe MCP Server.
 *
 * Provides the `info` tool that returns metadata about the server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../../log.js';
import { createToolProgress } from '../progress.js';

export interface ZoweInfoResponse {
  name: string;
  version: string;
  description: string;
  components: string[];
  /** Backend type when connected (e.g. "mock", "native") or null when none. */
  backend: string | null;
  notice?: string;
}

/** Options for configuring core tool registration. */
export interface CoreToolOptions {
  /** Backend type when connected (e.g. "mock", "native") or null when none. */
  backend: string | null;
}

/**
 * Registers core tools on the given MCP server.
 *
 * @param server - The McpServer instance to register tools on.
 * @param version - The server version (from package.json).
 * @param logger - Logger instance for diagnostic messages.
 * @param options - Configuration options (e.g. backend status).
 */
export function registerCoreTools(
  server: McpServer,
  version: string,
  logger: Logger,
  options?: CoreToolOptions
): void {
  const log = logger.child('core');
  const backend = options?.backend ?? null;
  const hasBackend = backend !== null;
  const backendDescription = hasBackend
    ? ''
    : 'When no z/OS backend is configured, only this tool is available. ' +
      'Configure a backend to enable z/OS tools: mock (VS Code "zoweMCP.mockDataDirectory" or standalone --mock / ZOWE_MCP_MOCK_DIR) or native SSH (VS Code "zoweMCP.nativeSystems" or standalone --native --system user@host).';

  server.registerTool(
    'info',
    {
      description:
        'Provides information about the Zowe MCP server, its version, and backend connection status. ' +
        backendDescription,
      annotations: { readOnlyHint: true },
    },
    async extra => {
      const progress = createToolProgress(extra, 'Server info');
      await progress.start();
      const clientInfo = server.server.getClientVersion();
      log.info('info tool called', {
        clientName: clientInfo?.name,
        clientVersion: clientInfo?.version,
        sessionId: extra.sessionId,
      });

      const info: ZoweInfoResponse = {
        name: 'Zowe MCP Server',
        version,
        description:
          'MCP server providing tools for z/OS systems including data sets, jobs, and UNIX System Services',
        components: hasBackend ? ['core', 'context', 'datasets'] : ['core'],
        backend,
      };

      if (!hasBackend) {
        info.notice =
          'No z/OS backend is configured. Only the "info" tool is available. ' +
          'To enable all z/OS tools, configure a backend:\n' +
          '  - Mock: VS Code — run "Zowe MCP: Generate Mock Data" or set "zoweMCP.mockDataDirectory"; ' +
          'Standalone — --mock <dir> or ZOWE_MCP_MOCK_DIR\n' +
          '  - Native (SSH): VS Code — set "zoweMCP.nativeSystems" (e.g. ["user@host"]); ' +
          'Standalone — --native --system user@host (or --config <path>)';
      }

      await progress.complete('ready');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(info, null, 2),
          },
        ],
      };
    }
  );
}
