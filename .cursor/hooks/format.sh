#!/bin/bash
#
# This program and the accompanying materials are made available under the terms of the
# Eclipse Public License v2.0 which accompanies this distribution, and is available at
# https://www.eclipse.org/legal/epl-v20.html
#
# SPDX-License-Identifier: EPL-2.0
#
# Copyright Contributors to the Zowe Project.
#

# Cursor hook: Auto-format files after edits
# Runs after both Agent and Tab file edits
#
# Input (JSON via stdin):
#   { "file_path": "<absolute path>", "edits": [...] }
#
# - TypeScript (.ts, .mts): ESLint --fix (license header), then Prettier
# - Prettier: .js, .mjs, .cjs, .json, .jsonc, .yaml, .yml, .css, .html
# - Markdown (.md): markdownlint-cli2 --fix
# - Shell (.sh, .bash): shfmt via scripts/shfmt-write.mjs (@wasm-fmt/shfmt)

# Read JSON input from stdin
input=$(cat)

# Extract the file path from the JSON input
file_path=$(echo "$input" | jq -r '.file_path // empty')

if [ -z "$file_path" ]; then
  exit 0
fi

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"

# Format based on file type (keep aligned with root `format` / `check-format` + `shfmt-write.mjs`)
case "$file_path" in
*.ts | *.mts)
  # Enforce license header via ESLint, then format with Prettier
  npx eslint --fix "$file_path" > /dev/null 2>&1
  npx prettier --write "$file_path" > /dev/null 2>&1
  ;;
*.js | *.mjs | *.cjs | *.json | *.jsonc | *.yaml | *.yml | *.css | *.html)
  npx prettier --write "$file_path" > /dev/null 2>&1
  ;;
*.md)
  npx markdownlint-cli2 --fix "$file_path" > /dev/null 2>&1
  ;;
*.sh | *.bash)
  node "$REPO_ROOT/scripts/shfmt-write.mjs" "$file_path" > /dev/null 2>&1
  ;;
esac

exit 0
