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

- **MCP server card** (SEP-2127 draft — experimental, shape may change until the SEP
  is accepted): the HTTP transport now serves an identity-and-transport-only server
  card at `GET /mcp/server-card` (`application/mcp-server-card+json`, with the CORS
  and ETag/`If-None-Match` support the draft spec requires) so clients can discover
  connection details without opening an MCP session. Tool/prompt/resource-template
  listings are exported separately, under the `io.zowe/mcp-server` `_meta` namespace
  of `docs/mcp-server-card.json`, via the `server-card` CLI command
  (`npm run server-card`) — SEP-2127 deliberately excludes primitives from the card
  itself, since they remain subject to runtime listing.
- **SSH key authentication** for the native (Zowe Remote SSH / zowex) backend, preferred
  over passwords and requiring no Zowe MCP configuration. Uses a `~/.ssh/config`
  `IdentityFile` or a default `~/.ssh/id_*` key; falls back to the existing password flow
  when no usable key is found or the key is rejected, so existing password users are
  unaffected. Resolution order: SSH key → password env → Vault KV → interactive prompt.
  New VS Code setting `zoweMCP.preferSshKey` (default on). See the README's
  "Authentication (in order of preference)" section for details.
