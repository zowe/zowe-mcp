#!/usr/bin/env bash
# Wipe the local MCP registry (Docker Postgres volume) and republish
# packages/zowe-mcp-server/remote-server-example-dev.json for gallery testing.
#
# Prerequisites: Docker, mcp-publisher (e.g. brew install mcp-publisher), registry default port 8085.
#
# Usage: npm run local-registry:wipe-publish-dev
#
# Env:
#   MCP_LOCAL_REGISTRY_URL — base URL for mcp-publisher login/publish (default http://localhost:8085).
#     Use https://registry.mcp.example.com:8445 if you terminate TLS via nginx; set NODE_EXTRA_CA_CERTS
#     to your mkcert rootCA.pem so Node trusts the leaf.
#   MCP_LOCAL_REGISTRY_READY_URL — HTTP GET .../v0.1/servers wait loop only (default http://localhost:8085).
#     Keep this on plain HTTP to the mapped host port even when publishing via HTTPS — the registry
#     container always listens on 8080; 8085 is the stable readiness check.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE="${ROOT}/infrastructure/local-registry/docker-compose.yml"
REGISTRY_URL="${MCP_LOCAL_REGISTRY_URL:-http://localhost:8085}"
READY_URL="${MCP_LOCAL_REGISTRY_READY_URL:-http://localhost:8085}"
MANIFEST="${ROOT}/packages/zowe-mcp-server/remote-server-example-dev.json"

if ! command -v mcp-publisher > /dev/null 2>&1; then
  echo "mcp-publisher not found. Install: brew install mcp-publisher" >&2
  exit 1
fi

if ! command -v docker > /dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi

docker compose -f "$COMPOSE" down -v
docker compose -f "$COMPOSE" up -d

echo "Waiting for registry at ${READY_URL} ..."
ready=0
for _ in $(seq 1 90); do
  if curl -sf "${READY_URL}/v0.1/servers" > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Registry did not become ready within 90s. Check: docker compose -f infrastructure/local-registry/docker-compose.yml ps" >&2
  exit 1
fi

mcp-publisher login none --registry="$REGISTRY_URL"
mcp-publisher publish "$MANIFEST" --registry="$REGISTRY_URL"
echo "Published ${MANIFEST} to ${REGISTRY_URL}"
