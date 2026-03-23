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
import * as path from 'path';
import * as vscode from 'vscode';
import { buildServerConfig, showNoConnectionsNotificationIfNeeded } from '../extension';
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

  suite('No-connections startup notification', () => {
    const originalGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
    const originalShowInformationMessage = vscode.window.showInformationMessage.bind(
      vscode.window
    );

    teardown(() => {
      (
        vscode.workspace as { getConfiguration: typeof originalGetConfiguration }
      ).getConfiguration = originalGetConfiguration;
      (
        vscode.window as {
          showInformationMessage: typeof originalShowInformationMessage;
        }
      ).showInformationMessage = originalShowInformationMessage;
    });

    test('Shows notification when native backend with no connections', async () => {
      const mockConfig: vscode.WorkspaceConfiguration = {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'backend') return 'native';
          if (key === 'nativeConnections') return [];
          if (key === 'nativeSystems') return [];
          if (key === 'mockDataDirectory') return '';
          return defaultValue;
        },
        has: () => false,
        inspect: () => undefined,
        update: () => Promise.resolve(),
      };
      (
        vscode.workspace as {
          getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
        }
      ).getConfiguration = (section: string) => {
        assert.strictEqual(section, 'zoweMCP');
        return mockConfig;
      };

      const showMessageArgs: [string, string][] = [];
      (
        vscode.window as {
          showInformationMessage: (
            message: string,
            ...items: string[]
          ) => Thenable<string | undefined>;
        }
      ).showInformationMessage = (message: string, ...items: string[]) => {
        showMessageArgs.push([message, items[0] ?? '']);
        return Promise.resolve(undefined);
      };

      showNoConnectionsNotificationIfNeeded();

      await new Promise(resolve => setTimeout(resolve, 0));

      assert.strictEqual(showMessageArgs.length, 1);
      assert.ok(
        showMessageArgs[0][0].includes('No connections are configured'),
        'Message should explain that no connections are configured'
      );
      assert.strictEqual(
        showMessageArgs[0][1],
        'Open Settings',
        'Should offer Open Settings button'
      );
    });

    test('Does not show notification when native connections are set', () => {
      const mockConfig: vscode.WorkspaceConfiguration = {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'nativeConnections') return ['user@host'];
          if (key === 'nativeSystems') return [];
          if (key === 'mockDataDirectory') return '';
          return defaultValue;
        },
        has: () => false,
        inspect: () => undefined,
        update: () => Promise.resolve(),
      };
      (
        vscode.workspace as {
          getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
        }
      ).getConfiguration = () => mockConfig;

      let showCalls = 0;
      (
        vscode.window as {
          showInformationMessage: (
            _message: string,
            ..._items: string[]
          ) => Thenable<string | undefined>;
        }
      ).showInformationMessage = () => {
        showCalls++;
        return Promise.resolve(undefined);
      };

      showNoConnectionsNotificationIfNeeded();

      assert.strictEqual(showCalls, 0, 'Should not show notification when connections are set');
    });

    test('Does not show notification when backend is mock', () => {
      const mockConfig: vscode.WorkspaceConfiguration = {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'backend') return 'mock';
          if (key === 'nativeConnections') return [];
          if (key === 'nativeSystems') return [];
          if (key === 'mockDataDirectory') return '/path/to/mock';
          return defaultValue;
        },
        has: () => false,
        inspect: () => undefined,
        update: () => Promise.resolve(),
      };
      (
        vscode.workspace as {
          getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
        }
      ).getConfiguration = () => mockConfig;

      let showCalls = 0;
      (
        vscode.window as {
          showInformationMessage: (
            _message: string,
            ..._items: string[]
          ) => Thenable<string | undefined>;
        }
      ).showInformationMessage = () => {
        showCalls++;
        return Promise.resolve(undefined);
      };

      showNoConnectionsNotificationIfNeeded();

      assert.strictEqual(showCalls, 0, 'Should not show notification when backend is mock');
    });
  });

  suite('Fresh config server startup', () => {
    const originalGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);

    suiteSetup(async () => {
      const zoweMcp = findZoweMcpExtension();
      if (zoweMcp && !zoweMcp.isActive) {
        await zoweMcp.activate();
      }
    });

    teardown(() => {
      (
        vscode.workspace as { getConfiguration: typeof originalGetConfiguration }
      ).getConfiguration = originalGetConfiguration;
    });

    test('With fresh config (backend=native default, no connections), server gets native backend and zero systems', async () => {
      const mockConfig: vscode.WorkspaceConfiguration = {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'backend') return 'native';
          if (key === 'nativeConnections') return [];
          if (key === 'nativeSystems') return [];
          if (key === 'mockDataDirectory') return '';
          return defaultValue;
        },
        has: () => false,
        inspect: () => undefined,
        update: () => Promise.resolve(),
      };
      (
        vscode.workspace as {
          getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
        }
      ).getConfiguration = (section: string) => {
        assert.strictEqual(section, 'zoweMCP');
        return mockConfig;
      };

      const zoweMcp = findZoweMcpExtension();
      assert.ok(zoweMcp, 'Extension should be present');
      const dummyContext = {
        extensionPath: zoweMcp.extensionPath,
      } as vscode.ExtensionContext;
      const serverModule = path.join(dummyContext.extensionPath, 'server', 'index.js');
      const log = getLog();
      assert.ok(log, 'Log should be initialized after activation');

      const serverConfig = await buildServerConfig(
        dummyContext,
        serverModule,
        '/tmp/discovery',
        'test-workspace-id',
        log
      );

      const args = serverConfig.args;
      assert.ok(args.includes('--native'), 'Fresh config should use native (SSH) backend');
      assert.ok(!args.includes('--mock'), 'Fresh config should not use mock mode');
      const systemFlagCount = args.filter((a: string) => a === '--system').length;
      assert.strictEqual(
        systemFlagCount,
        0,
        'Fresh config should pass zero systems (no --system args)'
      );
    });

    test('With backend=mock and mock dir set, server gets mock backend', async () => {
      const mockConfig: vscode.WorkspaceConfiguration = {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'backend') return 'mock';
          if (key === 'nativeConnections') return [];
          if (key === 'nativeSystems') return [];
          if (key === 'mockDataDirectory') return '/tmp/mock-data';
          return defaultValue;
        },
        has: () => false,
        inspect: <T>(key: string) => {
          if (key === 'backend') {
            return {
              key: 'zoweMCP.backend',
              globalValue: 'mock' as unknown as T,
            };
          }
          return undefined;
        },
        update: () => Promise.resolve(),
      };
      (
        vscode.workspace as {
          getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
        }
      ).getConfiguration = (section: string) => {
        assert.strictEqual(section, 'zoweMCP');
        return mockConfig;
      };

      const zoweMcp = findZoweMcpExtension();
      assert.ok(zoweMcp, 'Extension should be present');
      const dummyContext = {
        extensionPath: zoweMcp.extensionPath,
      } as vscode.ExtensionContext;
      const serverModule = path.join(dummyContext.extensionPath, 'server', 'index.js');
      const log = getLog();
      assert.ok(log, 'Log should be initialized after activation');

      const serverConfig = await buildServerConfig(
        dummyContext,
        serverModule,
        '/tmp/discovery',
        'test-workspace-id',
        log
      );

      const args = serverConfig.args;
      assert.ok(args.includes('--mock'), 'Backend=mock should use mock mode');
      assert.ok(!args.includes('--native'), 'Backend=mock should not use native mode');
      const mockIdx = args.indexOf('--mock');
      assert.strictEqual(
        args[mockIdx + 1],
        '/tmp/mock-data',
        'Mock dir should be passed after --mock'
      );
    });
  });
});
