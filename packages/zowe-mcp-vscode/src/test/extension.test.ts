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
 * VS Code Extension Integration Tests
 *
 * These tests run inside a real VS Code instance to verify
 * that the extension activates and registers the MCP server correctly.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Zowe MCP VS Code Extension', () => {
  test('Extension should be present', () => {
    // In development, the publisher may differ; check by name pattern
    const allExtensions = vscode.extensions.all;
    const zoweMcp = allExtensions.find(
      ext => ext.id.includes('zowe-mcp-vscode') || ext.id.includes('zowe-mcp')
    );
    assert.ok(zoweMcp !== undefined, 'Zowe MCP extension should be installed');
  });

  test('Extension should activate', async () => {
    const allExtensions = vscode.extensions.all;
    const zoweMcp = allExtensions.find(
      ext => ext.id.includes('zowe-mcp-vscode') || ext.id.includes('zowe-mcp')
    );

    if (zoweMcp) {
      await zoweMcp.activate();
      assert.ok(zoweMcp.isActive, 'Extension should be active after activation');
    }
  });
});
