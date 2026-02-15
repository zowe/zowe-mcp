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
import { getDisplayName, getLog } from '../log';

/**
 * Finds the Zowe MCP extension from the installed extensions list.
 */
function findZoweMcpExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find(
    ext => ext.id.includes('zowe-mcp-vscode') || ext.id.includes('zowe-mcp')
  );
}

suite('Zowe MCP VS Code Extension', () => {
  test('Extension should be present', () => {
    const zoweMcp = findZoweMcpExtension();
    assert.ok(zoweMcp !== undefined, 'Zowe MCP extension should be installed');
  });

  test('Extension should activate', async () => {
    const zoweMcp = findZoweMcpExtension();

    if (zoweMcp) {
      await zoweMcp.activate();
      assert.ok(zoweMcp.isActive, 'Extension should be active after activation');
    }
  });

  suite('Output channel', () => {
    suiteSetup(async () => {
      const zoweMcp = findZoweMcpExtension();
      if (zoweMcp && !zoweMcp.isActive) {
        await zoweMcp.activate();
      }
    });

    test('Log output channel should be initialized after activation', () => {
      const log = getLog();
      assert.ok(log, 'getLog() should return a LogOutputChannel');
      const expectedName = getDisplayName();
      assert.strictEqual(
        log.name,
        expectedName,
        `Output channel should be named "${expectedName}"`
      );
    });

    test('Log output channel should support all log levels', () => {
      const log = getLog();
      // Verify the LogOutputChannel interface methods exist and are callable
      assert.strictEqual(typeof log.info, 'function', 'info() should be available');
      assert.strictEqual(typeof log.warn, 'function', 'warn() should be available');
      assert.strictEqual(typeof log.error, 'function', 'error() should be available');
      assert.strictEqual(typeof log.debug, 'function', 'debug() should be available');
      assert.strictEqual(typeof log.trace, 'function', 'trace() should be available');
    });

    test('Log output channel should accept messages without throwing', () => {
      const log = getLog();
      assert.doesNotThrow(() => {
        log.info('Integration test: info message');
        log.warn('Integration test: warn message');
        log.debug('Integration test: debug message');
      }, 'Writing to the log output channel should not throw');
    });
  });
});
