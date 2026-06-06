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

Small `package.json` / config changes; no workflow edits yet. Verify each runs
locally before Phase 1+ consumes them.

- [ ] **Add a check-only markdown script.** Add
  `"lint:md": "markdownlint-cli2 \"**/*.md\" \"#node_modules\""` (no `--fix`);
  rename the mutating one to `markdownlint:fix`.
- [ ] **Add a typecheck script** independent of emit, e.g.
  `"typecheck": "tsc -b --noEmit"` (or per-workspace `--noEmit`).
- [ ] **Clean up jscpd output.** Stop committing `report/jscpd-report.json`
  (`git rm --cached` + gitignore); run CI with `--reporters console` (still
  fails past the 5% threshold).
- [ ] **Decide `npm ci` vs `--ignore-scripts`.** Introduce an explicit `npm ci`
  in CI for lockfile-reproducible installs and run the vscode `download-api`
  step explicitly (already invoked in `ci.yml`). Document the choice.

## Phase 1 — Harden the existing job

No new tools; make `ci.yml` robust.

- [ ] `concurrency` (cancel-in-progress) keyed on workflow + ref.
- [ ] `timeout-minutes` on the job (start at 30).
- [ ] Least-privilege `permissions`.
- [ ] npm caching via `setup-node`.
- [ ] Pin actions (or rely on Dependabot from Phase 4).

## Phase 2 — Enforce existing quality scripts

Each as its own job/step so failures are legible.

- [ ] **Format**: `npm run check-format` (Prettier + shfmt `--check`).
- [ ] **Markdown**: `npm run lint:md`.
- [ ] **Duplication**: `npm run duplication` (jscpd, 5% threshold).
- [ ] **Typecheck**: `npm run typecheck`.
- [ ] **Lint**: keep `npm run lint` (`--max-warnings 0`); optionally emit ESLint
  SARIF and upload to code-scanning for inline PR annotations.
- [ ] **Docs drift**: run `npm run generate-docs` then
  `git diff --exit-code docs/mcp-reference.md` so a stale reference fails CI.
- [ ] **Plugin schema validation**: validate bundled CLI-bridge plugin YAMLs
  against `schemas/plugin-tools.schema.json`.

## Phase 3 — Expand test execution

Today only `test:server` runs. Add the rest, tiered by infra needs.

- [ ] **Server tests**: already running; add **coverage (report-only)** via
  `vitest run --coverage` (Decision 4 — no threshold gate).
- [ ] **VS Code extension**: `npm run test:vscode` under `xvfb-run -a` on Linux;
  cache `.vscode-test/`. (Windows/macOS run it directly — see Phase 5.)
- [ ] **Mock/integration suites**: ensure the in-process `spawn-mock-zos.ts`
  suites run (CI-safe, no external services).
- [ ] **JUnit reporting**: vitest `junit` reporter + `dorny/test-reporter` so
  results render in the PR checks UI.
- [ ] **Airgap**: `test:airgap` after `npm pack`, exercising the real tarball.
- [ ] **Service-dependent e2e** (`test:keycloak-jwt-e2e`,
  `test:native-stdio-e2e`): **kept off the required PR path** per Decision 3 —
  nightly-only / manual dispatch until the Open Decision is resolved.
- [ ] **Nightly SDK-mode run**: scheduled job with `sdk-mode: nightly` to catch
  upstream zowex breakage (uses existing `workflow_dispatch` inputs).

## Phase 4 — Security & supply-chain

- [ ] **`audit.yml`** (Decision 2 — mirror zowex):

  ```yaml
  name: Audit
  on:
    pull_request:
      branches: [main, develop]
    schedule:
      - cron: "0 10 * * *"
  permissions: { contents: read }
  jobs:
    audit:
      runs-on: ubuntu-latest
      timeout-minutes: 10
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: lts/* }
        - run: npm audit --production --audit-level=moderate
  ```

- [ ] **`codeql.yml`** — TypeScript only (no C/C++ in this repo):

  ```yaml
  name: CodeQL
  on:
    push: { branches: [main, develop] }
    pull_request: { branches: [main, develop] }
    schedule:
      - cron: "0 10 * * 1"
  jobs:
    analyze:
      runs-on: ubuntu-latest
      timeout-minutes: 30
      permissions: { actions: read, contents: read, security-events: write }
      steps:
        - uses: actions/checkout@v4
        - uses: github/codeql-action/init@v3
          with: { languages: javascript-typescript, queries: security-extended }
        - uses: github/codeql-action/autobuild@v3
        - uses: github/codeql-action/analyze@v3
  ```

- [ ] **`dependabot.yml`** — npm + github-actions ecosystems:

  ```yaml
  version: 2
  updates:
    - package-ecosystem: npm
      directory: "/"
      schedule: { interval: weekly }
      groups: { dev-deps: { dependency-type: development } }
    - package-ecosystem: github-actions
      directory: "/"
      schedule: { interval: weekly }
  ```

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
