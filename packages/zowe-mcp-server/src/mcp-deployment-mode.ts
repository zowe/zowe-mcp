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
 * How the MCP server process is deployed, for user-facing hints (e.g. when no z/OS systems are configured).
 *
 * - **http** — Streamable HTTP (`--http`); startup sets `ZOWE_MCP_TRANSPORT=http`.
 * - **stdio-vscode** — stdio subprocess spawned by the Zowe MCP VS Code extension (`MCP_DISCOVERY_DIR` + `WORKSPACE_ID`).
 * - **stdio-standalone** — stdio without extension env (CLI, other MCP clients, tests).
 */

export type McpDeploymentMode = 'http' | 'stdio-vscode' | 'stdio-standalone';

/**
 * Detects deployment mode from environment. Safe to call from tool handlers after startup.
 */
export function getMcpDeploymentMode(): McpDeploymentMode {
  if (process.env.ZOWE_MCP_TRANSPORT?.trim() === 'http') {
    return 'http';
  }
  const discovery = process.env.MCP_DISCOVERY_DIR?.trim();
  const workspace = process.env.WORKSPACE_ID?.trim();
  if (discovery && workspace) {
    return 'stdio-vscode';
  }
  return 'stdio-standalone';
}
