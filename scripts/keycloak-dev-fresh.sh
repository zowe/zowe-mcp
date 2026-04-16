#!/usr/bin/env bash
# Recreate Keycloak (native HTTPS merge) with an empty dev database, then run keycloak-init.
# Same compose files as npm run start:remote-https-dev-native-zos — not the HTTP-only Keycloak stack.
#
# Use after experiments or when DCR clients are stale (LOGIN_ERROR client_not_found) — sign in again after.
#
# Env matches start-remote-https-dev-native-zos.sh defaults: ZOWE_MCP_TLS_CERT_DIR, ZOWE_MCP_KEYCLOAK_HTTPS_*,
# KEYCLOAK_HOST_PORT, ZOWE_MCP_HTTPS_HOST / ZOWE_MCP_MCP_TLS_PORT → ZOWE_MCP_PUBLIC_BASE_URL, realm/client.
# Override KC_HOSTNAME only if you set a non-default public Keycloak URL.
#
# Usage: npm run keycloak:dev-fresh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CERT_DIR="${ZOWE_MCP_TLS_CERT_DIR:-${ROOT}/docker/remote-https-dev/certs}"
export ZOWE_MCP_TLS_CERT_DIR="$(cd "$CERT_DIR" && pwd)"

KC_HTTPS_HOST="${ZOWE_MCP_KEYCLOAK_HTTPS_HOST:-keycloak.mcp.example.com}"
KC_HTTPS_BIND_PORT="${ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT:-18443}"
export KEYCLOAK_HOST_PORT="${KEYCLOAK_HOST_PORT:-18080}"
export ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT="$KC_HTTPS_BIND_PORT"
export ZOWE_MCP_KEYCLOAK_HTTPS_HOST="$KC_HTTPS_HOST"

KC_REALM="${ZOWE_MCP_KEYCLOAK_REALM:-demo}"
export ZOWE_MCP_KEYCLOAK_REALM="$KC_REALM"
export ZOWE_MCP_KEYCLOAK_CLIENT="${ZOWE_MCP_KEYCLOAK_CLIENT:-demo}"

HTTPS_HOST="${ZOWE_MCP_HTTPS_HOST:-zowe.mcp.example.com}"
MCP_TLS_PORT="${ZOWE_MCP_MCP_TLS_PORT:-7542}"
PUBLIC_BASE="https://${HTTPS_HOST}:${MCP_TLS_PORT}"
export ZOWE_MCP_PUBLIC_BASE_URL="${ZOWE_MCP_PUBLIC_BASE_URL:-$PUBLIC_BASE}"

if [ -z "${KC_HOSTNAME:-}" ]; then
  if [ "$KC_HTTPS_BIND_PORT" = "443" ]; then
    export KC_HOSTNAME="https://${KC_HTTPS_HOST}"
  else
    export KC_HOSTNAME="https://${KC_HTTPS_HOST}:${KC_HTTPS_BIND_PORT}"
  fi
fi

REMOTE_DEV="${ROOT}/docker/remote-dev/docker-compose.yml"
KC_TLS="${ROOT}/docker/remote-https-dev/docker-compose.keycloak-native-tls.yml"
COMPOSE=(docker compose -f "$REMOTE_DEV" -f "$KC_TLS")

echo "Recreating Keycloak (KC_HOSTNAME=${KC_HOSTNAME}, TLS certs from ${ZOWE_MCP_TLS_CERT_DIR})..."
"${COMPOSE[@]}" up -d --force-recreate keycloak

echo "Running realm bootstrap (keycloak-init)..."
"${COMPOSE[@]}" run --rm keycloak-init

KC_BASE_DIRECT="http://localhost:${KEYCLOAK_HOST_PORT}"
DISCOVERY_DIRECT="${KC_BASE_DIRECT}/realms/${KC_REALM}/.well-known/openid-configuration"
echo "Waiting for OIDC discovery (${KC_REALM}) at ${KC_BASE_DIRECT}..."
READY=0
LAST_CODE=""
for i in $(seq 1 60); do
  LAST_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 "$DISCOVERY_DIRECT" 2> /dev/null || true)
  [ -n "$LAST_CODE" ] || LAST_CODE="000"
  if [ "$LAST_CODE" = "200" ]; then
    READY=1
    break
  fi
  if [ $((i % 5)) -eq 0 ]; then
    echo "  ... still waiting (HTTP ${LAST_CODE}, attempt ${i}/60)"
  fi
  sleep 2
done
if [ "$READY" != "1" ]; then
  echo "Realm ${KC_REALM} OIDC discovery did not return HTTP 200 (last: ${LAST_CODE})." >&2
  exit 1
fi

echo "Updating Keycloak OAuth client ${ZOWE_MCP_KEYCLOAK_CLIENT} (redirect URIs + web origins; ZOWE_MCP_PUBLIC_BASE_URL=${ZOWE_MCP_PUBLIC_BASE_URL})..."
node "${ROOT}/scripts/patch-keycloak-mcp-dev-redirects.mjs" || {
  echo "Warning: could not patch Keycloak client ${ZOWE_MCP_KEYCLOAK_CLIENT} (OAuth redirects may need manual setup). See docs/remote-dev-keycloak.md#browser-oidc-and-redirect-uris" >&2
}

echo ""
echo "Fresh Keycloak is ready. Previous DCR client IDs are invalid — sign in again in VS Code / MCP Inspector."
echo "Next: npm run start:remote-https-dev-native-zos"
