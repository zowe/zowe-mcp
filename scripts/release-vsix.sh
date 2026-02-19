#!/usr/bin/env bash
#
# Build the Zowe MCP VS Code extension and create a GitHub Release with the VSIX.
# Requires: npm, gh (GitHub CLI), and gh auth login.
#
# Usage:
#   ./scripts/release-vsix.sh [TAG]
#
# If TAG is omitted, uses v<VERSION> from packages/zowe-mcp-vscode/package.json
# (e.g. v0.1.0). The tag is created from the current HEAD and pushed; then
# a release is created and the VSIX is uploaded.
#
# Examples:
#   ./scripts/release-vsix.sh           # use version from package.json
#   ./scripts/release-vsix.sh v0.1.0    # explicit tag

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Resolve tag
if [ -n "$1" ]; then
  TAG="$1"
else
  VERSION=$(node -p "require('./packages/zowe-mcp-vscode/package.json').version")
  TAG="v${VERSION}"
fi

echo "Building and packaging extension for tag: $TAG"

# Build all (server + extension)
npm run build

# Package VSIX (writes to packages/zowe-mcp-vscode/*.vsix)
npm run package -w packages/zowe-mcp-vscode

# Find the VSIX (single file)
VSIX_DIR="$REPO_ROOT/packages/zowe-mcp-vscode"
VSIX=$(find "$VSIX_DIR" -maxdepth 1 -name '*.vsix' -print | head -n 1)

if [ -z "$VSIX" ] || [ ! -f "$VSIX" ]; then
  echo "Error: No .vsix found in $VSIX_DIR" >&2
  exit 1
fi

echo "VSIX: $VSIX"

# Create and push tag if it doesn't exist
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Creating tag $TAG from current HEAD..."
  git tag "$TAG"
  echo "Pushing tag $TAG..."
  git push origin "$TAG"
fi

# Create release with VSIX or upload to existing release
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Release $TAG already exists; uploading VSIX..."
  gh release upload "$TAG" "$VSIX" --clobber
else
  echo "Creating GitHub Release and uploading VSIX..."
  gh release create "$TAG" "$VSIX" --generate-notes
fi

echo "Done. Release: $(gh release view "$TAG" --json url -q .url)"
