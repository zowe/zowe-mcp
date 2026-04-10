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
 * Async context for the current MCP tool name so the native backend can
 * include it in abend logs and CEEDUMP notifications without threading
 * it through every backend method.
 *
 * Also tracks the current {@link McpServer} during tool execution so standalone
 * password elicitation (form/URL) can reach the right MCP session (HTTP multi-session).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const mcpToolStorage = new AsyncLocalStorage<string>();
const mcpServerStorage = new AsyncLocalStorage<McpServer>();

/**
 * Runs the given function with the current MCP tool name set to `toolName`.
 * Used by tool-call logging so the native backend can read the tool name
 * when a ZNP abend occurs.
 */
export function runWithMcpTool<T>(toolName: string, fn: () => T): T {
  return mcpToolStorage.run(toolName, fn);
}

/**
 * Returns the MCP tool name for the current async context, or undefined
 * if not running inside a tool invocation (e.g. standalone ZNP call).
 */
export function getCurrentMcpTool(): string | undefined {
  return mcpToolStorage.getStore();
}

/**
 * Runs `fn` with the current {@link McpServer} in async local storage (for the whole async chain).
 */
export function runWithMcpServer<T>(mcpServer: McpServer, fn: () => T): T {
  return mcpServerStorage.run(mcpServer, fn);
}

/**
 * The MCP server handling the active tool invocation, or undefined outside tool handlers.
 */
export function getCurrentMcpServer(): McpServer | undefined {
  return mcpServerStorage.getStore();
}

/**
 * Wraps every tool handler so {@link getCurrentMcpServer} works during backend calls.
 * Call once on each {@link McpServer} instance before registering tools.
 */
export function installMcpServerInvocationContext(server: McpServer): void {
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = function registerToolWithContext(
    name: string,
    config: Parameters<McpServer['registerTool']>[1],
    cb: Parameters<McpServer['registerTool']>[2]
  ) {
    const wrapped = async (...args: Parameters<typeof cb>) => {
      return await mcpServerStorage.run(server, async () => {
        const r = (cb as (...a: Parameters<typeof cb>) => ReturnType<typeof cb>)(...args);
        return await Promise.resolve(r);
      });
    };
    return originalRegisterTool(name, config, wrapped as typeof cb);
  };
}
