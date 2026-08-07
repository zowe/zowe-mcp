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

- **SSH key authentication** for the native (Zowe Remote SSH / zowex) backend, preferred
  over passwords and requiring no Zowe MCP configuration. Uses a `~/.ssh/config`
  `IdentityFile` or a default `~/.ssh/id_*` key; falls back to the existing password flow
  when no usable key is found or the key is rejected, so existing password users are
  unaffected. Resolution order: SSH key → password env → Vault KV → interactive prompt.
  New VS Code setting `zoweMCP.preferSshKey` (default on). See the README's
  "Authentication (in order of preference)" section for details.

### Changed

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
