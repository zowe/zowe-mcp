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

import { describe, expect, it } from 'vitest';
import { isVisualStudioCodeMcpClient } from '../src/mcp-client-hints.js';

describe('isVisualStudioCodeMcpClient', () => {
  it('returns false for undefined and empty', () => {
    expect(isVisualStudioCodeMcpClient(undefined)).toBe(false);
    expect(isVisualStudioCodeMcpClient('')).toBe(false);
    expect(isVisualStudioCodeMcpClient('   ')).toBe(false);
  });

  it('matches Visual Studio Code and vscode variants', () => {
    expect(isVisualStudioCodeMcpClient('Visual Studio Code')).toBe(true);
    expect(isVisualStudioCodeMcpClient('visual studio code')).toBe(true);
    expect(isVisualStudioCodeMcpClient('vscode')).toBe(true);
    expect(isVisualStudioCodeMcpClient('vscode 1.99.0')).toBe(true);
  });

  it('returns false for other MCP clients', () => {
    expect(isVisualStudioCodeMcpClient('Cursor')).toBe(false);
    expect(isVisualStudioCodeMcpClient('Claude')).toBe(false);
    expect(isVisualStudioCodeMcpClient('mcp-inspector')).toBe(false);
  });
});
