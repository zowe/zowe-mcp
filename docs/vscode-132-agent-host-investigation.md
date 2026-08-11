# VS Code 1.132 / Copilot Chat 0.60.0 — e2e breakage investigation

Status: investigation complete (see Outcomes). Follow-up to PR #57's "Follow-up" section
("VS Code 1.132 rearchitected `code chat`"). Investigated 2026-08-08 against
VS Code **1.132.0** (df53daab, darwin-arm64) with the PR #57 harness from
`feature/copilot-byok-e2e`.

## TL;DR

The PR #57 diagnosis ("`code chat` now routes through the Agent Host, which
requires GitHub auth — migrate to Playwright-typed panel input") turned out to
be only partially right for the harness's actual code path. With `-r`
(reuse-window), the prompt still reaches the classic chat panel and the BYOK
model **is** selected. The turn then dies for a different, mundane reason:

> **Copilot Chat 0.60.0 computes the Ollama BYOK prompt budget as
> `context_length - min(4096, floor(context_length/2))`. Our fake model
> advertised `context_length: 4096`, so `maxInputTokens` came out as 0, the
> prompt renderer pruned every message to fit the zero budget, and every turn
> aborted instantly with "Invalid request: no messages." — silently (no
> errorDetails in the session, nothing at default log level).**

Fix: advertise a larger context (32768) from the fake server
(`src/ollama-api.ts`). One more new-in-0.60.0 gotcha found on the way: BYOK
main models now require a *utility model*; without a GitHub sign-in, seed
`"chat.byokUtilityModelDefault": "mainAgent"` (bare key — it is read via
`getNonExtensionConfig`, NOT `github.copilot.`-prefixed) to avoid
`No utility model is configured for 'copilot-utility-small'` errors in
side-flows (inline-chat progress, intent detection, tool-arg fetching).

## What actually changed in 1.132 (verified against the shipped bundle)

- **Copilot Chat 0.60.0 is now a built-in extension** (`extensions/copilot`,
  158 MB, publisher GitHub, still extension id `GitHub.copilot-chat`), bundling
  `@github/copilot` CLI 1.0.73 and a Claude Code-flavored CLI
  (`dist/cli.js` reads `.mcp.json` / `.claude/`). No marketplace install
  involved anymore.
- **The macOS app binary was renamed** `Contents/MacOS/Electron` →
  `Contents/MacOS/Code`. `activation.ts`'s `DEFAULT_MACOS_APP` and any
  `VSCODE_E2E_APP` docs need updating; the `pgrep -f "Code chat -m"` pattern in
  `chat-session.ts` still matches.
- **An Agent Host process exists** (`out/vs/platform/agentHost/`), registering
  agent providers `copilotcli` and `claude` on every launch (visible in
  `agenthost.log`). It hosts "agent sessions" (Agents window) powered by the
  Copilot SDK/CLI, which DO require GitHub auth (upstream #329667 tracks
  BYOK-without-sign-in; open). Settings: `chat.agentHost.enabled` (per-user
  opt-out), `chat.agentHost.byokModels.enabled` (default false; gates BYOK in
  agent sessions), `chat.agentHost.allowSignedOutWhenUsable` (experimental).
- **BYOK survives in the classic panel**: the bundled 0.60.0 still registers 9
  BYOK providers (ollama, anthropic, gemini, xai, openai, openrouter, azure,
  customoai, customendpoint) and still honors the
  `github.copilot.chat.byok.ollamaEndpoint` setting (default
  `http://localhost:11434`) — it is no longer *declared* in package.json but is
  still read. The "Manage Language Models" activation dance still works
  unchanged (verified: fake model fetched via /api/version, /api/tags,
  /api/show during activation, and `modelId: ollama/Ollama/<model>:latest`
  selected for the panel request).
- **`code chat -r` still lands in the panel** of the reused window as a
  `github.copilot.default` request (verified via session jsonl). The
  Agent-Host/copilotcli routing affects the `code chat` → *new/Agents window*
  paths (and shows up as the `agenthost.log` activity PR #57 observed).

## Failure chain observed on 1.132 (S1, unmodified harness)

1. Activation works; BYOK fake model registered and selected.
2. `code chat -m ask -r "<prompt>"` submits the prompt into the panel; session
   jsonl gets a request with `modelId: ollama/Ollama/fake-e2e-s1:latest`.
3. Turn produces only `{"kind":"mcpServersStarting","didStartServerIds":[]}`,
   `result.timings.totalElapsed` ≈ 127 ms, no errorDetails. Session never gets
   response text → harness times out (matches PR #57's observation).
4. At `--log trace`: exthost logs `Built prompt` → `Sending prompt to model` →
   nothing. Renderer logs two `[CHAT] extension request ERRORED in STREAM
   Invalid request: no messages.` (those two are the inline-chat progress
   fetches). The main turn throws the same "no messages" internally
   (`if (A.messages.length === 0) throw` immediately after the
   "Sending prompt to model" trace) and the turn ends silently.
5. Fake server request log proves `/api/chat` is never called.

Root cause of the empty prompt: 0.60.0's Ollama provider
(`_fetchOllamaModelInformation` consumer) computes

```js
a = model_info[`${arch}.context_length`] ?? 32768   // ours: 4096
s = a < 4096 ? floor(a/2) : 4096                    // ours: 4096
maxOutputTokens = s                                  // 4096
maxInputTokens  = a - s                              // 0  ← the bug trigger
```

## Experiment outcomes (all against 1.132.0)

| Experiment | Result |
|---|---|
| S1 unmodified harness (`code chat -m ask -r`) | FAIL — the PR #57 breakage, root-caused to the zero prompt budget |
| E0 `code chat` + context-length fix + `chat.byokUtilityModelDefault: mainAgent` | **PASS** (70 s) — `code chat` route works on 1.132 |
| E2 panel-typed ask prompt (Playwright keyboard, no `code chat`), context-length fix only | **PASS** — proves the panel route + BYOK works and the utility-model setting is NOT needed for the main turn |
| E3 panel-typed agent prompt + filesystem mock | **PASS** — `toolInvocationSerialized` for `listDatasets` with real mock data; extension-registered MCP fully functional on 1.132's classic panel |
| Full S1–S3 unmodified suite with only the fake-server fix | **PASS — 3/3 in 220 s** (S1 ask, S2 agent+fs-mock, S3 agent+mock-z/OS-SSH incl. `toolInvocationSerialized` assertions) |

## Harness changes (minimal fix set)

| Change | Status |
|---|---|
| Fake server: advertise `context_length: 32768` (+ `num_ctx 32768`) in `/api/show` (`src/ollama-api.ts`) | DONE — fixes the zero prompt budget; the only change strictly required |
| Seed `"chat.byokUtilityModelDefault": "mainAgent"` (bare key) in e2e profiles | RECOMMENDED — not required for the main turn (E2/E3 pass without it) but silences side-flow errors (inline-chat progress, intent detection) and keeps utility calls hermetic |
| `activation.ts`: try `Contents/MacOS/Code` in addition to `Contents/MacOS/Electron` for the default macOS app path | TODO (tiny) |
| Seed `"chat.agentHost.enabled": false` (or `"chat.defaultToCopilotHarness": false` + `"chat.editor.localAgent.enabled": true`) in e2e profiles | RECOMMENDED for determinism — the classic route is the default today only via experiment-controlled settings |
| Panel-typed prompt submission (Playwright) as `code chat` alternative | PROTOTYPED and passing (E2/E3 in `__tests__/e2e/vscode-132-experiments.e2e.test.ts`) — kept as a fallback, NOT needed for 1.132 |
| CI: unpin 1.126 → 1.132 | Possible once the fix lands; keep the pin policy (pin to a tested version, bump deliberately) |

### Panel-typing recipe (1.132), for the fallback path

- "Chat: Set Chat Mode" does not exist; use the mode-specific palette commands
  `Chat: Open Chat (Ask)` / `(Agent)` / `(Edit)` — one command opens the panel
  AND sets the mode.
- The chat input is a Monaco `native-edit-context` div whose default aria-label
  contains "not accessible" — the old `:not([aria-label*="not accessible"])`
  locator excludes the only real textbox on 1.132. Focus it via
  `el.focus()` in `page.evaluate` (a plain `.click()` can hang on a transient
  `ced-chat-session-detail-*` decoration intercepting pointer events).

## `code chat` routing on 1.132 (bundle-verified)

`code chat` is handled by `workbench.contrib.chatCommandLineHandler`, which
simply runs `workbench.action.chat.newChat` + `workbench.action.chat.open` —
the *session-type* decision then falls to the shared routing logic:

- Default routing returns **`local` (classic panel)** because
  `chat.editor.localAgent.enabled` defaults to `true` — this is why our `-r`
  runs still land in the panel.
- It routes to `agent-host-copilotcli` only if (a) the user previously picked
  an agent-host session type in the New Session UI (persisted in the
  **storage key** `chat.userSelectedSessionType`, checked *before* settings),
  or (b) `chat.defaultToCopilotHarness` / `chat.editor.preferCopilotHarness`
  are on — both default false but are **experiment-controlled**, as is
  `chat.agentHost.enabled` itself (`experiment:{mode:"startup"}`).
- Consequence for the harness: on a from-scratch profile the classic route is
  the default today, but an A/B experiment could flip it. For determinism,
  seed `"chat.agentHost.enabled": false` (also kills the ~2 agent-host
  processes per run) or at least `"chat.defaultToCopilotHarness": false` +
  `"chat.editor.localAgent.enabled": true`. Note `agentHostEnabled` is a
  one-way latch per session (false→true only; disabling requires restart).
- PR #57's "agenthost.log shows copilotcli being started" observation is
  explained: the Agent Host boots and registers providers on *every* launch
  regardless of routing; its presence in logs doesn't mean the prompt went
  there.

## Agent Host ↔ MCP (extension-registered servers) — bundle-verified

- **Extension-contributed MCP servers (`vscode.lm.registerMcpServerDefinitionProvider`)
  ARE forwarded to Agent Host sessions.** The workbench synthesizes a
  "VS Code Synced Data" plugin (scheme `vscode-synced-customization`)
  containing a generated `.mcp.json` built from VS Code's full MCP registry
  (`IMcpService.servers`), and the Agent Host feeds it into the Copilot SDK
  session config as `mcpServers` with `tools: ["*"]`.
- Caveats: only `stdio` (must have a static `command`) and `http` launches
  survive the conversion; the server must be enabled; and the forwarding does
  NOT activate extensions — on a truly first run, a not-yet-activated
  extension's servers are only visible if the workbench has cached its
  definitions from a prior run. Zowe's stdio launch qualifies once the
  extension has activated at least once in that profile.
- The Copilot CLI additionally discovers workspace `.mcp.json` /
  `.github/mcp.json` and its own `~/.copilot` config (`COPILOT_HOME`), plus a
  separate agent-host-only `mcpServers` block in
  `User/globalStorage/agent-host-config.json` (NOT settings.json).
- OAuth/auth-flow MCP servers are currently broken in Agent Host sessions
  (microsoft/vscode#326116, open; blocked on a Claude Agent SDK API).
- BYOK models in Agent Host sessions: gated behind
  `chat.agentHost.byokModels.enabled` (default false), Copilot-harness-only,
  and still force GitHub sign-in (microsoft/vscode#329667, open). Agent-host
  sessions also hard-require GitHub auth generally (Copilot provider degrades
  to zero models without a token). So agent-session e2e without sign-in is
  NOT currently possible; the classic panel remains the viable automation
  surface.

## Evidence

- Kept scratch profile of the S1 repro: `/tmp/zme2e-GabARN` (session jsonl,
  `agenthost.log`, `GitHub Copilot Chat.log` with the utility-model +
  GitHubLoginFailed lines).
- Trace-level repro: `/tmp/zme2e-PmS1Fd` (renderer.log lines 2639-2646:
  "Invalid request: no messages." stacks through
  `GG.validateRequest`/`_provideLanguageModelResponse`).
- Fake server request log: `/tmp/fake-model-e0.log` (activation-only traffic,
  no `/api/chat`).
