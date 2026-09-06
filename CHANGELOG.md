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

- Enabled the `runConsoleCommand` tool (z/OS operator console commands) at capability tier `full`. Requires zowex 0.9.0+ on the host and the separately installed APF-authorized `zoweax` binary; each command is authorized by the site ESM (OPERCMDS). Safe DISPLAY commands run directly, state-changing commands require user confirmation via elicitation, and system-stopping commands are blocked. Failures map to actionable guidance (server too old, zoweax missing, not authorized).
- Binary (base64, no-conversion) transfer on `readDataset`, `writeDataset`, `readUssFile`, and `writeUssFile` via a new optional `binary` input: reads return `data.contentBase64`, writes take `contentBase64` instead of `lines`. For non-text content (tersed files, load modules) that the UTF-8/EBCDIC text path would corrupt. Binary dataset writes require a preallocated target. Note that the z/OS server writes the byte stream as fixed-length records, NUL-pads the last record, and does not preserve the target's RECFM/LRECL (validated on a real z/OS: an FB/1024 sequential data set came back FB/80 after a binary write) — the bytes read back through `readDataset` are exact, but re-check the DCB attributes if another z/OS program consumes the data set. USS binary transfer is byte-exact with no such caveat.

### Changed

- Bundled zowex SDK pin moved to the 0.9.0 nightly (2026-08-25): brings the `consoleCommand` JSON-RPC support and the slimmed APF-authorized `zoweax` companion; hosts running older auto-deployed servers are redeployed on next connect. Also fixed the `sdk-switch.js nightly` resolver picking stale pre-rename artifacts (lexical sort) — it now filters to the current package name and sorts by datestamp.
- Bundled zowex SDK pin moved to the 0.9.0 nightly (2026-09-04). Also fixed `sdk-switch.js` recording the wrong version in `resources/zowex-pin.json`: it read the tarball's `package.json` with `tar --include=`, a bsdtar-only flag that GNU tar rejects outright, and the failure was swallowed so the function silently returned its fallback. Pins generated on CI therefore recorded `"version": "nightly"` and derived the doubled filename `zowe-zowex-for-zowe-sdk-nightly-nightly-<datestamp>.tgz`, while pins written on macOS were correct. It now extracts to stdout (`tar -xzOf`), which works on both, and warns instead of falling back silently. Also cleared the three CodeQL findings standing against `scripts/sdk-switch.js`: the tarball is read via `execFileSync` with an argument list so the path never reaches a shell, command-line arguments (version, PR number, branch name) are validated against an allow-list before being interpolated into any shell command, and `removeSdkIntegrityFromLockfile` no longer checks the lockfile's existence before reading it (a check-then-use file-system race) — it reads and treats `ENOENT` as "nothing to do".
- Console command elicitation (dormant tool) brought to parity with TSO: client-capability pre-check, form mode, and a required boolean confirmation.
- **The `@zowe/mcp-server` npm package is now bundled with esbuild.** Its production dependencies are compiled into `dist/` instead of being shipped as a full `node_modules` tree, so the published package drops from 26.6 MB to 8.2 MB packed (76.6 MB to 25.1 MB unpacked, 10,456 to 4,846 files). Installing offline takes 3.8 s instead of 13.5 s and the server reaches `tools/list` in ~210 ms instead of ~340 ms. `main`, `types`, and `bin` still point at `dist/index.js`, and the package remains self-contained for airgapped installs (`bundledDependencies`); only packages that cannot be bundled — `ssh2`, `hardstop-patterns`, `@zowe/zowex-for-zowe-sdk`, and the two packages zowex itself requires at runtime (`@zowe/imperative`, `@zowe/zos-uss-for-zowe-sdk`) — remain as real dependencies.
- Optional native dependencies are no longer shipped in the npm package (`npm install --omit=optional` at pack time). This drops `russh` (33 MB of prebuilt binaries for seven platforms, reachable only through zowex's `useNativeSsh` transport, which Zowe MCP never enables) and ssh2's optional `cpu-features`/`nan` accelerator. The default ssh2 transport is unaffected; enabling `useNativeSsh` in a future release would require restoring `russh`.
- Console authorization failures now distinguish the security-product cases instead of only matching "not authorized": an ESM profile denial (IEE345I `AUTHORITY INVALID, FAILED BY SECURITY PRODUCT`) asks for a permit on the matching `MVS.*` OPERCMDS profile, a no-profile-matched denial (`FAILED BY MVS`) asks for the profile to be defined, and a SAF console-activation denial (`service_rc 12`) points at `MVS.MCSOPER.<console-name>`. Each says not to retry until access is granted.
- Hardened the console command safety patterns (dormant tool): official abbreviations (`V`, `C`, `E`, `RO`, `K`, `T`, `M`, `U`, `G`, `I`), `DUMP`, `SLIP`, `CONFIG`/`CF`, dump/page management (`CHNGDUMP`/`CD`, `DUMPDS`/`DD`, `PAGEADD`/`PA`, `PAGEDEL`/`PD`, `IOACTION`/`IO`), and WTOR replies elicit confirmation; the SET pattern now also covers `SETPROG`/`SETXCF`/`SETSMF` and friends; system-stopping commands smuggled through `ROUTE` are blocked — including a routed `VARY XCF,...,OFFLINE` (sysplex partitioning) and the `RO T=nnn,...` and `RO (SYS1,SYS2),...` operand forms, which previously downgraded to a confirmation prompt.
- **Much faster installs: esbuild-bundled VSIX and slimmer npm tarball.** The
  VS Code extension no longer ships a full `npm install` of every production
  dependency (25,521 files, 172 MB unpacked): the extension host and the MCP
  server are now esbuild-bundled, with only native-binding packages (`ssh2`,
  `@zowe/zowex-for-zowe-sdk`) and `hardstop-patterns` kept as real
  `node_modules`, and files Node never loads at runtime (TypeScript sources,
  typings, sourcemaps, docs) pruned from what remains. The VSIX drops to
  7,575 files / 27 MB, which cuts install time substantially, especially on
  Windows. The `@zowe/mcp-server` release tarball gets the same pruning
  (minus `.mjs` files, which its unbundled ESM build still loads), shrinking
  it from ~19,000 to ~10,300 files. ([#54](https://github.com/zowe/zowe-mcp/issues/54))

### Fixed

- **Cleared three production dependency advisories** that had been failing the
  `audit` gate on `main` since 2026-09-02 and therefore blocking every PR:
  `fast-uri` 3.1.5 → 3.1.7 (high — host confusion and SSRF via IDN/IPv6/percent-decoding
  handling, reached through `ajv`), `sanitize-html` 2.17.6 → 2.17.7 (moderate — stored
  XSS via SVG SMIL URI-list scheme-policy bypass, reached through `@zowe/imperative`),
  and `qs` 6.15.2 → 6.16.0 (moderate — array-limit bypass and DoS via attacker-controlled
  `isBuffer`, reached through `express`). Transitive upgrades only; no direct dependency
  ranges changed.
- **`generate-docs` could crash outside the monorepo.** `markdown-table-prettify`
  was loaded through an undeclared (phantom) dependency that only resolved via
  monorepo hoisting; it is now a declared dependency and statically bundled, so
  the `generate-docs` subcommand works from the installed VSIX and tarball.

## [0.10.0] - 2026-08-13

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

### Fixed

- **`listMembers` did not return ISPF statistics**, so the AI would incorrectly report
  "no ISPF statistics recorded" for members that actually have them (e.g. asking who
  last updated a member). The native backend now requests attributes from the
  underlying `listDsMembers` RPC and returns them (`user`, `version`, `modLevel`,
  `createdDate`, `modifiedDate`, `modifiedTime`, `currentRecords`, `initialRecords`,
  `modifiedRecords`, `sclm`) alongside the member name; fields are omitted for members
  with no ISPF stats recorded. Fixes #69.

- **Claude Code headless smoke suite** (`npm run smoke:claude-code`): an opt-in 13-case
  integration smoke that drives the real `claude` CLI (`claude -p --output-format
  stream-json`) against the MCP server with mock z/OS data — the real client, its real
  system prompt, and its real tool-orchestration loop. Reuses existing eval questions and
  assertions; intended for pre-release/nightly runs, not per-commit. See
  [`packages/zowe-mcp-evals/README.md`](packages/zowe-mcp-evals/README.md).

### Fixed

- **Release pipeline hardening from the v0.10.0-rc.1 rehearsal** (findings in
  [#66](https://github.com/zowe/zowe-mcp/issues/66)): the version is passed to
  Octorelease explicitly instead of being inferred from `git describe` (which
  yielded `v0.0.0` — no release tag is an ancestor of `main`), the published
  release gets an explicit title, `set-version.js` now syncs
  `package-lock.json`, and release PRs validate the release-notes heading in CI
  instead of failing the publish after the merge.

- **Certificate tools reported empty SAF return codes.** zowex#1079 renamed the
  SDK's `SafReturns.racfReturnCode`/`racfReasonCode` to
  `esmReturnCode`/`esmReasonCode` (vendor-neutral, since the codes apply to ACF2
  and Top Secret too). The native backend still read the old names, so
  `safReturnCodes.productReturnCode` and `productReasonCode` came back
  `undefined` on every certificate action that carried SAF codes. The backend now
  sources these types from the SDK rather than mirroring them by hand, so a
  future upstream rename fails the build instead of silently emptying the field.

- **`exportCertificate` accepted `format: "p12"` without a passphrase**, which
  the z/OS side then rejected with an opaque error. The tool now validates it up
  front and says which parameter is missing.

- **Mock z/OS host compatibility with zowex SDK 0.7.1**: the RPC ready payload
  now reports a server `version` (resolved dynamically from the installed SDK),
  the SFTP subsystem uses ssh2's dedicated `'sftp'` event (previously the
  `server.pax.Z` install/redeploy handshake hung forever), and the exec router
  recognizes `cd '<dir>' ; pax ...` command wrapping.

### Changed

- **The zowex SDK tarball is no longer committed to the repository.**
  `resources/zowex-pin.json` records the exact build (URL, SHA-256, datestamp,
  upstream commit) and `scripts/sdk-switch.js pin` stages it on demand,
  verifying the checksum. Regular CI builds against that pin; the nightly
  workflow keeps floating on the newest upstream build and opens a pin-bump PR
  when it passes. Release artifacts now include the SDK tarball itself plus a
  `zowex-provenance.json`, so a published version stays reproducible after
  upstream prunes its nightly snapshots (~6 weeks). The `sdk-switch.js fallback`
  mode is gone — `pin` replaces it.

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
