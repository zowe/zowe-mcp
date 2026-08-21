# zowe-mcp-e2e

Two things live in this package:

1. A deterministic **fake LLM server** (`src/fake-model-server.ts` and friends)
   used to test VS Code Copilot Chat bring-your-own-key (BYOK) integration
   end-to-end, without calling a real model provider.
2. A **Copilot Chat BYOK end-to-end harness** (`src/portable-profile.ts`,
   `src/activation.ts`, `src/chat-session.ts`, `src/mock-backends.ts`,
   `src/vscode-settings.ts`, and `__tests__/e2e/*.e2e.test.ts`) that drives a
   real, from-scratch, fully isolated VS Code install through: extension
   install → BYOK model activation → a chat prompt → an agent-mode MCP tool
   call against a mock z/OS backend → assertions on the persisted chat
   session. This is what the rest of this README documents.

## Why

VS Code (1.122+) lets users register BYOK chat model providers. Historically
via a `chatLanguageModels.json` file; empirically (verified on VS Code 1.126
and 1.132, this repo)
the reliable mechanism is the (formally "deprecated" but functionally load-
bearing) setting `github.copilot.chat.byok.ollamaEndpoint`, which the
extension auto-migrates into a real BYOK provider registration on
activation — see [`src/activation.ts`](./src/activation.ts) doc comments for
the full empirically-derived recipe. The fake model server speaks that same
Ollama-compatible protocol, so the exact same activation path exercises
both:

- **FAKE mode**: the "model" is scripted (see
  [`src/script-engine.ts`](./src/script-engine.ts)) — when Copilot agent mode
  sends a chat request with tool definitions, the server deterministically
  calls a Zowe MCP tool; once it gets the tool result back it produces a
  final answer containing a sentinel string (`E2E-SENTINEL-OK ...` /
  `E2E-SENTINEL-PONG`) that the test asserts on. Hermetic, deterministic,
  CI-friendly.
- **OLLAMA mode**: the same activation/settings path, pointed at a real
  local Ollama server instead, for realism against a real (small, local)
  LLM. Not CI-viable (needs Ollama + a model installed locally); gated
  behind `ZOWE_E2E_OLLAMA=1`.

## Architecture

```text
 __tests__/e2e/vscode-copilot.e2e.test.ts         (S1, S2, S3 — FAKE model)
 __tests__/e2e/vscode-copilot-ollama.e2e.test.ts  (S4 — real Ollama, env-gated)
        │
        ├── src/portable-profile.ts   100%-from-scratch VS Code portable profile:
        │                             scratch dir under os.tmpdir()/tmp, seeded
        │                             settings.json, `code --install-extension`,
        │                             pattern-scoped process cleanup.
        │
        ├── src/activation.ts         Playwright-Electron launch of VS Code,
        │                             one-time-per-profile Copilot Chat activation
        │                             dance (Command Palette keyboard flow),
        │                             optional model-picker pinning (OLLAMA mode),
        │                             optional password-prompt answering,
        │                             screenshots on every step + on failure.
        │
        ├── src/chat-session.ts       Headless `code chat -m <mode> -n "<prompt>"`
        │                             + polling/parsing of the persisted session
        │                             jsonl, + cleanup of VS Code's internally-
        │                             detached `code chat` worker processes.
        │
        ├── src/mock-backends.ts      Spawns the REAL zowe-mcp-server CLI's
        │                             `init-mock` (filesystem mock) and
        │                             `mock-zos start` (mock z/OS SSH host)
        │                             subcommands as child processes.
        │
        └── src/vscode-settings.ts    settings.json fragment builders
                                       (BYOK endpoint, zoweMCP.* backend config).
```

## Scenarios

| # | Model | Backend | What it proves |
|---|-------|---------|-----------------|
| S1 | FAKE | none (ask mode) | Fresh profile → extension install → BYOK activation → `code chat` round-trip works at all. |
| S2 | FAKE | filesystem mock | Agent-mode: model calls `listDatasets` (an MCP tool prefixed `mcp_zowe_listDatasets` by Copilot), gets back real mock data, includes it in its final reply. |
| S3 | FAKE | mock z/OS SSH host (`zowex`/native backend) | Same as S2 but over the **production RPC-over-SSH code path** (real `ssh2` + zowex-sdk) against the in-repo mock SSH daemon instead of a real LPAR. |
| S4 | real Ollama (`phi4-mini:latest` by default) | filesystem mock | Same flow as S2 against a real, non-scripted local LLM. Env-gated, not part of CI. |

## Running

Prerequisites: VS Code installed locally, the `sqlite3` CLI on `PATH`
(pre-installed on macOS; `apt-get install sqlite3` on Debian/Ubuntu CI
images), and Node/npm for this workspace.

```sh
# Build dependencies first (from the repo root):
npm run build -w @zowe/mcp-server
cd packages/zowe-mcp-vscode && npm run package && cd -   # produces the .vsix, if missing

cd packages/zowe-mcp-e2e
npm run build

# S1-S3 (FAKE model, hermetic):
npm run e2e

# S4 (real Ollama; requires a local Ollama server + a tools-capable model):
ZOWE_E2E_OLLAMA=1 npm run e2e:ollama
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `VSCODE_E2E_APP` | `/Applications/Visual Studio Code.app/Contents/MacOS/Electron` (macOS) | Path to the VS Code Electron binary Playwright launches. |
| `VSCODE_E2E_CLI` | `code` | The `code` CLI binary used for `--install-extension` and `code chat`. |
| `ZOWE_E2E_OLLAMA` | unset | Set to `1` to enable the S4 Ollama suite (otherwise it's skipped via `describe.skipIf`). |
| `ZOWE_E2E_OLLAMA_URL` | `http://localhost:11434` | Ollama server URL for S4. |
| `ZOWE_E2E_OLLAMA_MODEL` | `phi4-mini:latest` | Model to pin and test in S4. Must advertise Ollama `toolCalling` capability — models that don't (embedding/vision-only, e.g. `gemma3:*`, `bge-m3`, `all-minilm`) are silently dropped from VS Code's model picker and cannot be selected this way. **In practice, `phi4-mini:latest` (3.8B) is too small to reliably call the tool at all** in this scenario (36 tools on offer) — observed printing the tool name/args as plain chat text instead of a real function call, so the turn "succeeds" with no tool invocation and the test times out waiting for tool-derived content. `ZOWE_E2E_OLLAMA_MODEL=qwen3.6:35b-a3b-coding-mxfp8` (a MoE coding model, ~3B active params, fits in memory and runs fast despite the 35B label) was verified to reliably call `listDatasets` correctly and pass end-to-end; prefer it (or another mid/large tool-calling-capable model) over `phi4-mini` for this scenario specifically. The default is kept as `phi4-mini:latest` here only because that's what the original from-scratch-activation recipe this harness is based on verified for the *ask-mode, no-tools* PONG smoke path — it is not a recommendation for the tool-calling S4 scenario. |

## Isolation & safety

Every scratch directory is created under a recognized OS temp root
(`os.tmpdir()`, or the literal `/tmp`/`/private/tmp` on macOS — both are
accepted; see `assertUnderTmp` in `portable-profile.ts`) and every
destructive/process-killing operation asserts the path is under one of those
roots before proceeding. `VSCODE_PORTABLE` is always set for every `code`/
Electron invocation the harness makes; the real
`~/Library/Application Support/Code` and `~/.ssh` are never touched.

### Process cleanup — two mechanisms, both required

VS Code's `code` CLI wrapper double-forks internally: `spawn()`ing `code
chat ...` returns almost immediately (its handoff process exits with code
0), but the actual chat worker gets **reparented to PID 1** and keeps
running detached, continuously re-forking Chrome helper (network/gpu)
subprocesses. That worker's own argv is just `Code chat -m <mode> -n
<prompt>` — it does **not** include `VSCODE_PORTABLE`/`--user-data-dir`, so
it can't be found by profile-directory pattern matching.

- `killProfileProcesses`/`cleanupPortableProfile` (in `portable-profile.ts`)
  pattern-match `pkill -9 -f <profile-dir>` — this catches the Electron GUI
  process tree (its Helper/renderer/gpu subprocesses *do* carry
  `--user-data-dir=<profile-dir>` in argv).
- `killChatCliProcesses` (in `chat-session.ts`) kills the PIDs returned as
  `detachedPids` from `runChatPrompt` — found by diffing `pgrep -f "Code
  chat -m"` before/after each invocation (sequential test execution makes
  this diff race-free). **Both must be called** in test teardown, or the
  detached worker keeps respawning Chrome helpers indefinitely. See the
  `afterEach` blocks in the test files for the pattern.

## Known gotchas (found empirically, worth reading before debugging a failure)

- **VS Code 1.132's apparent "`code chat` breakage" was NOT the Agent Host —
  it was a zero prompt-token budget.** The bundled Copilot Chat 0.60.0
  computes the Ollama BYOK budget as
  `maxInputTokens = context_length - min(4096, context_length/2)`; a model
  advertising `context_length: 4096` (this fake server, originally) gets
  `maxInputTokens: 0`, the prompt renderer prunes *every* message to fit,
  and each turn dies in ~130 ms with only a `mcpServersStarting` response
  part and **no errorDetails** — the underlying
  `Invalid request: no messages.` throw is visible only at `--log trace`.
  Fixed by advertising `context_length: 32768` (`src/ollama-api.ts`); with
  that one change S1-S3 pass unmodified on 1.132.0. The Agent Host
  (`agenthost.log` showing `Registering agent provider: copilotcli` and the
  bundled `@github/copilot-*` CLI starting) boots on *every* 1.132 launch and
  is a red herring: `code chat` still routes to the classic panel because
  `chat.editor.localAgent.enabled` defaults to true. Since the deciding
  settings are experiment-controlled, `portable-profile.ts` seeds
  `"chat.agentHost.enabled": false` to pin the classic route.

- **Copilot Chat 0.60.0 (VS Code 1.132) side-flows need a "utility model"
  when the main model is BYOK.** Inline-chat progress messages, intent
  detection, and tool-arg fetching request a `copilot-utility-small`
  endpoint; with no GitHub sign-in that errors (`No utility model is
  configured for 'copilot-utility-small' while the selected main agent model
  is BYOK`). Not fatal to the main turn, but `portable-profile.ts` seeds the
  BARE key `"chat.byokUtilityModelDefault": "mainAgent"` (it is read via
  `getNonExtensionConfig`, not under the `github.copilot.` prefix) to route
  utility calls to the BYOK model.

- **1.132 renamed the macOS app binary** from `Contents/MacOS/Electron` to
  `Contents/MacOS/Code`; `activation.ts` probes both for the default
  `VSCODE_E2E_APP`.

- **Fake server's `/api/version` must report a version VS Code accepts.**
  The Ollama BYOK provider rejects any server reporting below `0.6.4`
  ("Ollama server version ... is not supported"). A suffixed version string
  like `0.4.0-fake-e2e` gets parsed as older than `0.6.4` regardless of the
  numeric part and is rejected — report a plain `X.Y.Z` at or above that
  floor (`buildOllamaVersionResponse` in `src/ollama-api.ts`).

- **Agent-mode "tool grouping" silently requires a GitHub Copilot sign-in
  once the tool count is high enough — and the threshold is NOT
  configurable.** VS Code Copilot Chat has an internal "virtual tools" /
  "tool grouping" feature (progress message "Optimizing tool selection")
  that, once the number of tools offered to the model exceeds a **hardcoded
  constant (64, reverse-engineered from the minified bundle as
  `UXr = Vw/2` where `Vw` is the literal `128` — not read from the
  `github.copilot.chat.virtualTools.threshold` setting despite the
  misleadingly similar name/scale), unconditionally** calls
  `_generateEmbeddingBasedGroups` → a fixed GitHub-hosted CAPI utility model
  (`gpt-4o-mini`) to generate group descriptions. That call always fails in
  a profile with no GitHub sign-in ("Unable to resolve chat model with CAPI
  family selection: gpt-4o-mini" — visible in `GitHub Copilot Chat.log`,
  with a stack trace through `oz.addGroups` / `_processToolset` /
  `_generateBulkGroupDescriptions`), aborting the entire agent turn
  *before* your tool is ever called. Below that 64-tool floor there's a
  second, lower (20-tool) floor gated by an A/B experiment
  (`defaultToolsGrouped`) that can default to "on"; `portable-profile.ts`'s
  `DEFAULT_SETTINGS` forces that flag off (under both its public
  `github.copilot.*`-prefixed id and its bare internal one — pairing
  discovered empirically, not documented) as defense for tool counts in the
  20-63 range. **The 64-tool floor itself cannot be raised via settings —
  it's a literal, not sourced from configuration.** The Zowe MCP server
  registers 75 tools at `capabilityTier: "full"` (measured against the mock
  backend: `read-strict`/`read` → 36, `update` → 61, `delete` → 68, `full` →
  75), so the *actual* fix used here is `vscode-settings.ts` defaulting
  these e2e scenarios' `zoweMCP.capabilityTier` to `"read"` (36 tools,
  comfortable margin — these scenarios only ever call the read-only
  `listDatasets`). **If you see "Unable to resolve chat model with CAPI
  family selection" in `GitHub Copilot Chat.log`, count the tools your
  scenario's MCP server(s) register and get the total under 64** (lower a
  capability tier, disable unneeded CLI bridge plugins, etc.) — there is no
  settings-based escape hatch.

- **`chat.tools.global.autoApprove: true` in settings.json is not, by
  itself, enough to avoid a blocking confirmation dialog.** Copilot Chat's
  `checkGlobalAutoApprove()` also requires a one-time, storage-persisted
  "I understand the risk" acknowledgement
  (`chat.tools.global.autoApprove.optIn`) written to
  `User/globalStorage/state.vscdb` (a plain sqlite db, table
  `ItemTable(key, value)`) — normally set by clicking through a modal
  warning dialog the first time a tool actually needs auto-approval. In a
  headless `code chat` invocation there's no UI to click, so this shows up
  as an indefinite hang *after* the model's `tool_calls` turn — the MCP
  server log shows the server starting and tools being discovered, the fake
  model server's request log shows the tool-call decision, but the tool
  itself is never invoked and no further log lines ever appear. Fixed by
  `portable-profile.ts`'s `seedGlobalStorage`, which pre-creates
  `state.vscdb` with that row set before the very first launch (VS Code
  creates this db with the same schema on first run if it doesn't exist,
  so pre-seeding it is safe) — requires the `sqlite3` CLI on `PATH`
  (override the binary via `VSCODE_E2E_SQLITE3`).

- **Native (zowex/SSH) backend scenarios need SSH key auth, not a password
  env var — VS-Code-launched MCP servers never read `ZOWE_MCP_PASSWORD_*`.**
  `zowe-mcp-server`'s `NativeCredentialProvider` only reads
  `ZOWE_MCP_PASSWORD_<USER>_<HOST>` in **standalone** mode (`useEnvForPassword:
  true`, used by the CLI); in **VS Code mode** it's `false` by design —
  passwords are meant to come from an interactive SecretStorage-backed
  input box the extension shows, which nothing can answer in a headless
  `code chat` run (Playwright isn't attached at that point). SSH key
  resolution, however, reads `ZOWE_MCP_PRIVATE_KEY_<USER>_<HOST>` directly
  from `process.env` in **both** modes, so it's the only viable
  no-UI-required path. `mock-backends.ts`'s `startMockZosDaemon({
  sshKeyForUser: 'USER1' })` generates a throwaway ed25519 keypair (via the
  system `ssh-keygen`, into the mock's scratch dir — never `~/.ssh`) and
  authorizes it in the mock host's `users.json` before the daemon starts;
  the caller then sets `vscode-settings.ts`'s `privateKeyEnvVarName('USER1',
  mockZos.host)` to the private key path as `extraEnv` on
  `createPortableProfile`. See S3 in `vscode-copilot.e2e.test.ts` for the
  full wiring. (Password-prompt automation via Playwright, per the
  mission's fallback option, was not needed once this was found and wasn't
  implemented.)

- **The default scratch directory must stay short, or VS Code fails to
  launch at all — with a misleading Playwright error.** VS Code creates a
  Unix domain socket for its main IPC hook directly under the portable
  profile's `user-data` dir (`<userDataDir>/<version>-main.sock`);
  `sockaddr_un`'s `sun_path` is capped at 104 bytes on macOS/BSD. `os.tmpdir()`
  on macOS resolves to a long per-process path
  (`/var/folders/xx/<hash>/T`), and a naive `<tmpdir>/zowe-mcp-e2e/<uuid>`
  scratch root pushes the socket path over that limit — VS Code's Electron
  process then exits within a few seconds of launch, and Playwright reports
  it as `electronApplication.firstWindow: Target page, context or browser
  has been closed`, which looks like a generic launch failure with no hint
  about path length. Reproduced empirically (fails via `vitest` with the
  default scratch root, passes with an explicit short `/tmp/...` root, and
  passes again via `vitest` once the default was shortened). Fixed by
  `portable-profile.ts`'s `shortestTmpRoot()` (prefers the literal `/tmp`
  over `os.tmpdir()`) plus using an 8-character id instead of a full UUID
  for the default scratch directory name. If you see this Playwright error,
  check the total length of `profile.dir` first before assuming it's an
  activation/settings problem.

- **The one-time Copilot Chat activation dance is required per fresh
  profile.** `GitHub.copilot-chat` does not reliably activate on
  `onStartupFinished` in a cold profile; running "Chat: Manage Language
  Models" via the Command Palette fires the implicit
  `onLanguageModelChatProvider:copilot` activation event instead. See
  `triggerCopilotChatActivation` in `src/activation.ts`.

- **`code chat -n` opens a genuinely new empty window each call**, so the
  Zowe extension (registered via `vscode.lm.registerMcpServerDefinitionProvider`
  on normal `onStartupFinished`) re-activates and re-registers the MCP
  server fresh each time — no special handling needed, but it does mean
  each `code chat` call has real extension-host cold-start latency
  (~60-90s observed end-to-end for FAKE-mode scenarios on this machine).

- **Session jsonl format** (reverse-engineered, not documented by VS Code):
  each `.jsonl` line is `{kind: 0, v: <fullSnapshot>}` (exactly one, first
  line) followed by zero or more `{kind: 1, k: <path>, v: <value>}`
  incremental patches (`k` is a key-path into the snapshot object, applied
  with `chat-session.ts`'s `applyPatch`). `requests[].response[]` entries
  are typed by a `kind` field for structured events or carry a plain
  markdown `value` string for the actual reply text — see `parseSessionFile`
  and its `toolInvocationParts` (response parts whose `kind` mentions
  "tool"). Structured `kind`s observed: `mcpServersStarting`
  (`{didStartServerIds: []}`), `progressTaskSerialized` (transient progress
  messages like "Optimizing tool selection"), and — the interesting one —
  **`toolInvocationSerialized`** for an actual MCP tool call, e.g. (from a
  real S2 run, `mcp_zowe-mcp-serv_listDatasets`):

  ```jsonc
  {
    "kind": "toolInvocationSerialized",
    "invocationMessage": { "value": "Running `listDatasets`", ... },
    "pastTenseMessage": "List data sets matching USER.** – 8 data sets",
    "originMessage": "Zowe (MCP Server)",
    "isConfirmed": { "type": 1 },
    "isComplete": true,
    "source": {
      "type": "mcp",
      "serverLabel": "zowe-mcp-server",
      "label": "Zowe",
      "collectionId": "zowe.zowe-mcp-vscode/zowe",
      "definitionId": "zowe.zowe-mcp-vscode/Zowe",
      "instructions": "..." // the MCP server's full instructions text
    },
    "resultDetails": {
      "input": "{\n  \"dsnPattern\": \"USER.**\"\n}",
      "output": [{ "type": "embed", "isText": true, "value": "{...tool JSON result...}" }]
    }
  }
  ```

  `resultDetails.input`/`.output` is the ground truth for what the model
  actually sent the tool and what came back — more reliable to assert on
  than trying to parse the model's prose reply, if a scenario needs to
  check the exact tool call arguments.

## CI (Linux)

Not yet wired into a CI workflow in this repo, but the harness is written
to be Linux-portable:

- Launch VS Code under `xvfb-run` (Playwright's Electron launch needs a
  display) — e.g. `xvfb-run -a npm run e2e`.
- Obtain a VS Code build via `@vscode/test-electron`'s
  `downloadAndUnzipVSCode()`, or a `.tar.gz` from
  `https://code.visualstudio.com/Download#` (`linux-x64`); point
  `VSCODE_E2E_APP` at the extracted `code` binary (or set `VSCODE_E2E_CLI`
  separately if the CLI entrypoint differs from the GUI binary's location —
  on Linux they're usually the same `code` script).
- `VSCODE_PORTABLE` works identically on Linux.
- Pass `--password-store=basic` as an extra Electron launch arg (via
  `launchVsCode`'s `extraArgs`) if S3's password-prompt fallback path is
  exercised in CI — GNOME Keyring/libsecret usually isn't available in a
  minimal container.
- The `killChatCliProcesses`/`pgrep -f "Code chat -m"` matching pattern
  assumes the Electron binary's process name is `Code` (capital C, as
  shipped by Microsoft's official builds) — verify this against whichever
  build/OSS variant CI uses and adjust the pattern in `chat-session.ts` if
  needed (e.g. OSS builds report `code-oss`/`Code - OSS`).
- Only one VS Code instance is driven at a time by design (no
  `describe.concurrent`); CI should not parallelize these test files
  against each other.

## Testing (the fake model server unit tests)

```sh
npm run build
npx vitest run __tests__/fake-model-server.test.ts
```

See [`src/script-engine.ts`](./src/script-engine.ts) doc comments for the
scripted decision logic (no tools → PONG; tools + no result yet → call the
matching tool; tools + result present → `E2E-SENTINEL-OK <digest>`), and
the wire-protocol details below.

### Fake server protocol details

One HTTP server exposes **both** API surfaces on a single port:

- **OpenAI-compatible**: `GET /v1/models`, `POST /v1/chat/completions`
  (both `stream: false` and `stream: true` — SSE with `data: {...}\n\n`
  chunks and a final `data: [DONE]`). Tool calls use the OpenAI
  `tool_calls` format; in streaming mode the first chunk carries the tool
  call's `id`/`type`/`function.name`, later chunks carry `function.arguments`
  fragments (index-addressed), and the terminal chunk sets
  `finish_reason: "tool_calls"`.
- **Ollama-compatible**: `GET /api/tags`, `GET /api/version`,
  `POST /api/show` (includes `capabilities: ["completion","tools"]` plus a
  `details`/`model_info` superset for VS Code's Ollama BYOK provider), and
  `POST /api/chat` (streaming NDJSON — one JSON object per line — and
  non-streaming). Ollama tool calls use `message.tool_calls[].function`
  with **object-typed** `arguments` (not a JSON string, unlike OpenAI).

### Fake server CLI

```sh
npm run build
node dist/cli.js --port 0 --log-file ./fake-model-server.log
```

On startup the CLI prints a single JSON line to stdout —
`{"port":..., "url":"..."}` — so a shell harness can pick up the assigned
port even when `--port` is omitted (random ephemeral port). Shuts down
cleanly on `SIGINT`/`SIGTERM`. Flags: `--port`, `--host`, `--model-id`,
`--log-file`, `--tool-pattern` (a case-insensitive literal substring match),
`--dataset-pattern`.
