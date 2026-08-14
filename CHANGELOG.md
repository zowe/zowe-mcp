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

### Fixed

- **`listMembers` did not return ISPF statistics**, so the AI would incorrectly report
  "no ISPF statistics recorded" for members that actually have them (e.g. asking who
  last updated a member). The native backend now requests attributes from the
  underlying `listDsMembers` RPC and returns them (`user`, `version`, `modLevel`,
  `createdDate`, `modifiedDate`, `modifiedTime`, `currentRecords`, `initialRecords`,
  `modifiedRecords`, `sclm`) alongside the member name; fields are omitted for members
  with no ISPF stats recorded. Fixes #69.
