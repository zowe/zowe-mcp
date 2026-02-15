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
}

/**
 * Registers core tools on the given MCP server.
 *
 * @param server - The McpServer instance to register tools on.
 * @param version - The server version (from package.json).
 * @param logger - Logger instance for diagnostic messages.
 */
export function registerCoreTools(server: McpServer, version: string, logger: Logger): void {
  const log = logger.child('core');

  server.registerTool(
    'info',
    { description: 'Provides information about the Zowe MCP server and its version' },
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
        components: ['core'],
      };

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
