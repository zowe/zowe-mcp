#!/bin/sh
# SPDX-License-Identifier: EPL-2.0
#
# Idempotent Keycloak bootstrap for local Zowe MCP HTTP + JWT dev.
# Creates realm (default: demo), public client (default: demo), user user/password.
# Enables anonymous OIDC Dynamic Client Registration for localhost (Trusted Hosts policy; dev only).
# Environment: KC_URL (default http://keycloak:8080). Host port for printed URLs: KEYCLOAK_HOST_PORT (default 18080).
# Optional: jq — required for DCR policy update; Docker keycloak-init image includes it (Debian + Dockerfile.keycloak-init).
#
# Admin token: KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD (Keycloak 26+), else KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD, else admin/admin.
# Override: ZOWE_MCP_KEYCLOAK_REALM, ZOWE_MCP_KEYCLOAK_CLIENT, ZOWE_MCP_KEYCLOAK_DEV_USER, ZOWE_MCP_KEYCLOAK_DEV_PASSWORD
# DCR Trusted Hosts: host TCP check off, client URI allowlist on (Keycloak requires at least one check). trusted-hosts lists
# vscode/cursor/dev hosts + 192.168.65.1 (Docker Desktop gateway).

set -eu

REALM="${ZOWE_MCP_KEYCLOAK_REALM:-demo}"
CLIENT_ID="${ZOWE_MCP_KEYCLOAK_CLIENT:-demo}"
DEV_USER="${ZOWE_MCP_KEYCLOAK_DEV_USER:-user}"
DEV_PASSWORD="${ZOWE_MCP_KEYCLOAK_DEV_PASSWORD:-password}"

KC="${KC_URL:-http://keycloak:8080}"
KC="${KC%/}"

echo "Waiting for Keycloak at ${KC}..."
i=0
while [ "$i" -lt 120 ]; do
  if curl -sf "${KC}/health/ready" > /dev/null 2>&1 || curl -sf "${KC}/realms/master" > /dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$i" -ge 120 ]; then
  echo "Keycloak did not become ready in time." >&2
  exit 1
fi

ADMIN_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-${KEYCLOAK_ADMIN:-admin}}"
ADMIN_PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KEYCLOAK_ADMIN_PASSWORD:-admin}}"

echo "Fetching admin token..."
RAW_TOKEN=$(curl -sS -X POST "${KC}/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli \
  -d username="${ADMIN_USER}" \
  -d password="${ADMIN_PASS}" \
  -d grant_type=password)

ADMIN_TOKEN=$(printf '%s' "$RAW_TOKEN" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -z "$ADMIN_TOKEN" ]; then
  echo "Failed to obtain admin token. Response: $RAW_TOKEN" >&2
  exit 1
fi

HDR="Authorization: Bearer ${ADMIN_TOKEN}"

# Master realm: must allow HTTP for password-grant token used by host-side tools (e.g.
# patch-keycloak-mcp-dev-redirects.mjs → http://localhost:<port>/realms/master/...).
# Dev realm ssl alone is not enough; admin-cli uses the master realm token endpoint.
if command -v jq > /dev/null 2>&1; then
  echo "Ensuring master realm sslRequired=none (admin token from host)..."
  CODE=$(curl -sS "${KC}/admin/realms/master" -H "$HDR" | jq 'del(.id) | .sslRequired = "none"' | curl -sS -o /dev/null -w "%{http_code}" -X PUT "${KC}/admin/realms/master" \
    -H "$HDR" -H "Content-Type: application/json" -d @-)
  case "$CODE" in 200 | 204) ;; *)
    echo "Warning: could not set master sslRequired=none (HTTP ${CODE}). Host scripts may fail with HTTPS required on token endpoint." >&2
    ;;
  esac
else
  echo "Warning: jq not found; host-side Keycloak patch may get HTTPS required on master token. Install jq in keycloak-init." >&2
fi

realm_code=$(curl -sS -o /dev/null -w "%{http_code}" "${KC}/admin/realms/${REALM}" -H "$HDR" || printf '%s' "000")
if [ "$realm_code" != "200" ]; then
  echo "Creating realm ${REALM}..."
  # sslRequired=none: local HTTP OAuth (browser auth endpoint); default realm policy otherwise shows "HTTPS required"
  curl -sS -f -X POST "${KC}/admin/realms" \
    -H "$HDR" -H "Content-Type: application/json" \
    -d "{\"realm\":\"${REALM}\",\"enabled\":true,\"sslRequired\":\"none\"}"
else
  echo "Realm ${REALM} already exists."
fi

# Ensure HTTP works for existing realms (idempotent; Keycloak may default sslRequired to external/all)
if command -v jq > /dev/null 2>&1; then
  echo "Ensuring realm sslRequired=none for local HTTP dev..."
  CODE=$(curl -sS "${KC}/admin/realms/${REALM}" -H "$HDR" | jq 'del(.id) | .sslRequired = "none"' | curl -sS -o /dev/null -w "%{http_code}" -X PUT "${KC}/admin/realms/${REALM}" \
    -H "$HDR" -H "Content-Type: application/json" -d @-)
  case "$CODE" in 200 | 204) ;; *)
    echo "Warning: could not set sslRequired=none (HTTP ${CODE}). Keycloak Admin → Realm ${REALM} → Settings → SSL → None if the browser shows HTTPS required." >&2
    ;;
  esac
else
  echo "Warning: jq not found; if OAuth shows \"HTTPS required\", set Realm ${REALM} → Settings → SSL → None, or re-run init with jq." >&2
fi

# Ensure the openid client scope exists (avoids "Referenced client scope 'openid' doesn't exist" when policies reference it).
if command -v jq > /dev/null 2>&1; then
  echo "Ensuring openid client scope in realm ${REALM}..."
  HAS_OPENID=$(curl -sS "${KC}/admin/realms/${REALM}/client-scopes" -H "$HDR" | jq -r '.[] | select(.name=="openid") | .id' | head -n1)
  if [ -n "$HAS_OPENID" ] && [ "$HAS_OPENID" != "null" ]; then
    echo "Client scope openid already present."
  else
    MID=$(curl -sS "${KC}/admin/realms/master/client-scopes" -H "$HDR" | jq -r '.[] | select(.name=="openid") | .id' | head -n1)
    if [ -n "$MID" ] && [ "$MID" != "null" ]; then
      FULL=$(curl -sS "${KC}/admin/realms/master/client-scopes/${MID}" -H "$HDR")
      if ! printf '%s' "$FULL" | jq 'del(.id) | del(.subComponents) | if .protocolMappers then .protocolMappers |= map(del(.id)) else . end' | curl -sS -f -X POST "${KC}/admin/realms/${REALM}/client-scopes" \
        -H "$HDR" -H "Content-Type: application/json" -d @-; then
        echo "Warning: could not clone openid scope from master; creating minimal openid scope." >&2
        curl -sS -f -X POST "${KC}/admin/realms/${REALM}/client-scopes" \
          -H "$HDR" -H "Content-Type: application/json" \
          -d '{"name":"openid","protocol":"openid-connect","attributes":{"include.in.token.scope":"true","display.on.consent.screen":"true"}}'
      else
        echo "Cloned openid client scope from master realm."
      fi
    else
      echo "Creating minimal openid client scope (master realm had no openid)..."
      curl -sS -f -X POST "${KC}/admin/realms/${REALM}/client-scopes" \
        -H "$HDR" -H "Content-Type: application/json" \
        -d '{"name":"openid","protocol":"openid-connect","attributes":{"include.in.token.scope":"true","display.on.consent.screen":"true"}}'
    fi
  fi
  OID_ID=$(curl -sS "${KC}/admin/realms/${REALM}/client-scopes" -H "$HDR" | jq -r '.[] | select(.name=="openid") | .id' | head -n1)
  if [ -n "$OID_ID" ] && [ "$OID_ID" != "null" ]; then
    IN_DEFAULT=$(curl -sS "${KC}/admin/realms/${REALM}/default-default-client-scopes" -H "$HDR" | jq -r --arg id "$OID_ID" '.[] | select(.id==$id) | .id' | head -n1)
    if [ -z "$IN_DEFAULT" ]; then
      echo "Adding openid to realm default default client scopes..."
      HTTP_DEF=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT "${KC}/admin/realms/${REALM}/default-default-client-scopes/${OID_ID}" -H "$HDR")
      case "$HTTP_DEF" in
      200 | 204) echo "openid is a default default client scope for realm ${REALM}." ;;
      *) echo "Warning: could not register openid as default default client scope (HTTP ${HTTP_DEF})." >&2 ;;
      esac
    else
      echo "openid already in default default client scopes."
    fi
  fi
else
  echo "Warning: jq not found; skipping openid client scope ensure (install jq in keycloak-init)." >&2
fi

# Public OAuth client (dev only)
CLIENT_LIST=$(curl -sS "${KC}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}" -H "$HDR")
if printf '%s' "$CLIENT_LIST" | grep -q "\"clientId\":\"${CLIENT_ID}\""; then
  echo "Client ${CLIENT_ID} already exists."
else
  echo "Creating client ${CLIENT_ID}..."
  # redirectUris + webOrigins: browser OIDC (e.g. MCP Inspector uses <origin>/oauth/callback); password grant still enabled for dev.
  curl -sS -f -X POST "${KC}/admin/realms/${REALM}/clients" \
    -H "$HDR" -H "Content-Type: application/json" \
    -d "{\"clientId\":\"${CLIENT_ID}\",\"enabled\":true,\"publicClient\":true,\"directAccessGrantsEnabled\":true,\"standardFlowEnabled\":true,\"redirectUris\":[\"http://localhost/*\",\"http://127.0.0.1/*\",\"http://localhost:6274/*\",\"http://127.0.0.1:6274/*\",\"http://localhost:6274/oauth/callback\",\"http://127.0.0.1:6274/oauth/callback\"],\"webOrigins\":[\"http://localhost:6274\",\"http://127.0.0.1:6274\"]}"
fi

USER_LIST=$(curl -sS "${KC}/admin/realms/${REALM}/users?username=${DEV_USER}&exact=true" -H "$HDR")
if printf '%s' "$USER_LIST" | grep -q "\"username\":\"${DEV_USER}\""; then
  echo "User ${DEV_USER} already exists."
else
  echo "Creating user ${DEV_USER}..."
  curl -sS -f -X POST "${KC}/admin/realms/${REALM}/users" \
    -H "$HDR" -H "Content-Type: application/json" \
    -d "{\"username\":\"${DEV_USER}\",\"enabled\":true,\"email\":\"${DEV_USER}@example.com\",\"firstName\":\"Dev\",\"lastName\":\"User\",\"credentials\":[{\"type\":\"password\",\"value\":\"${DEV_PASSWORD}\",\"temporary\":false}]}"
fi

# Anonymous OIDC Dynamic Client Registration (DCR): Keycloak ships a "Trusted Hosts" policy for
# anonymous registration with an empty host list, which effectively disables DCR. Populate
# localhost + relax the "request source host must match" check so tools (e.g. VS Code Copilot)
# can register from loopback despite reverse-DNS differences. Dev-only — tighten for production
# (initial access tokens, stricter policies). Requires jq (Docker init installs it).
#
# PUT must follow GET shape; omit fields the Admin API rejects on PUT (e.g. subComponents — see ComponentRepresentation).
if command -v jq > /dev/null 2>&1; then
  echo "Configuring anonymous OIDC client registration (DCR) for local dev..."
  COMPONENTS=$(curl -sS "${KC}/admin/realms/${REALM}/components?type=org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy" -H "$HDR")
  TH_ID=$(printf '%s' "$COMPONENTS" | jq -r '.[] | select(.providerId=="trusted-hosts" and .subType=="anonymous") | .id' | head -n1)
  if [ -z "$TH_ID" ] || [ "$TH_ID" = "null" ]; then
    echo "Error: trusted-hosts anonymous Client registration policy not found; cannot configure DCR." >&2
    exit 1
  fi
  TH_GET=$(curl -sS "${KC}/admin/realms/${REALM}/components/${TH_ID}" -H "$HDR")
  # Keycloak validateConfiguration: at least one of host verification OR client-URI verification must be enabled.
  # Host check off + client URI allowlist on (vscode/cursor redirect URIs).
  HM="false"
  CM="true"
  # Wildcards use *.domain form (see TrustedHostClientRegistrationPolicyFactory).
  # 192.168.65.1: Docker Desktop gateway from container view — always listed so host TCP check can match DCR from the host.
  TH_PUT=$(printf '%s' "$TH_GET" | jq --arg hm "$HM" --arg cm "$CM" 'del(.subComponents)
    | .config = (.config // {})
    | .config["trusted-hosts"] = [
        "localhost","127.0.0.1","::1",
        "vscode.dev","insiders.vscode.dev",
        "zowe.mcp.example.com","keycloak.mcp.example.com",
        "vscode.microsoft.com","code.visualstudio.com",
        "anysphere.cursor-mcp",
        "*.vscode-cdn.net",
        "192.168.65.1"
      ]
    | .config["host-sending-registration-request-must-match"] = [$hm]
    | .config["client-uris-must-match"] = [$cm]')
  TMPF=$(mktemp)
  HTTP_CODE=$(curl -sS -w "%{http_code}" -o "$TMPF" -X PUT "${KC}/admin/realms/${REALM}/components/${TH_ID}" \
    -H "$HDR" -H "Content-Type: application/json" \
    -d "$TH_PUT")
  BODY=$(cat "$TMPF")
  rm -f "$TMPF"
  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "204" ]; then
    if [ "$CM" = "true" ]; then
      # Older Keycloak may reject explicit client-uris-must-match in PUT; retry host + trusted-hosts only (client URIs unchanged from GET).
      TH_PUT2=$(printf '%s' "$TH_GET" | jq 'del(.subComponents)
        | .config = (.config // {})
        | .config["trusted-hosts"] = [
            "localhost","127.0.0.1","::1",
            "vscode.dev","insiders.vscode.dev",
            "zowe.mcp.example.com","keycloak.mcp.example.com",
            "vscode.microsoft.com","code.visualstudio.com",
            "anysphere.cursor-mcp",
            "*.vscode-cdn.net",
            "192.168.65.1"
          ]
        | .config["host-sending-registration-request-must-match"] = ["false"]')
      TMPF=$(mktemp)
      HTTP_CODE=$(curl -sS -w "%{http_code}" -o "$TMPF" -X PUT "${KC}/admin/realms/${REALM}/components/${TH_ID}" \
        -H "$HDR" -H "Content-Type: application/json" \
        -d "$TH_PUT2")
      BODY=$(cat "$TMPF")
      rm -f "$TMPF"
    fi
  fi
  case "$HTTP_CODE" in
  200 | 204)
    echo "Anonymous DCR enabled (Trusted Hosts incl. 192.168.65.1; host TCP check off; client URI check on — dev only)."
    echo "Current Trusted Hosts policy config in Keycloak (component ${TH_ID}):"
    if TH_VERIFY=$(curl -sS -f "${KC}/admin/realms/${REALM}/components/${TH_ID}" -H "$HDR"); then
      printf '%s' "$TH_VERIFY" | jq '.config // {}'
    else
      echo "  Warning: could not re-fetch component to verify persisted config." >&2
    fi
    ;;
  *)
    echo "Error: DCR Trusted Hosts policy update failed (HTTP ${HTTP_CODE}). Response: ${BODY}" >&2
    echo "Hint: Admin Console → Realm → Client registration → Policies, or fix JSON shape for your Keycloak version." >&2
    exit 1
    ;;
  esac

  # Allowed Client Scopes (providerId allowed-client-templates): anonymous DCR sends scope "openid"; policy must whitelist it.
  ACS_ID=$(printf '%s' "$COMPONENTS" | jq -r '.[] | select(.providerId=="allowed-client-templates" and .subType=="anonymous") | .id' | head -n1)
  if [ -z "$ACS_ID" ] || [ "$ACS_ID" = "null" ]; then
    echo "Warning: anonymous Allowed Client Scopes policy (allowed-client-templates) not found; skip adding openid." >&2
  else
    echo "Ensuring scope openid is allowed for anonymous DCR (Allowed Client Scopes policy)..."
    ACS_GET=$(curl -sS "${KC}/admin/realms/${REALM}/components/${ACS_ID}" -H "$HDR")
    ACS_PUT=$(printf '%s' "$ACS_GET" | jq 'del(.subComponents)
      | .config = (.config // {})
      | .config["allowed-client-scopes"] = ((.config["allowed-client-scopes"] // []) | if index("openid") != null then . else . + ["openid"] end)')
    TMPF=$(mktemp)
    ACS_HTTP=$(curl -sS -w "%{http_code}" -o "$TMPF" -X PUT "${KC}/admin/realms/${REALM}/components/${ACS_ID}" \
      -H "$HDR" -H "Content-Type: application/json" \
      -d "$ACS_PUT")
    ACS_BODY=$(cat "$TMPF")
    rm -f "$TMPF"
    case "$ACS_HTTP" in
    200 | 204)
      echo "Allowed Client Scopes updated (openid permitted for anonymous registration)."
      if ACS_VERIFY=$(curl -sS -f "${KC}/admin/realms/${REALM}/components/${ACS_ID}" -H "$HDR"); then
        echo "Current Allowed Client Scopes policy config (component ${ACS_ID}):"
        printf '%s' "$ACS_VERIFY" | jq '.config // {}'
      fi
      ;;
    *)
      echo "Error: Allowed Client Scopes policy update failed (HTTP ${ACS_HTTP}). Response: ${ACS_BODY}" >&2
      echo "Hint: Realm → Client registration → Policies → Allowed Client Scopes (anonymous) → add client scope openid." >&2
      exit 1
      ;;
    esac
  fi
else
  echo "Error: jq is required to configure DCR (Trusted Hosts policy). Install jq or use the Docker keycloak-init image." >&2
  exit 1
fi

echo "Keycloak bootstrap finished."
HOST_PORT="${KEYCLOAK_HOST_PORT:-18080}"
if command -v jq > /dev/null 2>&1; then
  DISC=$(curl -sS "${KC}/realms/${REALM}/.well-known/openid-configuration" 2> /dev/null || true)
  REG_EP=$(printf '%s' "$DISC" | jq -r '.registration_endpoint // empty')
  if [ -n "$REG_EP" ]; then
    echo "OIDC discovery lists registration_endpoint (DCR): ${REG_EP}"
  else
    echo "Warning: OIDC discovery has no registration_endpoint — VS Code may require manual Client ID. Check realm Client registration policies." >&2
  fi
fi
echo "Token endpoint (host): http://localhost:${HOST_PORT}/realms/${REALM}/protocol/openid-connect/token"
echo "  client_id=${CLIENT_ID}  username=${DEV_USER}  password=${DEV_PASSWORD}  grant_type=password  scope=openid profile email"
