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
- [ ] Pin actions to SHAs — deferred to **Phase 4 Dependabot**; majors were
  already bumped to Node-24-ready versions in the carry-overs PR
  (checkout v6, setup-node v6, upload-artifact v7, sticky-comment v3).

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
- [ ] **Plugin schema validation**: validate bundled CLI-bridge plugin YAMLs
  against `schemas/plugin-tools.schema.json`. Needs a validator (`ajv` is not
  currently a dependency) — a small node script or `ajv-cli` dev dep.

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

- [ ] **Secret scanning** (gitleaks) — improvement beyond zowex; we handle
  tokens/credentials.
- [ ] **License header check** — verify SPDX/EPL-2.0 headers on source files
  (zowex runs a license step).
- [ ] *(Optional / later)* `step-security/harden-runner`, OpenSSF Scorecard,
  SBOM (CycloneDX).

## Phase 5 — Cross-platform matrix

- [ ] **OS matrix** for build + unit/vscode tests:

  ```yaml
  strategy:
    fail-fast: false
    matrix: { os: [ubuntu-latest, windows-latest, macos-latest] }
  runs-on: ${{ matrix.os }}
  ```

  Catches path-separator, CRLF, and case-sensitivity bugs the extension/CLI hit
  on user machines. **Gotcha**: `xvfb` is Linux-only — guard the display
  wrapper per-OS; Windows/macOS run `vscode-test` directly.
- [ ] Keep `.nvmrc` (Node 24) as the single source of truth; optionally add a
  second LTS Node to the unit-test lane only.

## Phase 6 — Gating & ergonomics

- [ ] **Aggregate `ci-ok` gate job** that `needs:` all required jobs, so branch
  protection requires one stable check name:

  ```yaml
  ci-ok:
    needs: [build, format, lint, lint-md, dup, typecheck, test-server, test-vscode, audit, codeql]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: |
          [ "${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" = "false" ]
  ```

- [ ] **Enable branch protection** on `main` and `develop`: require `ci-ok` +
  1 review + DCO + up-to-date branch. (Repo setting — document in
  `CONTRIBUTING.md`.)
- [ ] **Changelog check** (`changelog.yml`, `no-changelog` label escape hatch) —
  pairs with later release-automation work.
- [ ] **`[ci skip]` handling** — replicate the existing guard onto new jobs (or
  hoist to a shared condition).

## Phase 7 — Speed & cost (after correctness)

- [ ] Cache npm, `.vscode-test/`, TS build outputs, and the CodeQL DB.
- [ ] Path filters (`dorny/paths-filter`) so docs-only PRs skip heavy lanes.
- [ ] Split a fast fail-early "lint" job from the slower test matrix and e2e
  lanes.

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

## Reference: what zowex runs (for comparison)

`build` (3-OS matrix build+test), `lint` (Biome + cpp-linter), `audit`
(`npm audit --production --audit-level=moderate`, PR + daily), `codeql`
(C/C++ + TypeScript), `changelog` (enforced "## Recent Changes" updates),
`zos-build` / `zos-py-build` (real z/OS hardware build+test, JUnit reports),
`release` (Octorelease + JFrog Artifactory, nightly + tagged), `update-project`
(project-board automation).

[zowex]: https://github.com/zowe/zowex
