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

import type { CredentialProvider } from '../zos/credentials.js';
import type { SessionState } from '../zos/session.js';

/**
 * Ensures a system context exists, initialising it from the credential provider when absent.
 * Shared by console, TSO, and local-file tools.
 */
export async function ensureContext(
  deps: { sessionState: SessionState; credentialProvider: CredentialProvider },
  systemId: string,
  userId?: string
): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const credentials = await deps.credentialProvider.getCredentials(systemId, userId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
}

/**
 * Wraps a string error message in a standard MCP tool error response.
 * Shared by console, TSO, and local-file tools.
 */
export function errorResult(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}
