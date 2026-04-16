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

# Cursor hook: Check for code duplication after edits
# Runs after Agent file edits (not Tab edits — too noisy)
#
# Input (JSON via stdin):
#   { "file_path": "<absolute path>", "edits": [...] }
#
# Runs jscpd on the edited file to detect duplication introduced by the edit.
# Advisory only — always exits 0.

input=$(cat)

file_path=$(echo "$input" | jq -r '.file_path // empty')

if [ -z "$file_path" ]; then
  exit 0
fi

# Only check TypeScript files under packages/
case "$file_path" in
*/packages/*.ts)
  ;;
*)
  exit 0
  ;;
esac

# Run jscpd on the specific file — output goes to the agent as advisory info
npx jscpd "$file_path" --silent --reporters console 2> /dev/null

exit 0
