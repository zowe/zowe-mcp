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
 * Command-routing tests for the mock z/OS host's SSH `exec` handler.
 *
 * These pin the shapes the zowex SDK actually sends. The post-deploy binary check is the
 * cautionary case: the mock originally matched only `zowex -v` (what our own
 * zowex-deploy-check.ts sends), but SDK 0.7.1's `ZSshUtils.verifyServerBinary` sends
 * `./zowex --version` with a `cwd`, which node-ssh turns into `cd '<dir>' ; ./zowex --version`.
 * That fell through to the USS shell interpreter, which has no `zowex` builtin, so it came back
 * FSUM7351/rc=127 and every fresh deploy looked like a binary that would not load. It only
 * surfaced on one CI platform, because the check runs solely after an actual (re)install.
 *
 * SDK 1.0 renamed the binary from `zowex` to `zo` (`ZSshClient.BIN_NAME`). Until the router
 * learned the new name, `zo server` hit the same fall-through, the SDK reported "Server not
 * found", and the nightly SDK workflow failed on every run from 2026-09-05.
 */

import { createRequire } from 'node:module';
import type ssh2 from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { handleExec } from '../src/mock-host/channels/exec-router.js';
import type { MockHostStore } from '../src/mock-host/store.js';
import type { MockUser } from '../src/mock-host/users.js';

/** Minimal ServerChannel double: records what the router wrote and how it exited. */
function createFakeChannel() {
  const written: string[] = [];
  const channel = {
    write: vi.fn((chunk: string) => written.push(String(chunk))),
    exit: vi.fn(),
    end: vi.fn(),
    stderr: { write: vi.fn() },
    on: vi.fn(),
  };
  return { channel, written };
}

function createCtx() {
  return {
    store: {} as MockHostStore,
    user: { username: 'USER1' } as MockUser,
    systemId: '127.0.0.1',
    log: vi.fn(),
  };
}

function runExec(command: string) {
  const { channel, written } = createFakeChannel();
  handleExec(channel as unknown as ssh2.ServerChannel, command, createCtx());
  return { channel, written };
}

describe('mock host exec router', () => {
  describe('post-deploy binary check', () => {
    // Both spellings are in live use: `-v` from our zowex-deploy-check.ts, `--version` from
    // the SDK. The cwd-wrapped form is what actually reaches the wire from the SDK.
    const versionCommands = [
      './zowex -v',
      './zowex --version',
      '~/.zowe-server/zowex --version',
      "cd '~/.zowe-server' ; ./zowex --version",
      'cd "~/.zowe-server" ; ./zowex -v',
      // SDK 1.0 (`zo`)
      './zo -v',
      './zo --version',
      '~/.zowe-server/zo -v',
      "cd '~/.zowe-server' ; ./zo --version",
    ];

    for (const cmd of versionCommands) {
      it(`answers rc=0 with a version line for: ${cmd}`, () => {
        const { channel, written } = runExec(cmd);

        expect(channel.exit).toHaveBeenCalledWith(0);
        expect(written.join('')).toMatch(/\S/);
        // A fall-through to the USS shell is the specific regression guarded here.
        expect(written.join('')).not.toMatch(/FSUM7351/);
        expect(channel.stderr.write).not.toHaveBeenCalled();
      });
    }

    it('does not mistake the RPC server command for a version check', () => {
      // `zowex server` must reach the RPC dispatcher, which takes over the channel and
      // neither exits nor writes a version line.
      const { channel } = runExec('~/.zowe-server/zowex server');

      expect(channel.exit).not.toHaveBeenCalledWith(0);
    });
  });

  describe('server start command', () => {
    // The RPC dispatcher answers with its readiness line on the same tick; a fall-through to
    // the USS shell would answer FSUM7351/rc=127 asynchronously instead.
    const startCommands = [
      '~/.zowe-server/zowex server',
      // SDK 1.0 (`zo`): plain, wrapped by ZSshClient.execAsync, and with a quoted path
      '~/.zowe-server/zo server',
      '~/.zowe-server/zo server || echo "@@ZOWE_EXIT_CODE@@$?" >&2',
      "~'/my dir/zo' server",
    ];

    for (const cmd of startCommands) {
      it(`starts the RPC dispatcher for: ${cmd}`, () => {
        const { channel, written } = runExec(cmd);

        expect(written.join('')).toContain('"status":"ready"');
        expect(channel.exit).not.toHaveBeenCalled();
      });
    }

    it('reports the installed SDK version, so checkIfOutdated does not force a redeploy', () => {
      // The version is looked up by walking node_modules up from the mock's own file. On Windows
      // that walk once built its paths from URL.pathname (`/C:/...`), matched nothing, and fell
      // back to 0.0.0, which every SDK treats as outdated.
      const sdkVersion = (
        createRequire(import.meta.url)('@zowe/zowex-for-zowe-sdk/package.json') as {
          version: string;
        }
      ).version;
      const { written } = runExec('~/.zowe-server/zo server');
      const ready = JSON.parse(written[0]) as { data: { version: string } };

      expect(ready.data.version).toBe(sdkVersion);
    });
  });

  describe('pax extraction', () => {
    // ZSshUtils.installServer extracts via execCommand('pax -rzf server.pax.Z', { cwd }),
    // so the `cd` wrapper has to be tolerated here too.
    const paxCommands = [
      'pax -rzf server.pax.Z',
      "cd '~/.zowe-server' ; pax -rzf server.pax.Z",
      'pax -rzf /u/user1/.zowe-server/server.pax.Z',
    ];

    for (const cmd of paxCommands) {
      it(`reports success for: ${cmd}`, () => {
        const { channel } = runExec(cmd);

        expect(channel.exit).toHaveBeenCalledWith(0);
        expect(channel.stderr.write).not.toHaveBeenCalled();
      });
    }
  });
});
