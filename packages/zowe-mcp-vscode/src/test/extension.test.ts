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

import type { ExtensionToServerEvent } from '@zowe/mcp-server/dist/events.js';
import * as assert from 'assert';
import * as fs from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { handleServerEvent } from '../event-handler';
import {
  buildServerConfig,
  provideZoweMcpServerDefinitions,
  showNoConnectionsNotificationIfNeeded,
} from '../extension';
import { getDisplayName, getLog } from '../log';
import { getRestConnections } from '../rest-settings';

/**
 * Finds the Zowe MCP extension from the installed extensions list.
 */
function findZoweMcpExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find(
    ext => ext.id.includes('zowe-mcp-vscode') || ext.id.includes('zowe-mcp')
  );
}

/**
 * Create a stub vscode.WorkspaceConfiguration backed by an overrides map.
 * Keys not present in overrides fall through to defaultValue.
 * Pass a custom inspect function for tests that need to simulate persisted settings.
 */
function makeMockConfig(
  overrides: Record<string, unknown> = {},
  customInspect?: vscode.WorkspaceConfiguration['inspect']
): vscode.WorkspaceConfiguration {
  return {
    get: <T>(key: string, defaultValue?: T): T => {
      if (key in overrides) return overrides[key] as T;
      return defaultValue as T;
    },
    has: () => false,
    inspect: customInspect ?? (() => undefined),
    update: () => Promise.resolve(),
  };
}

/**
 * Monkey-patch vscode.workspace.getConfiguration to return config.
 * When assertSection is true (default), asserts the section is 'zoweMCP'.
 */
function installMockZoweMcpConfig(
  config: vscode.WorkspaceConfiguration,
  assertSection = true
): void {
  (
    vscode.workspace as {
      getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
    }
  ).getConfiguration = (section: string) => {
    if (assertSection) assert.strictEqual(section, 'zoweMCP');
    return config;
  };
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
      const mockConfig = makeMockConfig({
        backend: 'native',
        nativeConnections: [],
        nativeSystems: [],
        mockDataDirectory: '',
      });
      installMockZoweMcpConfig(mockConfig);

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
      const mockConfig = makeMockConfig({
        nativeConnections: ['user@host'],
        nativeSystems: [],
        mockDataDirectory: '',
      });
      installMockZoweMcpConfig(mockConfig, false);

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
      const mockConfig = makeMockConfig({
        backend: 'mock',
        nativeConnections: [],
        nativeSystems: [],
        mockDataDirectory: '/path/to/mock',
      });
      installMockZoweMcpConfig(mockConfig, false);

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

    test('Recognizes REST connections when no SSH connections exist', () => {
      installMockZoweMcpConfig(
        makeMockConfig({
          backend: 'zo-rest',
          zoRestConnections: [{ url: 'https://gateway.example.com:7554', user: 'USER1' }],
        })
      );
      let showCalls = 0;
      (
        vscode.window as { showInformationMessage: typeof originalShowInformationMessage }
      ).showInformationMessage = () => {
        showCalls++;
        return Promise.resolve(undefined);
      };
      showNoConnectionsNotificationIfNeeded();
      assert.strictEqual(showCalls, 0);
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

    test('REST backend writes a secret-free config and selects HTTPS without SSH flags', async () => {
      const connections = [
        { url: 'https://gateway.example.com:7554', user: 'USER1', caFile: '/site/ca.pem' },
      ];
      installMockZoweMcpConfig(
        makeMockConfig({
          backend: 'zo-rest',
          zoRestConnections: connections,
          zowexConnections: ['OTHER@ssh.example.com'],
        })
      );
      const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'zowe-mcp-rest-settings-'));
      try {
        const context = {
          globalStorageUri: vscode.Uri.file(storageDir),
        } as vscode.ExtensionContext;
        const built = await buildServerConfig(
          context,
          '/server/index.js',
          '/discovery',
          'test',
          getLog()
        );
        assert.ok(built.args.includes('--zo-rest'));
        assert.ok(!built.args.includes('--native'));
        assert.ok(!built.args.includes('--system'));
        const configPath = built.args[built.args.indexOf('--config') + 1];
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), {
          systems: connections,
        });
        assert.strictEqual(built.env.WORKSPACE_ID, 'test');
      } finally {
        fs.rmSync(storageDir, { recursive: true, force: true });
      }
    });

    test('REST settings reject embedded secrets before writing a config snapshot', async () => {
      installMockZoweMcpConfig(
        makeMockConfig({
          backend: 'zo-rest',
          zoRestConnections: [
            { url: 'https://gateway.example.com', user: 'USER1', password: 'must-not-be-written' },
          ],
        })
      );
      const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'zowe-mcp-rest-invalid-'));
      try {
        const context = {
          globalStorageUri: vscode.Uri.file(storageDir),
        } as vscode.ExtensionContext;
        await assert.rejects(
          buildServerConfig(context, '/server/index.js', '/discovery', 'test', getLog()),
          /Passwords are collected securely/
        );
        assert.deepStrictEqual(fs.readdirSync(storageDir), []);
      } finally {
        fs.rmSync(storageDir, { recursive: true, force: true });
      }
    });

    test('REST settings require absolute CA paths with no process-directory dependency', () => {
      for (const caFile of ['site-ca.pem', '', null, 42]) {
        assert.throws(
          () =>
            getRestConnections(
              makeMockConfig({
                zoRestConnections: [{ url: 'https://zos.example.com', user: 'USER1', caFile }],
              })
            ),
          /caFile must be an absolute path/
        );
      }
      const caFile = path.resolve(tmpdir(), 'site-ca.pem');
      assert.strictEqual(
        getRestConnections(
          makeMockConfig({
            zoRestConnections: [{ url: 'https://zos.example.com', user: 'USER1', caFile }],
          })
        )[0].caFile,
        caFile
      );
    });

    test('REST settings accept secret references for the token-exchange proof of concept', () => {
      const oidcTokenExchange = {
        url: 'https://idp.example.com/token',
        audience: 'zo-backend',
        clientId: 'mcp-client',
        clientSecretEnv: 'ZOWE_MCP_EXCHANGE_CLIENT_SECRET',
      };
      const config = (exchange: object) =>
        makeMockConfig({
          zoRestConnections: [
            { url: 'https://zos.example.com', user: 'USER1', oidcTokenExchange: exchange },
          ],
        });
      assert.deepStrictEqual(
        getRestConnections(config(oidcTokenExchange))[0].oidcTokenExchange,
        oidcTokenExchange
      );
      assert.throws(
        () =>
          getRestConnections(
            config({ ...oidcTokenExchange, clientSecret: 'must-not-be-written' })
          ),
        /must not contain credentials/
      );
      for (const url of ['http://idp.example.com/token', 'https://secret@idp.example.com/token'])
        assert.throws(
          () => getRestConnections(config({ ...oidcTokenExchange, url })),
          /must use HTTPS without credentials/
        );
      assert.throws(
        () => getRestConnections(config({ ...oidcTokenExchange, audience: '   ' })),
        /must be nonblank/
      );
      for (const resource of ['relative', 'https://zos.example.com/#fragment'])
        assert.throws(
          () => getRestConnections(config({ ...oidcTokenExchange, resource })),
          /resource must be an absolute URI/
        );
    });

    test('With fresh config (backend=native default, no connections), server gets native backend and zero systems', async () => {
      const mockConfig = makeMockConfig({
        backend: 'native',
        nativeConnections: [],
        nativeSystems: [],
        mockDataDirectory: '',
      });
      installMockZoweMcpConfig(mockConfig);

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
      const mockConfig = makeMockConfig(
        {
          backend: 'mock',
          nativeConnections: [],
          nativeSystems: [],
          mockDataDirectory: '/tmp/mock-data',
        },
        <T>(key: string) => {
          if (key === 'backend') {
            return { key: 'zoweMCP.backend', globalValue: 'mock' as unknown as T };
          }
          return undefined;
        }
      );
      installMockZoweMcpConfig(mockConfig);

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

  suite('Credential prompt persistence', () => {
    for (const transient of [true, false]) {
      test(
        transient
          ? 'REST prompts bypass SecretStorage entirely'
          : 'SSH prompts retain existing SecretStorage persistence',
        async () => {
          const originalInput = vscode.window.showInputBox;
          let reads = 0;
          let stores = 0;
          const password = 'test-only-transient-password';
          const context = {
            secrets: {
              get: () => {
                reads++;
                return Promise.resolve(undefined);
              },
              store: () => {
                stores++;
                return Promise.resolve();
              },
            },
          } as unknown as vscode.ExtensionContext;
          vscode.window.showInputBox = () => Promise.resolve(password);
          try {
            const event = await new Promise<ExtensionToServerEvent>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error('Password event not delivered')),
                1000
              );
              handleServerEvent(
                getLog(),
                {
                  type: 'request-password',
                  data: {
                    user: 'USER1',
                    host: 'example.com',
                    port: 443,
                    ...(transient ? { transient: true } : {}),
                  },
                  timestamp: Date.now(),
                },
                {
                  context,
                  sendEventToServers: delivered => {
                    clearTimeout(timeout);
                    resolve(delivered);
                  },
                }
              );
            });
            if (event.type !== 'password') throw new Error('Expected a password delivery event');
            assert.strictEqual(event.data.password, password);
            assert.strictEqual(event.data.transient, transient ? true : undefined);
            assert.strictEqual(reads, transient ? 0 : 1);
            assert.strictEqual(stores, transient ? 0 : 1);
          } finally {
            vscode.window.showInputBox = originalInput;
          }
        }
      );
    }
  });

  suite('Registered commands', () => {
    suiteSetup(async () => {
      const zoweMcp = findZoweMcpExtension();
      if (zoweMcp && !zoweMcp.isActive) {
        await zoweMcp.activate();
      }
    });

    test('Exposes Zowe MCP palette commands', async () => {
      const all = await vscode.commands.getCommands(true);
      for (const id of [
        'zowe-mcp.initMockData',
        'zowe-mcp.clearStoredPassword',
        'zowe-mcp.resetAllSettingsAndState',
      ]) {
        assert.ok(all.includes(id), `Command ${id} should be registered after activation`);
      }
    });
  });

  suite('Bundled MCP server', () => {
    test('server/index.js exists under extension path', () => {
      const zoweMcp = findZoweMcpExtension();
      assert.ok(zoweMcp, 'Zowe MCP extension should be installed');
      const indexJs = path.join(zoweMcp.extensionPath, 'server', 'index.js');
      assert.ok(fs.existsSync(indexJs), `Bundled server entry missing: ${indexJs}`);
    });
  });

  suite('Zowe MCP settings', () => {
    test('zoweMCP configuration section is readable', () => {
      const cfg = vscode.workspace.getConfiguration('zoweMCP');
      const logLevel = cfg.get<string>('logLevel');
      assert.ok(
        logLevel !== undefined && logLevel !== null,
        'logLevel should have a default from package.json contribution'
      );
    });
  });

  suite('MCP server definitions (provider parity)', () => {
    suiteSetup(async () => {
      const zoweMcp = findZoweMcpExtension();
      if (zoweMcp && !zoweMcp.isActive) {
        await zoweMcp.activate();
      }
    });

    test('provideZoweMcpServerDefinitions matches single Zowe stdio definition', async () => {
      const zoweMcp = findZoweMcpExtension();
      assert.ok(zoweMcp, 'Zowe MCP extension should be installed');
      const dummyContext = {
        extensionPath: zoweMcp.extensionPath,
        globalStorageUri: vscode.Uri.file(path.join(zoweMcp.extensionPath, '.vscode-test-global')),
      } as vscode.ExtensionContext;
      const serverModule = path.join(zoweMcp.extensionPath, 'server', 'index.js');
      const log = getLog();
      assert.ok(log);
      const defs = await provideZoweMcpServerDefinitions(
        dummyContext,
        serverModule,
        '/tmp/discovery',
        'test-workspace-id',
        log
      );
      assert.strictEqual(defs.length, 1, 'Exactly one MCP server definition');
      const d = defs[0] as {
        command: string;
        args: string[];
        env: Record<string, string>;
      };
      const direct = await buildServerConfig(
        dummyContext,
        serverModule,
        '/tmp/discovery',
        'test-workspace-id',
        log
      );
      assert.deepStrictEqual(
        { command: d.command, args: d.args, env: d.env },
        {
          command: direct.command,
          args: direct.args,
          env: direct.env,
        },
        'MCP definition should match buildServerConfig output'
      );
    });
  });

  suite('buildServerConfig with real workspace settings', function (this: Mocha.Suite) {
    this.timeout(10000); // Real settings writes can exceed Mocha's 2s default on slow CI runners.
    let previousZowexConnections: string[] | undefined;

    suiteSetup(async () => {
      const zoweMcp = findZoweMcpExtension();
      if (zoweMcp && !zoweMcp.isActive) {
        await zoweMcp.activate();
      }
      const cfg = vscode.workspace.getConfiguration('zoweMCP');
      previousZowexConnections = cfg.get<string[]>('zowexConnections');
      await cfg.update(
        'zowexConnections',
        ['zowemcp-test-user@127.0.0.1'],
        vscode.ConfigurationTarget.Global
      );
    });

    suiteTeardown(async () => {
      const cfg = vscode.workspace.getConfiguration('zoweMCP');
      await cfg.update(
        'zowexConnections',
        previousZowexConnections,
        vscode.ConfigurationTarget.Global
      );
    });

    test('includes configured zowex connection in server args', async () => {
      const zoweMcp = findZoweMcpExtension();
      assert.ok(zoweMcp);
      const dummyContext = {
        extensionPath: zoweMcp.extensionPath,
        globalStorageUri: vscode.Uri.file(path.join(zoweMcp.extensionPath, '.vscode-test-global')),
      } as vscode.ExtensionContext;
      const serverModule = path.join(zoweMcp.extensionPath, 'server', 'index.js');
      const log = getLog();
      assert.ok(log);
      const serverConfig = await buildServerConfig(
        dummyContext,
        serverModule,
        '/tmp/discovery',
        'test-workspace-id',
        log
      );
      assert.ok(
        serverConfig.args.includes('zowemcp-test-user@127.0.0.1'),
        'args should include --system value from real settings'
      );
    });
  });

  suite('Command execution (cancel paths, no dialogs)', () => {
    suiteSetup(async () => {
      const zoweMcp = findZoweMcpExtension();
      if (zoweMcp && !zoweMcp.isActive) {
        await zoweMcp.activate();
      }
    });

    test('initMockData exits cleanly when folder dialog is cancelled', async () => {
      const original = vscode.window.showOpenDialog;
      vscode.window.showOpenDialog = () => Promise.resolve(undefined);
      try {
        await vscode.commands.executeCommand('zowe-mcp.initMockData');
      } finally {
        vscode.window.showOpenDialog = original;
      }
    });

    test('clearStoredPassword exits cleanly when input is cancelled', async () => {
      const originalInput = vscode.window.showInputBox;
      const originalPick = vscode.window.showQuickPick;
      vscode.window.showInputBox = () => Promise.resolve(undefined);
      vscode.window.showQuickPick = () => Promise.resolve(undefined);
      try {
        await vscode.commands.executeCommand('zowe-mcp.clearStoredPassword');
      } finally {
        vscode.window.showInputBox = originalInput;
        vscode.window.showQuickPick = originalPick;
      }
    });
  });

  suite('Extension manifest', () => {
    test('declares onStartupFinished activation', () => {
      const ext = vscode.extensions.getExtension('Zowe.zowe-mcp-vscode');
      assert.ok(ext, 'Extension Zowe.zowe-mcp-vscode should be resolvable');
      const pkg = ext.packageJSON as { activationEvents?: string[] };
      assert.ok(
        pkg.activationEvents?.includes('onStartupFinished'),
        'Should activate on startup finished'
      );
    });
  });
});
