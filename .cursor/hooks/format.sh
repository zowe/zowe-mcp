#!/bin/bash

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
