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

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { handleServerEvent } from '../event-handler';
import type { ExplorerProfileApi } from '../zowe-profile';

suite('Editor event profile selection', () => {
  const system = 'TESTUSER@target.invalid';
  const defaultProfile = { profName: 'default.zosmf' };
  const targetZosmf = { profName: 'target.zosmf' };
  const targetSsh = { profName: 'target.ssh' };
  const getExtension = vscode.extensions.getExtension;
  let disposables: vscode.Disposable[] = [];
  let log: vscode.LogOutputChannel;

  suiteSetup(() => {
    const api: ExplorerProfileApi = {
      getExplorerExtenderApi: () => ({
        getProfilesCache: () => ({
          getProfileInfo: () =>
            Promise.resolve({
              getDefaultProfile: () => defaultProfile,
              getAllProfiles: (type: string) =>
                type === 'zosmf' ? [defaultProfile, targetZosmf] : [targetSsh],
              mergeArgsForProfile: ({ profName }) => ({
                knownArgs: [
                  {
                    argName: 'host',
                    argValue:
                      profName === defaultProfile.profName ? 'other.invalid' : 'target.invalid',
                  },
                  { argName: 'user', argValue: 'TESTUSER' },
                ],
              }),
            }),
        }),
      }),
    };
    vscode.extensions.getExtension = <T>(id: string) =>
      id === 'Zowe.vscode-extension-for-zowe'
        ? ({ activate: () => Promise.resolve(api) } as unknown as vscode.Extension<T>)
        : getExtension<T>(id);

    const changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    const files: vscode.FileSystemProvider = {
      onDidChangeFile: changes.event,
      watch: () => new vscode.Disposable(() => undefined),
      stat: () => ({ type: vscode.FileType.File, size: 0, ctime: 0, mtime: 0 }),
      readFile: () => new Uint8Array(),
      readDirectory: () => [],
      createDirectory: () => {
        throw vscode.FileSystemError.NoPermissions();
      },
      writeFile: () => {
        throw vscode.FileSystemError.NoPermissions();
      },
      delete: () => {
        throw vscode.FileSystemError.NoPermissions();
      },
      rename: () => {
        throw vscode.FileSystemError.NoPermissions();
      },
    };
    log = vscode.window.createOutputChannel('Editor event profile test', { log: true });
    disposables = [
      changes,
      vscode.workspace.registerFileSystemProvider('zowe-uss', files, { isReadonly: true }),
      log,
    ];
  });

  suiteTeardown(() => {
    vscode.extensions.getExtension = getExtension;
    for (const disposable of disposables) disposable.dispose();
  });

  async function openUssFile(path: string, systemId: string, connectionKind: 'zowex' | 'zosmf') {
    let listener: vscode.Disposable | undefined;
    const selectedProfile = new Promise<string | undefined>(resolve => {
      listener = vscode.window.onDidChangeActiveTextEditor(editor => {
        const uri = editor?.document.uri;
        if (uri?.scheme === 'zowe-uss' && uri.path.endsWith(path)) {
          resolve(uri.path.split('/')[1]);
        }
      });
    });
    const timeout = AbortSignal.timeout(5000);
    const opened = new Promise<never>((_, reject) => {
      timeout.addEventListener('abort', () => reject(new Error(`Editor did not open ${path}`)), {
        once: true,
      });
    });
    try {
      handleServerEvent(log, {
        type: 'open-uss-file-in-editor',
        data: { path, system: systemId, connectionKind },
        timestamp: Date.now(),
      });
      return await Promise.race([selectedProfile, opened]);
    } finally {
      listener?.dispose();
    }
  }

  test('opens a matching system before the default profile for another host', async () => {
    assert.equal(await openUssFile('/system-match.txt', system, 'zosmf'), 'target.zosmf');
  });

  test('prefers matching SSH even after a z/OSMF event for the same system', async () => {
    await openUssFile('/zosmf-first.txt', system, 'zosmf');
    assert.equal(await openUssFile('/ssh-match.txt', system, 'zowex'), 'target.ssh');
  });

  test('falls back to the default when no profile matches the system', async () => {
    assert.equal(
      await openUssFile('/default.txt', 'TESTUSER@unmatched.invalid', 'zosmf'),
      'default.zosmf'
    );
  });
});
