# Local MCP Registry — Setup Guide

This guide runs the official [MCP registry](https://github.com/modelcontextprotocol/registry) on your local machine and publishes the Zowe MCP Server to it so you can browse and install it directly from the VS Code Copilot gallery.

Registry URL once running: **<http://localhost:8085>**
API docs: **<http://localhost:8085/docs>**

## Architecture

```text
VS Code Copilot chat
  chat.mcp.gallery.serviceUrl = http://localhost:8085
    or https://registry.mcp.example.com:8445  (optional TLS via nginx; see below)
  ↓  GET /v0.1/servers
Local MCP Registry  (ghcr.io image + PostgreSQL, port 8080 on the Docker network)
  optional: nginx-registry-tls → registry:8080 (same cert.pem/key.pem as MCP/Keycloak; host registry.mcp.example.com)
  name: io.modelcontextprotocol.anonymous/zowe-mcp-server
  package: @zowe/mcp-server (Zowe Artifactory)
```

**Ports:** **8085** maps the registry container to **`http://localhost:8085`** (no TLS). **8445** (default **`REGISTRY_TLS_PORT`**) maps **nginx** for **`https://registry.mcp.example.com:8445`** when you use the TLS profile — same idea as **`zowe.mcp.example.com`** for the MCP HTTP stack in **`docker/remote-https-dev`**.

## Prerequisites

| Tool | Install | Notes |
| --- | --- | --- |
| Docker Desktop | <https://docs.docker.com/desktop/> | Must be running |
| mcp-publisher 1.5+ | `brew install mcp-publisher` | Pre-built macOS binary |
| VS Code 1.99+ | — | For `chat.mcp.gallery.serviceUrl` support |

Verify:

```bash
docker --version
mcp-publisher --help
```

## Step 1 — Start the registry

```bash
docker compose -f infrastructure/local-registry/docker-compose.yml up -d
```

This pulls `ghcr.io/modelcontextprotocol/registry:latest` and `postgres:16-alpine` — no Go or
`ko` toolchain required. The database is ephemeral; it resets each time the containers restart.

Wait for both containers to become healthy (usually < 10 seconds):

```bash
docker compose -f infrastructure/local-registry/docker-compose.yml ps
```

Confirm the registry API is up:

```bash
curl -s http://localhost:8085/v0.1/servers | python3 -m json.tool
# Expected: {"servers":[], "metadata": {...}}
```

### Optional — HTTPS via nginx (`registry.mcp.example.com`)

The compose file includes **`nginx-registry-tls`**, which terminates TLS and proxies to **`registry:8080`**, matching the pattern used for the MCP dev server behind **`zowe.mcp.example.com`**.

1. Add **`127.0.0.1 registry.mcp.example.com`** to **`/etc/hosts`** (or your OS equivalent).
2. Use the same **`cert.pem`** and **`key.pem`** as the Keycloak/MCP stack (**`docker/remote-https-dev/certs/README.md`**). That mkcert leaf already includes **`registry.mcp.example.com`**. The compose file mounts **`ZOWE_MCP_TLS_CERT_DIR`** (default **`../../docker/remote-https-dev/certs`** relative to **`infrastructure/local-registry/`**).
3. Start the stack (same command as Step 1). Nginx listens on host port **8445** by default; override with **`REGISTRY_TLS_PORT`**. Override the hostname with **`REGISTRY_HTTPS_HOST`** if you use a different name.

**VS Code gallery URL** when using HTTPS:

```json
"chat.mcp.gallery.serviceUrl": "https://registry.mcp.example.com:8445"
```

**`mcp-publisher`** against HTTPS must trust the mkcert CA (Node does not use the system store the same way as browsers). Example (macOS/Linux; path from **`mkcert -CAROOT`**):

```bash
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
mcp-publisher login none --registry=https://registry.mcp.example.com:8445
```

You can keep using **`http://localhost:8085`** for **`login`/`publish`** and **`curl`**; the registry container is unchanged — only the gallery URL needs HTTPS if you want Copilot to hit the same host naming as your other dev TLS services.

The wipe script (**`npm run local-registry:wipe-publish-dev`**) waits on **`MCP_LOCAL_REGISTRY_READY_URL`** (default **`http://localhost:8085`**) so readiness does not depend on nginx TLS. Set **`MCP_LOCAL_REGISTRY_URL`** to your HTTPS base if you publish through nginx.

## Step 2 — Authenticate (anonymous)

The local instance has anonymous auth enabled, which lets you publish to the
`io.modelcontextprotocol.anonymous/` namespace without a GitHub account.

```bash
cd packages/zowe-mcp-server
mcp-publisher login none --registry=http://localhost:8085
```

Expected output:

```text
Logging in with none...
✓ Successfully logged in
```

## Step 3 — Publish the server

```bash
# Still in packages/zowe-mcp-server/ (uses ./server.json by default)
mcp-publisher publish server.json --registry=http://localhost:8085
```

Put the **manifest path before** `--registry`. If you run `mcp-publisher publish --registry=… <file>.json`, the CLI **ignores** the file and publishes **`./server.json`** instead (you may see a **403** with the wrong `name`).

Expected output:

```text
Publishing to http://localhost:8085...
✓ Successfully published
✓ Server io.modelcontextprotocol.anonymous/zowe-mcp-server version 0.8.0
```

Confirm it appeared in the registry:

```bash
curl -s "http://localhost:8085/v0.1/servers?search=zowe" | python3 -m json.tool
```

You should see `"name": "io.modelcontextprotocol.anonymous/zowe-mcp-server"` in the response.

### Publishing `remote-server-example.json` / `remote-server-example-dev.json` (stdio + `remotes`)

`mcp-publisher` accepts an optional path to the manifest (default: `./server.json`). **Path must come before `--registry`** (see Step 3 note above).

**`remote-server-example-dev.json`** — **`remotes.url`** is a **concrete** HTTPS URL for the Keycloak dev MCP endpoint (`https://zowe.mcp.example.com:7542/mcp`) so the gallery does not need to resolve **`{placeholders}`**. **`remote-server-example.json`** illustrates **URL template variables** (same shape as public multi-tenant docs); for a **private on-prem** registry entry, substitute a **literal** hostname in `remotes[].url` before publishing—there is no automatic replacement at publish time (see **`docs/remote-http-mcp-registry.md`** — *URL template variables*).

**Local dev with anonymous auth** (`login none`) — use the **dev** copy, which uses **`io.modelcontextprotocol.anonymous/zowe-mcp-server`**:

```bash
cd packages/zowe-mcp-server
mcp-publisher publish remote-server-example-dev.json --registry=http://localhost:8085
```

**GitHub namespace** (`io.github.zowe/zowe-mcp-server`) — use **`remote-server-example.json`** and **`mcp-publisher login github`** (public org membership may be required for the `@zowe` org; see **Limitations** below):

```bash
mcp-publisher publish remote-server-example.json --registry=http://localhost:8085
```

**Namespace:** With **`mcp-publisher login none`**, you may only publish names under **`io.modelcontextprotocol.anonymous/*`**. If you see **403** when publishing **`remote-server-example.json`**, switch to **`remote-server-example-dev.json`** or use GitHub login. If the error shows **`io.github.zowe`** while you thought you published the dev file, check argument order (manifest first).

**Republish:** The registry rejects the same **`name`** + **`version`** twice. Bump **`version`** (top-level and in **`packages[]`**) in **`remote-server-example-dev.json`** before each new publish, or wipe the local registry DB (see **Troubleshooting** — duplicate version).

## Step 4 — Point VS Code Copilot at the local registry

Open your VS Code user `settings.json` (**`Cmd+Shift+P` → "Preferences: Open User Settings (JSON)"**) and add one of:

```json
"chat.mcp.gallery.serviceUrl": "http://localhost:8085"
```

or, if you enabled the nginx HTTPS front (**Optional — HTTPS via nginx** above):

```json
"chat.mcp.gallery.serviceUrl": "https://registry.mcp.example.com:8445"
```

> **You must edit the JSON file directly, not through the Settings UI editor.**
> `chat.mcp.gallery.serviceUrl` is greyed out (disabled) in the graphical Settings editor on all
> VS Code editions — both stable and Insiders — because it is not registered as a user-visible
> setting. IT can deploy the `McpGalleryServiceUrl` group policy (Windows registry / MDM / plist).
> **GitHub Copilot:** Without **Copilot Enterprise**, the same setting may remain ineffective for
> Copilot’s MCP gallery even when present in JSON — use an Enterprise-enabled org/account to test
> a **custom** private registry URL with Copilot. To revert, remove or comment out the line — the
> default is `https://registry.modelcontextprotocol.io`.

## Step 5 — Install from the gallery in VS Code Copilot

1. Open Copilot Chat (`Ctrl+Alt+I` / `Cmd+Alt+I`)
2. Switch to **Agent mode** (the `@` / tools toggle)
3. Click **Add MCP Server** (the plug icon or `+` in the tools list)
4. Choose **Browse MCP Gallery**
5. You should see **Zowe MCP Server** listed
6. Click **Install** — VS Code writes an entry to `.vscode/mcp.json`

After install, configure the server in `.vscode/mcp.json`. For mock mode (no z/OS needed):

```json
{
  "mcpServers": {
    "zowe-mcp-server": {
      "command": "npx",
      "args": ["@zowe/mcp-server", "--stdio", "--mock"],
      "env": {
        "ZOWE_MCP_MOCK_DIR": "/absolute/path/to/your/mock-data"
      }
    }
  }
}
```

Generate mock data if you do not have it yet:

```bash
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data
```

## Updating the registry entry

When the server version changes, update `server.json`, re-authenticate if the session expired,
and re-publish:

```bash
cd packages/zowe-mcp-server
mcp-publisher publish server.json --registry=http://localhost:8085
```

## Stopping the registry

```bash
docker compose -f infrastructure/local-registry/docker-compose.yml down
```

Containers stop; **published catalog data may remain** in Docker volumes until you remove them (see **Wiping the local catalog** below).

## Wiping the local catalog (remove all published servers)

There is **no** `mcp-publisher` delete/unpublish command. The [official MCP registry FAQ](https://modelcontextprotocol.io/registry/faq) also states there is **no** self-service removal of versions on the public registry; published metadata is **immutable** per version (you add new versions instead).

For **this local** Docker registry, the practical way to remove **everything** you published is to destroy the PostgreSQL data and start clean:

```bash
docker compose -f infrastructure/local-registry/docker-compose.yml down -v
docker compose -f infrastructure/local-registry/docker-compose.yml up -d
```

Wait until Postgres is healthy (~10 seconds), then confirm the catalog is empty:

```bash
curl -s http://localhost:8085/v0.1/servers | python3 -m json.tool
# Expected: "servers": [] (or empty array)
```

Re-run **`mcp-publisher login none`** if your session was tied to the old DB, then publish again from **`server.json`** or **`remote-server-example-dev.json`**.

Use a full wipe when you hit **duplicate version** and prefer to re-use the same **`version`** string, or when you want a clean slate without bumping semver in the manifest.

### One command: wipe and republish the dev manifest

From the **repository root**:

```bash
npm run local-registry:wipe-publish-dev
```

This runs **`scripts/local-registry-wipe-publish-dev.sh`**: **`docker compose … down -v`** and **`up -d`** for **`infrastructure/local-registry/docker-compose.yml`**, waits until **`GET /v0.1/servers`** responds on **`MCP_LOCAL_REGISTRY_READY_URL`** (default **`http://localhost:8085`**), then **`mcp-publisher login none`** and **`mcp-publisher publish`** for **`packages/zowe-mcp-server/remote-server-example-dev.json`** (manifest path before **`--registry`**).

Requires **Docker**, **`mcp-publisher`** on your **`PATH`**, and **`curl`**. Override **`MCP_LOCAL_REGISTRY_URL`** for **`login`/`publish`** (default **`http://localhost:8085`**; use **`https://registry.mcp.example.com:8445`** with **`NODE_EXTRA_CA_CERTS`** if publishing through nginx). Keep **`MCP_LOCAL_REGISTRY_READY_URL`** on plain HTTP unless you changed the host port mapping.

## Limitations

| Limitation | Explanation |
| --- | --- |
| Anonymous namespace | Published as `io.modelcontextprotocol.anonymous/zowe-mcp-server`. For a production entry use `io.github.zowe/zowe-mcp-server` (requires GitHub OAuth and the `@zowe` org). |
| Not on public npmjs.com | `@zowe/mcp-server` lives on Zowe Artifactory. VS Code's `npx @zowe/mcp-server` resolves correctly if your `.npmrc` points to Artifactory (already the case in this repo). On a machine without that config, the auto-install would fail. Publishing to public npmjs.com is the long-term fix. |
| Ephemeral storage | Catalog data lives in Docker volumes. Use **`docker compose … down -v`** to wipe it; see **Wiping the local catalog** above. |
| TLS | Default is plain HTTP on **`localhost:8085`**. Optional **HTTPS** on **`registry.mcp.example.com:8445`** via **`nginx-registry-tls`** using **`docker/remote-https-dev/certs`**; do not expose either port to untrusted networks without proper controls. |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Browser or VS Code shows **SSL error** for **`https://registry.mcp.example.com:8445`** | Regenerate the leaf cert with **`registry.mcp.example.com`** in SAN (**`docker/remote-https-dev/certs/README.md`**), restart **`nginx-registry-tls`**, confirm **`/etc/hosts`**. |
| `curl: connection refused` on port 8080 | Run `docker compose ps` — the registry container may still be waiting for Postgres to become healthy. Wait a few seconds and retry. |
| `mcp-publisher login` returns 404 | Confirm the registry is up: `curl http://localhost:8085/version` |
| `mcp-publisher publish` returns "permission denied" | Re-run `mcp-publisher login none --registry=http://localhost:8085` — the JWT may have expired. |
| **403** with `io.github.zowe` while publishing `remote-server-example-dev.json` | You ran `publish --registry=… <file>`; the CLI used **`server.json`** instead. Use **`mcp-publisher publish <manifest.json> --registry=http://localhost:8085`** (manifest **before** `--registry`). |
| **400** `cannot publish duplicate version` | The registry already has this **`name`** + **`version`**. Bump **`version`** in the manifest (semver; e.g. `0.8.0-2` after `0.8.0-1`) and publish again, or reset the DB: **`docker compose -f infrastructure/local-registry/docker-compose.yml down -v`** then **`up -d`** (empty catalog). |
| **422** `body.description` / `expected length <= 100` | The MCP registry limits **`description`** to **100 characters**. Shorten the string (match **`server.json`**) or move details into docs. |
| Gallery is empty in VS Code / Copilot | Confirm `chat.mcp.gallery.serviceUrl` is in the **JSON file** (`settings.json`), not the Settings UI — it is greyed out/disabled there on all editions. For **GitHub Copilot** with a **custom** registry URL, use **Copilot Enterprise** if the gallery stays on the default catalog. No reload needed when the setting applies. |
| `npx @zowe/mcp-server` fails after gallery install | Your `.npmrc` must include the Zowe Artifactory registry. Run `npm config get registry` to verify. |
