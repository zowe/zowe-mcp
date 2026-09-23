# Plan: Zowe CLI `ssh` profiles as a source of native-backend connections

Status: **draft, not yet reviewed.** Requirements in §1 were agreed with the
project lead; the design (§3 onwards) is a proposal awaiting review, and the
points in §8 are open. **No code yet.** Written 2026-09-10 on branch
`zowe-ssh-profile-support` from `main` at `7d366a7`; revised 2026-09-23 with
three decisions: a type-neutral `--zowe-profile` flag, a backend-aware
connection identity, and `base` profile inheritance.
Every code reference below was checked on that commit; SDK references are
against the pinned `@zowe/zowex-for-zowe-sdk` 0.9.0 nightly
(`resources/zowex-pin.json`) and `@zowe/imperative` 8.36.0.

Supersedes the recommendation in the earlier local research note
`notes/zowe-cli-profiles-and-mcp.md` §5 (`notes/` is gitignored, so that file
is not in the repository) where the two disagree: that note allowed falling
back to Zowe MCP's own credential store; this plan does not — see
requirement 5.

## 1. Requirements

Stated by the project lead on 2026-09-10.

1. **Use what is in Zowe profiles, including their secrets, but do not depend
   on them.** Everything that works today keeps working when no Zowe
   configuration exists. The reason is that Zowe MCP does not run only on a
   developer workstation with Zowe CLI or Zowe Explorer. It also runs as a
   remote MCP server (`http` mode) on a system where Zowe CLI cannot be
   installed, so no team configuration and no Zowe secure store exist there.
   Profiles are a convenience for workstation users, never a prerequisite.
2. **Work without Zowe CLI.** `ssh` profiles are used when present; the
   `user@host[:port]` path is unchanged.
3. **Explicit selection.** The user names which profiles the server may
   use. The server never imports every profile it can see.
4. **The standalone server is non-interactive.** Profile problems fail fast
   during initialisation; at runtime they are reported clearly, naming the
   profile and the field.
5. **No credential substitution.** A profile supplies its own credentials from
   Zowe's secure store. "Its own" means the selected profile, its parent
   profiles, and the default `base` profile it inherits from — exactly the
   values Zowe CLI would use for that profile. If they are missing or invalid,
   the problem is reported and the user fixes it with Zowe CLI or Zowe
   Explorer. None of Zowe MCP's own methods (env passwords,
   `ZOWE_MCP_CREDENTIALS`, Vault, MCP elicitation, the VS Code input box,
   `~/.ssh` key discovery, SecretStorage, team-config write-back) backfills a
   profile-sourced connection.

Decisions taken the same day:

| Question | Decision |
| --- | --- |
| Deployment modes | `stdio-standalone` and `stdio-vscode` only. `http` never reads team config. |
| VS Code (interactive) | Same rule as standalone: report and stop, no prompting, no write-back. |
| Selection | A named list of profile names (flag / env / setting). May be combined with `user@host` specs. `defaults.ssh` never widens the allowed set. |
| Initial active connection | If the team-config default `ssh` profile is one of the allowed profiles, it is the initial active connection, regardless of list order. `ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM` still overrides. |
| Keyring | Bundle `@zowe/secrets-for-zowe-sdk` on all platforms; optional at runtime. If it fails to load, profile-sourced systems report "secure store unavailable"; `user@host` systems are unaffected. |
| Config layers | Global `~/.zowe` plus a project layer. Project directory: VS Code workspace folder, else the first MCP root, else the process cwd. (See §3.7 for a timing constraint.) |
| Key → password | After a profile's `privateKey` fails, retry with the same profile's `password`. Error only when every credential the profile itself holds has failed. |
| `zowe config list --rfj` | Dropped. `ProfileInfo` is the only reader; the `zowe` binary is never invoked. |

Decisions taken 2026-09-23:

| Question | Decision |
| --- | --- |
| Flag naming | Type-neutral `--zowe-profile <name>`. The profile's `type` selects the backend; only `ssh` is accepted in the first iteration. Avoids renaming a shipped flag, env var, and setting when a z/OSMF backend arrives. |
| Connection identity | Includes the backend: `ssh` and a future `zosmf` connection to the same `user@host` are different connections. The `user@host` text users type is unchanged. See §3.2. |
| `base` inheritance | Supported. Values from parent profiles and the default `base` profile count as the profile's own (requirement 5). Only fields the `ssh` backend understands are taken. |

## 2. Facts the design rests on

**Zowe CLI `ssh` profile** (Zowe CLI 3.4 web help, `zowe zos-ssh issue command`):
properties `host`, `port` (default 22), `user`, `password`, `privateKey` (path),
`keyPassphrase`, `handshakeTimeout` (ms). Selected by `--ssh-profile <name>` or
`defaults.ssh`. `zos-ssh` commands also accept an optional `base` profile, from
which `host`, `user` and `password` can come. API ML token options do not apply
to `ssh`. Secrets live in the OS secure store when listed under `secure` and
`autoStore` is on.

**Profile names are unique across types.** `ProfileInfo.getAllProfiles()`
(`lib/config/src/ProfileInfo.js:343-372`) iterates the `profiles` object of the
layer-merged config; each key is one profile with one `type`, and nested
profiles are addressed by their dotted path (`lpar1.ssh`, `lpar1.zosmf`). A
name therefore identifies exactly one profile and its type. The same name in
the global and the project layer is merged into one profile before listing, so
the effective `type` is the merged one, not something inferred from the name.

**`mergeArgsForProfile` merges `base` automatically**
(`lib/config/src/ProfileInfo.js:510-577`):

- Service-profile values come from `profiles.get(name)`, which includes values
  inherited from parent profiles.
- Every property of the default `base` profile not already set is then added,
  secure values included. There is no schema filter, so an `ssh` profile also
  receives `tokenType`, `tokenValue`, `rejectUnauthorized`, etc. from `base`.
- A profile defined in the global layer resolves `defaults.base` from the
  global layer, not the project layer (lines 537-556).
- Every merged value carries `argLoc.jsonLoc`
  (e.g. `profiles.global_base.properties.password`), so the source profile of
  each field is known.

**Native backend today**: connection identity is `user@host[:port]`
(`ParsedConnectionSpec { user, host, port }`,
`src/zos/native/connection-spec.ts:20-24`, parsed at `:98-135`); credentials
come from `NativeCredentialProvider.getCredentials()`
(`src/zos/native/native-credential-provider.ts:300-400`), cached under
`cacheKey(spec)` (`src/zos/native/ssh-client-cache.ts`): SSH key
(`ssh-key-resolver.ts`, using `SshConfigUtils.migrateSshConfig()` and
`findPrivateKeys()` from the zowex SDK) then password (env → `ZOWE_MCP_CREDENTIALS`
→ Vault → elicitation, or the VS Code pipe). Systems list assembly:
`--config` systems, then `--system`, deduplicated (`src/index.ts:100-113`);
native mode with zero systems exits 1 (`src/index.ts:1279-1290`). With no
`setSystem` call the first configured system is used unless
`ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM` (`src/zos/session.ts:83-115`).

**The `ssh` profile maps onto that model field for field** (after the merge,
any field may come from a parent or `base`):

| Native backend | `ssh` profile |
| --- | --- |
| `user@host[:port]` | `user`, `host`, `port` |
| `ZOWE_MCP_PASSWORD_<USER>_<HOST>` | `password` (secure) |
| `ZOWE_MCP_PRIVATE_KEY_<USER>_<HOST>` | `privateKey` |
| `ZOWE_MCP_KEY_PASSPHRASE_<USER>_<HOST>` | `keyPassphrase` (secure) |
| — | `handshakeTimeout` (SSH handshake only; not the zowex RPC timeout) |

**Dependencies already present**: `@zowe/imperative` 8.36.0 is a real
dependency of the server (peer of the zowex SDK), so team config can be read
without the `zowe` binary. `ProfileInfo` gives `getAllProfiles()`,
`getDefaultProfile('ssh')`, `mergeArgsForProfile(prof, { getSecureVals: true })`.
`Config.load` accepts `{ homeDir, projectDir: string | false }`
(`lib/config/src/doc/IConfigOpts.d.ts`), so the project layer is chosen
explicitly. `ProfileInfo` accepts `credMgrOverride`
(`lib/config/src/doc/IProfOpts.d.ts:22`) and
`ProfileCredentials.defaultCredMgrWithKeytar(requireKeytar)` lets the caller
supply the `require` used to load the keyring.

**Dependency absent**: `@zowe/secrets-for-zowe-sdk` is installed nowhere in the
tree. Without it, `ProfileInfo.readProfilesFromDisk()` throws
`ProfInfoErr` `LOAD_CRED_MGR_FAILED` ("Failed to initialize secure credential
manager") whenever the config uses `secure` (`lib/config/src/ProfileInfo.js:807-821`).
The default manager resolves the package from `require.main.filename`
(`lib/security/src/DefaultCredentialManager.js:130-135`), which is fragile under
esbuild bundling — the same trap already recorded for the zowex SDK's peer
dependencies (`AGENTS.md`, VSIX `SERVER_EXTERNAL` in
`packages/zowe-mcp-vscode/scripts/esbuild.mjs:89-95`).

**zowex SDK team-config code, not used here**: the SDK ships
`AbstractConfigManager` and `ConfigFileUtils` (an interactive "pick / create /
validate / write back an `ssh` profile" flow lifted from Zowe Explorer). It
prompts, migrates `~/.ssh/config`, and edits `zowe.config.json`, so it violates
requirements 4 and 5. Only its read-side pattern (`getMergedAttrs`, ten lines) is
reused. No file under `packages/*/src` references either class today.

**Existing extension code**: `packages/zowe-mcp-vscode/src/zowe-profile.ts`
loads `ProfileInfo` (falling back to `zowe config list --rfj`) to find the
Explorer profile matching an MCP `user@host`, only to build editor URIs. The
extension already passes the first workspace folder as `ZOWE_MCP_WORKSPACE_DIR`
(`src/extension.ts:520`) and every `zowexConnections` entry as `--system`
(`src/extension.ts:440-443`); live updates go over the pipe as
`connections-update { connections: string[] }`
(`docs/pipe-events-extension-server.md`).

## 3. Design

### 3.1 Configuration surface

A separate, ordered list of profile names next to the existing connection list.
Profile names are not mixed into `--system` because `@` is not reserved in Zowe
profile names and nested names contain `.`; a separate flag keeps parsing
unambiguous.

The flag is type-neutral: the server looks the name up among all profiles and
dispatches on its `type`. In the first iteration only `ssh` is accepted; any
other type is rejected with `profile-type-unsupported` (§4), naming the type.
A later z/OSMF backend adds `zosmf` to the accepted types without renaming
anything.

| Source | Form | Notes |
| --- | --- | --- |
| CLI | `--zowe-profile <name>` (repeatable) | mirrors `--system` |
| Env | `ZOWE_MCP_ZOWE_PROFILE` (comma list) | same list encoding as `ZOWE_MCP_LOCAL_FILES_ROOT` |
| `--config` JSON | `"zoweProfiles": ["lpar1.ssh", …]` | beside `systems`; job cards stay keyed by the resolved `user@host` as today |
| VS Code | `zoweMCP.zoweProfiles: string[]` (window scope) | passed as repeated `--zowe-profile`; live over the pipe |
| Project dir | `--zowe-config-dir <dir>` (optional) / `ZOWE_MCP_ZOWE_CONFIG_DIR` | overrides the project-layer directory; see §3.7 |

Flag and env follow the derivation rule `--foo-bar` ↔ `ZOWE_MCP_FOO_BAR`
(`docs/configuration-and-deployment-model.md` §2.7), with the singular
comma-list env form that `ZOWE_MCP_LOCAL_FILES_ROOT` already uses. The array
setting and the `--config` key are plural; see §8 point 3.

`--zowe-profile` together with `--http` is a startup error ("Zowe profiles
are read only in stdio mode"). `--zowe-profile` together with `--mock` is
a startup error like `--system` is today.

Native mode with zero `--system` entries but one or more profiles is valid; the
zero-systems check counts both lists.

### 3.2 Connection identity

Today a connection is identified by `ParsedConnectionSpec { user, host, port }`
and credentials are cached under `cacheKey(spec)`. The identity gains the
backend so that a future `zosmf` connection to the same host does not collide
with an `ssh` one:

```ts
type ConnectionId =
  | { backend: 'ssh';   user: string; host: string; port: number }                    // port default 22
  | { backend: 'zosmf'; user: string; host: string; port: number; basePath: string }; // later; port default 443
```

| Where | `ssh` | `zosmf` (later) |
| --- | --- | --- |
| `--system` input | `USER1@lpar1.example.com` (unchanged) | not accepted; profile only |
| Internal cache key | `ssh:USER1@lpar1.example.com:22` | `zosmf:USER1@lpar1.example.com:443/zosmf` |
| `listSystems` entry | `{ id: "USER1@lpar1.example.com", backend: "ssh", profileName: "lpar1.ssh" }` | `{ id: "USER1@lpar1.example.com/zosmf", backend: "zosmf", profileName: "lpar1.zosmf" }` |

- `basePath` is part of the `zosmf` identity because behind an API ML gateway
  several services share one host and port.
- User-facing ids for `ssh` stay `user@host[:port]`, so existing `--system`
  values, `setSystem` arguments and settings keep working.
- Job cards and other per-system defaults stay keyed by `user@host`: a job card
  belongs to a user on a system, not to a transport.
- In the first iteration this is type plumbing only (`backend: 'ssh'`
  everywhere and an `ssh:` prefix on the cache key); the `zosmf` variant is
  added with the z/OSMF backend.

### 3.3 Resolution at startup

New module `packages/zowe-mcp-server/src/zos/zowe-profiles.ts` (backend-neutral
reader) with the `ssh` mapping in `src/zos/native/zowe-ssh-profile.ts`, loaded
only when the profile list is non-empty (so a server started without it never
touches `@zowe/imperative`'s config code):

1. `import('@zowe/imperative')` lazily. Failure → `ZoweProfileError`
   `imperative-unavailable`.
2. `new ProfileInfo('zowe', { credMgrOverride })` where `credMgrOverride` is
   `ProfileCredentials.defaultCredMgrWithKeytar(() => require('@zowe/secrets-for-zowe-sdk'))`
   using the server's own module resolution. If that `require` throws, the
   override is omitted and the resulting `LOAD_CRED_MGR_FAILED` is mapped to
   `secure-store-unavailable` — but only if the config actually has secure
   entries; a config without `secure` never needs the keyring.
3. `readProfilesFromDisk({ projectDir })` with the directory from §3.7, or
   `projectDir: false` when none applies.
4. For each requested name, in order: find it in `getAllProfiles()` (all types)
   by `profName`; not found → `profile-not-found` listing the names of
   profiles of supported types (names only, never values). Found with a type
   other than `ssh` → `profile-type-unsupported`.
5. `mergeArgsForProfile(prof, { getSecureVals: true })`. This already includes
   parent-profile and default-`base` values (§2). From `knownArgs` take only
   `host`, `port`, `user`, `password`, `privateKey`, `keyPassphrase`,
   `handshakeTimeout`; ignore everything else (`tokenValue`,
   `rejectUnauthorized`, …). For each taken field keep the source profile
   name, derived from `argLoc.jsonLoc`.
6. Validate the merged values: `host` and `user` present, else
   `profile-incomplete` naming the missing field and the profiles searched
   (the profile, its parents, and the `base` profile, or "no base profile");
   at least one of `password` or `privateKey`, else
   `profile-has-no-credentials`. A `privateKey` path that does not exist or is
   unreadable → `private-key-unreadable`. A `privateKey` that is encrypted
   (`classifyKeyEncryption`, `ssh-key-resolver.ts`) with no `keyPassphrase` and
   no `password` → `passphrase-missing`.
7. Produce one `ResolvedZoweProfile` per name:
   `{ profileName, profileType: 'ssh', id: ConnectionId, password?,
   privateKeyPath?, keyPassphrase?, handshakeTimeoutMs?, sources, isDefault }`
   where `id` is built through `parseConnectionSpec(`${user}@${host}:${port}`)`
   so it canonicalises exactly like `--system` entries, `sources` maps each
   field to the profile that supplied it, and `isDefault` is true when
   `getDefaultProfile('ssh')?.profName === profileName`.

Duplicates are compared on the full `ConnectionId`. If a profile resolves to
the same identity as a `--system` entry, the profile wins (it carries
credentials; the spec entry does not) and a warning is logged. Two profiles
resolving to the same identity is a startup error `duplicate-connection`.

Failure policy:

- **stdio-standalone**: any `ZoweProfileError` → the message from §4 on
  stderr, `process.exit(1)`. Same as the existing native-mode startup errors.
- **stdio-vscode**: the failing profile is dropped, the error goes to the
  extension as a `status`/error event, and the extension shows an error
  notification naming the profile. The server continues with the remaining
  connections so a typo in one profile does not disable the `user@host`
  systems in the same window. This is the one place the two modes differ; see
  §8.

Secrets never appear in log lines. Logs carry `profileName`, the source
profile of each credential, `user`, `host`, `port`, and the existing 16-hex
`passwordHash` correlation field.

### 3.4 Credential provider

`NativeCredentialProvider` gains an optional
`profileCredentials?: Map<string, ResolvedZoweProfile>` keyed by the same
cache key it already uses (now `ssh:`-prefixed, §3.2). In `getCredentials()`:

```text
if the connection is profile-sourced:
  if privateKeyPath and not keyFailedKeys.has(key):
      return { authMethod: 'key', privateKeyPath, keyPassphrase }
  if password and not invalidKeys.has(key):
      return { authMethod: 'password', password }
  throw ZoweProfileError('credentials-exhausted', profileName)
else: existing flow, unchanged
```

Nothing else in the existing flow runs for a profile-sourced connection: no
`tryResolveKeyCredentials` (no `~/.ssh` discovery), no
`resolveStandalonePassword`, no elicitation, no `requestPasswordCallback`, no
SecretStorage. `markKeyFailed(spec)` keeps its current meaning and moves the
profile to its own password, wherever in the inheritance chain that password
came from (decision: key → password within one profile). `markInvalid(spec)`
for a profile-sourced connection records the failure and must not touch
`passwordStore` or send `password-invalid` to the extension; instead it emits
the §4 `credentials-invalid` message, naming the profile that supplied the
failed credential (e.g. the `base` profile), since that is where the user
fixes it.

`listUsers()` and `resolveJobCardConnectionSpec()` are unchanged because the
profile is registered under an ordinary `user@host` id.

### 3.5 Initial active connection

`SystemRegistry` gets an optional `preferredDefaultSpec` set at startup to the
identity of the profile whose `isDefault` is true, if any. In
`resolveSystemForTool()` (`src/zos/session.ts`) the "no active system" branch
uses `preferredDefaultSpec` before falling back to `hosts[0]`. The
`ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM` check stays first. When the list is
replaced at runtime (pipe update), `preferredDefaultSpec` is recomputed.

### 3.6 Reporting at runtime

- `listSystems` and `getContext` add `backend`, `source: "zowe-profile"` and
  `profileName` for profile-sourced systems, so the model and the user can
  tell where a connection came from and how it is reached.
- Authentication failures on a profile-sourced system raise the §4 messages
  through the existing tool-error path; the deployment-mode hint
  (`src/mcp-deployment-mode.ts`) is extended so the fix text says "Zowe
  Explorer" in `stdio-vscode` and "`zowe config set …`" in `stdio-standalone`,
  addressed at the profile that supplied the failing value.
- No retry loop and no prompt. Once a profile's credentials are exhausted for
  the session, every call reports the same message until restart (standalone)
  or a settings change (VS Code, which re-resolves the profile).

### 3.7 Config layers and the project directory

Layers read: global (`~/.zowe`, or `ZOWE_CLI_HOME` as imperative already
honours) plus one project layer. Project directory precedence at startup:

1. `--zowe-config-dir` / `ZOWE_MCP_ZOWE_CONFIG_DIR` (explicit).
2. `ZOWE_MCP_WORKSPACE_DIR` (the extension sets it to the first workspace
   folder; standalone users may set it).
3. The first `--local-files-root` / `ZOWE_MCP_LOCAL_FILES_ROOT` entry.
4. `process.cwd()`.

**Constraint**: MCP `roots/list` is only available after the client has
completed `initialize`, whereas fail-fast resolution happens before the
transport is connected. Roots therefore cannot drive startup resolution.
Position 2 covers the VS Code case (the workspace folder is passed in env), and
for standalone clients cwd is what the client launched the server with —
Claude Code and Cursor launch from the project directory. This deviates from
the literal "first MCP root" decision; see §8.

`*.user.json` layers are read as imperative reads them; nothing is written.
The `base` profile a profile inherits from follows imperative's layer rule
(§2): a global-layer profile uses the global `defaults.base`.

### 3.8 VS Code extension

- New setting `zoweMCP.zoweProfiles` (array of strings, window scope,
  default `[]`), with a description that names `zowe.config.json`, says only
  `ssh` profiles are supported for now, and says credentials are managed in
  Zowe Explorer or Zowe CLI.
- Spawn: each entry becomes `--zowe-profile <name>` next to the `--system`
  loop (`src/extension.ts:440-443`).
- Live update: extend `connections-update` to
  `{ connections: string[], zoweProfiles?: string[] }` (additive, old
  servers ignore the field). The server re-runs §3.3 on receipt.
- Errors: a new server → extension event `zowe-profile-error { profileName,
  code, message }` shown as `showErrorMessage` with a "Open Zowe Config" button
  when the config path is known. Documented in
  `docs/pipe-events-extension-server.md`.
- Status bar: the active connection label shows the profile name when the
  active system is profile-sourced.
- "Open in Zowe Explorer" (`zowe-profile.ts`): for profile-sourced systems use
  the profile name directly instead of host/user matching. Remove the
  `zowe config list --rfj` fallback in the same file (decision: dropped).
- "Clear Stored Password" and "Reset All Settings and State" are unaffected:
  profile credentials are never stored by the extension.
- Cursor / Kiro / Roo guidance: same flag in `mcp.json`.

### 3.9 Packaging: the keyring

- Add `@zowe/secrets-for-zowe-sdk` to `packages/zowe-mcp-server/package.json`
  `dependencies`. It is a napi-rs package with prebuilt binaries per platform.
- npm tarball: `scripts/bundle-for-pack.cjs` does an `npm install --omit=dev`
  of the real dependency list, so no externals change; verify that
  `pruneNapiRsCli` in `scripts/bundle-production-deps.cjs` does not strip the
  runtime `.node` binaries.
- VSIX: add `@zowe/secrets-for-zowe-sdk` to `SERVER_EXTERNAL`
  (`packages/zowe-mcp-vscode/scripts/esbuild.mjs:89-95`) so `bundle-server.js`
  installs it under `server/node_modules`.
- Because the server supplies `credMgrOverride` with its own `require`, the
  keyring does not depend on `require.main.filename` resolution.
- Runtime optional: load failure → `secure-store-unavailable`, only raised when
  a requested profile (or the `base` profile it inherits from) needs a secure
  value. Plain `user@host` systems never load it.
- Size: record the VSIX and tarball deltas in the PR. The extension VSIX is
  already 67 MB (`AGENTS.md`); this adds one native module set.
- Test: a packaged-layout smoke test that starts the bundled server with a
  profile whose password is in the secure store and asserts the keyring loaded.
  "It compiles" is not evidence here — the known failure mode is silent.

### 3.10 Out of scope

- `http` mode (flag rejected).
- A z/OSMF backend and API ML. `zosmf` and other profile types are recognised
  and rejected with `profile-type-unsupported`; the identity (§3.2) and flag
  (§3.1) are shaped so that backend can be added without renames.
- `base` profile tokens (`tokenType`, `tokenValue`): inherited values are read
  but ignored by the `ssh` mapping.
- The CLI bridge's own profile JSON (unchanged; a later step may let bridge
  profile types resolve from team config using the same reader).
- `AbstractConfigManager`, `ConfigFileUtils`, any team-config write-back,
  `~/.ssh/config` migration into team config.
- ssh-agent (`TODO.md`, separate item).
- Reading `handshakeTimeout` into the zowex client: recorded but not applied
  in the first iteration, because the SDK's `handshakeTimeout` client setting
  and Zowe MCP's `--zowex-response-timeout` measure different things.

## 4. Error catalogue

| Code | Detected | Message shape | Fix text |
| --- | --- | --- | --- |
| `imperative-unavailable` | startup | `Cannot read Zowe configuration: @zowe/imperative failed to load (<cause>).` | reinstall the server package |
| `no-zowe-config` | startup | `Zowe profile "<name>" requested but no zowe.config.json was found in <home> or <projectDir>.` | `zowe config init` or remove the profile from the list |
| `profile-not-found` | startup, pipe update | `Zowe profile "<name>" not found. Supported profiles available: a, b, c.` | fix the name; `zowe config list` |
| `profile-type-unsupported` | startup, pipe update | `Zowe profile "<name>" has type "<type>"; only "ssh" profiles are supported.` | select an `ssh` profile |
| `profile-incomplete` | startup, pipe update | `Zowe profile "<name>" has no "<field>" (not set in <name>, <parents>, or base profile "<base>").` | `zowe config set profiles.<name>.properties.<field> …` / Zowe Explorer |
| `profile-has-no-credentials` | startup, pipe update | `Zowe profile "<name>" has neither a password nor a privateKey (searched <name>, <parents>, base profile "<base>").` | set one with `--secure` / Zowe Explorer |
| `private-key-unreadable` | startup, pipe update | `Zowe profile "<name>": privateKey "<path>" (from "<source>") cannot be read.` | fix the path in the source profile |
| `passphrase-missing` | startup, pipe update | `Zowe profile "<name>": privateKey is encrypted and no keyPassphrase is set.` | `zowe config set profiles.<name>.properties.keyPassphrase --secure` |
| `secure-store-unavailable` | startup | `Zowe profile "<name>" needs the secure credential store, which could not be loaded (<cause>).` | platform-specific note; plain `user@host` still works |
| `duplicate-connection` | startup | `Zowe profiles "<name>" and "<other>" both resolve to <backend> user@host.` | remove one |
| `credentials-invalid` | first tool call | `Authentication failed for Zowe profile "<name>" (user@host) using <key \| password> from "<source>".` | `zowe config secure` / Zowe Explorer on `<source>`; restart or edit settings |
| `credentials-exhausted` | tool calls after failure | `Zowe profile "<name>": all credentials in the profile failed this session.` | same |

Every message names the profile, and where it matters the profile that
supplied the value; none echoes a secret or a key's contents.

## 5. Work breakdown

Ordered so each step is reviewable and testable on its own. Sizes are
S (< 1 day), M (1–2 days), L (> 2 days).

| # | Step | Files | Size |
| --- | --- | --- | --- |
| 1 | Keyring dependency and packaging: add `@zowe/secrets-for-zowe-sdk`, `SERVER_EXTERNAL`, prune check, packaged-layout load test | server `package.json`, `scripts/bundle-for-pack.cjs`, `scripts/bundle-production-deps.cjs`, vscode `scripts/esbuild.mjs`, airgap test | M |
| 2 | Connection identity: `ConnectionId` with `backend: 'ssh'`, `ssh:`-prefixed cache key, `backend` in `listSystems`/`getContext`; no behaviour change for `--system` | `connection-spec.ts`, `ssh-client-cache.ts`, `system.ts`, tests | S |
| 3 | Profile reader: `zowe-profiles.ts` + `zowe-ssh-profile.ts` with `ZoweProfileError`, type dispatch, `base`/parent merge with field whitelist and source tracking, `credMgrOverride`, project-dir selection, unit tests against fixture `zowe.config.json` files in a temp `ZOWE_CLI_HOME` (plain and secure, using an in-memory credential manager via `credMgrOverride`) | new modules + `__tests__/zowe-profiles.test.ts` | M |
| 4 | Startup wiring: `--zowe-profile`, env, `--config` key, `--http`/`--mock` conflicts, zero-systems check, fail-fast in standalone, merge into the systems list, duplicate handling | `src/index.ts`, `load-native.ts` | M |
| 5 | Credential provider: `profileCredentials` map, the §3.4 branch, `markKeyFailed`/`markInvalid` behaviour, no-substitution tests (assert env/Vault/elicitation are never consulted for a profile connection) | `native-credential-provider.ts`, tests | M |
| 6 | Initial active connection: `preferredDefaultSpec`, `session.ts` change, tests including `REQUIRE_EXPLICIT_SYSTEM` | `system.ts`, `session.ts`, tests | S |
| 7 | Runtime reporting: `source`/`profileName` in `listSystems`/`getContext`, deployment-mode fix hints, error text | `context-tools`, `mcp-deployment-mode.ts`, `docs/mcp-reference.md` regen | S |
| 8 | Mock-host integration test: temp team config pointing at `mock-zos` (`USER1` password via in-memory manager; a key-auth variant; a password inherited from `base`; an `EXPIRED` user to exercise `credentials-invalid`) | `__tests__/…integration.test.ts` using `helpers/spawn-mock-zos.ts` | M |
| 9 | VS Code extension: setting, spawn args, pipe field, error event + notification, status bar, `zowe-profile.ts` cleanup, extension tests | `package.json`, `extension.ts`, `pipe-server.ts`, `event-handler.ts`, `zowe-profile.ts`, tests | L |
| 10 | Docs: README "Native (SSH) backend", extension README, `copilot-setup-guide.md`, `roo-or-standalone-mcp.md`, `claude-code-mcp.md`, `pipe-events-extension-server.md`, `server.json` env declarations, `AGENTS.md` note, `configuration-and-deployment-model.md` §2/§5 | docs | S |

Steps 2–7 can land as one server PR; 1 must land first (or together) because
8 needs the keyring in CI only for the secure-store variant. 9 is a separate
extension PR.

## 6. Test plan

- **Unit, identity**: `ssh:` cache key; `user@host` ids and job-card lookup
  unchanged; duplicate check compares the full identity.
- **Unit, reader**: fixture configs for: plain properties; `secure` with an
  in-memory manager; nested profile inheriting `host` from a parent; project
  layer overriding global; default `ssh` profile present/absent; each §4 code.
  Type dispatch: a `zosmf` profile name → `profile-type-unsupported`; a name
  present in both layers with different types uses the merged type.
- **Unit, `base` inheritance**: password inherited from `base`; `user` from
  `base` with `privateKey` in the `ssh` profile; `ssh` profile value overrides
  `base`; global-layer profile resolves the global `defaults.base`; project
  `base` overriding global; `base` `tokenValue`/`rejectUnauthorized` ignored;
  error messages and `sources` name the supplying profile.
- **Unit, provider**: profile connection → key creds; key failed → password
  (including one inherited from `base`); both failed → `credentials-exhausted`;
  spies proving `resolveStandalonePassword`, the elicitation callback,
  `passwordStore`, and the `~/.ssh` resolver are not called for profile
  connections.
- **Unit, session**: default profile becomes the initial system; not when
  absent from the allowed list; `REQUIRE_EXPLICIT_SYSTEM` wins.
- **Startup**: `--zowe-profile` with `--http` exits 1; unknown profile
  exits 1 with the names list; `zosmf` profile exits 1 with the type message;
  profile-only start (no `--system`) succeeds.
- **Integration (mock-zos)**: end-to-end `listDatasets` through a profile and
  through a profile whose password comes from `base`; `EXPIRED` user produces
  `credentials-invalid` naming the supplying profile.
- **Packaged layout**: keyring loads from the npm tarball install and from the
  VSIX `server/` tree (the silent-failure guard).
- **Extension**: settings → args; pipe update re-resolves; error notification
  text; status bar label.
- **Evals**: no new questions in the first iteration; `getContext` output
  change is covered by the docs-drift gate.

## 7. Documentation to update when the code lands

`README.md` §"Native (SSH) backend" (new subsection "Using Zowe CLI ssh
profiles" placed before "Authentication (in order of preference)", covering
`base` inheritance); `packages/zowe-mcp-vscode/README.md`;
`docs/copilot-setup-guide.md`; `docs/roo-or-standalone-mcp.md`;
`docs/claude-code-mcp.md`; `docs/pipe-events-extension-server.md`;
`docs/mcp-reference.md` (generated); `packages/zowe-mcp-server/server.json`
(declare `ZOWE_MCP_ZOWE_PROFILE`); `AGENTS.md`;
`docs/configuration-and-deployment-model.md` §2.1, §2.2, §2.4, §2.7, §5, §7.2;
`docs/zowe-mcp-config-survey.md` §2, §4, §11.

## 8. Points to confirm before implementation

1. **VS Code partial start** (§3.3): a failing profile is dropped and reported
   while other connections start. Alternative: exit like standalone.
2. **Project directory without roots** (§3.7): startup uses
   `ZOWE_MCP_WORKSPACE_DIR` → local-files root → cwd, because `roots/list`
   is not available before `initialize`.
3. **Plural names for the list** (§3.1): resolved 2026-09-23 that the flag is
   type-neutral `--zowe-profile` beside `--system`. Still open: the array
   setting `zoweMCP.zoweProfiles` and `--config` key `zoweProfiles` are plural
   while the flag and env are singular. The derivation rule in
   `configuration-and-deployment-model.md` §2.7 does not yet say how
   repeatable flags map to array settings (`--system` ↔ `zowexConnections`
   already breaks it). Either accept plural array settings as part of the
   rule, or name the setting `zoweProfile`.
4. **`handshakeTimeout`** (§3.10): read and reported, not applied, in the first
   iteration.
