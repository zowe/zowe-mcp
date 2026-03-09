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
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const mcpToolStorage = new AsyncLocalStorage<string>();

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
