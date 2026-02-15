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

export interface ZoweInfoResponse {
  name: string;
  version: string;
  description: string;
  components: string[];
  backendConnected: boolean;
  notice?: string;
}

/** Options for configuring core tool registration. */
export interface CoreToolOptions {
  /** Whether a z/OS backend is connected (mock or real). */
  backendConnected: boolean;
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
  const backendConnected = options?.backendConnected ?? false;

  server.registerTool(
    'info',
    {
      description:
        'Provides information about the Zowe MCP server, its version, and backend connection status. ' +
        'When no z/OS backend is configured, only this tool is available. ' +
        'Configure a backend (e.g. set the "zowe-mcp.mockDataDir" VS Code setting) to enable z/OS tools.',
      annotations: { readOnlyHint: true },
    },
    extra => {
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
        components: backendConnected ? ['core', 'context', 'datasets'] : ['core'],
        backendConnected,
      };

      if (!backendConnected) {
        info.notice =
          'No z/OS backend is configured. Only the "info" tool is available. ' +
          'To enable all z/OS tools, configure a backend:\n' +
          '  - VS Code: run "Zowe MCP: Generate Mock Data" from the Command Palette, ' +
          'or set "zowe-mcp.mockDataDir" in Settings to an existing mock data directory\n' +
          '  - Standalone: use --mock <dir> or set ZOWE_MCP_MOCK_DIR environment variable';
      }

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
