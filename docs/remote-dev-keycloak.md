# Remote HTTP MCP with local Keycloak

This guide runs **Zowe MCP** in **HTTP Streamable** mode with **Bearer JWT** validation against **Keycloak**. The supported one-command flow uses **HTTPS** for MCP (nginx) and **native TLS** for Keycloak — see **`docker/remote-https-dev/README.md`**.

Defaults (remote HTTPS dev script):

- **MCP (public):** `https://zowe.mcp.example.com:7542/mcp` (nginx → Node on **`ZOWE_MCP_HTTP_BACKEND_PORT`**, default **7543**)
- **Keycloak (issuer / JWKS):** `https://keycloak.mcp.example.com:18443/realms/demo` (adjust host/port via env; see **`docker/remote-https-dev/README.md`**)
- **OIDC realm:** `demo`
- **Dev client:** `demo` (public — **dev only**)
- **Dev user:** `user` / `password`

Requires **Docker**, **mkcert** TLS assets under **`docker/remote-https-dev/certs/`**, **`/etc/hosts`** for the dev hostnames, and **Node.js** / **npm**.

<a id="one-command-remote-https"></a>

## One command (recommended): `npm run start:remote-https-dev-native-zos`

From the **repository root**:

```bash
npm run start:remote-https-dev-native-zos
```

This starts Keycloak with **native HTTPS** (merged compose files), runs **`keycloak-init`**, starts **nginx** for MCP TLS only, waits for OIDC discovery, runs **`patch-keycloak-mcp-dev-redirects.mjs`**, sets **`ZOWE_MCP_JWT_ISSUER`** / **`ZOWE_MCP_JWKS_URI`** / tenant store, builds the server, and runs **`--http --native`** (real z/OS). Optional args after **`--`**: e.g. **`--config ./native-config.json`**, **`--system USERID@host`**.

Details, ports, and troubleshooting: **`docker/remote-https-dev/README.md`**.

### Stale OAuth clients (`LOGIN_ERROR` / `client_not_found`)

After you **remove and recreate** the Keycloak container, the dev database is new. **Dynamically registered clients** (VS Code / MCP Inspector) from the **previous** instance no longer exist — logs may show **`LOGIN_ERROR`** with **`client_not_found`** for the old client UUID. **Fix:** sign out, clear site data for the Keycloak origin if needed, then complete OAuth again so a new client is registered.

**Optional — one-step clean Keycloak:** **`npm run keycloak:dev-fresh`** — same **native HTTPS** compose merge as **`start:remote-https-dev-native-zos`** (defaults for **`KC_HOSTNAME`**, **`ZOWE_MCP_TLS_CERT_DIR`**, and Keycloak ports match that script). This **force-recreates** the Keycloak service and runs **`keycloak-init`**. Leaving Keycloak running across MCP restarts is still the default; use this when you want an empty realm without hand-rolling **`docker compose`** commands.

Press **Ctrl+C** to stop MCP and the MCP nginx TLS stack; Keycloak may keep running until **`docker compose -f docker/remote-dev/docker-compose.yml … down`**.

<a id="keycloak-only-background"></a>

### Keycloak + realm only (manual MCP)

```bash
docker compose -f docker/remote-dev/docker-compose.yml up -d keycloak
docker compose -f docker/remote-dev/docker-compose.yml run --rm keycloak-init
```

Set **`ZOWE_MCP_JWT_ISSUER`** and **`ZOWE_MCP_JWKS_URI`** to match your Keycloak base URL (see OIDC discovery), then build and run **`node packages/zowe-mcp-server/dist/index.js --http --mock …`** or **`--native …`** as needed.

## Keycloak host port

The compose file maps **`KEYCLOAK_HOST_PORT`** (default **`18080`**) on the host to Keycloak’s container port **8080**. Keycloak always listens on **8080** inside the container; only the published host port changes.

- To use host port **8080** instead: `export KEYCLOAK_HOST_PORT=8080` before `docker compose`, or set it in a **`.env`** file in the directory you run Compose from (usually the **repository root**).

1. **URLs and JWT env** must use that host port everywhere you reference Keycloak from the host (token endpoint, OIDC discovery, **`ZOWE_MCP_JWT_ISSUER`**, **`ZOWE_MCP_JWKS_URI`** when MCP runs on the host). The JWT **`iss`** claim matches the URL you use to obtain tokens (e.g. `http://localhost:18080/realms/demo`), so **`ZOWE_MCP_JWT_ISSUER`** must be exactly that issuer string.

2. **Inside Docker Compose**, services still reach Keycloak as **`http://keycloak:8080`** — only **host-facing** URLs change.

The **`start:remote-https-dev-native-zos`** script sets **`ZOWE_MCP_JWT_*`** from the HTTPS Keycloak URL. If you set **`ZOWE_MCP_JWT_ISSUER`** / **`ZOWE_MCP_JWKS_URI`** yourself, they override the defaults.

## Browser OIDC and redirect URIs

**Zowe MCP HTTP** validates **Bearer JWTs** on `/mcp`. When **`ZOWE_MCP_JWT_ISSUER`** / **`ZOWE_MCP_JWKS_URI`** are set, it also serves **[OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728)** at **`GET /.well-known/oauth-protected-resource`** and **`GET /.well-known/oauth-protected-resource/mcp`** (with **CORS** `*` so the browser can read it). That document points **`authorization_servers`** at your Keycloak realm issuer so the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) can **discover** the IdP — otherwise its OAuth **fetch fails** with “Resource server does not implement OAuth 2.0 Protected Resource Metadata”. The **authorization** and **redirect** flows still run in the **browser against Keycloak**; the MCP server does not host the Keycloak login page.

**MCP Inspector OAuth fields** (connect to **`http://localhost:7542/mcp`** with **Streamable HTTP**):

| Field | Value (local Keycloak dev) |
| --- | --- |
| **Client ID** | `demo` |
| **Client Secret** | *(leave empty — public client)* |
| **Redirect URL** | **`http://localhost:6274/oauth/callback`** (must end with **`/oauth/callback`**, not `/oauth/` alone) |
| **Scope** | `openid profile email` |

The Inspector (default UI **`http://localhost:6274`**) registers **`/oauth/callback`** on its own origin. Keycloak must allow that URL as a **Valid redirect URI** and allow the Inspector origin under **Web origins** (CORS) on client **`demo`**.

If the MCP server is behind a reverse proxy and discovery builds the wrong **`resource` URL**, set **`ZOWE_MCP_OAUTH_RESOURCE`** to the absolute URL clients use for the MCP endpoint (e.g. `https://mcp.example.com/mcp`).

This repo:

1. **Bootstrap** ([`docker/remote-dev/init-keycloak.sh`](../docker/remote-dev/init-keycloak.sh)) creates **`demo`** with **`standardFlowEnabled`**, **`redirectUris`** including `http://localhost:6274/oauth/callback` (and wildcards for localhost), and **`webOrigins`** for the Inspector port — **only when the client is first created**.
2. **`npm run start:remote-https-dev-native-zos`** runs an **idempotent** patch ([`scripts/patch-keycloak-mcp-dev-redirects.mjs`](../scripts/patch-keycloak-mcp-dev-redirects.mjs)) after the realm is ready so **existing** Keycloak data gets the same URIs merged in.

Run the patch manually if Keycloak was started another way (from repo root, same env defaults as **`start:remote-https-dev-native-zos`** — set **`ZOWE_MCP_PUBLIC_BASE_URL`** if your public MCP base differs):

```bash
node scripts/patch-keycloak-mcp-dev-redirects.mjs
```

**`npm run keycloak:dev-fresh`** runs **`keycloak-init`** and then this patch automatically.

Optional env: **`MCP_INSPECTOR_PORT`** (default **`6274`**) if the Inspector uses another client port; **`KC_URL`** / **`KEYCLOAK_HOST_PORT`** to match your Keycloak base URL.

In the Keycloak Admin Console: **Clients → demo → Settings** — confirm **Valid redirect URIs** and **Web origins** include your Inspector origin. Use **Standard flow** (authorization code) in your OAuth client; keep **Direct access grants** only for local dev password-grant smoke tests.

### Local HTTP: “HTTPS required” and OIDC discovery wait

- **Browser: “We are sorry… HTTPS required”** — Realms must allow **non-HTTPS** for local dev. [`init-keycloak.sh`](../docker/remote-dev/init-keycloak.sh) sets **`sslRequired`** to **`none`** on **`demo`** and on **`master`** (the **master** realm affects the **`admin-cli`** token endpoint used by host scripts such as [`patch-keycloak-mcp-dev-redirects.mjs`](../scripts/patch-keycloak-mcp-dev-redirects.mjs)). Re-run **`docker compose -f docker/remote-dev/docker-compose.yml run --rm keycloak-init`**, or set **Realm settings → General → SSL** to **None** on both realms manually.
- **`patch-keycloak-mcp-dev-redirects`: Keycloak admin token failed: HTTPS required** — Same as above: **`master`** realm SSL. Re-run **`keycloak-init`** with the current script, or set **master** → **SSL** to **None** in the Admin Console.
- **Startup stuck on “Waiting for OIDC discovery”** — The start scripts poll **`<keycloak>/realms/demo/.well-known/openid-configuration`** until HTTP **200** (about two minutes max). If it never succeeds, check **`docker compose … ps`**, **`logs keycloak`**, and that **`KEYCLOAK_HOST_PORT`** (default **18080**) matches **`http://localhost:<port>`** in your URLs.

### Dynamic Client Registration (DCR) and VS Code / Copilot

Keycloak exposes OpenID Connect **Dynamic Client Registration** at the **`registration_endpoint`** listed in the realm OIDC discovery document (`<keycloak-base>/realms/demo/.well-known/openid-configuration`; path shape: **`/realms/demo/clients-registrations/openid-connect`**). By default, Keycloak’s **Trusted Hosts** policy has **no** entries, so **anonymous** registration is effectively **disabled**.

The bootstrap script ([`docker/remote-dev/init-keycloak.sh`](../docker/remote-dev/init-keycloak.sh)) updates that policy. **Keycloak** rejects disabling **both** “host sending the registration request must match” and **client-uris-must-match**. The script uses **host TCP check off** and **client URI check on** — redirect/root URIs in DCR are validated against **`trusted-hosts`** (VS Code / **Cursor** hosts: **`vscode.microsoft.com`**, **`code.visualstudio.com`**, **`anysphere.cursor-mcp`**, **`*.vscode-cdn.net`**, dev hostnames, loopback, **`192.168.65.1`**). It also adds **`openid`** to the anonymous **Allowed Client Scopes** policy (`allowed-client-templates`) so DCR requests that include **`scope=openid`** are not rejected.

**HTTPS MCP URL vs HTTP:** VS Code often includes **`https://vscode.dev/redirect`** (and loopback) in **dynamic client registration**. The **default** policy (**client URI check on**) requires those redirect hosts to be covered by **`trusted-hosts`** (the script sets them). Re-run **`keycloak-init`** after pulling changes.

You can still use the static public client **`demo`** whenever a product asks for a **Client ID** — that remains the supported dev choice and avoids orphan dynamically registered clients in the realm.

#### Wrong OAuth Client ID (typo or old value)

VS Code **caches** the client ID / OAuth session it used for an MCP server. If you entered the wrong **Client ID** (or need to switch back to **`demo`** after an experiment):

1. Run **Manage Dynamic Authentication Providers** from the Command Palette (**⇧⌘P** / **Ctrl+Shift+P**) or open it from the **Accounts** menu (avatar, bottom left). Remove the provider or session tied to this MCP / Keycloak URL so the next connection prompts again.
2. If the product documents it, run **Authentication: Remove Dynamic Authentication Providers** (wording can vary slightly by VS Code version) to clear cached OAuth for MCP.
3. Run **Developer: Reload Window**, then connect again and enter **`demo`** (or complete DCR if the client registers automatically).

If something still reuses the old value, check your **`.vscode/mcp.json`** / user **MCP** configuration for any hardcoded client metadata and fix it there.

## Debug logging (remote dev)

**Zowe MCP** (host — `start:remote-https-dev-native-zos`): set **`ZOWE_MCP_LOG_LEVEL=debug`** in the environment before `npm run …` (default is **`info`**). Logs go to **stderr** and, when the client supports it, MCP **`logging`** notifications.

```bash
export ZOWE_MCP_LOG_LEVEL=debug
npm run start:remote-https-dev-native-zos
```

**Docker Compose** ([`docker/remote-dev/docker-compose.yml`](../docker/remote-dev/docker-compose.yml)): optional commented samples — **`# ZOWE_MCP_LOG_LEVEL: debug`** on the **`zowe-mcp`** service, **`# KC_LOG_LEVEL: debug`** on **`keycloak`**. Uncomment to enable; see [Keycloak logging](https://www.keycloak.org/server/logging) for **`KC_LOG_LEVEL`**.

## Full stack in Docker (MCP + Keycloak)

Use this when you want **both** services in containers (for example a CI-like environment).

1. Create the packed server tarball at the repo root (bundles dependencies — same idea as airgap install):

   ```bash
   npm run pack:server
   ```

2. Start **Keycloak** and the **Zowe MCP** image (`--profile mcp-image`):

   ```bash
   docker compose -f docker/remote-dev/docker-compose.yml --profile mcp-image up -d
   ```

The image installs **`zowe-mcp-server-*.tgz`** from the repo root.

**Compose note:** `keycloak-init` uses `depends_on: service_completed_successfully` — use **Docker Compose v2** (recent **2.29+** recommended).

The **`zowe-mcp`** service in this compose file runs the **stock** image ([`docker/remote-dev/Dockerfile`](../docker/remote-dev/Dockerfile)) with **`--http --mock` only**. It does **not** include native z/OS configuration. For native z/OS with JWT, run the server **on the host** (previous section) or build a **custom** image/compose override—see [Native z/OS in Docker](#native-zos-in-docker).

## Real z/OS (native SSH backend)

Use this when the MCP server should connect to **real z/OS** through the [Zowe Native Proto](https://github.com/zowe/zowe-native-proto) SSH path (`--native`), instead of `--mock`.

**Prerequisites:**

- TCP reachability from the machine running `zowe-mcp-server` to the z/OS **SSH** port (default **22**, or the port in your connection spec).
- The same **JWT** setup as mock mode: set **`ZOWE_MCP_JWT_ISSUER`** and **`ZOWE_MCP_JWKS_URI`** (see [Keycloak only](#keycloak-only-background) or run **`keycloak-init`** as above).
- **SSH passwords** — HTTP mode does not use the VS Code extension pipe. Prefer **MCP elicitation** (interactive prompt in the client when a z/OS tool needs a password); see [Passwords (standalone native)](#passwords-standalone-native).

**Do not** pass both `--mock` and `--native`; choose one.

### Connection list: production vs testing (HTTP + JWT)

For **shared remote HTTP** with JWT and **`ZOWE_MCP_TENANT_STORE_DIR`**, **recommended:** each user adds their own z/OS systems with the **`addZosConnection`** tool (`user@host` or `user@host:port`). Connections are **persisted per OIDC `sub`** in separate files — they are **not** shared across users.

**`--config <path>`** and **`--system`** at startup are **not** the recommended way to define production connection lists for multi-user HTTP; use them for **local testing, smoke tests, or a minimal bootstrap** list only. Optional startup lists are **merged** with each tenant’s file (see **`AGENTS.md`**).

### Connection list format (`--config` or `--system`, testing / bootstrap)

- **`--config <path>`** — JSON file with a **`systems`** array of connection specs: `user@host` or `user@host:port`.
- **`--system <spec>`** — Repeatable; same spec format.

Example file (also **[`native-config.example.json`](../native-config.example.json)**):

```json
{
  "systems": ["USERID@zos.example.com"],
  "jobCards": {
    "USERID@zos.example.com": [
      "//{jobname}  JOB (ACCT),'{programmer}',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID",
      "/*JOBPARM S=*"
    ]
  }
}
```

Optional **`jobCards`** supply default JCL when submitting jobs without a `JOB` statement (same shape as standalone stdio; see [`roo-or-standalone-mcp.md`](roo-or-standalone-mcp.md#job-cards-and-multiple-systems-no-extension)).

### Start on the host (Keycloak in Docker, MCP native)

After Keycloak is up (see [Keycloak + realm only](#keycloak--realm-only-manual-mcp)), build once and run:

```bash
export ZOWE_MCP_JWT_ISSUER="http://localhost:18080/realms/demo"
export ZOWE_MCP_JWKS_URI="http://localhost:18080/realms/demo/protocol/openid-connect/certs"

npm run build -w zowe-mcp-common -w @zowe/mcp-server

# JWT + tenant store: no startup systems — users add connections via addZosConnection (recommended)
# node packages/zowe-mcp-server/dist/index.js --http --native

# Testing only: config file or --system
# node packages/zowe-mcp-server/dist/index.js --http --native --config ./native-config.json
# node packages/zowe-mcp-server/dist/index.js --http --native --system USERID@zos.example.com
```

Do **not** set **`ZOWE_MCP_CREDENTIALS`** / **`ZOWE_MCP_PASSWORD_*`** unless you need non-interactive operation (see [Passwords](#passwords-standalone-native)).

Other useful standalone flags (see `zowe-mcp-server --help`): **`--native-response-timeout`**, **`--default-mvs-encoding`** / **`--default-uss-encoding`**, **`ZOWE_MCP_TENANT_STORE_DIR`** for per-user persisted connections on JWT-backed HTTP (see **`AGENTS.md`**).

### Passwords (standalone native)

Without the VS Code extension pipe, the server resolves SSH passwords in this order:

1. **Recommended (interactive / remote):** **MCP elicitation** — if the client advertises elicitation support, the server prompts for the SSH password when a tool first needs it. Default **`ZOWE_MCP_PASSWORD_ELICIT_MODE`** is **`auto`**: **URL-mode** (browser to `/zowe-mcp/password-elicit/…` on the MCP HTTP server — password not shown in chat) when the client supports **`elicitation.url`**; **form** only as fallback. **Do not** inject mainframe passwords into Compose **`environment`** or **`secrets`** for production-style remote deployments; avoid baking them into images.

2. **Optional (automation / CI / headless):** **`ZOWE_MCP_PASSWORD_<USER>_<HOST>`** or **`ZOWE_MCP_CREDENTIALS`** — inject from a secret manager or CI secrets at runtime, not committed files. Precedence and details: [`roo-or-standalone-mcp.md`](roo-or-standalone-mcp.md#passwords-standalone) and [`packages/zowe-mcp-server/server.json`](../packages/zowe-mcp-server/server.json).

Env-based passwords take precedence when set; if they are **unset**, elicitation runs when the client supports it.

### Smoke test (native)

Use the same [token request](#get-an-access-token-smoke-test) as mock mode, then `POST` to `/mcp` with **`Authorization: Bearer …`**. You should still get **200** on `initialize`; z/OS operations succeed only if SSH and credentials are valid.

### Native z/OS in Docker

The published **`docker/remote-dev/Dockerfile`** installs the packed server and runs **`--http --mock`** only. To run **native** z/OS inside a container you must extend that flow, for example:

- Prefer **no** shared startup connection list in production: users add systems via **`addZosConnection`**. For tests only, you may **mount** a config file (e.g. **`--config /config/native-config.json`**) with **`systems`** only — **no** passwords in the file.
- **Rely on MCP elicitation** for SSH passwords: clients connect to **`/mcp`** with a Bearer token; when a tool needs z/OS access, users are prompted per the client’s elicitation UI (same as [Passwords](#passwords-standalone-native)). Avoid putting **`ZOWE_MCP_CREDENTIALS`** or **`ZOWE_MCP_PASSWORD_*`** in Compose **`environment`** or image layers for normal remote use; reserve env-based secrets for **automation** only.
- Ensure the container **network** can reach z/OS SSH (firewall, VPN, `extra_hosts`, or host networking as appropriate). For **URL-mode** elicitation (browser), the MCP HTTP server must expose a **public base URL** reachable by the user’s browser (see HTTP transport / public URL helpers in the server).
- Set **`ZOWE_MCP_JWT_ISSUER`** to match the **`iss`** claim in tokens issued to clients (often the **external** Keycloak URL). If MCP and Keycloak are both in Compose, **`ZOWE_MCP_JWKS_URI`** should point at a URL the MCP process can use to fetch JWKS (compare [Why `issuer` uses `localhost` while JWKS may use `keycloak`](#why-issuer-uses-localhost-while-jwks-may-use-keycloak)).

There is no second one-command script for native-in-Docker; treat this as a **deployment-specific** image or compose overlay.

## Why `issuer` uses `localhost` while JWKS may use `keycloak`

Access tokens are requested from the host as `http://localhost:<port>/...` (default port **18080**, or **`KEYCLOAK_HOST_PORT`**), so the JWT **`iss`** claim is `http://localhost:<port>/realms/demo`. That value must match **`ZOWE_MCP_JWT_ISSUER`** exactly.

When the MCP server runs **inside Docker**, **`ZOWE_MCP_JWKS_URI`** is set to `http://keycloak:8080/.../certs` so the process can reach Keycloak on the Compose network. The keys are the same as `http://localhost:<port>/.../certs` on the host.

## Get an access token (smoke test)

```bash
KC_PORT="${KEYCLOAK_HOST_PORT:-18080}"
ACCESS_TOKEN=$(curl -sS -X POST "http://localhost:${KC_PORT}/realms/demo/protocol/openid-connect/token" \
  -d client_id=demo \
  -d username=user \
  -d password=password \
  -d grant_type=password \
  -d scope='openid profile email' \
  | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).access_token)")

curl -sS -X POST "http://localhost:7542/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

You should get a **200** Streamable HTTP response, not **401**.

### Reusing the same Bearer token across MCP restarts

**Yes.** Each `npm run start:remote-https-dev-native-zos` only restarts the **MCP Node process** (and the MCP nginx TLS stack exits on **Ctrl+C**). JWT validation is **stateless**: the server fetches signing keys from **`ZOWE_MCP_JWKS_URI`** and checks signature, issuer, audience, and expiry. It does **not** keep a server-side session table for your access token, so **restarting MCP does not revoke** tokens you already obtained from Keycloak.

To keep using one token across runs:

1. **Leave Keycloak running** — After you stop MCP with **Ctrl+C**, Keycloak stays up in Docker. Run **`npm run start:remote-https-dev-native-zos`** again; **`ZOWE_MCP_JWT_ISSUER`** / **`ZOWE_MCP_JWKS_URI`** stay the same when env and ports are unchanged. Your **existing** `Authorization: Bearer …` value keeps working until the token’s **`exp`** (and any other claims your client relies on) pass.
2. **Do not wipe Keycloak’s data** — If you run **`docker compose … down -v`** or remove volumes, the realm may be recreated and **signing keys can change**, so previously issued tokens may fail verification even before calendar expiry. Normal **`down`** without removing volumes is fine for typical dev.
3. **After expiry** — Request a new access token with the same [token request](#get-an-access-token-smoke-test) (or your OAuth client’s refresh flow if you configure **offline_access** / refresh tokens in Keycloak for dev — not required for the default password grant smoke test).

**Summary:** Reuse the same Bearer string in curl, MCP Inspector, or **`.vscode/mcp.json`** until it expires; restarting MCP alone is not a reason to fetch a new token.

### MCP Inspector and `addZosConnection`

The **`addZosConnection`** tool is registered only for **native (SSH) z/OS** with **HTTP + JWT + `ZOWE_MCP_TENANT_STORE_DIR`** — not for **`--mock`**.

**`npm run start:remote-https-dev-native-zos`** wires JWT, tenant store, and **`--http --native`** in one step (see [One command](#one-command-remote-https)).

Manual equivalent: set **`ZOWE_MCP_JWT_*`**, **`ZOWE_MCP_TENANT_STORE_DIR`**, then **`node … --http --native`** (optional **`--config` / `--system`**).

The server logs a **notice** at startup when JWT HTTP is enabled but **`addZosConnection`** is not registered (mock, or missing tenant store).

## GitHub Copilot (VS Code MCP)

Copilot Chat uses the same **MCP** configuration as VS Code.

1. Run **MCP: Open User Configuration** (or edit workspace **`.vscode/mcp.json`**).
2. Add a server with **`type`: `streamable-http`**, **`url`**: `http://localhost:7542/mcp`, and an **`Authorization`** header carrying `Bearer <access_token>`.

Shape (see also [MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)):

```json
{
  "servers": {
    "zowe-mcp-http": {
      "type": "streamable-http",
      "url": "http://localhost:7542/mcp",
      "headers": {
        "Authorization": "Bearer <paste-access-token-here>"
      }
    }
  }
}
```

Paste a token from the Keycloak token endpoint (same grant as the smoke test). Tokens expire — refresh from Keycloak when requests return **401**.

**Note:** The published npm **`server.json`** describes **stdio**; remote HTTP is documented per deployment ([`remote-http-mcp-registry.md`](remote-http-mcp-registry.md)).

A copy-paste template also lives at [`examples/mcp-remote-http-keycloak.json`](examples/mcp-remote-http-keycloak.json).

## Cursor

Cursor uses the same **`mcp.json`** shape as VS Code (user or workspace **`.vscode/mcp.json`**, or Cursor’s MCP UI depending on version). Use the same **`streamable-http`** URL and **`Authorization`** header as above.

Use a **different server name** from any local stdio Zowe MCP entry so tool IDs stay distinct.

## Roo Code

Roo supports **Streamable HTTP** with optional **`headers`** ([Using MCP in Roo Code](https://docs.roocode.com/features/mcp/using-mcp-in-roo)). Configure **`type`**: **`streamable-http`**, your MCP URL, and **`Authorization`**.

Example for **`.roo/mcp.json`** (or global Roo MCP settings — paths vary by OS):

```json
{
  "mcpServers": {
    "zowe-http": {
      "type": "streamable-http",
      "url": "http://localhost:7542/mcp",
      "headers": {
        "Authorization": "Bearer <paste-access-token-here>"
      }
    }
  }
}
```

For **stdio-only** setups (no HTTP), see [`roo-or-standalone-mcp.md`](roo-or-standalone-mcp.md).

## Port conflicts

- **Keycloak (host port):** default **`18080`**; override with **`KEYCLOAK_HOST_PORT`** as in [Keycloak host port](#keycloak-host-port).
- **MCP HTTP (7542 busy):** change the **`7542:7542`** mapping for the **`zowe-mcp`** service in **`docker/remote-dev/docker-compose.yml`**, and pass **`--port <N>`** with **`--http`** when starting MCP on the host (`zowe-mcp-server --help`). Update client **`mcp.json`** URLs to match.

In all cases, **`ZOWE_MCP_JWT_ISSUER`** must match the **`iss`** claim in tokens (the URL you use to call Keycloak’s token endpoint from the host).

## Production-oriented notes (API ML, HTTPS, proxies)

This guide uses **local Keycloak** and **plain HTTP** to MCP for developer speed. **Production** deployments typically:

- Terminate **HTTPS** at a **reverse proxy** (e.g. **nginx**) or load balancer and forward **`http://`** to the MCP process; set **`ZOWE_MCP_PUBLIC_BASE_URL`** and often **`ZOWE_MCP_OAUTH_RESOURCE`** to the **external** `https://` URL users and browsers see (see **`remote-http-mcp-registry.md`** — *HTTPS, reverse proxies, and public URLs*).

**Zowe API Mediation Layer (API ML):** Shops that standardize on **API ML** for OIDC and routing may eventually **register the MCP HTTP service** behind the gateway or align **JWT issuers** with the platform IdP. That is **not implemented** in this repo yet; it is tracked as future work in **`TODO.md`** and summarized in **`remote-http-mcp-registry.md`** (*Future: Zowe API ML and OIDC*).

## See also

- [`dev-oidc-tinyauth.md`](dev-oidc-tinyauth.md) — OIDC details, optional audience, Vitest Keycloak E2E (`ZOWE_MCP_KEYCLOAK_URL`; use **`http://localhost:18080`** with this stack unless you override **`KEYCLOAK_HOST_PORT`**).
- [`remote-http-mcp-registry.md`](remote-http-mcp-registry.md) — production registry / headers shape.
