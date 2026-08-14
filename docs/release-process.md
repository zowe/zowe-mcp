# Release Process

This document describes how Zowe MCP releases are prepared, reviewed, and
published. It replaces the old developer-laptop workflow
(`scripts/release-vsix.sh`) with a CI-driven pipeline gated by a reviewed
pull request — the same model used by other Zowe JS projects (zowex, Zowe
Explorer) via [Octorelease](https://github.com/zowe-actions/octorelease).

## Flow

```text
develop ──(feature PRs, each adds a changelog entry; changelog check)──►
release PR to main:  set-version to X.Y.Z (strip -dev), roll changelog headers,
                     regen docs/mcp-reference.md, slides if changed
        │  ← human review (CODEOWNERS) = THE approval gate; full ci-ok runs
        ▼ merge
.github/workflows/release.yml (push to main, version has no -dev suffix):
    npm ci → extract release notes → octorelease (exec + github plugins):
      build + package VSIX + npm pack tgz + airgap smoke test
      → create vX.Y.Z GitHub Release with the extracted notes + assets
    → auto-open follow-up PR "chore: set development version to X.(Y+1).0-dev"
```

## Roles

- **AI prepares.** The `/prepare-release` Cursor command
  ([`.cursor/commands/prepare-release.md`](../.cursor/commands/prepare-release.md))
  runs the test suite, suggests the next version, drafts the user-facing
  changelog, and — after explicit human approval of the changelog — bumps
  the version, rolls both CHANGELOGs, regenerates docs, and opens a PR to
  `main` titled `Release vX.Y.Z`. It never tags, publishes, or pushes to
  `main` directly.
- **A human reviews and merges.** Reviewing and merging that PR (code owner
  approval, required per branch protection) **is** the release approval.
  There is no separate release button and no laptop with publish
  credentials — the PR diff is the entire decision surface.
- **CI publishes.** [`.github/workflows/release.yml`](../.github/workflows/release.yml)
  runs on every push to `main`. It reads the version from
  `packages/zowe-mcp-vscode/package.json`; if the version ends in `-dev`
  (the normal state between releases) **or the `vX.Y.Z` tag already
  exists** (the version was already released), every publishing step is
  skipped — the pipeline is dormant except right after a release PR
  merges, and pushes to `main` between a release and the dev-bump merge
  cannot re-release. When the version is clean and untagged, it extracts
  release notes from the extension changelog (failing if the release PR
  forgot the changelog rollover), then runs
  [Octorelease](https://github.com/zowe-actions/octorelease)
  (`release.config.js`): the `exec` plugin builds and packages the assets
  (`npm run ci:package-release`, see `scripts/package-release.sh`), and
  the `github` plugin creates the `vX.Y.Z` tag and a **draft** release
  with the assets. A final step sets the human-reviewed notes and flips
  the draft live in one atomic edit — so a mid-job failure leaves at most
  a draft, never a half-configured public release — and then opens the
  follow-up "set development version" PR.

## Assets published

Same four assets as the old manual flow:

- `zowe-mcp-vscode-<version>.vsix`
- `zowe-mcp-server-<version>.tgz` (`npm pack` of `@zowe/mcp-server`)
- `docs/mcp-reference.md`
- `presentations/zowe-mcp/zowe-mcp-slides.pdf`

## Rehearsal paths

Two ways to exercise the pipeline without cutting a real release:

1. **Dry run.** Trigger `.github/workflows/release.yml` manually
   (`workflow_dispatch`) with `dry-run: true`. This runs the full
   build/package path (`npm run ci:package-release`, including the airgap
   smoke test) and best-effort notes extraction, uploads the `dist/`
   contents as a workflow artifact for inspection, and never touches
   Octorelease, tags, or releases. It works even while the version is
   `-dev`, on any branch that has the workflow file — and as a safety net,
   any run on a ref other than `main` is forced into dry-run mode
   regardless of inputs.
2. **Prerelease rehearsal (recommended before the first real release).**
   Run `/prepare-release` targeting a prerelease version, e.g. `0.10.0-rc.1`.
   The `-dev` guard only skips versions ending in `-dev`, so an `-rc.N`
   release PR goes through the identical pipeline end to end — reviewed PR,
   CI build, tag, assets, notes. The workflow marks any version with a
   prerelease component (`-rc.N` etc.) as a GitHub **Pre-release** (never
   "latest"). Delete the rc release/tag afterwards if desired, then repeat
   with the clean version.

## One-time repo settings checklist

These are manual, org-admin actions applied once (not automated by this
pipeline):

- [ ] Make the `changelog` check (`.github/workflows/changelog.yml`)
      **required** on `main` branch protection (it is advisory today).
- [ ] Add a tag ruleset protecting `v*` so only GitHub Actions (via the
      release workflow's `GITHUB_TOKEN`) can create release tags.
- [ ] Enable **immutable releases** for the repository.
- [ ] Enable **"Allow GitHub Actions to create and approve pull
      requests"** (repo Settings → Actions → General) — required for the
      post-release dev-bump PR step.
- [ ] Delete the stray `v0.10.0-dev` tag — it sits first in `git
      describe`'s match order and is an anomaly, not a real release tag.

## Later phases (not implemented yet)

Phase 1 above covers GitHub Releases only. Later phases, gated on Zowe org
coordination:

- **Phase 2 — npm.** Publish `@zowe/mcp-server` via Zowe Artifactory
  (`publishConfig.registry`, `@octorelease/npm`, org `ARTIFACTORY_*`
  secrets) plus a PR to `zowe-cli-standalone-package/zowe-versions.yaml`
  (under `extras:`, like `zowex-for-zowe-sdk`) for the npmjs.org mirror.
  Unblocks the MCP registry.
- **Phase 3 — VS Code Marketplace + Open VSX.** `@octorelease/vsce` with
  `vscePublish`/`ovsxPublish`, as Zowe Explorer does; needs org
  `VSCODE_VSCE_PUBLISHER_TOKEN` / `VSCODE_OVSX_PUBLISHER_TOKEN` and a
  `repository` field in the extension `package.json` (drop
  `--allow-missing-repository`).
- **Phase 4 — MCP registry.** `mcp-publisher publish` of `server.json` as a
  release step, once the package resolves on registry.npmjs.org.
- **Phase 5 — hardening to full Zowe parity.** `ZOWE_ROBOT_TOKEN` +
  `@octorelease/git` / `@octorelease/changelog` (automated changelog
  rollover and dev-bump commit instead of a PR-carried change), Sigstore
  signing of release assets, and an optional GitHub Environment with
  required reviewers as a second gate.

## See also

- [DEVELOPMENT.md](../DEVELOPMENT.md#releases-and-ci-artifacts)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [`release.config.js`](../release.config.js)
- [`.github/workflows/release.yml`](../.github/workflows/release.yml)
