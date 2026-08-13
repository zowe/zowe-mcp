# Prepare a Release PR

Prepare a release pull request for the Zowe MCP VS Code extension. Execute each step in order; do not skip steps. Wait for the user’s approval after drafting the changelog before committing anything. **This command stops at an open pull request — it never tags, publishes a GitHub Release, or pushes to `main`.** CI ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) does that once the PR is reviewed and merged; see [`docs/release-process.md`](release-process.md) for the full pipeline.

## 1. All tests passing

- Run **`npm run test:all`** from the repo root.
- If any test fails, stop and report the failure. Do not proceed until tests pass.

## 2. Git state: committed and pushed

- Run **`git status`** and ensure the working tree is clean (no uncommitted changes).
- If there are uncommitted changes, list them and stop. Ask the user to commit or stash before continuing.
- Run **`git status -sb`** or **`git rev-parse HEAD @{u}`** and ensure the branch is pushed (no “ahead of origin” or confirm that the user is okay to push later).

## 3. Todos updated

- Open **`TODO.md`** and ensure every item that has been implemented for this release is marked as done with a check mark **✅** (e.g. `- ✅ **Title**: ...`).
- If you see work in the codebase or in recent commits that clearly corresponds to an unmarked TODO item, list those items and ask the user to add ✅ to them in `TODO.md` before proceeding. Do not continue until the user has updated `TODO.md` or confirmed that nothing is missing.

## 4. Suggest next version number

- Read **`packages/zowe-mcp-vscode/package.json`** and note the current **version** (this is the last release version, or the in-progress `-dev` version).
- Determine what changed since the last release:
  - If the tag **`v<version>`** exists (e.g. `v0.9.0`), use **`git log v<version>..HEAD --oneline`** (and optionally **`git diff v<version>..HEAD --stat`**) to see commits and file changes.
  - If the tag does not exist, use **`git log -20 --oneline`** and recent changes to infer scope.
- Apply **version rules**:
  - **0.x.y** (pre-1.0): Treat as 0.MINOR.PATCH. Bump **MINOR** for new features or notable improvements; bump **PATCH** for bug fixes and small changes only. No breaking-change rule.
  - **1.0.0 and above**: Use **SemVer**. MAJOR for breaking changes, MINOR for new features (backward compatible), PATCH for bug fixes.
  - **Rehearsal releases**: if the user wants to practice the pipeline end-to-end before the real release, suggest a prerelease version instead, e.g. `0.10.0-rc.1` — it goes through the identical pipeline and CI marks it a GitHub Pre-release automatically. Ask the user whether they want a `-rc.N` rehearsal or the real, clean version.
- Propose the **next version** (e.g. `0.2.0`, `0.1.1`, or `0.10.0-rc.1`) and briefly justify it. If in doubt, suggest a patch bump and explain.

## 5. Draft changelog and ask for review

- Open **`packages/zowe-mcp-vscode/CHANGELOG.md`** and follow its existing format (see the “Change Log” header and the `## \`0.9.0\`` style).
- Draft a new section for the **proposed version** (e.g. `## \`0.10.0\``) with:
  - **New features and enhancements**
  - **Bug fixes** (if any)
  - **Other** (if needed)
- **User-facing only**: Include only changes that affect extension users (settings, commands, UX, docs they see). Omit internal implementation details (e.g. CLI/library migrations, internal tooling, AGENTS.md or process docs).
- Also check the root **`CHANGELOG.md`**’s **`## [Unreleased]`** section — this release absorbs it (see step 6).
- Base the draft on the commits/changes you found in step 4. Keep entries short and user-focused.
- **Show the full draft** (the new section only or the full CHANGELOG if clearer) and say: **“Review this changelog draft. Reply with ‘ok’ or ‘looks good’ (or similar) to approve, or tell me what to change.”**
- **Do not commit or open a PR until the user explicitly approves** (e.g. “ok”, “looks good”, “approved”).

## 6. After approval: version bump, docs, slides, changelog, commit, open PR

Only after the user has approved the changelog:

1. **Bump version**: Run **`node scripts/set-version.js <version>`** (e.g. `node scripts/set-version.js 0.10.0`) — a clean version, **no** `-dev` suffix. This sets the version in every workspace `package.json`, the extension’s `dependencies["@zowe/mcp-server"]`, `packages/zowe-mcp-server/server.json`, and syncs **`package-lock.json`** (commit it too — `npm ci` fails on a version mismatch). Do not edit version fields manually — the script is the single source of truth. Do this **before** regenerating docs so the MCP reference header matches the release.
2. **Roll the extension changelog heading**: Change **`## Recent Changes`** to **`` ## `X.Y.Z` ``** in **`packages/zowe-mcp-vscode/CHANGELOG.md`** — the section you drafted and got approved in step 5 becomes the new version’s section.
3. **Roll the root changelog heading**: Change **`## [Unreleased]`** to the versioned heading per [Keep a Changelog](https://keepachangelog.com/) style used in `CHANGELOG.md` (e.g. `## [0.10.0] - YYYY-MM-DD`), and add a fresh empty `## [Unreleased]` section above it for the next cycle.
4. **Regenerate MCP reference docs**: From the repo root, run **`npm run generate-docs`**. This refreshes **`docs/mcp-reference.md`**. Include the updated file in the release commit.
5. **Publish slides (when the Slidev deck changed this release)**: If **`presentations/zowe-mcp/slides.md`**, theme assets, or related files changed, refresh the exported deck. From **`presentations/zowe-mcp/`**, run **`npm install`** if needed (off the corporate network, use `npm install --registry https://registry.npmjs.org/` — the directory has no project `.npmrc`, so a user-level mirror config may otherwise apply and 403), then **`npm run export`** to regenerate **`zowe-mcp-slides.pdf`**. Include the updated PDF in the release commit. If the presentation did not change, skip this step.
6. **Commit on a release branch**: Create branch **`release/vX.Y.Z`**, commit everything (version bump, both CHANGELOGs, `docs/mcp-reference.md`, slides PDF if updated) with message **“Release vX.Y.Z”**, and push it.
7. **Open the release PR**: Open a PR to **`main`** titled **`Release vX.Y.Z`** with the approved changelog section as the PR body (include the AI Usage section per [CONTRIBUTING.md](../CONTRIBUTING.md#ai-usage-disclosure-in-pull-requests)).
8. **Stop here.** Do not tag, do not run any release/publish script, and do not push to `main` directly.

> **Releasing X.Y.Z after an X.Y.Z-rc.N rehearsal:** keep a **single changelog section** — retitle the rc section heading to the final version (and refresh the date) instead of adding a separate rc entry; the rc's GitHub release keeps its own frozen copy of the notes. Also remember that a prerelease leaves `main` sitting on the `-rc.N` version (the automated dev-bump PR is deliberately skipped for prereleases), so the follow-up release PR is what moves `main` forward.

## 7. Closing message

After opening the PR, say something short and clear about what happens next — e.g. “Release PR for v0.10.0 is open: <url>. Once it’s reviewed and merged, CI builds, tags, and publishes the release automatically.” One or two sentences, professional, no celebration yet — the release isn’t live until the PR merges and CI finishes.

---

**Summary**: Tests → clean git → **`TODO.md`** checklist → suggest version (or `-rc.N` rehearsal) → draft changelog → **wait for user “ok”** → **`node scripts/set-version.js X.Y.Z`** (clean, no `-dev`) → roll both CHANGELOGs → **`npm run generate-docs`** → slide export when the deck changed → commit on `release/vX.Y.Z` → open PR titled `Release vX.Y.Z` to `main` → stop. Human review + merge of that PR **is** the release approval; CI (`.github/workflows/release.yml`) builds, tags, publishes the GitHub Release, and opens the next `-dev` version bump PR. Rehearse first with `workflow_dispatch` `dry-run: true` on `main`, or with a `-rc.N` prerelease PR.
