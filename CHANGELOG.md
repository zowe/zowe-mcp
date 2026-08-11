<!-- markdownlint-disable MD024 -->

# Change Log

All notable, user-facing changes to Zowe MCP (the `@zowe/mcp-server` package and
the repository as a whole) are documented in this file. Per-component history
for the VS Code extension lives in
[`packages/zowe-mcp-vscode/CHANGELOG.md`](packages/zowe-mcp-vscode/CHANGELOG.md).

Add an entry under **Unreleased** in the same PR that makes the change. PRs that
don't warrant an entry (CI, chores, internal refactors, docs-only) can carry the
`no-changelog` label instead — see
[CONTRIBUTING.md](CONTRIBUTING.md#continuous-integration--branch-protection).

## [Unreleased]

### Added

- **Copilot Chat e2e: VS Code 1.132 compatibility.** The apparent 1.132
  "Agent Host breaks `code chat`" regression was root-caused to the fake
  model server advertising `context_length: 4096`, which the bundled Copilot
  Chat 0.60.0 turns into a zero prompt-token budget (input budget =
  `context_length − min(4096, context_length/2)`), silently killing every
  turn. The fake server now advertises 32768; e2e profiles additionally pin
  `chat.agentHost.enabled: false` (the classic-panel routing is
  experiment-controlled) and seed `chat.byokUtilityModelDefault: mainAgent`
  for 0.60.0's BYOK utility-model side-flows. S1–S3 pass unmodified on
  1.132.0 (and still on 1.126); the CI pin moves to 1.132.0. Full
  investigation notes (Agent Host routing internals, MCP-forwarding into
  agent sessions, and a working Playwright panel-typing fallback) in
  `docs/vscode-132-agent-host-investigation.md`.

- **End-to-end Copilot Chat testing** (`packages/zowe-mcp-e2e`): a scripted
  harness that drives a from-scratch, isolated VS Code instance with the built
  extension installed, a BYOK model configured with no GitHub sign-in (VS Code
  1.122+), and real Copilot agent-mode tool calls flowing through the MCP
  server into a mock z/OS backend — including the full native SSH path against
  the mock z/OS host. A deterministic fake LLM (Ollama/OpenAI-compatible)
  makes the suite hermetic for CI (`copilot-e2e` workflow); an env-gated
  variant runs against a real local Ollama model. Screenshots of the rendered
  chat response are preserved on every run.
- **Native-backend coverage against the mock z/OS host over MCP stdio**
  (`native-mock-zos-stdio.e2e.test.ts`): the production zowex/ssh2 path is now
  exercised in the default test run without requiring a real LPAR.
- **SSH key authentication** for the native (Zowe Remote SSH / zowex) backend, preferred
  over passwords and requiring no Zowe MCP configuration. Uses a `~/.ssh/config`
  `IdentityFile` or a default `~/.ssh/id_*` key; falls back to the existing password flow
  when no usable key is found or the key is rejected, so existing password users are
  unaffected. Resolution order: SSH key → password env → Vault KV → interactive prompt.
  New VS Code setting `zoweMCP.preferSshKey` (default on). See the README's
  "Authentication (in order of preference)" section for details.
- **Claude Code headless smoke suite** (`npm run smoke:claude-code`): an opt-in 13-case
  integration smoke that drives the real `claude` CLI (`claude -p --output-format
  stream-json`) against the MCP server with mock z/OS data — the real client, its real
  system prompt, and its real tool-orchestration loop. Reuses existing eval questions and
  assertions; intended for pre-release/nightly runs, not per-commit. See
  [`packages/zowe-mcp-evals/README.md`](packages/zowe-mcp-evals/README.md).

### Fixed

- **Mock z/OS host compatibility with zowex SDK 0.7.1**: the RPC ready payload
  now reports a server `version` (resolved dynamically from the installed SDK),
  the SFTP subsystem uses ssh2's dedicated `'sftp'` event (previously the
  `server.pax.Z` install/redeploy handshake hung forever), and the exec router
  recognizes `cd '<dir>' ; pax ...` command wrapping.

### Changed

- **Releases are now built and published by CI** via a reviewed release PR —
  see [docs/release-process.md](docs/release-process.md). The manual
  `release-vsix` script has been replaced by `ci:package-release`
  (build/package only; CI owns tagging and publishing).
- **Session default: first configured system instead of an error.** When a tool
  is called with no `system` parameter and no active system, the server now
  defaults to the first configured connection instead of erroring, so the first
  tool call "just works." The response context reports which system was used.
  Set `ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1` to restore the old behavior of
  requiring an explicit system — recommended for multi-environment deployments
  (e.g. dev vs prod) where silently defaulting could target the wrong system.
- **Data trust boundary directive added to server instructions by default.**
  Tool-result content — data set/USS contents, job output, search results, and
  console output — is now explicitly marked as untrusted data, as a
  defense-in-depth measure against prompt injection carried through mainframe
  content. Set `ZOWE_MCP_DATA_MARKING=0` to omit the directive (used for A/B
  evals of its effect on injection resistance).
- **Existing `zowex` on `$PATH` is now preferred over deploying a private copy.**
  When the native (Zowe Remote SSH) backend needs to install its server, it now
  checks the user's `$PATH` first (e.g. an admin-managed system-wide install)
  and uses that if it's executable, connecting to it directly instead of
  uploading a new copy. Falls back to the normal deploy if nothing usable is
  found on `$PATH` or connecting to it fails.

### Fixed

- **Zowe Remote SSH server deploy could silently corrupt when the deploy
  directory ran out of space**, producing a cryptic z/OS SE06 abend
  (`IEW4006I ... MODULE HAS BEEN TRUNCATED`) the next time zowex ran, instead
  of a clear error at deploy time. Deploy now probes for real, writable space
  before uploading — a `df` free-space check is not reliable on zFS, which can
  auto-grow — and smoke-tests the binary immediately after install. A detected
  truncation now triggers an automatic redeploy with an actionable message
  instead of an opaque abend.
