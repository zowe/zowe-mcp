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
 * Pending URL-mode password elicitations (browser flow). The HTTP POST handler
 * completes the promise and {@link PendingPasswordUrlElicit.mcpServer} sends the MCP completion notification.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface PendingPasswordUrlElicit {
  resolve: (password: string) => void;
  reject: (e: Error) => void;
  mcpServer: McpServer;
  /** SSH principal for the z/OS connection (shown on the elicitation page). */
  user: string;
  /** Target host (shown on the elicitation page). */
  host: string;
  /** SSH port (shown when not 22). */
  port: number;
  /** From MCP `initialize` clientInfo (shown on the elicitation page when present). */
  mcpClientName?: string;
  mcpClientVersion?: string;
}

const pending = new Map<string, PendingPasswordUrlElicit>();

export function registerPasswordUrlPending(id: string, entry: PendingPasswordUrlElicit): void {
  pending.set(id, entry);
}

/** Read pending elicitation without removing (for GET /password-elicit/:id). */
export function getPasswordUrlPending(id: string): PendingPasswordUrlElicit | undefined {
  return pending.get(id);
}

export function takePasswordUrlPending(id: string): PendingPasswordUrlElicit | undefined {
  const e = pending.get(id);
  if (e) {
    pending.delete(id);
  }
  return e;
}
