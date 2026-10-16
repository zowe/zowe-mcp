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
# Build the Zowe MCP Slidev deck to a PDF:
#   presentations/zowe-mcp/zowe-mcp-slides.pdf
#
# The single build path used both by CI (.github/workflows/ci.yml `slides` job)
# and by scripts/package-release.sh when packaging a release. The PDF used to be
# a committed binary that the releaser exported locally before every release;
# that export requires Playwright to download a Chromium build, which 403s off
# the corporate VPN because it is pulled through a Broadcom Artifactory mirror.
# Building it in CI (which has network access to the mirror) removes that
# dependency on the releaser's network. (zowe-mcp#66, finding 4)
#
# Usage:
#   ./scripts/build-slides.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLIDES_DIR="$REPO_ROOT/presentations/zowe-mcp"
OUTPUT_PDF="$SLIDES_DIR/zowe-mcp-slides.pdf"

cd "$SLIDES_DIR"

echo "Installing Slidev deck dependencies ($SLIDES_DIR)..."
# This package has its own package.json/package-lock.json, separate from the
# root workspace. Do NOT pass --ignore-scripts: the playwright-chromium
# postinstall is what downloads the browser `slidev export` needs below.
npm ci

echo "Exporting slides to PDF..."
npm run export

# `slidev export` with no --output writes <entry-basename>-export.pdf next to
# the entry file — for entry slides.md that is slides-export.pdf (see the
# now-stale presentations/zowe-mcp/slides-export.pdf entry in .gitignore, kept
# as a safety net for local exports that don't hit this rename). Handle both
# names so this script keeps working if a future Slidev version changes the
# default, or if a local run already produced the file under its final name.
if [ ! -f "$OUTPUT_PDF" ] && [ -f "$SLIDES_DIR/slides-export.pdf" ]; then
  mv "$SLIDES_DIR/slides-export.pdf" "$OUTPUT_PDF"
fi

if [ ! -f "$OUTPUT_PDF" ]; then
  echo "Error: Slidev export did not produce $OUTPUT_PDF" >&2
  echo "Looked for presentations/zowe-mcp/{zowe-mcp-slides.pdf,slides-export.pdf}." >&2
  exit 1
fi

echo "Slides: $OUTPUT_PDF"
