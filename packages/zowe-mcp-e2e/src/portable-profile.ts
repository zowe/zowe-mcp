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
 * Creates and manages a 100%-from-scratch, fully isolated VS Code "portable"
 * profile for the Copilot Chat BYOK e2e harness.
 *
 * SAFETY: every operation here is scoped to a directory under `os.tmpdir()`.
 * `assertUnderTmp` is called before any filesystem-destructive or
 * process-killing operation so a bug can never reach outside /tmp — in
 * particular it can never touch the real
 * `~/Library/Application Support/Code` or `~/.ssh`.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Settings every profile gets unless explicitly overridden. */
const DEFAULT_SETTINGS: Record<string, unknown> = {
  'chat.tools.global.autoApprove': true,
  'chat.agent.enabled': true,
  'workbench.startupEditor': 'none',
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'security.workspace.trust.enabled': false,
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'workbench.enableExperiments': false,
  // Copilot Chat's "tool grouping" optimization (progress message "Optimizing
  // tool selection") calls a fixed GitHub-hosted CAPI model (gpt-4o-mini) to
  // pick a tool subset before the turn even reaches the selected chat model.
  // That call always fails in a BYOK-only, no-GitHub-sign-in profile
  // ("Unable to resolve chat model with CAPI family selection: gpt-4o-mini"),
  // which aborts the whole agent-mode turn before our tool ever gets called.
  // Below a hardcoded 64-tool floor (see README "Known gotchas" — the floor
  // itself is a baked-in constant and NOT configurable, so the real fix is
  // keeping the registered tool count under it via capabilityTier; see
  // vscode-settings.ts), grouping is still *optionally* triggered above a
  // lower 20-tool floor by an A/B experiment that can default to "on" even
  // though this setting's own schema default is false — force it off
  // explicitly rather than relying on the schema default. The actual
  // internal setting IDs (`chat.advanced.tools.defaultToolsGrouped`, with
  // legacy alias `chat.tools.defaultToolsGrouped`) are registered by the
  // extension at runtime, separately from the "github.copilot.*"-prefixed
  // public one — set all three since it's unclear from the minified bundle
  // alone which one `getExperimentBasedConfig` actually reads, and setting
  // extras is harmless.
  'github.copilot.chat.tools.defaultToolsGrouped': false,
  'chat.tools.defaultToolsGrouped': false,
  'chat.advanced.tools.defaultToolsGrouped': false,
};

export interface CreatePortableProfileOptions {
  /**
   * Root scratch directory for this profile. MUST resolve under
   * `os.tmpdir()`. Defaults to a fresh directory under
   * `os.tmpdir()/zowe-mcp-e2e/<uuid>`.
   */
  scratchRoot?: string;
  /** Settings merged on top of {@link DEFAULT_SETTINGS} into `User/settings.json`. */
  settings?: Record<string, unknown>;
  /** Extra environment variables merged into every `code`/Electron launch against this profile. */
  extraEnv?: Record<string, string>;
}

/**
 * Pre-seeds `chat.tools.global.autoApprove.optIn = true` into the profile's
 * global storage sqlite db (`User/globalStorage/state.vscdb`, table
 * `ItemTable(key, value)` — plain, unencrypted, VS Code's own schema).
 *
 * `chat.tools.global.autoApprove` in settings.json alone is NOT enough:
 * Copilot Chat's `checkGlobalAutoApprove()` only trusts that setting once a
 * one-time, storage-persisted "I understand the risk" flag
 * (`chat.tools.global.autoApprove.optIn`) is also set — otherwise it opens
 * a *modal warning dialog* the first time a tool actually needs
 * auto-approval and awaits the user's click, which hangs forever in a
 * headless `code chat` invocation (no UI attached to click it). This was
 * found empirically: S2/S3 hung indefinitely after the model's tool_calls
 * turn, with the MCP server started and tools discovered but the tool
 * itself never invoked — reproducible, and resolved by pre-seeding this row
 * before the very first launch against a fresh profile (VS Code creates
 * `state.vscdb` on first run if it doesn't exist yet, using this same
 * schema, so pre-creating it here is safe).
 */
function seedGlobalStorage(userDir: string): void {
  const dbPath = path.join(userDir, 'globalStorage', 'state.vscdb');
  const sqliteBin = process.env.VSCODE_E2E_SQLITE3 ?? 'sqlite3';
  const sql =
    'CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);' +
    "INSERT INTO ItemTable (key, value) VALUES ('chat.tools.global.autoApprove.optIn', 'true');";
  const result = spawnSync(sqliteBin, [dbPath, sql], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) {
    throw new Error(
      `Failed to pre-seed global storage (${dbPath}) via "${sqliteBin}" ` +
        `(status ${String(result.status)}, error=${String(result.error)}): ${result.stderr}`
    );
  }
}

export interface PortableProfile {
  /** The scratch root — also the value used for `VSCODE_PORTABLE`. */
  dir: string;
  userDataDir: string;
  extensionsDir: string;
  settingsPath: string;
  sessionsDir: string;
  /** Base env (includes VSCODE_PORTABLE + extraEnv + inherited process.env) for all invocations against this profile. */
  env: NodeJS.ProcessEnv;
}

/** Resolves symlinks for the nearest existing ancestor of `p`, then re-appends any not-yet-created tail segments. */
function realpathAllowMissing(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break; // reached filesystem root without finding an existing ancestor
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  const resolvedBase = fs.existsSync(cur) ? fs.realpathSync(cur) : cur;
  return tail.length > 0 ? path.join(resolvedBase, ...tail) : resolvedBase;
}

/**
 * Throws unless `dir` resolves to a path under a recognized system scratch
 * root: `os.tmpdir()` (respects `$TMPDIR`, e.g. macOS's `/var/folders/.../T`)
 * or the literal `/tmp` (resolving symlinks, e.g. macOS's `/tmp` ->
 * `/private/tmp`). Both are accepted so the harness works the same whether
 * a caller passes an explicit `/tmp/...` scratch root or relies on the
 * default `os.tmpdir()`-based one — either way this guarantees every
 * destructive/pkill operation stays out of the user's HOME.
 */
export function assertUnderTmp(dir: string): void {
  const real = realpathAllowMissing(path.resolve(dir));
  const roots = ['/tmp', '/private/tmp', os.tmpdir()]
    .filter(Boolean)
    .map(r => realpathAllowMissing(path.resolve(r)));
  const ok = roots.some(root => real === root || real.startsWith(root + path.sep));
  if (!ok) {
    throw new Error(
      `Refusing to operate outside of a recognized tmp root (${roots.join(', ')}): "${real}". ` +
        'This is a hard safety guard for the Copilot BYOK e2e harness.'
    );
  }
}

/**
 * Picks the shortest available recognized tmp root. Prefers the literal
 * `/tmp` over `os.tmpdir()`: on macOS `os.tmpdir()` resolves to a long
 * per-process path (`/var/folders/xx/<hash>/T`), and VS Code creates a Unix
 * domain socket for its main IPC hook directly under the portable profile's
 * `user-data` dir (`<userDataDir>/<version>-main.sock`) — `sockaddr_un`'s
 * `sun_path` is capped at 104 bytes on macOS/BSD, so a long default scratch
 * root silently breaks VS Code startup (Electron exits within a few
 * seconds, before Playwright's `firstWindow()` ever sees a window; found
 * empirically — see README "Known gotchas"). `/tmp` (or its resolved form
 * `/private/tmp` on macOS) is only a few characters, leaving comfortable
 * headroom.
 */
function shortestTmpRoot(): string {
  return fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
}

/** Creates a brand-new, empty portable VS Code profile directory tree + seeded settings.json. */
export function createPortableProfile(
  options: CreatePortableProfileOptions = {}
): PortableProfile {
  // A short random id (not a full UUID) keeps the total path comfortably
  // under the ~103-usable-byte sockaddr_un limit even after VS Code appends
  // its own subpaths (see shortestTmpRoot doc comment).
  const shortId = randomUUID().split('-')[0];
  const root = options.scratchRoot ?? path.join(shortestTmpRoot(), 'zme2e', shortId);
  assertUnderTmp(root);

  const userDataDir = path.join(root, 'user-data');
  const extensionsDir = path.join(root, 'extensions');
  const userDir = path.join(userDataDir, 'User');
  const sessionsDir = path.join(userDir, 'globalStorage', 'emptyWindowChatSessions');

  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(path.join(userDir, 'globalStorage'), { recursive: true });
  seedGlobalStorage(userDir);

  const merged = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) };
  const settingsPath = path.join(userDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VSCODE_PORTABLE: root,
    ...(options.extraEnv ?? {}),
  };

  return { dir: root, userDataDir, extensionsDir, settingsPath, sessionsDir, env };
}

/** Re-writes `User/settings.json`, merging on top of what's already there. */
export function updateSettings(profile: PortableProfile, patch: Record<string, unknown>): void {
  assertUnderTmp(profile.dir);
  const current = JSON.parse(fs.readFileSync(profile.settingsPath, 'utf8')) as Record<
    string,
    unknown
  >;
  fs.writeFileSync(profile.settingsPath, JSON.stringify({ ...current, ...patch }, null, 2));
}

/**
 * Runs `code --install-extension <vsix>` against this profile. Headless —
 * no Electron window is shown. Throws with combined stdout/stderr on failure.
 */
export function installExtension(profile: PortableProfile, vsixPath: string): void {
  assertUnderTmp(profile.dir);
  if (!fs.existsSync(vsixPath)) {
    throw new Error(
      `vsix not found: ${vsixPath}. Build it first: cd packages/zowe-mcp-vscode && npm run package`
    );
  }
  const codeBin = process.env.VSCODE_E2E_CLI ?? 'code';
  const result = spawnSync(codeBin, ['--install-extension', vsixPath, '--force'], {
    env: profile.env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `"${codeBin} --install-extension ${vsixPath}" failed (status ${String(result.status)}, ` +
        `error=${String(result.error)}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

/**
 * Kills any processes whose command line contains this profile's scratch
 * directory. Pattern-scoped to the profile path per the harness safety rules
 * — never a bare `pkill -f code` or similar.
 */
export function killProfileProcesses(profile: PortableProfile): void {
  assertUnderTmp(profile.dir);
  spawnSync('pkill', ['-9', '-f', profile.dir], { stdio: 'ignore' });
}

/** Kills any lingering processes for this profile and (by default) deletes the scratch directory. */
export function cleanupPortableProfile(
  profile: PortableProfile,
  opts: { removeDir?: boolean } = { removeDir: true }
): void {
  killProfileProcesses(profile);
  if (opts.removeDir !== false) {
    assertUnderTmp(profile.dir);
    fs.rmSync(profile.dir, { recursive: true, force: true });
  }
}
