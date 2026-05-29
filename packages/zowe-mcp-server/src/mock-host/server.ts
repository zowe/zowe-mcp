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
 * Standalone mock z/OS SSH host built on the `ssh2` server library.
 *
 * Accepts password and publickey auth, services SFTP uploads of `server.pax.Z`,
 * exec channels for the `zowex server` RPC and one-shot USS commands, and
 * interactive shell channels. The Zowe MCP server connects with `--native` and
 * is unaware it's talking to a mock.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ssh2 from 'ssh2';
import { recordAuthOutcome } from './audit.js';
import { authenticateUser } from './auth.js';
import { handleExec } from './channels/exec-router.js';
import { startShellChannel } from './channels/shell.js';
import { AuthMessages } from './errors.js';
import { loadOrCreateHostKey } from './host-keys.js';
import { colorize, makeLogger, type MockLogger } from './log.js';
import { DEFAULT_PRE_AUTH_BANNER, DEFAULT_SSH_IDENT } from './realism.js';
import { attachSftpServer } from './sftp-server.js';
import { MockHostStore } from './store.js';
import { findUser, loadMockUsers, type MockUser } from './users.js';

export interface StartMockZosOptions {
  host: string;
  port: number;
  mockDir: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  /** Override the SSH ident string. Default mimics IBM z/OS OpenSSH. */
  sshIdent?: string;
  /**
   * Path to a custom pre-auth banner file. Default behavior:
   *   1. Read `<mockDir>/_ssh/banner.txt` if present.
   *   2. Otherwise fall back to {@link DEFAULT_PRE_AUTH_BANNER}.
   * Setting this option overrides the lookup.
   */
  bannerFile?: string;
  /**
   * Path to a specific host key file. When set, the daemon uses this file as-is
   * without writing anything to the mockDir or the user-level cache.
   *
   * Without this, the host key resolution is:
   *   1. `ZOWE_MCP_MOCK_HOST_KEY` env var
   *   2. `<mockDir>/_ssh/host_key`
   *   3. `~/.zowe-mcp/mock-host_key` (machine-stable cache)
   *   4. Freshly generated, saved to both 2 and 3
   *
   * So by default every mockDir on a given OS user account sees the same
   * fingerprint — `ssh known_hosts` stays happy across `gen-fixtures` resets.
   */
  hostKeyFile?: string;
  /**
   * When true, do not consult or write to the machine-stable cache; treat the
   * mockDir as fully self-contained. Useful for tests that need a unique key
   * per scenario.
   */
  isolateHostKey?: boolean;
  /**
   * If set, also start a z/OSMF HTTP listener on this port (use 0 for ephemeral).
   * Omit to disable the HTTP side entirely (SSH-only mode, the previous default).
   *
   * Plain HTTP only in this iteration — TLS support is planned but not implemented.
   */
  httpPort?: number;
  /** Bind address for the z/OSMF HTTP listener. Defaults to '127.0.0.1'. */
  httpHost?: string;
  /**
   * When true, the z/OSMF HTTP listener logs full request + response details
   * (headers with Authorization/Cookie redacted; bodies truncated at 4 KiB).
   * Useful for debugging Zowe Explorer / Zowe SDK exchanges against the mock.
   */
  verbose?: boolean;
  /**
   * z/OSMF version to advertise in `GET /zosmf/info`. Defaults to `'5.30'`.
   * Currently the only supported value. Controls the `zos_version`,
   * `zosmf_version`, and `zosmf_full_version` response fields.
   */
  zosmfVersion?: '5.30';
}

export interface StartMockZosResult {
  /** SSH listener — always started. */
  ssh: { host: string; port: number };
  /** z/OSMF HTTP listener — present iff `httpPort` was provided. */
  http?: { host: string; port: number };
  mockDir: string;
  /** Close both listeners and free associated resources (tokens, etc.). */
  dispose: () => Promise<void>;
}

export async function startMockZosHost(opts: StartMockZosOptions): Promise<StartMockZosResult> {
  const hostKey = await loadOrCreateHostKey(opts.mockDir, {
    keyFile: opts.hostKeyFile,
    isolateToMockDir: opts.isolateHostKey,
  });
  const { users, defaultSystemId } = await loadMockUsers(opts.mockDir);
  const store = new MockHostStore(opts.mockDir);
  const banner = await resolveBanner(opts);

  const baseLogger = makeLogger(opts.logLevel);
  // Tag every SSH-side log line with `[mock-ssh]` so operators can grep by
  // transport (mirrors the `[mock-zosmf]` tag the HTTP listener uses).
  const sshLogger: MockLogger = (lvl, msg) => baseLogger(lvl, `[mock-ssh] ${msg}`);
  // The startup banner uses the untagged logger so the daemon header stays
  // visually distinct from per-transport traffic.
  const logger = baseLogger;

  // ASCII-art "z/OS" header — printed once at startup so a fresh terminal
  // window immediately shows what's launching. Green so it pops, but suppressed
  // when stderr is not a TTY (file/pipe output stays clean).
  printAsciiBanner();
  logger('info', `Mock z/OS host starting (mockDir=${opts.mockDir})`);

  const server = new ssh2.Server(
    {
      hostKeys: [hostKey],
      ident: opts.sshIdent ?? DEFAULT_SSH_IDENT,
      banner,
      algorithms: {
        serverHostKey: ['rsa-sha2-256', 'rsa-sha2-512', 'ssh-rsa'],
      },
    },
    client =>
      handleClient(client, {
        users,
        defaultSystemId,
        store,
        mockDir: opts.mockDir,
        log: sshLogger,
      })
  );

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });

  const sshAddress = server.address();
  const sshPort = typeof sshAddress === 'object' && sshAddress ? sshAddress.port : opts.port;
  logger('info', `SSH    listening on ${opts.host}:${sshPort}`);

  // Optional z/OSMF HTTP listener. Imported lazily so a daemon launched without
  // --http-port doesn't pull Express into memory until the first request.
  let httpHandle: { host: string; port: number; close: () => Promise<void> } | undefined;
  if (opts.httpPort !== undefined) {
    const { startZosmfHttpServer } = await import('./zosmf/http-server.js');
    httpHandle = await startZosmfHttpServer({
      host: opts.httpHost ?? '127.0.0.1',
      port: opts.httpPort,
      mockDir: opts.mockDir,
      users,
      defaultSystemId,
      store,
      log: (lvl, msg) => logger(lvl, `[mock-zosmf] ${msg}`),
      verbose: opts.verbose,
      zosmfVersion: opts.zosmfVersion,
    });
    logger(
      'info',
      `z/OSMF listening on http://${httpHandle.host}:${httpHandle.port}` +
        (opts.verbose ? ' (verbose HTTP traces ON)' : '')
    );
  }

  // Startup summary — emit what the daemon will accept so operators can debug
  // "why didn't my request match?" without grepping fixtures. Logged at info,
  // so visible by default.
  logStartupSummary(logger, {
    mockDir: opts.mockDir,
    users,
    defaultSystemId,
    httpEnabled: opts.httpPort !== undefined,
  });

  return {
    ssh: { host: opts.host, port: sshPort },
    http: httpHandle ? { host: httpHandle.host, port: httpHandle.port } : undefined,
    mockDir: opts.mockDir,
    dispose: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (httpHandle) await httpHandle.close();
    },
  };
}

interface ClientCtx {
  users: MockUser[];
  defaultSystemId: string;
  store: MockHostStore;
  mockDir: string;
  log: MockLogger;
}

/**
 * ssh2's exported `Connection` type doesn't expose the underlying TCP socket,
 * but the implementation does set it as `_sock`. We use it only for logging
 * (the remote IP), and tolerate it being absent.
 */
interface ConnectionInternals {
  _sock?: { remoteAddress?: string };
}

function handleClient(client: ssh2.Connection, ctx: ClientCtx): void {
  const sock = (client as unknown as ConnectionInternals)._sock;
  const clientIp = sock?.remoteAddress ?? '127.0.0.1';
  let authedUser: MockUser | undefined;
  let failedAttempts = 0;
  const MAX_AUTH = 3;
  ctx.log('info', `New connection from ${clientIp}`);

  client.on('authentication', authCtx => {
    const username = authCtx.username;
    const candidate = findUser(ctx.users, username);
    ctx.log('debug', `auth method=${authCtx.method} user=${username}`);

    if (authCtx.method === 'none') {
      authCtx.reject(['password', 'publickey']);
      return;
    }

    if (!candidate) {
      // Unknown user — let them try a few methods then reject.
      failedAttempts++;
      if (failedAttempts >= MAX_AUTH) {
        ctx.log('info', `${AuthMessages.tooManyAttempts(username)} (${clientIp})`);
        void recordAuthOutcome(ctx.mockDir, username, 'tooManyAttempts');
        client.end();
        return;
      }
      authCtx.reject(['password', 'publickey']);
      return;
    }

    // Scenario gates
    if (candidate.scenario === 'racfRevoked') {
      ctx.log('info', `${AuthMessages.racfRevoked(username)}`);
      void recordAuthOutcome(ctx.mockDir, username, 'racfRevoked');
      authCtx.reject([]);
      return;
    }

    if (authCtx.method === 'password') {
      const pwCtx = authCtx;
      // Delegate the decision to the shared helper so the HTTP route uses the
      // exact same branch order. The retry / disconnect / delay behaviors below
      // are SSH-protocol-level concerns and stay here.
      const result = authenticateUser(ctx.users, username, pwCtx.password);

      if (!result.ok) {
        // Translate the failure reason into the appropriate SSH-side response.
        if (result.reason === 'wrongPassword') {
          failedAttempts++;
          ctx.log('info', AuthMessages.wrongPassword(username));
          if (failedAttempts >= MAX_AUTH) {
            ctx.log('info', AuthMessages.tooManyAttempts(username));
            void recordAuthOutcome(ctx.mockDir, username, 'tooManyAttempts');
            client.end();
            return;
          }
          void recordAuthOutcome(ctx.mockDir, username, 'wrongPassword');
          pwCtx.reject(['password', 'publickey']);
          return;
        }
        if (result.reason === 'passwordExpired') {
          ctx.log('info', AuthMessages.passwordExpired(username));
          void recordAuthOutcome(ctx.mockDir, username, 'passwordExpired');
          pwCtx.reject([]);
          return;
        }
        // `unknownUser` and `racfRevoked` were already short-circuited above
        // by the early `!candidate` / `racfRevoked` checks. This branch is
        // unreachable in practice but kept defensively.
        pwCtx.reject([]);
        return;
      }

      // Success path. The expiry-soon warning is logged + persisted (real
      // z/OS OpenSSH writes such warnings to stderr during keyboard-interactive
      // auth — for plain password auth we cannot send a banner mid-auth, so
      // we record it in last_auth.json for tests / operator awareness).
      if (result.warning?.kind === 'passwordExpiresInDays') {
        ctx.log('info', AuthMessages.passwordExpiresInDays(result.warning.days));
        void recordAuthOutcome(ctx.mockDir, username, 'passwordExpiringSoon', result.warning.days);
      }

      const proceed = () => {
        authedUser = result.user;
        pwCtx.accept();
      };
      if (candidate.scenario === 'authDelay' && candidate.scenarioValue) {
        setTimeout(proceed, candidate.scenarioValue);
      } else {
        proceed();
      }
      return;
    }

    if (authCtx.method === 'publickey') {
      const pkCtx = authCtx;
      const allowed = (candidate.authorizedKeys ?? []).map(line => parseAuthorizedKey(line));
      const match = allowed.find(
        k => pkCtx.key.algo === k?.type && k.getPublicSSH().equals(pkCtx.key.data)
      );
      if (!match) {
        pkCtx.reject(['password', 'publickey']);
        return;
      }
      if (!pkCtx.signature || !pkCtx.blob) {
        // Probing query — accept the key
        pkCtx.accept();
        return;
      }
      const verifyResult = match.verify(pkCtx.blob, pkCtx.signature);
      if (verifyResult !== true) {
        pkCtx.reject([]);
        return;
      }
      authedUser = candidate;
      pkCtx.accept();
      return;
    }

    authCtx.reject(['password', 'publickey']);
  });

  client.on('ready', () => {
    if (!authedUser) {
      ctx.log('warn', 'ready event without authed user — closing');
      client.end();
      return;
    }
    const systemId = authedUser.systemId ?? ctx.defaultSystemId;
    ctx.log('info', `Authenticated ${authedUser.username} for system ${systemId}`);

    client.on('session', accept => {
      const session = accept();
      session.on('subsystem', (accept2, reject2, info) => {
        if (info.name === 'sftp') {
          ctx.log('debug', 'sftp subsystem requested');
          // ssh2's subsystem `accept2` callback yields an SFTPWrapper for the
          // 'sftp' subsystem, but its typing is the generic `accept` signature;
          // cast through `unknown` because attachSftpServer expects the SFTP
          // accept factory.
          const sftpAccept = accept2 as unknown as () => ssh2.SFTPWrapper;
          attachSftpServer(
            sftpAccept,
            () => {
              reject2();
              return false;
            },
            ctx.log,
            ctx.mockDir
          );
        } else {
          reject2();
        }
      });
      session.on('exec', (accept2, _reject2, info) => {
        const channel = accept2();
        handleExec(channel, info.command, {
          store: ctx.store,
          user: authedUser!,
          systemId,
          log: ctx.log,
        });
      });
      session.on('shell', accept2 => {
        const channel = accept2();
        void startShellChannel(channel, {
          store: ctx.store,
          user: authedUser!,
          systemId,
          mockDir: ctx.mockDir,
          clientIp,
          log: ctx.log,
        });
      });
      session.on('pty', (accept2, _reject2, _info) => {
        accept2();
      });
    });
  });

  client.on('error', err => {
    ctx.log('debug', `client error: ${err.message}`);
  });
  client.on('close', () => {
    ctx.log('debug', `client closed (${clientIp})`);
  });
}

function parseAuthorizedKey(line: string): ssh2.ParsedKey | null {
  try {
    const result = ssh2.utils.parseKey(line.trim());
    return result instanceof Error ? null : result;
  } catch {
    return null;
  }
}

/**
 * Resolve the pre-auth banner text in this priority order:
 *   1. opts.bannerFile (explicit CLI / API override)
 *   2. `<mockDir>/_ssh/banner.txt` (per-mock-dir override)
 *   3. {@link DEFAULT_PRE_AUTH_BANNER} (Zowe default)
 *
 * Returns the banner with CRLF line endings as required by SSH protocol.
 */
async function resolveBanner(opts: StartMockZosOptions): Promise<string> {
  const candidates: string[] = [];
  if (opts.bannerFile) candidates.push(opts.bannerFile);
  candidates.push(path.join(opts.mockDir, '_ssh', 'banner.txt'));
  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      // Normalize to CRLF; ssh2 forwards bytes as-is to the client.
      return raw.replace(/\r?\n/g, '\r\n');
    } catch {
      /* try next */
    }
  }
  return DEFAULT_PRE_AUTH_BANNER;
}

/**
 * Print a one-shot startup summary at `info` level so operators can debug
 * "why doesn't this user log in?" or "why doesn't this query match?" without
 * grepping fixtures. Lists: systems.json (anonymized — passwords elided),
 * the resolved user catalog (uppercase usernames, scenarios), and the
 * registered z/OSMF HTTP routes when the HTTP listener is enabled.
 */
function logStartupSummary(
  logger: MockLogger,
  ctx: {
    mockDir: string;
    users: MockUser[];
    defaultSystemId: string;
    httpEnabled: boolean;
  }
): void {
  // systems.json — read synchronously? Avoid: we already loaded users
  // asynchronously above. Reuse what we already have plus a small one-off
  // read of systems.json for the host/defaultUser display. Best-effort.
  void (async () => {
    let systemsSummary = '(no systems.json found)';
    try {
      const raw = await fs.readFile(path.join(ctx.mockDir, 'systems.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        systems?: { host: string; port?: number; defaultUser?: string }[];
      };
      systemsSummary =
        (parsed.systems ?? [])
          .map(s => `${s.host}${s.port ? ':' + s.port : ''} (defaultUser=${s.defaultUser ?? '-'})`)
          .join(', ') || '(empty)';
    } catch {
      /* leave default */
    }
    logger('info', `Team config (systems.json): ${systemsSummary}`);
    logger(
      'info',
      `Default systemId: ${ctx.defaultSystemId} (used when a user has no explicit .systemId)`
    );
    const userLines = ctx.users.map(u => {
      const tag = u.scenario && u.scenario !== 'normal' ? ` [${u.scenario}]` : '';
      const sys = u.systemId ? ` sys=${u.systemId}` : '';
      const home = u.home ? ` home=${u.home}` : '';
      return `  ${u.username.toUpperCase()}${tag}${sys}${home}`;
    });
    logger('info', `Available credentials (${ctx.users.length} user(s)):`);
    for (const line of userLines) logger('info', line);
    if (ctx.httpEnabled) {
      logger('info', 'z/OSMF endpoints registered:');
      logger('info', '  POST   /zosmf/services/authenticate         (login — Basic → LtpaToken2)');
      logger('info', '  DELETE /zosmf/services/authenticate         (logout — clears token)');
      logger('info', '  GET    /zosmf/info                          (token verify + metadata)');
      logger(
        'info',
        '  GET    /zosmf/restfiles/ds                  (?dslevel=<pat>; bare HLQ → <HLQ>.**)'
      );
      logger('info', '  GET    /zosmf/restfiles/ds/<dsname>         (read sequential dataset)');
      logger('info', '  GET    /zosmf/restfiles/ds/<dsname>(<mbr>)  (read PDS / PDS-E member)');
      logger(
        'info',
        '  GET    /zosmf/restfiles/ds/<dsname>/member  (list members of a PDS / PDS-E)'
      );
      logger('info', '  Anything else → 404 + IZUG1099E');
    }
  })();
}

/**
 * Print the green "z/OS" ASCII art header. Suppressed when stderr isn't a TTY
 * (file redirects, CI logs) and when NO_COLOR is set — the leveled startup
 * lines that follow still carry all the info.
 */
function printAsciiBanner(): void {
  // Use process.stdout? No — keep everything on stderr so log redirection
  // captures the banner too. Honor TTY/NO_COLOR so non-interactive consumers
  // (test harnesses, journald) don't get a wall of ANSI noise.
  if (!process.stderr.isTTY) return;
  if (process.env.NO_COLOR && process.env.NO_COLOR !== '') return;
  // Lowercase "z" (top stroke, diagonal, bottom stroke) + "/" + uppercase O
  // + uppercase S, hand-drawn so the slash between z and OS is obvious.
  const lines = [
    '   _____             _____     ____  ',
    '       /     /      /     \\   / ___| ',
    '      /     /      |       |  \\___ \\ ',
    '     /     /       |       |   ___) |',
    '   _/____ /         \\_____/   |____/ ',
    '                                     ',
    '   Mock z/OS Host  -  Zowe Project   ',
  ];
  for (const line of lines) {
    process.stderr.write(`${colorize(line, 'green')}\n`);
  }
}
