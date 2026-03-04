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
# - TypeScript files: license header enforced via ESLint, then formatted with Prettier
# - JavaScript/JSON files: formatted with Prettier
# - Markdown files: formatted with markdownlint-cli2

# Read JSON input from stdin
input=$(cat)

# Extract the file path from the JSON input
file_path=$(echo "$input" | jq -r '.file_path // empty')

if [ -z "$file_path" ]; then
  exit 0
fi

# Format based on file type
case "$file_path" in
  *.ts|*.mts)
    # Enforce license header via ESLint, then format with Prettier
    npx eslint --fix "$file_path" > /dev/null 2>&1
    npx prettier --write "$file_path" > /dev/null 2>&1
    ;;
  *.js|*.mjs|*.json|*.jsonc)
    # Run prettier on the file, suppressing output
    npx prettier --write "$file_path" > /dev/null 2>&1
    ;;
  *.md)
    # Run markdownlint with auto-fix on the file, suppressing output
    npx markdownlint-cli2 --fix "$file_path" > /dev/null 2>&1
    ;;
esac

exit 0
