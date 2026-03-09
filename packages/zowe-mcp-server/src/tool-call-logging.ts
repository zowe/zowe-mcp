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
 * Tool-call logging middleware.
 *
 * Patches McpServer.registerTool so every tool invocation is logged with
 * full input, full response (or error), and backend type.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from './log.js';
import { runWithMcpTool } from './mcp-tool-context.js';

/**
 * Installs tool-call logging on the given server by replacing registerTool
 * with a wrapper that logs each call (tool name, backend, full input),
 * then the full result or error.
 *
 * @param server - The MCP server to patch
 * @param logger - Root logger (a child "tools" logger will be used for log lines)
 * @param backendKind - Backend type to include in every log entry ('mock' | 'native' | null)
 */
export function installToolCallLogging(
  server: McpServer,
  logger: Logger,
  backendKind: string | null
): void {
  const toolLog = logger.child('tools');
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = function (
    name: string,
    config: Parameters<McpServer['registerTool']>[1],
    cb: Parameters<McpServer['registerTool']>[2]
  ) {
    const wrappedCb = async (
      ...invocationArgs: unknown[]
    ): Promise<Awaited<ReturnType<typeof cb>>> => {
      return runWithMcpTool(name, async () => {
        const input = invocationArgs.length >= 2 ? invocationArgs[0] : undefined;
        toolLog.info('Tool call', {
          tool: name,
          backend: backendKind,
          input,
        });
        let result: Awaited<ReturnType<typeof cb>>;
        try {
          const invoked =
            invocationArgs.length >= 2
              ? (cb as (args: unknown, extra: unknown) => ReturnType<typeof cb>)(
                  invocationArgs[0],
                  invocationArgs[1]
                )
              : (cb as (extra: unknown) => ReturnType<typeof cb>)(invocationArgs[0]);
          result = await Promise.resolve(invoked);
        } catch (e) {
          toolLog.info('Tool call error', {
            tool: name,
            backend: backendKind,
            error: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
        toolLog.info('Tool call result', {
          tool: name,
          backend: backendKind,
          result,
        });
        return result;
      });
    };
    return originalRegisterTool(
      name,
      config,
      wrappedCb as Parameters<McpServer['registerTool']>[2]
    );
  };
}
