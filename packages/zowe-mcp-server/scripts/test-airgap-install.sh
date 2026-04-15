#!/usr/bin/env bash
#
# Test that the packed tarball can be installed in an airgapped/offline environment.
# Uses an empty cache and invalid registry to simulate no network access.
#
# Usage:
#   npm run test:airgap              # Use existing tarball
#   npm run test:airgap:build       # Build and pack before testing
#   npm run test:airgap:build:native # Build, pack, offline install, then native z/OS smoke

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SERVER_DIR/../.." && pwd)"

BUILD_AND_PACK=false
NATIVE_SMOKE=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD_AND_PACK=true ;;
    --native) NATIVE_SMOKE=true ;;
  esac
done

# Build and pack if requested
if [ "$BUILD_AND_PACK" = true ]; then
  echo "Building and packing server..."
  echo ""
  cd "$REPO_ROOT"
  npm run build -w zowe-mcp-common
  npm run pack:server
  echo ""
fi

# Find the tarball (created by npm run pack:server at repo root)
TARBALL=$(find "$REPO_ROOT" -maxdepth 1 -name "zowe-mcp-server-*.tgz" | head -1)

if [ -z "$TARBALL" ]; then
  echo "Error: No zowe-mcp-server-*.tgz found in repo root."
  echo "Run 'npm run pack:server' first, or use 'npm run test:airgap:build'"
  exit 1
fi

echo "Testing airgapped install with tarball: $TARBALL"
echo ""

# Create temporary test directory
TEST_DIR=$(mktemp -d)
trap "rm -rf '$TEST_DIR'" EXIT

cd "$TEST_DIR"
mkdir test-install
cd test-install

echo "Installing with:"
echo "  - Empty cache: --cache /tmp/no-cache"
echo "  - Invalid registry: --registry http://localhost"
echo "  - Timeout: 5ms (--fetch-timeout 5) - fails fast if network is accessed"
echo "  - Verbose logging: --loglevel verbose"
echo ""

# Create empty cache directory
mkdir -p /tmp/no-cache

# Install with empty cache and invalid registry
if npm install \
  --cache /tmp/no-cache \
  --registry http://localhost \
  --fetch-timeout 5 \
  --loglevel verbose \
  "$TARBALL" 2>&1; then
  echo ""
  echo "SUCCESS: Installation completed in airgapped mode!"
  echo ""
  echo "Verifying installation..."
  if [ -d "node_modules/@zowe/mcp-server" ]; then
    echo "  Package installed: node_modules/@zowe/mcp-server"
  fi
  if [ -d "node_modules/zowe-mcp-common" ]; then
    echo "  Bundled dependency installed: node_modules/zowe-mcp-common"
  fi
  if [ -d "node_modules/zowex-sdk" ]; then
    echo "  Bundled dependency installed: node_modules/zowex-sdk"
  fi
  echo ""
  echo "Testing binary..."
  BIN_PATH="node_modules/.bin/zowe-mcp-server"
  if [ ! -f "$BIN_PATH" ]; then
    echo "FAILED: Binary not found: $BIN_PATH"
    echo "  Looking for binaries in node_modules/.bin/:"
    ls -la node_modules/.bin/ 2>/dev/null || echo "    (directory does not exist)"
    exit 1
  fi
  
  echo "  Running: $BIN_PATH --version"
  OUTPUT=$("$BIN_PATH" --version 2>&1) || {
    EXIT_CODE=$?
    echo "FAILED: Binary test failed (exit code: $EXIT_CODE)"
    echo "  Output:"
    echo "$OUTPUT" | sed 's/^/    /'
    echo ""
    echo "  Binary file details:"
    echo "    Path: $BIN_PATH"
    echo "    Exists: $([ -f "$BIN_PATH" ] && echo "yes" || echo "no")"
    if [ -f "$BIN_PATH" ]; then
      echo "    Size: $(stat -f%z "$BIN_PATH" 2>/dev/null || stat -c%s "$BIN_PATH" 2>/dev/null || echo "unknown") bytes"
      echo "    First line: $(head -1 "$BIN_PATH" 2>/dev/null || echo "cannot read")"
      if command -v node >/dev/null 2>&1; then
        echo "    Testing with node directly:"
        NODE_OUTPUT=$(node "$BIN_PATH" --version 2>&1) || NODE_EXIT=$?
        echo "$NODE_OUTPUT" | sed 's/^/      /'
        if [ -n "${NODE_EXIT:-}" ]; then
          echo "      (exit code: $NODE_EXIT)"
        fi
      fi
    fi
    exit 1
  }
  echo "  Binary works: $OUTPUT"
else
  echo ""
  echo "FAILED: Installation failed in airgapped mode"
  echo "The packed tarball does not contain all required dependencies."
  exit 1
fi

echo ""
echo "Offline airgap test passed."

# ---------------------------------------------------------------------------
# Optional native z/OS smoke test
# ---------------------------------------------------------------------------

if [ "$NATIVE_SMOKE" = false ]; then
  exit 0
fi

echo ""
echo "=== Native z/OS smoke test ==="
echo ""

NATIVE_CONFIG="$REPO_ROOT/native-config.json"
ENV_FILE="$REPO_ROOT/.env"

if [ ! -f "$NATIVE_CONFIG" ]; then
  echo "SKIP: $NATIVE_CONFIG not found (copy from native-config.example.json)"
  exit 0
fi

# Source .env for ZOWE_MCP_PASSWORD_* variables
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "Loaded credentials from $ENV_FILE"
fi

# Read the first system from native-config.json to check for password
FIRST_SYSTEM=$(node -e "
  const c = require('$NATIVE_CONFIG');
  if (Array.isArray(c.systems) && c.systems.length > 0) {
    console.log(c.systems[0]);
  }
" 2>/dev/null || true)

if [ -z "$FIRST_SYSTEM" ]; then
  echo "SKIP: No systems configured in $NATIVE_CONFIG"
  exit 0
fi

# Derive the password env var name (USER_HOST with dots → underscores, uppercase)
USER_PART=$(echo "$FIRST_SYSTEM" | cut -d@ -f1 | tr '[:lower:]' '[:upper:]')
HOST_PART=$(echo "$FIRST_SYSTEM" | cut -d@ -f2 | tr '.' '_' | tr ':' '_' | tr '[:lower:]' '[:upper:]')
PASSWORD_VAR="ZOWE_MCP_PASSWORD_${USER_PART}_${HOST_PART}"

PASSWORD_VALUE="${!PASSWORD_VAR:-${ZOS_PASSWORD:-}}"
if [ -z "$PASSWORD_VALUE" ]; then
  echo "SKIP: No password found (set $PASSWORD_VAR or ZOS_PASSWORD in .env)"
  exit 0
fi

echo "System: $FIRST_SYSTEM"
echo "Running: call-tool --native --config ... getContext"
echo ""

ENTRY_POINT="node_modules/@zowe/mcp-server/dist/index.js"
if [ ! -f "$ENTRY_POINT" ]; then
  echo "FAILED: Installed entry point not found: $ENTRY_POINT"
  exit 1
fi

TOOL_OUTPUT=$(node "$ENTRY_POINT" call-tool --native --config="$NATIVE_CONFIG" getContext 2>&1) || {
  EXIT_CODE=$?
  echo "FAILED: call-tool getContext failed (exit code: $EXIT_CODE)"
  echo "Output:"
  echo "$TOOL_OUTPUT" | sed 's/^/  /'
  exit 1
}

echo "$TOOL_OUTPUT" | sed 's/^/  /'

# Basic sanity: output should contain "native" (the backend type)
if echo "$TOOL_OUTPUT" | grep -qi "native"; then
  echo ""
  echo "Native z/OS smoke test passed."
else
  echo ""
  echo "WARNING: Output did not contain 'native' — review output above."
  exit 1
fi
