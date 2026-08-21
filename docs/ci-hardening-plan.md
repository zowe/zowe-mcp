<!-- markdownlint-disable MD013 -->

# CI Hardening Plan

Status: **proposed** · Target branch: `develop` (all work lands here as small PRs) ·
Last updated: 2026-06-06

This document is the reference backlog for hardening Continuous Integration in
this repository. It is delivered as a series of **small, independently
reviewable PRs against `develop`**. Each PR should link back to the relevant
section(s) here.

## Goals

- Enforce the quality gates we already own but do **not** currently run in CI
  (formatting, markdown lint, duplication, type-checking, extension/e2e tests).
- Add the security and supply-chain checks the [`zowe/zowex`][zowex] pipeline
  has and we lack (dependency audit, CodeQL, Dependabot).
- Test on the platforms our users actually run (Windows/macOS, not just Linux).
- Keep the pipeline fast, legible, and gateable behind branch protection.

We follow the `zowex` model where it makes sense and improve on it where this
project's shape (a Node/TypeScript MCP server + VS Code extension) differs.

## Decisions (settled)

These were agreed before authoring and govern the snippets below.

1. **Triggers**: every workflow runs on **both `main` and `develop`**, and on
   pull requests targeting either. (zowex is `main`-only; we keep both because
   we use `develop` as the integration branch.)
2. **`npm audit` strictness**: **follow zowex exactly** —
   `npm audit --production --audit-level=moderate`, on `pull_request` plus a
   daily `schedule` cron.
3. **e2e infrastructure (Keycloak / Docker)**: **undecided.** Until resolved,
   `test:keycloak-jwt-e2e` (and any other service-dependent e2e) is **kept out
   of the required PR path** and runs nightly-only or behind a manual dispatch.
   See [Open Decisions](#open-decisions).
4. **Coverage**: **report-only.** Collect and surface coverage; do **not** fail
   the build on a threshold (we may ratchet later).

## Current state (baseline)

`/.github/workflows/ci.yml` is a **single ubuntu job** that:

- checks out, sets up Node from `.nvmrc` (Node 24), downloads the zowex SDK via
  `scripts/sdk-switch.js` (which runs `npm install --ignore-scripts`),
- builds `zowe-mcp-common` + `@zowe/mcp-server`,
- runs `npm run lint` and `npm run test` (**server package only**),
- packs the npm tarball, generates docs, builds the VSIX, uploads artifacts, and
  posts a sticky PR comment.

**What is NOT enforced today** (scripts exist in `package.json` but CI never runs
them): `check-format` (Prettier + shfmt), `markdownlint`, `duplication` (jscpd),
`test:vscode`, the mock/integration suites, the e2e suites
(`test:native-stdio-e2e`, `test:keycloak-jwt-e2e`), `test:airgap`, and any
type-check independent of build. There is **no** `npm audit`, **no** CodeQL,
**no** Dependabot, **no** OS matrix, **no** job timeout/concurrency.

### Ground-truth notes that shape the work

- **shfmt** is the WASM build (`@wasm-fmt/shfmt`) — no external binary needed in
  CI. `check-format` already supports `--check` (non-mutating). ✅ CI-safe.
- **jscpd** is configured by `.jscpd.json` (threshold **5%**, reporters
  `console` + `json`). `npm run duplication` exits non-zero past threshold. The
  JSON report (`report/jscpd-report.json`) is currently **committed** — to be
  cleaned up (Phase 0).
- **markdownlint** script is `markdownlint-cli2 --fix` — it **mutates** files and
  cannot be used as a gate as-is. A check-only variant is needed (Phase 0).
- **VS Code tests** use `@vscode/test-cli` (`vscode-test`) → download VS Code and
  need a display on Linux → must run under `xvfb-run` (Phase 3).
- **Dependencies** come from `sdk-switch.js`'s `npm install --ignore-scripts`,
  not `npm ci` → installs are not lockfile-reproducible and postinstall hooks
  (the vscode `download-api`) are skipped. Revisit in Phase 0.
- **SDK `fallback` mode** uses a committed tarball (`resources/zowex-sdk-*.tgz`),
  so CI needs no network for the SDK. Keep using `fallback`.

## Conventions for all new workflows

- Trigger block (per Decision 1):

  ```yaml
  on:
    push:
      branches: [main, develop]
    pull_request:
      branches: [main, develop]
  ```

- Top-level least-privilege `permissions: { contents: read }`; widen per-job
  only where needed (e.g. `pull-requests: write` for sticky comments,
  `security-events: write` for CodeQL/SARIF).
- `concurrency` to cancel superseded runs; `timeout-minutes` on every job.
- `actions/setup-node@v4` with `node-version-file: .nvmrc` and `cache: npm`.
- Pin third-party actions (Dependabot `github-actions` ecosystem keeps them
  current — Phase 4).

---

## Phase 0 — Make scripts CI-safe (prerequisite)

Small `package.json` / config changes plus the `npm ci` switch. Verify each runs
locally before Phase 1+ consumes them.

**Done in PR-1:**

- [x] **Add a typecheck script.** Per-package `"typecheck": "tsc -p … --noEmit"`
  (each package's dev `tsconfig.json`, so tests/scripts are checked too) plus a
  root aggregator `"typecheck": "npm run build -w …common && npm run build -w
  @zowe/mcp-server && npm run typecheck --workspaces --if-present"`. The root
  script builds the two library packages first because cross-package types
  resolve via built `dist` (no tsconfig path mappings).
- [x] **Clean up jscpd output.** `.jscpd.json` reporters set to `["console"]`
  only (still fails past the 5% threshold); `report/jscpd-report.json`
  untracked via `git rm --cached` (it was tracked despite already being in
  `.gitignore`).
- [x] **Switch CI to `npm ci`.** Default path (push / PR / `fallback` dispatch)
  now runs `npm ci --ignore-scripts` for lockfile-reproducible installs — the
  committed lockfile already pins the fallback `zowex-sdk`, so `sdk-switch` is
  no longer run on the normal path (and no longer mutates the lockfile in CI).
  `sdk-switch` still runs for manual dispatch with a non-fallback SDK mode.
  `--ignore-scripts` is kept (the prebuilt `zowex-sdk` tarball has no build
  step); the VS Code API types are still fetched by the explicit `download-api`
  step.

**Done in PR-1b (markdownlint cleanup):**

- [x] **Markdown lint (`lint:md`).** The old `markdownlint` script
  (`markdownlint-cli2 --fix` with **no globs**) was a silent **no-op** (linted
  0 files), so markdown was never gated. Fixed `.markdownlint-cli2.jsonc` (added
  `globs`, `gitignore: true`, ignored `themes/**` / `vendor/**` / `.claude/**`),
  which dropped the backlog from ~681 to ~206. Disabled cosmetic/noisy rules
  (`MD060` table pipe spacing — not auto-fixable; `MD036` intentional bold
  labels) and set `MD024` to `siblings_only`. Scoped `MD041` off for
  `.github/**` templates via a nested `.github/.markdownlint.jsonc`. Auto-fixed
  the rest and manually fixed the residue: escaped literal `|` inside table
  cells (`MD056`) and added languages to 14 code fences (`MD040`). Added the
  check-only `lint:md` script and renamed the mutating one to `markdownlint:fix`.
  Result: **0 errors across 61 files.** Since the tree is clean, `lint:md` is
  also **enforced in CI** in this PR (a step in the `build` job, before build so
  it fails fast) — covered by the existing required `build` check.

## Phase 1 — Harden the existing job

No new tools; make `ci.yml` robust.

- [x] `concurrency` (cancel-in-progress) keyed on workflow + ref.
- [x] `timeout-minutes` on the job (30).
- [x] Least-privilege `permissions` (`contents: read` + `pull-requests: write`).
- [x] npm caching via `setup-node` (`cache: npm`).
- [x] **Action pinning — decided: tag-pinning, not SHAs.** Actions stay pinned to
  major tags (checkout v6, setup-node v6, upload-artifact v7, sticky-comment v3,
  codeql-action v3) and the Dependabot `github-actions` ecosystem (Phase 4) keeps
  them current. Full-SHA pinning was considered and **not adopted** — the marginal
  supply-chain hardening isn't worth the readability/maintenance cost here, and
  Dependabot would rewrite the SHAs anyway. Revisit only if we adopt OpenSSF
  Scorecard, which scores SHA-pinning.

## Phase 2 — Enforce existing quality scripts

Each as its own job/step so failures are legible.

- [x] **Format**: `npm run check-format` (Prettier + shfmt `--check`) — enforced
  in the `build` job. Required fixing a pre-existing `src/index.ts` Prettier
  violation first (carry-overs PR).
- [x] **Markdown**: `npm run lint:md` — enforced in the `build` job (PR-1b).
- [x] **Duplication**: `npm run duplication` (jscpd, 5% threshold) — enforced in
  the `build` job. Currently 14 clones, well under threshold.
- [x] **Typecheck**: `npm run typecheck --workspaces` — enforced in the `build`
  job. Type-checks `src/**` + `__tests__/**` per package (dev `tsconfig.json`,
  `--noEmit`). Required clearing a 59-error test type backlog in
  `@zowe/mcp-server` first (stale duplicate types, partial mocks, missing
  narrowing); the shared `__tests__/helpers/stub-backend.ts` keeps backend
  doubles complete going forward.
- [x] **Lint**: `npm run lint` (`--max-warnings 0`) — already a `build`-job step
  (predates this plan). ESLint SARIF → code-scanning is a future nice-to-have.
- [x] **Docs drift** — enforced in the `build` job (PR #14). Required making
  `generate-docs` deterministic first: the header no longer embeds the git
  commit hash, and the mock TSO clock is pinned via `ZOWE_MCP_MOCK_CLOCK_ISO`
  (UTC-formatted when set), so regenerating on a clean tree is byte-identical
  and `git diff --exit-code` gates both reference docs.
- [x] **Plugin schema validation**: a vitest test
  (`__tests__/plugin-schema.test.ts`) validates every CLI-bridge plugin
  `*-tools.yaml` against `schemas/plugin-tools.schema.json` with `ajv` (added as
  a server devDep). Runs in the normal test job on every OS — no separate CI
  step. Catches schema drift (the schema is `additionalProperties: false`
  throughout), wrong types, and missing required fields.

## Phase 3 — Expand test execution

Today only `test:server` runs. Add the rest, tiered by infra needs.

- [x] **Server tests**: coverage (report-only, Decision 4) via `--coverage` on
  the CI test step (`@vitest/coverage-v8`, scoped to `src/**` excluding
  `src/scripts/**`). ~45% statements at time of enablement; no threshold gate.
  Surfaced three ways: a text summary in the step log, a Markdown table on the
  **run Summary page** (from the `json-summary` reporter via
  `GITHUB_STEP_SUMMARY`), and a browsable HTML report uploaded as the
  `coverage-report` artifact and linked from the sticky PR comment.
- [x] **VS Code extension**: `xvfb-run -a npm run test:vscode` in the `build`
  job, with the `.vscode-test/` VS Code download cached.
- [x] **Mock/integration suites**: verified the in-process `spawn-mock-zos.ts`
  suites already run in plain `npm test` (no include/exclude in vitest config);
  e2e suites self-skip via env gates, so the default run is CI-safe.
- [x] **JUnit reporting**: vitest `junit` reporter writes
  `test-results.junit.xml` (gitignored); `dorny/test-reporter@v2` renders it on
  the **run Summary page** (its v2 default `use-actions-summary: true` — no
  separate check run) with failure annotations on PR files (needs
  `checks: write`; skipped for fork PRs whose token is read-only).
- [x] **Airgap**: `npm run test:airgap` runs after the `npm pack` step and
  installs the freshly packed tarball with an empty cache, invalid registry,
  and 5 ms network timeout — proves the tarball is self-contained.
- [ ] **Service-dependent e2e** (`test:keycloak-jwt-e2e`,
  `test:native-stdio-e2e`): **kept off the required PR path** per Decision 3 —
  nightly-only / manual dispatch until the Open Decision is resolved.
- [x] **Nightly SDK-mode run**: new `nightly.yml` (daily cron + dispatch) runs
  `sdk-switch nightly` → build → typecheck → test against the latest upstream
  zowex SDK, catching upstream drift without touching the PR path.
  **Caveat:** GitHub fires `schedule`/`workflow_dispatch` only from the default
  branch, so the cron activates once this lands on `main` (the next
  develop → main promotion).

## Phase 4 — Security & supply-chain

- [x] **`audit.yml`** (Decision 2 — mirror zowex) — `npm audit --omit=dev
  --audit-level=moderate` on push/PR (both branches) + a daily cron. To ship it
  green, first cleared the production findings (high `fast-uri` path traversal
  and moderate `hono` / `express-rate-limit` / `ip-address` / `qs`) with a
  **targeted `npm update`** of just those 5 transitive packages (lockfile-only, no
  `package.json` change; `npm audit fix` was rejected — it churned 98 packages).
  Remaining 5 lows are evals-only `@ai-sdk/*` needing major bumps — below the
  `moderate` gate; left to Dependabot.

- [x] **`codeql.yml`** — CodeQL SAST for `javascript-typescript` (no C/C++ here),
  `build-mode: none` (source analysis, no build), `security-extended` queries,
  on push/PR (main + develop) + a weekly cron. A `.github/codeql/codeql-config.yml`
  scopes analysis to our own source (ignores `vendor`, `dist`, `out`, `coverage`).
  Results surface under **Security → Code scanning**.

- [x] **`dependabot.yml`** — weekly `npm` (grouped dev vs production to limit PR
  volume; security updates still raised individually) + `github-actions`
  ecosystems. The actions ecosystem replaces manual SHA-pinning (Phase 1).

- [x] **Secret scanning** (`secret-scan.yml`) — gitleaks via the OSS CLI (the
  GitHub Action needs a paid org license), on push/PR + weekly cron. A
  `.gitleaks.toml` allowlists known-public dev/test values by exact match (so
  real secrets are still caught anywhere, including tests) and excludes
  non-source paths.
- [x] **License header check** (`license-headers.yml`) — verifies the EPL-2.0
  SPDX header on non-TS source (`.js`/`.mjs`/`.cjs`/`.sh`); `.ts`/`.mts` are
  already enforced by `eslint-plugin-headers` in the lint step. Added the header
  to 6 files that were missing it.
- [ ] *(Optional / later)* `step-security/harden-runner`, OpenSSF Scorecard,
  SBOM (CycloneDX).

## Phase 5 — Cross-platform matrix

- [x] **OS matrix** — a separate `cross-platform` job (matrix
  `windows-latest` + `macos-latest`, `fail-fast: false`) runs the portable set:
  `npm ci` → build → type-check → server tests (`--no-file-parallelism`) → VS
  Code extension tests. The full `build` job stays Linux-only (it owns the
  packaging/release/coverage/JUnit steps that shouldn't run 3×); ubuntu is
  already covered there. No `xvfb` on win/mac (`@vscode/test-electron` is
  headless there). Catches path-separator, CRLF, and case-sensitivity bugs.
  Prerequisite: the **macOS bundling fix** (PR #20) — `dereferenceSymlinks`
  threw `ERR_FS_EISDIR` removing a dir symlink without `recursive: true`, which
  broke `pack:server` / `bundle:server` on macOS; that PR also hardened the
  prepack crash-restore and made the package.json backup byte-exact.
- [x] **`.gitattributes`** with `* text=auto eol=lf` so Windows checkouts don't
  CRLF-mangle the shell scripts (renormalized one CRLF-committed SVG).
- [x] **Cross-platform bugs the matrix caught and fixed** (the payoff):
  - **`validateCommand` degraded to `elicit` on Windows** — a real product bug.
    `hardstop-patterns` filters by the *host* platform, but USS commands always
    target z/OS Unix; fixed by passing `platform: null` in
    `command-validation.ts`.
  - **`extension-client` tests used unix `.sock` paths** for their mock pipe
    (`listen EACCES` on Windows) — fixed with a `makePipePath()` helper that
    mirrors the production pipe-server (`\\.\pipe\…` on Windows).
- [x] **Promoted to required** in Phase 6 (PR-8) via the `ci-ok` aggregate, which
  `needs: [build, cross-platform]`; the security checks are required individually.
- [x] **`.nvmrc` (Node 24) is the single source of truth** (settled decision); a
  second LTS Node was deliberately not added — the matrix exercises OS variation,
  which is the higher-value axis.

## Phase 6 — Gating & ergonomics

**Done in PR-8.** The plan's original `ci-ok` snippet assumed every gate was a
job in one workflow. Reality: the checks live in **5 workflows** — `ci.yml`
(`build` + `cross-platform`), `audit.yml`, `codeql.yml`, `secret-scan.yml`,
`license-headers.yml`. A `needs:`-based aggregate can only span jobs **within its
own workflow**, so we chose **Option A**: `ci-ok` aggregates the `ci.yml` jobs
into one stable name; the four security checks stay independent workflows
(keeping their own cron schedules) and are required individually.

- [x] **Aggregate `ci-ok` gate job** in `ci.yml`:

  ```yaml
  ci-ok:
    name: ci-ok
    needs: [build, cross-platform]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: |
          if [ "${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" = "true" ]; then
            exit 1
          fi
  ```

  Collapses the `cross-platform` matrix legs into one check name, so CI jobs can
  be added/renamed/sharded without churning branch protection — only a brand-new
  *workflow* would.
- [x] **Branch protection** now requires: `ci-ok`, `audit`, `gitleaks`,
  `headers`, `Analyze (javascript-typescript)`, plus `DCO`. `main` additionally
  requires a code-owner review and enforces rules for admins; `develop` merges
  stay restricted to `zowe-mcp-administrators`.
- [x] **Changelog check** (`changelog.yml`, `no-changelog` label escape hatch) —
  **advisory, not required.** A PR passes when it edits a `CHANGELOG.md` (root or
  package) or carries `no-changelog`. Added a root `CHANGELOG.md` (Keep-a-Changelog
  style, `[Unreleased]` section) as the repo-wide home; per-component history for
  the extension stays in `packages/zowe-mcp-vscode/CHANGELOG.md`.
- [x] **`[ci skip]` handling** — the only new `ci.yml` job, `ci-ok`, uses
  `if: always()` so it runs even when `build`/`cross-platform` are guarded off by
  `[ci skip]`; skipped jobs count as a pass, so `[ci skip]` commits still satisfy
  the required check.

## Phase 7 — Speed & cost (after correctness)

**Done in PR-9.** Measured baseline (a green code PR): `build` job **304 s** (the
long pole), `Cross-platform (windows)` 260 s, total wall-clock ~**350 s**.

- [x] **Caching.** npm was already cached via `setup-node` (Phase 1). Added the
  `.vscode-test/` cache to the **`cross-platform`** matrix (Windows/macOS
  previously re-downloaded the editor every run — part of a ~70 s step; it was
  cached only on Linux). Also added eslint `--cache` so the SARIF pass reuses the
  gate's cache (≈16 s → ≈2 s in CI). TS build outputs and the CodeQL DB were
  **deliberately not cached** — the TS build is ~25 s with real staleness risk,
  and `codeql-action` manages its own DB caching.
- [x] **Path filters** — a fast `changes` job (git-diff, no third-party action)
  sets `code=true` unless the change is **purely Markdown**. `lint` / `build` /
  `cross-platform` are `needs: changes` + `if: code == 'true'`, so a docs-only
  PR skips all heavy lanes; `ci-ok` (`needs:` them, `if: always()`) still passes
  because skipped counts as a pass. Safe default: an empty or failed diff runs
  the full pipeline.
- [x] **Fast fail-early `lint` job** — the static checks (markdown, format,
  duplication, type-check, ESLint + SARIF) moved out of `build` into their own
  parallel `lint` job, so lint/type failures surface in ~1.5 min instead of after
  the full test + package lane, and they no longer sit on `build`'s critical
  path. (Service-dependent e2e remains nightly-only per Decision 3, so there is
  no e2e lane to split here.)

After: `build` drops to ~235 s (static checks removed) and `lint` (~90 s) runs in
parallel; the `changes` job adds ~12 s up front. See PR-9 for the before/after
numbers.

---

## Suggested PR sequence

All PRs target `develop`.

| PR | Scope | Phases |
| --- | --- | --- |
| PR-1 | Script fixes: `lint:md`, `typecheck`, jscpd cleanup, `npm ci` decision | 0 |
| PR-2 | Harden existing job + enforce format/md/dup/typecheck/docs-drift | 1, 2 |
| PR-3 | `audit.yml` + `dependabot.yml` | 4 |
| PR-4 | `codeql.yml` (+ ESLint SARIF) | 4 |
| PR-5 | Tests: coverage (report-only), vscode (xvfb), JUnit | 3 |
| PR-6 | Service e2e + airgap as separate (non-required) lanes | 3 |
| PR-7 | OS matrix | 5 |
| PR-8 | `ci-ok` gate + changelog check + branch protection | 6 |
| PR-9 | Caching + path filters | 7 |

## Open decisions

- **e2e infrastructure (Decision 3, unresolved):** Is Keycloak available as a
  GitHub `services:` container / docker-compose in CI, or should
  `test:keycloak-jwt-e2e` stay nightly-only? Same question for
  `test:native-stdio-e2e` (does it need a real backend, or does it run against
  the mock?). Until resolved, these stay **off the required PR path**.

## Follow-ups (tracked)

Deferred work spun off from the phases above, so it isn't lost:

- ✅ **Re-enable the Windows extension-client tests** (from Phase 5) — **done**
  (PR #23). All six `extension-client.test.ts` data-flow tests now run on
  Windows. Root cause was a test-harness readiness race, not a product bug: the
  mock server attached its `data` listener *late* (so it missed the connect-time
  handshake), and for the server→client tests it replied before the named pipe
  was established in both directions. Fix mirrors production — attach the
  server's `data` listener inside the connection callback and accumulate into a
  buffer, give the receive tests a `pipeSecret` so the client handshakes, and
  wait until the server has received that handshake before it replies. No
  production change.
- ✅ **Plugin-schema validation** (from Phase 2) — **done** (PR #24). A vitest
  test validates every CLI-bridge plugin `*-tools.yaml` against
  `schemas/plugin-tools.schema.json` with `ajv`; runs in the normal test job on
  every OS. `vendor/zowe/cli-bridge-plugins/db2-tools.yaml` passes clean (no
  drift).
- ✅ **ESLint SARIF → code scanning** (from Phase 2) — **done** (PR #26). The
  `build` job runs `npm run lint:sarif` (`@microsoft/eslint-formatter-sarif`)
  and uploads the result via `github/codeql-action/upload-sarif`, so lint
  findings surface in the Security tab and as inline PR annotations. It's
  visibility-only (`continue-on-error`, runs on `!cancelled()`); the existing
  `npm run lint` (`--max-warnings 0`) remains the hard gate. Inline
  `// eslint-disable` directives are emitted with SARIF `suppressions`, so code
  scanning shows them as suppressed rather than active alerts. Upload is skipped
  for fork PRs (no `security-events: write` on their token).

## Reference: what zowex runs (for comparison)

`build` (3-OS matrix build+test), `lint` (Biome + cpp-linter), `audit`
(`npm audit --production --audit-level=moderate`, PR + daily), `codeql`
(C/C++ + TypeScript), `changelog` (enforced "## Recent Changes" updates),
`zos-build` / `zos-py-build` (real z/OS hardware build+test, JUnit reports),
`release` (Octorelease + JFrog Artifactory, nightly + tagged), `update-project`
(project-board automation).

[zowex]: https://github.com/zowe/zowex
