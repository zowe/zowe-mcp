# Local OIDC for HTTP JWT development

Use this guide when you want a **small, local OpenID Connect (OIDC) provider** so you can obtain **Bearer access tokens** and exercise the Zowe MCP HTTP transport with **`ZOWE_MCP_JWT_*`** validation enabled.

The server validates **RS256** JWTs against **`ZOWE_MCP_JWKS_URI`** and checks **`iss`** against **`ZOWE_MCP_JWT_ISSUER`**. Implementation: `packages/zowe-mcp-server/src/auth/bearer-jwt.ts` (tests: `__tests__/bearer-jwt.test.ts`, `__tests__/http-transport-jwt.test.ts`).

## What the MCP server expects

| Claim / check | Notes |
| --- | --- |
| `iss` | Must match `ZOWE_MCP_JWT_ISSUER` exactly. |
| `sub` | Required; used to scope per-tenant caches and CLI plugin state in shared HTTP mode. |
| `aud` | Optional; if `ZOWE_MCP_JWT_AUDIENCE` is set, the token must match. |
| Signature | RS256; public key resolved from JWKS (`kid` match). |

Tokens are sent by clients as `Authorization: Bearer <access_token>` on every Streamable HTTP request to `/mcp`.

## Environment variables (Zowe MCP)

Set these when starting the server with `--http` (alongside your usual `--native` / `--config` / `ZOWE_MCP_CREDENTIALS` as needed):

```bash
export ZOWE_MCP_JWT_ISSUER="http://localhost:8080/realms/<realm>"
export ZOWE_MCP_JWKS_URI="http://localhost:8080/realms/<realm>/protocol/openid-connect/certs"
# Optional:
# export ZOWE_MCP_JWT_AUDIENCE="account"
```

Use the **same** issuer string your IdP puts in the `iss` claim (trailing slashes matter—keep them consistent).

## One-command local stack (Keycloak + Zowe MCP HTTP)

For a **full local stack** (Keycloak + MCP HTTP + JWT), see **`docs/remote-dev-keycloak.md`**: **`npm run start:remote-https-dev-native-zos`** (HTTPS MCP + Keycloak native TLS; **`--http --native`** for real z/OS). For a **minimal** Keycloak on port **8080** and hand-set **`ZOWE_MCP_JWT_*`**, use the examples below. Optional **MCP in Docker** (mock): **`docker compose -f docker/remote-dev/docker-compose.yml --profile mcp-image up`** after **`npm run pack:server`**.

## Example: Keycloak in development mode

Keycloak is a common **“tiny” local IdP** for development (not a Zowe product dependency—you can substitute any OIDC provider that exposes JWKS).

1. Start Keycloak (see [Keycloak getting started](https://www.keycloak.org/getting-started)); for a quick dev instance:

   ```bash
   docker run --rm -p 8080:8080 \
     -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
     -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
     quay.io/keycloak/keycloak:latest start-dev
   ```

2. In the admin console, create a **realm** (e.g. `demo`), a **user**, and a **client** configured for your desired flow (authorization code for real users; for scripted smoke tests some teams enable **Direct Access Grants** on a confidential client—**dev only**).

3. Read issuer and JWKS URLs from OIDC discovery, e.g.
   `http://localhost:8080/realms/demo/.well-known/openid-configuration`
   Use `issuer` as `ZOWE_MCP_JWT_ISSUER` and derive JWKS as
   `{issuer}/protocol/openid-connect/certs` (Keycloak’s usual shape).

4. Obtain an access token from your realm’s token endpoint (method depends on grant type and client settings), then call the MCP HTTP endpoint with `Authorization: Bearer …`.

If **port 8080 is already in use**, map another host port (example uses **18080**): `-p 18080:8080` and replace `http://localhost:8080` with `http://localhost:18080` in all URLs and in `ZOWE_MCP_JWT_*`.

### Optional: API-only setup (Keycloak Admin REST + OIDC)

Instead of the admin UI, you can create the realm, a public dev client with **Direct Access Grants**, and a user with `curl` against the **Admin REST API** (master admin token), then read the user back via **OIDC UserInfo** or **GET /admin/realms/{realm}/users**.

Set `KC` to your Keycloak base URL (no trailing slash):

```bash
KC=http://localhost:18080   # or http://localhost:8080

# 1) Master-realm admin token (bootstrap)
ADMIN_TOKEN=$(curl -sS -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d username=admin -d password=admin -d grant_type=password \
  | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).access_token)")

# 2) Create realm `demo`
curl -sS -X POST "$KC/admin/realms" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"realm":"demo","enabled":true}'

# 3) Public client `demo` (password grant — dev only)
curl -sS -X POST "$KC/admin/realms/demo/clients" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"demo","enabled":true,"publicClient":true,"directAccessGrantsEnabled":true,"standardFlowEnabled":true,"redirectUris":["http://localhost/*"]}'

# 4) User `user`
curl -sS -X POST "$KC/admin/realms/demo/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"user","enabled":true,"email":"user@example.com","firstName":"Zowe","lastName":"MCP","credentials":[{"type":"password","value":"password","temporary":false}]}'

# 5) Same user via Admin API (lookup by username)
curl -sS "$KC/admin/realms/demo/users?username=user&exact=true" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 6) Access token (resource owner password — dev only) + OIDC UserInfo
#    Include `scope=openid profile email` or UserInfo may return an empty body.
ACCESS_TOKEN=$(curl -sS -X POST "$KC/realms/demo/protocol/openid-connect/token" \
  -d client_id=demo -d username=user -d password=password \
  -d grant_type=password -d scope='openid profile email' \
  | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).access_token)")

curl -sS "$KC/realms/demo/protocol/openid-connect/userinfo" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

`preferred_username` in UserInfo is `user`; `sub` is the stable UUID Keycloak uses in JWTs (matches Zowe MCP tenant scoping).

## Smoke test

With the server listening on port **7542** and a valid access token:

```bash
curl -sS -X POST "http://localhost:7542/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

You should get a Streamable HTTP response (including session headers per MCP), not `401`.

## Automated E2E (Vitest)

With Keycloak running and the `demo` realm / `demo` client / `user` user configured (see above), run the repo’s **opt-in** HTTP JWT tests:

```bash
npm run build -w @zowe/mcp-server
npm run test:keycloak-jwt-e2e
```

This sets **`ZOWE_MCP_KEYCLOAK_E2E=1`** and executes `packages/zowe-mcp-server/__tests__/keycloak-http-jwt.e2e.test.ts` (real JWKS fetch, no mocked `fetch`): **initialize** (401 without Bearer), **initialize** with token, and **`getContext`** via **`tools/call`** using the MCP Streamable HTTP client. Override the Keycloak base URL if needed: **`ZOWE_MCP_KEYCLOAK_URL`** (default `http://localhost:18080`; use **`http://localhost:8080`** when using `docs/remote-dev-keycloak.md`). Default **`npm test`** skips this file so CI does not require Keycloak.

## See also

- **`docs/remote-http-mcp-registry.md`** — production registry `server.json`, per-organization URLs, Bearer headers.
- **`docs/mcp-authentication-oauth.md`** — HTTP JWT, Copilot / VS Code clients, z/OS credentials, multi-tenant overview.
- **`AGENTS.md`** — HTTP remote auth guidance and future z/OS identity notes.
