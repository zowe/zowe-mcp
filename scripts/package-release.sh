#!/usr/bin/env bash
#
# This program and the accompanying materials are made available under the terms of the
# Eclipse Public License v2.0 which accompanies this distribution, and is available at
# https://www.eclipse.org/legal/epl-v20.html
#
# SPDX-License-Identifier: EPL-2.0
#
# Copyright Contributors to the Zowe Project.
#

#
# Build and package the release assets for the Zowe MCP VS Code extension
# and MCP server:
#   - VSIX (dist/zowe-mcp-vscode-<VERSION>.vsix)
#   - npm pack of @zowe/mcp-server (dist/zowe-mcp-server-<VERSION>.tgz)
#   - docs/mcp-reference.md
#   - presentations/zowe-mcp/zowe-mcp-slides.pdf
#
# Invoked by CI as the Octorelease exec plugin's publish command (see
# release.config.js and .github/workflows/release.yml — `npm run
# ci:package-release`). Tagging, pushing, and creating the GitHub Release are
# CI's job now (Octorelease's github plugin); this script only builds and
# collects assets into dist/. Also usable locally for dry runs.
#
# Usage:
#   ./scripts/package-release.sh
#
# Uses the version from packages/zowe-mcp-vscode/package.json.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION=$(node -p "require('./packages/zowe-mcp-vscode/package.json').version")

# Sync version in all package.json so VSIX and builds use the same version
node scripts/set-version.js "$VERSION"

echo "Building and packaging release assets for version: $VERSION"

# Build all (server + extension)
npm run build

# Package VSIX (writes to packages/zowe-mcp-vscode/*.vsix)
npm run package -w packages/zowe-mcp-vscode

# Use the VSIX that matches the release version (ignore any leftover old .vsix files)
VSIX_DIR="$REPO_ROOT/packages/zowe-mcp-vscode"
VSIX="$VSIX_DIR/zowe-mcp-vscode-${VERSION}.vsix"

if [ ! -f "$VSIX" ]; then
  echo "Error: Expected VSIX not found: $VSIX" >&2
  exit 1
fi

echo "VSIX: $VSIX"

# npm pack @zowe/mcp-server (prepack/postpack bundle production deps; same output as npm run pack:server)
npm pack -w @zowe/mcp-server --pack-destination "$REPO_ROOT"
SERVER_TGZ="$REPO_ROOT/zowe-mcp-server-${VERSION}.tgz"
if [ ! -f "$SERVER_TGZ" ]; then
  echo "Error: Expected server tarball not found: $SERVER_TGZ" >&2
  exit 1
fi
echo "Server npm pack: $SERVER_TGZ"

# Airgap install smoke test against the tarball just packed (existing-tarball
# variant of test:airgap — it locates zowe-mcp-server-*.tgz at the repo root).
npm run test:airgap

MCP_REFERENCE="$REPO_ROOT/docs/mcp-reference.md"
SLIDES_PDF="$REPO_ROOT/presentations/zowe-mcp/zowe-mcp-slides.pdf"
for f in "$MCP_REFERENCE" "$SLIDES_PDF"; do
  if [ ! -f "$f" ]; then
    echo "Error: Release asset missing: $f" >&2
    echo "Regenerate docs (npm run generate-docs) and slides (presentations/zowe-mcp: npm run export) before releasing." >&2
    exit 1
  fi
done
echo "Docs: $MCP_REFERENCE"
echo "Slides: $SLIDES_PDF"

# Collect the final artifacts into dist/ at the repo root, wiping stale
# contents first so a re-run never leaves an old version's files behind.
DIST_DIR="$REPO_ROOT/dist"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
cp "$VSIX" "$DIST_DIR/"
cp "$SERVER_TGZ" "$DIST_DIR/"
rm -f "$SERVER_TGZ"

# Archive the zowex SDK build this release was compiled against, plus a provenance record.
# Upstream nightly snapshots are pruned after ~6 weeks, so without this a released version's
# exact SDK becomes unobtainable.
node "$REPO_ROOT/scripts/archive-zowex-sdk.js" "$DIST_DIR"

echo "Release assets collected in $DIST_DIR:"
ls -la "$DIST_DIR"
