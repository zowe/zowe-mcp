/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */
/**
 * Octorelease configuration (phase 1 — GitHub Releases only).
 *
 * `@octorelease/exec` builds and packages the release assets (`npm run
 * ci:package-release` — see scripts/package-release.sh) and
 * `@octorelease/github` creates the vX.Y.Z tag + a DRAFT GitHub Release and
 * uploads the assets. The release workflow then sets the human-reviewed
 * notes and flips the draft live in one atomic edit (`publishRelease` stays
 * off so a mid-job failure never leaves a half-configured public release,
 * and so the notes edit precedes GitHub's immutable-release lock-in).
 * No `@octorelease/git` / `@octorelease/changelog` plugins in
 * this phase: those push commits to `main`, which needs an org-level robot
 * token we don't have yet (see docs/release-process.md). Version, changelog
 * rollover, and generated docs are all carried by the release PR itself and
 * reviewed there instead.
 */
module.exports = {
  branches: [{ name: 'main', level: 'minor' }],
  plugins: [
    ['@octorelease/exec', { publishCmd: 'npm run ci:package-release' }],
    [
      '@octorelease/github',
      {
        assets: [
          'dist/*.vsix',
          'dist/*.tgz',
          'docs/mcp-reference.md',
          'presentations/zowe-mcp/zowe-mcp-slides.pdf',
        ],
        publishRelease: false,
      },
    ],
  ],
};
