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
 * Stateless-tools mode: the tools `setSystem` and `changeUssDirectory` are not
 * registered, and every tool call must name its target system (`system`
 * parameter) unless exactly one connection is configured.
 *
 * Enabled by `CreateServerOptions.statelessTools` or `ZOWE_MCP_STATELESS_TOOLS=1|true`.
 * The flag is process-wide and is set by `createServer()` before any tool is
 * registered, so tool descriptions built at registration time follow it.
 */

let active = false;

/** Resolve the mode from the explicit option, falling back to the environment. Default off. */
export function resolveStatelessTools(option?: boolean): boolean {
  if (option !== undefined) return option;
  return ['1', 'true'].includes((process.env.ZOWE_MCP_STATELESS_TOOLS ?? '').trim().toLowerCase());
}

/** Set by `createServer()` before tools are registered. */
export function setStatelessToolsActive(value: boolean): void {
  active = value;
}

/** Whether tool descriptions built now should use stateless wording. */
export function isStatelessToolsActive(): boolean {
  return active;
}
