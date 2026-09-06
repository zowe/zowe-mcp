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

  PKG_DIR="node_modules/@zowe/mcp-server"
  if [ ! -d "$PKG_DIR" ]; then
    echo "FAILED: Package not installed: $PKG_DIR"
    exit 1
  fi
  echo "  Package installed: $PKG_DIR"

  # bundledDependencies (see bundle-for-pack.cjs) keeps the small set of
  # packages esbuild couldn't inline (native bindings, install scripts,
  # __dirname-relative asset loading — see SERVER_EXTERNAL in
  # scripts/esbuild-server-config.cjs) INSIDE the package's own
  # node_modules — nested one level under the consumer's node_modules/, not
  # hoisted to this test dir's top level. These used to be informational-only
  # `if [ -d ... ]` checks that printed nothing (and passed) even if zowex
  # vanished from the tarball entirely — assert and fail instead.
  NESTED_NM="$PKG_DIR/node_modules"

  if [ ! -d "$NESTED_NM/@zowe/zowex-for-zowe-sdk" ]; then
    echo "FAILED: zowex not found at $NESTED_NM/@zowe/zowex-for-zowe-sdk"
    echo "  Contents of $NESTED_NM:"
    ls -la "$NESTED_NM" 2> /dev/null || echo "    (directory does not exist)"
    exit 1
  fi
  echo "  Bundled dependency installed: $NESTED_NM/@zowe/zowex-for-zowe-sdk"

  if [ ! -d "$NESTED_NM/ssh2" ]; then
    echo "FAILED: ssh2 not found at $NESTED_NM/ssh2 — this is the transport the product actually uses"
    exit 1
  fi
  echo "  Bundled dependency installed: $NESTED_NM/ssh2"

  # zowe-mcp-common used to be shipped as a real (if unresolvable against the
  # public registry) npm dependency purely so bundledDependencies would carry
  # it through `npm install`. esbuild now inlines its compiled dist/ straight
  # into the server bundle (see bundle-for-pack.cjs's file-header comment), so
  # it must never appear as a separate installed package again — if it does,
  # the inlining regressed and this install is carrying dead weight (or a
  # stale duplicate copy) back.
  if [ -d "node_modules/zowe-mcp-common" ] || [ -d "$NESTED_NM/zowe-mcp-common" ]; then
    echo "FAILED: zowe-mcp-common found as a separate package — it should be inlined into the bundle now"
    exit 1
  fi
  echo "  Confirmed inlined (not a separate package): zowe-mcp-common"

  # russh (an optionalDependency of zowex: ~33 MB across 7 platform-specific
  # native prebuilds, backing only the SDK's createClient(useNativeSsh) path,
  # which nothing in this repo enables) and cpu-features/nan (ssh2's own
  # optional native accelerator) are deliberately dropped by
  # `npm install --omit=optional` in bundle-for-pack.cjs. Assert they're
  # absent so a future accidental re-inclusion (dropping --omit=optional,
  # zowex un-optional-ing russh, etc.) is caught here instead of silently
  # bloating every install by tens of MB again.
  for pkg in russh cpu-features nan; do
    if [ -d "node_modules/$pkg" ] || [ -d "$NESTED_NM/$pkg" ]; then
      echo "FAILED: $pkg is present — expected it to be dropped by --omit=optional (see bundle-for-pack.cjs)"
      exit 1
    fi
  done
  echo "  Confirmed absent (--omit=optional): russh, cpu-features, nan"

  echo ""
  echo "Testing binary..."
  BIN_PATH="node_modules/.bin/zowe-mcp-server"
  if [ ! -f "$BIN_PATH" ]; then
    echo "FAILED: Binary not found: $BIN_PATH"
    echo "  Looking for binaries in node_modules/.bin/:"
    ls -la node_modules/.bin/ 2> /dev/null || echo "    (directory does not exist)"
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
      echo "    Size: $(stat -f%z "$BIN_PATH" 2> /dev/null || stat -c%s "$BIN_PATH" 2> /dev/null || echo "unknown") bytes"
      echo "    First line: $(head -1 "$BIN_PATH" 2> /dev/null || echo "cannot read")"
      if command -v node > /dev/null 2>&1; then
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

  # --version never loads ssh2 or zowex (it short-circuits before any backend
  # is constructed), so it proves almost nothing about the slimmed-down
  # dependency tree. Supplement it with a real MCP stdio session against the
  # INSTALLED entry point: generate a mock data dir, start the server with
  # --stdio --mock, and drive it over the actual JSON-RPC protocol
  # (initialize, then tools/list), asserting a non-empty tool list. This is
  # dependency-free (a plain node script, no test framework) and fully
  # offline (mock backend, no network).
  echo ""
  echo "Testing real MCP stdio session (init-mock + --stdio --mock)..."

  ENTRY_POINT="$PWD/node_modules/@zowe/mcp-server/dist/index.js"
  MOCK_DATA_DIR="$TEST_DIR/mock-data"

  echo "  Running: node $ENTRY_POINT init-mock --output $MOCK_DATA_DIR --preset minimal"
  INIT_OUTPUT=$(node "$ENTRY_POINT" init-mock --output "$MOCK_DATA_DIR" --preset minimal 2>&1) || {
    EXIT_CODE=$?
    echo "FAILED: init-mock failed (exit code: $EXIT_CODE)"
    echo "$INIT_OUTPUT" | sed 's/^/  /'
    exit 1
  }
  echo "$INIT_OUTPUT" | sed 's/^/  /'

  STDIO_CHECK="$TEST_DIR/mcp-stdio-check.mjs"
  cat > "$STDIO_CHECK" << 'NODE_EOF'
// Drives the installed server binary over real MCP stdio JSON-RPC:
// initialize -> notifications/initialized -> tools/list. Plain Node, no
// dependencies, so it works against an offline-installed package that
// deliberately has no dev/test tooling around it.
import { spawn } from 'node:child_process';

const [, , entryPoint, mockDir] = process.argv;
const child = spawn(process.execPath, [entryPoint, '--stdio', '--mock', mockDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderrBuf = '';
child.stderr.on('data', d => {
  stderrBuf += d.toString();
});

let stdoutBuf = '';
const messages = [];
child.stdout.on('data', d => {
  stdoutBuf += d.toString();
  let idx;
  while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, idx);
    stdoutBuf = stdoutBuf.slice(idx + 1);
    if (line.trim()) {
      try {
        messages.push(JSON.parse(line));
      } catch (err) {
        console.error(`non-JSON line on stdout: ${line}`);
      }
    }
  }
});

function send(msg) {
  child.stdin.write(`${JSON.stringify(msg)}\n`);
}

function waitFor(id, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const msg = messages.find(m => m.id === id);
      if (msg) {
        clearInterval(iv);
        resolve(msg);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`timed out waiting for response id ${id}`));
      }
    }, 50);
  });
}

function fail(message) {
  console.error(`FAILED: ${message}`);
  if (stderrBuf.trim()) {
    console.error('  Server stderr:');
    console.error(
      stderrBuf
        .trim()
        .split('\n')
        .map(l => `    ${l}`)
        .join('\n')
    );
  }
  child.kill();
  process.exit(1);
}

(async () => {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'airgap-install-check', version: '1.0.0' },
    },
  });

  const initResp = await waitFor(1).catch(err => fail(err.message));
  if (initResp.error) {
    fail(`initialize returned an error: ${JSON.stringify(initResp.error)}`);
  }
  console.log(`  initialize OK: ${JSON.stringify(initResp.result?.serverInfo)}`);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  const toolsResp = await waitFor(2).catch(err => fail(err.message));
  if (toolsResp.error) {
    fail(`tools/list returned an error: ${JSON.stringify(toolsResp.error)}`);
  }
  const tools = toolsResp.result?.tools ?? [];
  console.log(`  tools/list returned ${tools.length} tools (e.g. ${tools.slice(0, 3).map(t => t.name).join(', ')})`);

  child.kill();
  if (tools.length === 0) {
    fail('tools/list returned an empty tool list');
  }
  process.exit(0);
})().catch(err => fail(err.stack || String(err)));
NODE_EOF

  if node "$STDIO_CHECK" "$ENTRY_POINT" "$MOCK_DATA_DIR"; then
    echo "  MCP stdio session works: initialize + tools/list succeeded against the installed package."
  else
    echo "FAILED: MCP stdio session against the installed package did not succeed."
    exit 1
  fi
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
" 2> /dev/null || true)

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
