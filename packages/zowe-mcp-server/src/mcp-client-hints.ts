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
 * Whether the MCP `initialize` client {@link clientInfo.name} identifies as Visual Studio Code.
 * VS Code opens URL-mode elicitation in a full browser tab (not a small popup), so copy can be shorter.
 */
export function isVisualStudioCodeMcpClient(clientName?: string): boolean {
  const n = clientName?.trim().toLowerCase() ?? '';
  if (n.length === 0) {
    return false;
  }
  if (n.includes('visual studio code')) {
    return true;
  }
  if (n === 'vscode') {
    return true;
  }
  if (n.startsWith('vscode ')) {
    return true;
  }
  return false;
}
