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
 * Provides the `zowe_info` tool that returns metadata about the server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
 */
export function registerCoreTools(server: McpServer, version: string): void {
  server.tool(
    'zowe_info',
    'Provides information about the Zowe MCP server and its version',
    {},
    () => {
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
