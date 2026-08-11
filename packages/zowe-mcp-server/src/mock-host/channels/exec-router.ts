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
 * Routes incoming SSH `exec` commands. Four classes of command are recognized:
 *
 *   1. `<path>/zowex server [args]`   →  start the JSON-RPC dispatcher on this channel
 *   1b. `<path>/zowex -v`             →  post-deploy smoke test (verifyZowexBinary):
 *      report a fake version line and exit 0
 *   2. `cat > /tmp/zrs-pipe-*`        →  client is uploading bytes for a PUT streaming RPC
 *      `cat /tmp/zrs-pipe-*`          →  client is downloading bytes for a GET streaming RPC
 *   3. anything else (e.g. `pax -rzf server.pax.Z`, `mkdir -p`, `ls -la /u/USER`)
 *      →  hand off to the USS shell interpreter for one-shot execution.
 *
 * The channel object is the ssh2 ServerChannel returned to the `exec` callback.
 */

import ssh2 from 'ssh2';
import type { MockHostStore } from '../store.js';
import type { MockUser } from '../users.js';
import { newShellSession, runLine } from '../uss-shell/interpreter.js';
import { loadServerVersion, startRpcChannel } from './rpc-channel.js';
import {
  appendReceiveChunk,
  failReceive,
  finishReceive,
  isReceiveChannel,
  takeSendBuffer,
} from './stream-channel.js';

import type { MockLogger } from '../log.js';

export interface ExecRouterCtx {
  store: MockHostStore;
  user: MockUser;
  systemId: string;
  log: MockLogger;
}

const ZOWEX_RE = /(?:^|\/)zowex\s+server\b/;
// zowex-deploy-check.ts's verifyZowexBinary runs `<path>/zowex -v` right after a deploy
// to confirm the binary isn't a truncated program object (see issue #47). The real binary
// prints a version line and exits 0; without this case the command falls through to the
// USS shell interpreter, which has no `zowex` builtin and returns FSUM7351 (rc=127) —
// making every mock-backed deploy look like it failed to start.
const ZOWEX_VERSION_RE = /(?:^|\/)zowex\s+-v\b/;
const CAT_WRITE_RE = /^cat\s*>\s*(\/tmp\/zrs-pipe-\S+)\s*$/;
const CAT_READ_RE = /^cat\s+(\/tmp\/zrs-pipe-\S+)\s*$/;
// zowex-sdk 0.7.1's ZSshUtils.installServer extracts the PAX archive via
// `ssh.execCommand('pax -rzf server.pax.Z', { cwd: remoteDir })`. node-ssh
// (see node_modules/node-ssh/lib/cjs/index.js execCommand) implements `cwd` by
// prefixing the command with `cd <shell-escaped dir> ; `, so the string this
// mock actually receives on the wire looks like
// `cd '~/.zowe-server' ; pax -rzf server.pax.Z`, not the bare `pax` command.
// Match an optional leading `cd <dir> ;` wrapper, and tolerate a path prefix
// on the archive name (in case a future SDK version passes a full remote path
// instead of relying on `cwd`).
const CD_WRAPPER_RE = /^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*;\s*/;
const PAX_RE = /^pax\s+-rzf\s+(?:\S*\/)?server\.pax\.Z\s*$/;
const SILENT_OK_RE = /^(mkdir|rm)\s+/;

export function handleExec(
  channel: ssh2.ServerChannel,
  command: string,
  ctx: ExecRouterCtx
): void {
  const cmd = command.trim();
  // Visibility — every exec command, with user tag.
  ctx.log('info', `EXEC user=${ctx.user.username} cmd=${cmd}`);

  // 1. zowex server → RPC channel
  if (ZOWEX_RE.test(cmd)) {
    startRpcChannel(channel, {
      store: ctx.store,
      user: ctx.user,
      systemId: ctx.systemId,
      log: ctx.log,
    });
    return;
  }

  // 1b. zowex -v → post-deploy smoke test → report a version line, rc=0.
  // Real zowex prints the bare version (e.g. "0.6.1+1c4859ed"), no "zowex " prefix
  // (confirmed against a real z/OS system).
  if (ZOWEX_VERSION_RE.test(cmd)) {
    const version = loadServerVersion();
    ctx.log('info', `EXEC zowex -v (no-op) → rc=0 version=${version}`);
    channel.write(`${version}\n`);
    channel.exit(0);
    channel.end();
    return;
  }

  // 2a. cat > /tmp/zrs-pipe-N — incoming stream (client → server)
  const writeMatch = CAT_WRITE_RE.exec(cmd);
  if (writeMatch) {
    const pipePath = writeMatch[1];
    if (!isReceiveChannel(pipePath)) {
      ctx.log('warn', `STREAM no pending receive for ${pipePath}`);
      channel.stderr.write(`mock: no pending receive for ${pipePath}\n`);
      channel.exit(1);
      channel.end();
      return;
    }
    ctx.log('debug', `STREAM put pipe=${pipePath}`);
    channel.on('data', (chunk: Buffer) => appendReceiveChunk(pipePath, chunk));
    channel.on('end', () => {
      finishReceive(pipePath);
      channel.exit(0);
      channel.end();
    });
    channel.on('error', (err: Error) => failReceive(pipePath, err));
    return;
  }

  // 2b. cat /tmp/zrs-pipe-N — outgoing stream (server → client)
  const readMatch = CAT_READ_RE.exec(cmd);
  if (readMatch) {
    const pipePath = readMatch[1];
    const buf = takeSendBuffer(pipePath);
    if (!buf) {
      ctx.log('warn', `STREAM no pending send for ${pipePath}`);
      channel.stderr.write(`mock: no pending send for ${pipePath}\n`);
      channel.exit(1);
      channel.end();
      return;
    }
    ctx.log('debug', `STREAM get pipe=${pipePath} bytes=${buf.length}`);
    // The client wraps with Base64Decode; we must emit base64 bytes.
    channel.write(buf.toString('base64'));
    channel.exit(0);
    channel.end();
    return;
  }

  // 3a. pax -rzf server.pax.Z → silent success (we don't actually extract).
  // Strip a `cd <dir> ; ` wrapper first — node-ssh's execCommand({ cwd })
  // (used by ZSshUtils.installServer's extraction step) prefixes the real
  // command with one instead of sending `pax` bare.
  const unwrapped = cmd.replace(CD_WRAPPER_RE, '');
  if (PAX_RE.test(unwrapped)) {
    ctx.log('info', `EXEC pax extract (no-op) → rc=0`);
    channel.exit(0);
    channel.end();
    return;
  }

  // 3b. mkdir -p / rm -rf for the zowex install dance → silent success
  if (SILENT_OK_RE.test(unwrapped) && !isShellCommand(unwrapped)) {
    ctx.log('debug', `EXEC install-dance command (no-op) → rc=0`);
    channel.exit(0);
    channel.end();
    return;
  }

  // 4. anything else → one-shot through the USS shell
  void (async () => {
    const session = newShellSession(ctx.store, ctx.user, ctx.systemId);
    const start = Date.now();
    try {
      const res = await runLine(session, cmd);
      if (res.stdout) channel.write(res.stdout);
      if (res.stderr) channel.stderr.write(res.stderr);
      const lvl = res.exitCode === 0 ? 'info' : 'warn';
      ctx.log(lvl, `EXEC done cmd=${cmd} rc=${res.exitCode} ${Date.now() - start}ms`);
      channel.exit(res.exitCode);
    } catch (e) {
      ctx.log('error', `EXEC error cmd=${cmd}: ${(e as Error).message}`);
      channel.stderr.write(`mock: ${(e as Error).message}\n`);
      channel.exit(1);
    } finally {
      channel.end();
    }
  })();
}

function isShellCommand(cmd: string): boolean {
  // Heuristic — if the command appears to operate on a non-zowex path, it's a
  // shell command the user wants to run interactively. The simple silent-OK
  // path above is only for the zowex install dance.
  return /\/u\/|\/etc\/|\/var\/|\.\.|\$/.test(cmd);
}
