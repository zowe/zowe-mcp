#!/usr/bin/env bash
# Keycloak native HTTPS (TLS inside Keycloak JVM) + nginx TLS for MCP only.
# Public URLs (defaults):
#   MCP:  https://zowe.mcp.example.com:7542  (nginx TLS → Node HTTP on ZOWE_MCP_HTTP_BACKEND_PORT, default 7543)
#   IdP:  https://keycloak.mcp.example.com:18443  (JWT issuer / JWKS; Keycloak HTTPS on host port ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT)
#
# Keycloak HTTPS is served by the Keycloak JVM (merged compose), not by a second nginx in front of Keycloak.
#
# Prereqs:
#   1. /etc/hosts — 127.0.0.1 zowe.mcp.example.com keycloak.mcp.example.com
#   2. mkcert — cert SANs must include BOTH hostnames (see docker/remote-https-dev/certs/README.md)
#
# Usage: npm run start:remote-https-dev-native-zos [-- --system USER@host]
#
# Env (optional): ZOWE_MCP_HTTPS_HOST, ZOWE_MCP_MCP_TLS_PORT, ZOWE_MCP_HTTP_BACKEND_PORT,
#   ZOWE_MCP_KEYCLOAK_HTTPS_HOST, ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT, KEYCLOAK_HOST_PORT, ZOWE_MCP_TLS_CERT_DIR
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HTTPS_HOST="${ZOWE_MCP_HTTPS_HOST:-zowe.mcp.example.com}"
KC_HTTPS_HOST="${ZOWE_MCP_KEYCLOAK_HTTPS_HOST:-keycloak.mcp.example.com}"
CERT_DIR="${ZOWE_MCP_TLS_CERT_DIR:-${ROOT}/docker/remote-https-dev/certs}"
export ZOWE_MCP_TLS_CERT_DIR="$(cd "$CERT_DIR" && pwd)"

MCP_TLS_PORT="${ZOWE_MCP_MCP_TLS_PORT:-7542}"
HTTP_BACKEND_PORT="${ZOWE_MCP_HTTP_BACKEND_PORT:-7543}"
KC_HTTPS_BIND_PORT="${ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT:-18443}"

KC_REALM="${ZOWE_MCP_KEYCLOAK_REALM:-demo}"
export ZOWE_MCP_KEYCLOAK_REALM="$KC_REALM"
export ZOWE_MCP_KEYCLOAK_CLIENT="${ZOWE_MCP_KEYCLOAK_CLIENT:-demo}"

if [ "$MCP_TLS_PORT" = "$HTTP_BACKEND_PORT" ]; then
  echo "Port conflict: ZOWE_MCP_MCP_TLS_PORT (${MCP_TLS_PORT}) cannot equal ZOWE_MCP_HTTP_BACKEND_PORT (nginx and Node cannot share the same port)." >&2
  exit 1
fi

if [ "$KC_HTTPS_BIND_PORT" = "$HTTP_BACKEND_PORT" ] || [ "$KC_HTTPS_BIND_PORT" = "$MCP_TLS_PORT" ]; then
  echo "Port conflict: ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT (${KC_HTTPS_BIND_PORT}) must differ from MCP TLS (${MCP_TLS_PORT}) and Node backend (${HTTP_BACKEND_PORT})." >&2
  exit 1
fi

# Public Keycloak HTTPS base (issuer / JWKS). Omit :443 only when using default HTTPS port.
if [ "$KC_HTTPS_BIND_PORT" = "443" ]; then
  KC_BASE_HTTPS="https://${KC_HTTPS_HOST}"
  export KC_HOSTNAME="https://${KC_HTTPS_HOST}"
else
  KC_BASE_HTTPS="https://${KC_HTTPS_HOST}:${KC_HTTPS_BIND_PORT}"
  export KC_HOSTNAME="https://${KC_HTTPS_HOST}:${KC_HTTPS_BIND_PORT}"
fi

export ZOWE_MCP_HTTPS_HOST="$HTTPS_HOST"
export ZOWE_MCP_KEYCLOAK_HTTPS_HOST="$KC_HTTPS_HOST"
export ZOWE_MCP_MCP_TLS_PORT="$MCP_TLS_PORT"
export ZOWE_MCP_HTTP_BACKEND_PORT="$HTTP_BACKEND_PORT"
export ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT="$KC_HTTPS_BIND_PORT"

CERT_PEM="${ZOWE_MCP_TLS_CERT_DIR}/cert.pem"
KEY_PEM="${ZOWE_MCP_TLS_CERT_DIR}/key.pem"

if [ ! -f "$CERT_PEM" ] || [ ! -f "$KEY_PEM" ]; then
  echo "Missing TLS files: expected" >&2
  echo "  $CERT_PEM" >&2
  echo "  $KEY_PEM" >&2
  echo "Generate with mkcert (see docker/remote-https-dev/certs/README.md) — include ${HTTPS_HOST} and ${KC_HTTPS_HOST} in SANs." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found; install it to verify certificate SANs, or skip by fixing cert.pem manually." >&2
  exit 1
fi
CERT_TEXT=$(openssl x509 -in "$CERT_PEM" -noout -text 2>/dev/null) || {
  echo "Could not parse $CERT_PEM (openssl x509 failed)." >&2
  exit 1
}
for h in "$HTTPS_HOST" "$KC_HTTPS_HOST"; do
  if ! echo "$CERT_TEXT" | grep -q "DNS:${h}"; then
    echo "TLS certificate does not list DNS:${h} in Subject Alternative Name (SAN)." >&2
    echo "See docker/remote-https-dev/certs/README.md" >&2
    exit 1
  fi
done

# Keycloak image runs as uid 1000 (user keycloak). Bind mounts keep host ownership/mode; a mode-600
# key.pem owned by your macOS uid is often not readable inside the container, so HTTPS never binds
# to :8443 and curl reports "Couldn't connect to server" on the host HTTPS port.
if command -v docker >/dev/null 2>&1; then
  if ! docker run --rm \
    -v "${KEY_PEM}:/opt/keycloak/conf/mkcert-key.pem:ro" \
    --entrypoint cat \
    quay.io/keycloak/keycloak:latest \
    /opt/keycloak/conf/mkcert-key.pem >/dev/null 2>&1; then
    echo "Error: Keycloak container (uid 1000) cannot read ${KEY_PEM}." >&2
    echo "Bind mounts preserve file mode; for local dev only: chmod a+r ${KEY_PEM} ${CERT_PEM}" >&2
    echo "Then recreate Keycloak: docker compose -f docker/remote-dev/docker-compose.yml -f docker/remote-https-dev/docker-compose.keycloak-native-tls.yml up -d --force-recreate keycloak" >&2
    exit 1
  fi
  if ! docker run --rm \
    -v "${CERT_PEM}:/opt/keycloak/conf/mkcert.pem:ro" \
    --entrypoint cat \
    quay.io/keycloak/keycloak:latest \
    /opt/keycloak/conf/mkcert.pem >/dev/null 2>&1; then
    echo "Error: Keycloak container cannot read ${CERT_PEM}. chmod a+r ${CERT_PEM}" >&2
    exit 1
  fi
fi

MKCERT_ROOT=""
if command -v mkcert >/dev/null 2>&1; then
  CAROOT="$(mkcert -CAROOT 2>/dev/null || true)"
  if [ -n "${CAROOT}" ] && [ -f "${CAROOT}/rootCA.pem" ]; then
    MKCERT_ROOT="${CAROOT}/rootCA.pem"
    export NODE_EXTRA_CA_CERTS="${MKCERT_ROOT}"
  fi
fi

COMPOSE_REMOTE_DEV="${ROOT}/docker/remote-dev/docker-compose.yml"
COMPOSE_KC_NATIVE="${ROOT}/docker/remote-https-dev/docker-compose.keycloak-native-tls.yml"
COMPOSE_MCP_NGINX="${ROOT}/docker/remote-https-dev/docker-compose.yml"

# Compose v2 interactive progress can corrupt lines in npm/script logs (e.g. "[+] 1/1t 1/11"); plain is readable.
export COMPOSE_PROGRESS="${COMPOSE_PROGRESS:-plain}"

KC_HOST_PORT="${KEYCLOAK_HOST_PORT:-18080}"
export KEYCLOAK_HOST_PORT="$KC_HOST_PORT"
KC_BASE_DIRECT="http://localhost:${KC_HOST_PORT}"

cleanup_mcp_nginx() {
  docker compose -f "$COMPOSE_MCP_NGINX" down --remove-orphans 2>/dev/null || true
}
trap cleanup_mcp_nginx EXIT INT TERM

echo "Starting Keycloak with native HTTPS (two compose files required):"
echo "  -f ${COMPOSE_REMOTE_DEV#"$ROOT"/}"
echo "  -f ${COMPOSE_KC_NATIVE#"$ROOT"/}"
docker compose -f "$COMPOSE_REMOTE_DEV" -f "$COMPOSE_KC_NATIVE" up -d keycloak

# Wait for Compose/Docker to register :8443 — an immediate `docker compose port keycloak 8443` can fail
# briefly and would wrongly trigger --force-recreate even when the merged compose already mapped both ports.
PUBLISH_HTTPS=""
for _try in $(seq 1 30); do
  PUBLISH_HTTPS=$(docker compose -f "$COMPOSE_REMOTE_DEV" -f "$COMPOSE_KC_NATIVE" port keycloak 8443 2>/dev/null || true)
  [ -n "$PUBLISH_HTTPS" ] && break
  sleep 1
done

# Published ports are fixed at container create time. `up -d` alone does not add :8443 to an existing
# container that was started with only docker/remote-dev/docker-compose.yml (HTTP-only).
if [ -z "$PUBLISH_HTTPS" ]; then
  echo "Keycloak still has no host mapping for container port 8443 after 30s (stale HTTP-only container). Recreating with merged compose..."
  docker compose -f "$COMPOSE_REMOTE_DEV" -f "$COMPOSE_KC_NATIVE" up -d --force-recreate keycloak
  PUBLISH_HTTPS=""
  for _try in $(seq 1 30); do
    PUBLISH_HTTPS=$(docker compose -f "$COMPOSE_REMOTE_DEV" -f "$COMPOSE_KC_NATIVE" port keycloak 8443 2>/dev/null || true)
    [ -n "$PUBLISH_HTTPS" ] && break
    sleep 1
  done
fi
if [ -z "$PUBLISH_HTTPS" ]; then
  echo "Error: keycloak does not publish port 8443. Check ${COMPOSE_KC_NATIVE##*/} and PEM mounts." >&2
  exit 1
fi
echo "Keycloak HTTPS mapped: ${PUBLISH_HTTPS} (host → container :8443)"

echo "Running Keycloak realm bootstrap..."
# Must use the same -f merge as `up`; `run` with only docker-compose.yml recreates keycloak from the base file (HTTP-only — loses :8443).
docker compose -f "$COMPOSE_REMOTE_DEV" -f "$COMPOSE_KC_NATIVE" run --rm -T keycloak-init

DISCOVERY_DIRECT="${KC_BASE_DIRECT}/realms/${KC_REALM}/.well-known/openid-configuration"
echo "Waiting for OIDC discovery (${KC_REALM} realm) at ${KC_BASE_DIRECT}..."
READY=0
LAST_CODE=""
for i in $(seq 1 60); do
  LAST_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 "$DISCOVERY_DIRECT" 2>/dev/null || true)
  [ -n "$LAST_CODE" ] || LAST_CODE="000"
  if [ "$LAST_CODE" = "200" ]; then
    READY=1
    break
  fi
  if [ $((i % 5)) -eq 0 ]; then
    echo "  ... still waiting (HTTP ${LAST_CODE}, attempt ${i}/60) — is Keycloak healthy? docker compose -f docker/remote-dev/docker-compose.yml ps"
  fi
  sleep 2
done
if [ "$READY" != "1" ]; then
  echo "Realm ${KC_REALM} OIDC discovery did not return HTTP 200 (last: ${LAST_CODE})." >&2
  exit 1
fi

echo "Starting nginx TLS (MCP only) — ${COMPOSE_MCP_NGINX##*/}..."
docker compose -f "$COMPOSE_MCP_NGINX" up -d
sleep 2

if ! docker compose -f "$COMPOSE_MCP_NGINX" ps --status running --format '{{.Name}}' | grep -q .; then
  echo "nginx TLS container is not running. Recent logs:" >&2
  docker compose -f "$COMPOSE_MCP_NGINX" ps -a >&2
  docker compose -f "$COMPOSE_MCP_NGINX" logs --tail 80 >&2 || true
  exit 1
fi

DISCOVERY_HTTPS="${KC_BASE_HTTPS}/realms/${KC_REALM}/.well-known/openid-configuration"
echo "Waiting for OIDC discovery via Keycloak native HTTPS (${KC_BASE_HTTPS})..."
if [ -n "${MKCERT_ROOT}" ]; then
  CURL_HTTPS=(curl -4 -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --cacert "${MKCERT_ROOT}"
    --resolve "${KC_HTTPS_HOST}:${KC_HTTPS_BIND_PORT}:127.0.0.1")
else
  echo "Warning: mkcert CAROOT not found — using curl -k for HTTPS wait only. Install mkcert and run mkcert -install; set NODE_EXTRA_CA_CERTS for Node JWKS." >&2
  CURL_HTTPS=(curl -4 -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 -k
    --resolve "${KC_HTTPS_HOST}:${KC_HTTPS_BIND_PORT}:127.0.0.1")
fi
READY_H=0
LAST_H=""
for i in $(seq 1 60); do
  LAST_H=$("${CURL_HTTPS[@]}" "$DISCOVERY_HTTPS" 2>/dev/null || true)
  [ -n "$LAST_H" ] || LAST_H="000"
  if [ "$LAST_H" = "200" ]; then
    READY_H=1
    break
  fi
  if [ $((i % 5)) -eq 0 ]; then
    echo "  ... still waiting (HTTP ${LAST_H}, attempt ${i}/60) — Keycloak HTTPS on host :${KC_HTTPS_BIND_PORT} → container :8443; docker compose -f docker/remote-dev/docker-compose.yml -f docker/remote-https-dev/docker-compose.keycloak-native-tls.yml logs keycloak"
  fi
  sleep 2
done
if [ "$READY_H" != "1" ]; then
  echo "HTTPS OIDC discovery did not return HTTP 200 (last: ${LAST_H})." >&2
  echo "HTTP 000 usually means nothing accepted the connection (Keycloak not listening on :8443 inside the container, or TLS failed before HTTP). Check Keycloak logs for HTTPS / certificate errors." >&2
  echo "Check: lsof -iTCP:${KC_HTTPS_BIND_PORT} -sTCP:LISTEN" >&2
  docker compose -f "$COMPOSE_REMOTE_DEV" -f "$COMPOSE_KC_NATIVE" logs --tail 80 keycloak >&2 || true
  if [ -n "${MKCERT_ROOT}" ]; then
    curl -4 -v --max-time 10 --cacert "${MKCERT_ROOT}" --resolve "${KC_HTTPS_HOST}:${KC_HTTPS_BIND_PORT}:127.0.0.1" "$DISCOVERY_HTTPS" 2>&1 | tail -n 35 >&2 || true
  else
    curl -4 -v --max-time 10 -k --resolve "${KC_HTTPS_HOST}:${KC_HTTPS_BIND_PORT}:127.0.0.1" "$DISCOVERY_HTTPS" 2>&1 | tail -n 35 >&2 || true
  fi
  exit 1
fi

PUBLIC_BASE="https://${HTTPS_HOST}:${MCP_TLS_PORT}"
export ZOWE_MCP_PUBLIC_BASE_URL="${ZOWE_MCP_PUBLIC_BASE_URL:-$PUBLIC_BASE}"
echo "Updating Keycloak OAuth client ${ZOWE_MCP_KEYCLOAK_CLIENT} (redirect URIs + web origins; includes ZOWE_MCP_PUBLIC_BASE_URL for HTTPS MCP)..."
node "${ROOT}/scripts/patch-keycloak-mcp-dev-redirects.mjs" || {
  echo "Warning: could not patch Keycloak client ${ZOWE_MCP_KEYCLOAK_CLIENT} (OAuth redirects may need manual setup). See docs/remote-dev-keycloak.md#browser-oidc-and-redirect-uris" >&2
}

export ZOWE_MCP_JWT_ISSUER="${ZOWE_MCP_JWT_ISSUER:-${KC_BASE_HTTPS}/realms/${KC_REALM}}"
export ZOWE_MCP_JWKS_URI="${ZOWE_MCP_JWKS_URI:-${KC_BASE_HTTPS}/realms/${KC_REALM}/protocol/openid-connect/certs}"

TENANT_DIR="${ZOWE_MCP_TENANT_STORE_DIR:-${ROOT}/.zowe-mcp-tenant-store}"
export ZOWE_MCP_TENANT_STORE_DIR="$TENANT_DIR"
mkdir -p "$TENANT_DIR"

export ZOWE_MCP_OAUTH_RESOURCE="${ZOWE_MCP_OAUTH_RESOURCE:-${PUBLIC_BASE}/mcp}"

echo ""
echo "Using tenant store: $TENANT_DIR"
echo "HTTPS MCP URL: $PUBLIC_BASE (nginx → http://127.0.0.1:${HTTP_BACKEND_PORT})"
echo "HTTPS IdP URL (native TLS): $KC_BASE_HTTPS (JWT issuer / JWKS)"
echo "NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS:-<unset — JWKS fetch may fail; install mkcert>}"
echo "ZOWE_MCP_JWT_ISSUER=$ZOWE_MCP_JWT_ISSUER"
echo "ZOWE_MCP_JWKS_URI=$ZOWE_MCP_JWKS_URI"
echo "ZOWE_MCP_PUBLIC_BASE_URL=$ZOWE_MCP_PUBLIC_BASE_URL"
echo "ZOWE_MCP_OAUTH_RESOURCE=$ZOWE_MCP_OAUTH_RESOURCE"

echo "Building server packages..."
npm run build -w zowe-mcp-common -w @zowe/mcp-server

echo "Starting Zowe MCP HTTP on http://127.0.0.1:${HTTP_BACKEND_PORT}/mcp — Bearer from ${KC_BASE_HTTPS} (Ctrl+C stops MCP and nginx ${COMPOSE_MCP_NGINX##*/})..."
echo "Extra args: $*"
node packages/zowe-mcp-server/dist/index.js --http --port "$HTTP_BACKEND_PORT" --native "$@"
