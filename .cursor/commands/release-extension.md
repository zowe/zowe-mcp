# Release New Extension Version

Run the full release workflow for the Zowe MCP VS Code extension. Execute each step in order; do not skip steps. Wait for the user’s approval after drafting the changelog before committing or releasing.

## 1. All tests passing

- Run **`npm run test:all`** from the repo root.
- If any test fails, stop and report the failure. Do not proceed until tests pass.

## 2. Git state: committed and pushed

- Run **`git status`** and ensure the working tree is clean (no uncommitted changes).
- If there are uncommitted changes, list them and stop. Ask the user to commit or stash before continuing.
- Run **`git status -sb`** or **`git rev-parse HEAD @{u}`** and ensure the branch is pushed (no “ahead of origin” or confirm that the user is okay to push later).
- If the branch is ahead of origin, tell the user and ask whether to push now or after the release. Do not push without explicit approval at the appropriate step.

## 3. Todos updated

- Open **`TODO.md`** and ensure every item that has been implemented for this release is marked as done with a check mark **✅** (e.g. `- ✅ **Title**: ...`).
- If you see work in the codebase or in recent commits that clearly corresponds to an unmarked TODO item, list those items and ask the user to add ✅ to them in `TODO.md` before proceeding. Do not continue the release until the user has updated `TODO.md` or confirmed that nothing is missing.

## 4. Suggest next version number

- Read **`packages/zowe-mcp-vscode/package.json`** and note the current **version** (this is the last release version).
- Determine what changed since that release:
  - If the tag **`v<version>`** exists (e.g. `v0.1.0`), use **`git log v<version>..HEAD --oneline`** (and optionally **`git diff v<version>..HEAD --stat`**) to see commits and file changes.
  - If the tag does not exist, use **`git log -20 --oneline`** and recent changes to infer scope.
- Apply **version rules**:
  - **0.x.y** (pre-1.0): Treat as 0.MINOR.PATCH. Bump **MINOR** for new features or notable improvements; bump **PATCH** for bug fixes and small changes only. No breaking-change rule.
  - **1.0.0 and above**: Use **SemVer**. MAJOR for breaking changes, MINOR for new features (backward compatible), PATCH for bug fixes.
- Propose the **next version** (e.g. `0.2.0` or `0.1.1`) and briefly justify it (e.g. “new features X, Y → suggest 0.2.0”). If in doubt, suggest a patch bump and explain.

## 5. Draft changelog and ask for review

- Open **`packages/zowe-mcp-vscode/CHANGELOG.md`** and follow its existing format (see the “Change Log” header and the `## \`0.1.0\`` style).
- Draft a new section for the **proposed version** (e.g. `## \`0.2.0\``) with:
  - **New features and enhancements**
  - **Bug fixes** (if any)
  - **Other** (if needed)
- **User-facing only**: Include only changes that affect extension users (settings, commands, UX, docs they see). Omit internal implementation details (e.g. CLI/library migrations, internal tooling, AGENTS.md or process docs).
- Base the draft on the commits/changes you found in step 4. Keep entries short and user-focused.
- **Show the full draft** (the new section only or the full CHANGELOG if clearer) and say: **“Review this changelog draft. Reply with ‘ok’ or ‘looks good’ (or similar) to approve, or tell me what to change.”**
- **Do not commit, push, or run the release script until the user explicitly approves** (e.g. “ok”, “looks good”, “approved”).

## 6. After approval: version bump, changelog, commit, push, release

Only after the user has approved the changelog:

1. **Bump version**: Update **`packages/zowe-mcp-vscode/package.json`** — set **`version`** to the agreed next version (e.g. `0.2.0`). If this repo keeps the server package in sync, update **`packages/zowe-mcp-server/package.json`** **`version`** to the same value, and the extension’s **`dependencies["zowe-mcp-server"]`** in **`packages/zowe-mcp-vscode/package.json`** to that version as well.
2. **Write changelog**: Insert the approved changelog section into **`packages/zowe-mcp-vscode/CHANGELOG.md`** at the top of the changelog (below the “Change Log” intro), so the new version is the first listed.
3. **Commit and push**: Create a single commit (e.g. “Release v0.2.0” or “chore: release v0.2.0”) that includes the version and CHANGELOG changes, then **`git push origin <branch>`**.
4. **Release**: Run **`npm run release-vsix`** from the repo root. This script uses the version from **`packages/zowe-mcp-vscode/package.json`** to build, tag, and create the GitHub release with the VSIX. Do not pass a tag unless the user asked for a specific tag.
5. If anything fails (e.g. tag already exists, `gh` not authenticated), report the error and stop; do not force-push or overwrite tags without explicit user request.

## 7. Closing message

After a successful release, say something short and positive about the release (e.g. “Ship it. v0.2.0 is out.” or “Release v0.2.0 is live. Nice work.”). Keep it one sentence and professional but a bit celebratory.

---

**Summary**: Tests → clean git → checklist → suggest version → draft changelog → **wait for user “ok”** → bump version, update CHANGELOG, commit, push, `npm run release-vsix` → short congrats.
