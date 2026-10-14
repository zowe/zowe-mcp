# Releasing

Zowe MCP uses CI-driven GitHub Release process. Maintainers merge a
release pull request which triggers CI to tag and publish the release.

The current pipeline publishes GitHub Release assets only. It does not publish
the server to npm, the extension to VS Code Marketplace or Open VSX, or the
server to an MCP Registry.

## Normal release flow

1. User-facing changes merge into `main` with entries under **Unreleased** in
   the root [`CHANGELOG.md`](CHANGELOG.md).
2. A maintainer creates `release/vX.Y.Z` from an up-to-date `main` and prepares
   the version, changelogs, generated reference files, and presentation assets.
3. A human reviews and merges the release pull request into `main`.
4. [`.github/workflows/release.yml`](.github/workflows/release.yml) verifies
   that the version is clean and untagged, then builds and publishes the GitHub
   Release.
5. After a stable release, the workflow opens a pull request setting the next
   minor development version, such as `0.11.0-dev` after `0.10.0`.

A version ending in `-dev` is never published. A push whose version already has
a `vX.Y.Z` tag is also skipped.

## Prepare a release pull request

Follow these steps in order. If an AI assistant prepares the release, it must
stop for explicit human approval of the version and release notes before
changing files, committing, or opening the pull request. It must stop again
after opening the pull request; it must not merge, tag, or publish.

### 1. Start from a clean, current `main`

```bash
git switch main
git pull --ff-only
git status --short
```

Stop if the working tree is not clean. Run the full test suite:

```bash
npm run test:all
```

Do not continue until the tests pass.

### 2. Confirm the release version

Read the current version from
[`packages/zowe-mcp-vscode/package.json`](packages/zowe-mcp-vscode/package.json).
The normal stable release removes the `-dev` suffix:

```text
0.11.0-dev → 0.11.0
```

The development version represents the planned next stable release. Do not
choose a lower patch version based only on the contents of the release. This
repository has no established out-of-band hotfix procedure.

For a prerelease rehearsal, use the same base version with an `-rc.N` suffix,
such as `0.11.0-rc.1`. If `main` already has an `X.Y.Z-rc.N` version, choose
either the next release candidate or the final `X.Y.Z`. Ask the release
approver to confirm whether to prepare the stable version or a release
candidate.

Review changes since the latest release tag:

```bash
git describe --tags --abbrev=0
git log <latest-tag>..HEAD --oneline
git diff <latest-tag>..HEAD --stat
```

If no release tag is available locally, fetch tags before continuing:

```bash
git fetch origin --tags
```

### 3. Draft the release notes

GitHub release notes come from the matching version section in
[`packages/zowe-mcp-vscode/CHANGELOG.md`](packages/zowe-mcp-vscode/CHANGELOG.md).
Despite its location, that section must cover all user-facing changes in the
shipped MCP server and VS Code extension.

Use the root `CHANGELOG.md` **Unreleased** section, the extension changelog's
**Recent Changes** section, and the commit range from the previous step as
inputs. Follow the existing extension changelog structure:

```markdown
## `X.Y.Z`

### New features and enhancements

### Bug fixes

### Other
```

Include user-visible behavior, settings, commands, compatibility changes, and
important documentation. Omit internal implementation details, repository
maintenance, and release machinery unless they affect users.

Show the complete proposed section to the release approver. Do not modify files
until they explicitly approve both the version and the notes.

### 4. Create the release branch and update release files

After approval:

1. Create the release branch:

   ```bash
   git switch -c release/vX.Y.Z
   ```

2. Set the version with the repository script:

   ```bash
   node scripts/set-version.js X.Y.Z
   ```

   Use the clean release or release-candidate version, without `-dev`. The
   script updates every workspace version, the extension's server dependency,
   `packages/zowe-mcp-server/server.json`, and `package-lock.json`. Do not edit
   version fields manually.

3. In `packages/zowe-mcp-vscode/CHANGELOG.md`, roll the contents under
   **Recent Changes** into the approved ``## `X.Y.Z` `` section and add a new
   empty **Recent Changes** section above it.

4. In the root `CHANGELOG.md`, replace **Unreleased** with a versioned Keep a
   Changelog heading such as `## [X.Y.Z] - YYYY-MM-DD`, then add a new empty
   **Unreleased** section above it.

5. Regenerate both MCP reference files:

   ```bash
   npm run generate-docs
   ```

   Commit both generated outputs:

   - `docs/mcp-reference.md`
   - `vendor/zowe/docs/mcp-reference-vendor.md`

6. If the Slidev source, theme assets, or related presentation files changed
   since the previous release, regenerate the PDF:

   ```bash
   cd presentations/zowe-mcp
   npm install
   npm run export
   cd ../..
   ```

   If a user-level npm mirror returns 403 while off the corporate network, use
   `npm install --registry https://registry.npmjs.org/`. Commit
   `presentations/zowe-mcp/zowe-mcp-slides.pdf` when regenerated.

For a stable release following an `X.Y.Z-rc.N` release, keep one changelog
section: retitle the release-candidate section to `X.Y.Z`, update its date, and
incorporate any changes made after the release candidate. Do not add a second
section for the same release.

### 5. Validate the release changes

Confirm that the release notes can be extracted and that the documentation is
valid:

```bash
node scripts/extract-release-notes.js X.Y.Z > /tmp/zowe-mcp-release-notes.md
npm run lint:md
git diff --check
git status --short
```

Review every changed file. The release pull request CI performs the complete
build and validation suite.

### 6. Commit and open the pull request

Commit with DCO sign-off, push the branch, and open a pull request to `main`:

```bash
git add <release-files>
git commit -s -m "Release vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z --title "Release vX.Y.Z"
```

Use the approved release notes in the pull request body. Include the AI usage
disclosure required by [`CONTRIBUTING.md`](CONTRIBUTING.md#ai-usage-disclosure).
State that merging the pull request authorizes CI to publish the release.

Stop after opening the pull request. Report its URL and state that CI will
publish after human review and merge. Human review and merge are the release
approval.

## Publishing pipeline

When the release pull request merges, `.github/workflows/release.yml`:

1. Reads the version from `packages/zowe-mcp-vscode/package.json`.
2. Skips publishing when the version ends in `-dev` or its tag already exists.
3. Stages the pinned Zowe Remote SSH SDK and installs dependencies.
4. Extracts the reviewed notes from the extension changelog, failing if the
   version section is missing or empty.
5. Runs Octorelease. Its build command, `npm run ci:package-release`, builds the
   workspaces, packages the VSIX and server tarball, performs the airgap install
   smoke test, and archives the pinned SDK with provenance.
6. Creates the `vX.Y.Z` tag and a draft GitHub Release, uploads the assets,
   applies the reviewed notes and explicit title, and publishes the release.
7. Marks versions with prerelease suffixes as GitHub prereleases.
8. For a stable release, opens the next-minor `-dev` version pull request.

The release contains:

- `zowe-mcp-vscode-X.Y.Z.vsix`
- `zowe-mcp-server-X.Y.Z.tgz`
- The archived `zowe-zowex-for-zowe-sdk-*.tgz`
- `zowex-provenance.json`
- `mcp-reference.md`
- `zowe-mcp-slides.pdf`

The server tarball is a GitHub Release asset. It is not currently published to
an npm registry.

## Rehearsals and dry runs

### GitHub Actions dry run

Run the **Release** workflow manually with `dry-run: true`. It stages the SDK,
installs dependencies, exercises the complete build/package and airgap-test
path, and uploads `dist/` as the `release-dry-run` workflow artifact. It does
not invoke Octorelease or create a tag or release.

The dry-run artifact contains the VSIX, server tarball, SDK tarball, and
provenance record. The workflow validates that the MCP reference and slides PDF
exist, but those two files are published from their repository paths and are
not copied into the dry-run artifact.

Any manual workflow run on a ref other than `main` is forced into dry-run mode.
When dispatching from `main`, always set `dry-run: true` unless the intent is to
publish a clean, untagged release version.

### Local package rehearsal

To reproduce the CI package build without publishing:

```bash
node scripts/sdk-switch.js pin --no-install
npm ci --ignore-scripts
npm run download-api -w packages/zowe-mcp-vscode
npm run ci:package-release
```

Inspect the generated `dist/` directory. This command does not tag, push, or
create a GitHub Release.

### Release-candidate rehearsal

A release candidate such as `X.Y.Z-rc.1` follows the complete publishing path
and is marked as a GitHub prerelease. The automated development-version pull
request is deliberately skipped, leaving `main` at the release-candidate
version. Prepare the next release candidate or final `X.Y.Z` release to move
`main` forward.

## Post-release checks

After CI completes:

1. Confirm that the GitHub Release is public and has the expected title,
   release notes, stable/prerelease status, tag, and six assets.
2. Confirm that the server tarball passed the airgap smoke test in the workflow.
3. For a stable release, review and merge the automated next-minor `-dev`
   version pull request. It must include both generated MCP references and the
   synchronized lockfile.
4. Do not expect npm, Marketplace, Open VSX, or MCP Registry publication from
   the current workflow.

## Failure recovery

First determine whether the release tag or a public release exists.

- **Failure before a tag exists:** Fix the problem through a pull request to
  `main`, or rerun the failed workflow after correcting a transient failure.
  A later push with the same clean, untagged version will attempt publishing
  again.
- **Correct tag and draft release exist:** A rerun will skip because the tag
  exists. Inspect the draft and its assets. If they are complete, extract the
  approved notes with `scripts/extract-release-notes.js`, then publish the
  existing draft with the correct title and prerelease status. Record the
  manual recovery in the relevant issue or pull request.
- **Draft or tag is incomplete or incorrect:** Do not delete it without release
  maintainer approval. Before it becomes public, a maintainer may delete the
  draft and tag and rerun the workflow from the release commit.
- **Public release exists:** Treat the release as published. Do not delete or
  rewrite an immutable public release; correct it through a follow-up release.
- **Only the development-version pull request failed:** The release itself is
  complete. Create the same next-minor `-dev` change manually with
  `scripts/set-version.js`, regenerate both MCP references, and open a signed
  pull request to `main`. Do not rerun or republish the release.

## Related files

- [`.github/workflows/release.yml`](.github/workflows/release.yml)
- [`release.config.js`](release.config.js)
- [`scripts/package-release.sh`](scripts/package-release.sh)
- [`scripts/extract-release-notes.js`](scripts/extract-release-notes.js)
- [`scripts/set-version.js`](scripts/set-version.js)
- [`CONTRIBUTING.md`](CONTRIBUTING.md)
