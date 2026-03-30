# Local MCP Registry — Setup Guide

This guide runs the official [MCP registry](https://github.com/modelcontextprotocol/registry) on your local machine and publishes the Zowe MCP Server to it so you can browse and install it directly from the VS Code Copilot gallery.

Registry URL once running: **<http://localhost:8085>**
API docs: **<http://localhost:8085/docs>**

## Architecture

```text
VS Code Copilot chat
  chat.mcp.gallery.serviceUrl = http://localhost:8085
  ↓  GET /v0.1/servers
Local MCP Registry  (ghcr.io image + PostgreSQL, port 8080)
  name: io.modelcontextprotocol.anonymous/zowe-mcp-server
  package: @zowe/mcp-server (Zowe Artifactory)
```

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
# Still in packages/zowe-mcp-server/
mcp-publisher publish --registry=http://localhost:8085
```

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

## Step 4 — Point VS Code Copilot at the local registry

Open your VS Code user `settings.json` (**`Cmd+Shift+P` → "Preferences: Open User Settings (JSON)"**) and add:

```json
"chat.mcp.gallery.serviceUrl": "http://localhost:8085"
```

> **You must edit the JSON file directly, not through the Settings UI editor.**
> `chat.mcp.gallery.serviceUrl` is greyed out (disabled) in the graphical Settings editor on all
> VS Code editions — both stable and Insiders — because it is not registered as a user-visible
> setting. The enterprise equivalent is the `McpGalleryServiceUrl` group policy (Windows registry /
> MDM / plist) used by IT admins in Copilot Business/Enterprise organisations. For individual
> developers, adding it directly to the JSON file still takes effect at runtime immediately with no
> reload needed. To revert, remove or comment out the line — the default is `https://registry.modelcontextprotocol.io`.

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
mcp-publisher publish --registry=http://localhost:8085
```

## Stopping the registry

```bash
docker compose -f infrastructure/local-registry/docker-compose.yml down
```

Add `-v` to also delete the PostgreSQL data volume (full reset).

## Limitations

| Limitation | Explanation |
| --- | --- |
| Anonymous namespace | Published as `io.modelcontextprotocol.anonymous/zowe-mcp-server`. For a production entry use `io.github.zowe/zowe-mcp-server` (requires GitHub OAuth and the `@zowe` org). |
| Not on public npmjs.com | `@zowe/mcp-server` lives on Zowe Artifactory. VS Code's `npx @zowe/mcp-server` resolves correctly if your `.npmrc` points to Artifactory (already the case in this repo). On a machine without that config, the auto-install would fail. Publishing to public npmjs.com is the long-term fix. |
| Ephemeral storage | The PostgreSQL container uses no named volume; data is lost on `docker compose down`. This is intentional for local development. |
| No TLS | `http://localhost:8085` only. Suitable for local development; do not expose this port externally. |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `curl: connection refused` on port 8080 | Run `docker compose ps` — the registry container may still be waiting for Postgres to become healthy. Wait a few seconds and retry. |
| `mcp-publisher login` returns 404 | Confirm the registry is up: `curl http://localhost:8085/version` |
| `mcp-publisher publish` returns "permission denied" | Re-run `mcp-publisher login none --registry=http://localhost:8085` — the JWT may have expired. |
| Gallery is empty in VS Code | Confirm `chat.mcp.gallery.serviceUrl` is in the **JSON file** (`settings.json`), not the Settings UI — it is greyed out/disabled there on all editions. No reload needed; takes effect immediately. |
| `npx @zowe/mcp-server` fails after gallery install | Your `.npmrc` must include the Zowe Artifactory registry. Run `npm config get registry` to verify. |
