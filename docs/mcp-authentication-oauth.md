# Authentication, OAuth, and z/OS access for Zowe MCP

This document describes how **identity and secrets** work for the Zowe MCP server: **OAuth / OIDC at the HTTP MCP layer**, how **clients such as GitHub Copilot and VS Code** supply credentials, and how **z/OS access** is authenticated separately (SSH, not OAuth).

For **MCP registry** discovery, `server.json` shape, and the broader ecosystem, see **`docs/mcp-registry-research.md`**.

---

## Two separate layers

| Layer | Question it answers | Typical mechanism |
| --- | --- | --- |
| **MCP HTTP (optional)** | Who is this chat or IDE user talking to the MCP server? | OIDC access token as **`Authorization: Bearer`** — validated by Zowe MCP (resource server) or by a reverse proxy |
| **z/OS (native backend)** | How does the server connect to the mainframe? | **SSH** credentials: env (`ZOWE_MCP_CREDENTIALS`, `ZOWE_MCP_PASSWORD_*`), Vault KV, Kubernetes secrets, MCP elicitation, or per-tenant saved connection specs — **not** derived from the OAuth access token by default |

The IdP **`sub`** (and optional `email`) identify the **portal or chat user** at the MCP layer. They are **not** automatically the SAF user ID or SSH principal for z/OS. See **`docs/future-zos-identity-mapping.md`**.

---

## HTTP MCP: OAuth 2.1 / OIDC (resource server)

**Product policy:** Zowe MCP **does not embed** an OAuth 2.0 Authorization Server. It acts as a **resource server**: it validates access tokens issued by **your** IdP (Azure AD, Okta, Keycloak, Zowe API ML with OIDC, etc.).

Configure validation with:

- **`ZOWE_MCP_JWT_ISSUER`** — expected token issuer (`iss` claim)
- **`ZOWE_MCP_JWKS_URI`** — JWKS URL for signature verification
- **`ZOWE_MCP_JWT_AUDIENCE`** (optional) — expected `aud`

When issuer and JWKS are set, the HTTP transport exposes **OAuth protected resource metadata** at **`GET /.well-known/oauth-protected-resource`** and **`GET /.well-known/oauth-protected-resource/mcp`** (CORS enabled) so MCP clients can discover the authorization server. Optional **`ZOWE_MCP_OAUTH_RESOURCE`** sets the metadata `resource` URL when behind a reverse proxy.

For **multi-user** shared HTTP deployments, Bearer JWT validation (gateway or in-process) gives a stable per-user identity (`sub`). **VPN or network perimeter alone** does not establish end-user identity at the MCP layer. Undifferentiated shared secrets or ad-hoc identity headers are **not** adequate for multi-tenant service. **mTLS** may be added later as an additional binding.

**Multi-session HTTP:** Each client session uses Streamable HTTP; state is scoped per session. With JWT + **`ZOWE_MCP_TENANT_STORE_DIR`**, per-user connection lists are isolated on disk (see **`AGENTS.md`**, tenant persistence).

Local and lab setup: **`docs/dev-oidc-tinyauth.md`**, **`docs/remote-dev-keycloak.md`** (Keycloak + HTTPS MCP + native z/OS).

---

## MCP clients: VS Code and GitHub Copilot

### Private MCP registry URL (catalog)

Only **GitHub Copilot** (across multiple IDEs) natively supports a **custom MCP registry URL** as the discoverable catalog today. Set:

| Setting / policy | Purpose |
| --- | --- |
| **`chat.mcp.gallery.serviceUrl`** / **`McpGalleryServiceUrl`** | Base URL of a **v0.1-spec** MCP registry (`GET /v0.1/servers`). Replaces the default GitHub gallery for `@mcp` Extensions search |
| **`chat.mcp.access`** / **`ChatMCP`** | `allowed` (default), `registryOnly`, or `off` |

**VS Code** (from approximately **1.101**): add `"chat.mcp.gallery.serviceUrl": "https://your-registry.example.com"` **in `settings.json` JSON** — the graphical Settings UI often does **not** expose this field; JSON edit is supported for individuals while enterprises use policy.

**Confirmed behavior:** VS Code calls **`GET <gallery-service-url>/v0.1/servers`** to populate the server list. No window reload is always required; behavior matches your VS Code build.

### `chat.mcp.access` and what gets blocked

| Server type | `allowed` (default) | `registryOnly` |
| --- | --- | --- |
| From registry — stdio | Allowed | Allowed |
| From registry — remote HTTP | Allowed | Allowed |
| Direct **`mcp.json`** — remote HTTP | Allowed | **Blocked** |
| Direct **`mcp.json`** — localhost HTTP (sidecar) | Allowed | **Blocked** |
| Direct **`mcp.json`** — stdio | Allowed | **Blocked** |

**Localhost remote URLs** cannot appear in a public registry `remotes` entry (publisher tooling rejects them by design). Sidecar HTTP servers on `localhost` are only usable with **`chat.mcp.access: "allowed"`** and a direct `mcp.json` entry.

**Enterprise postures:**

- **Permissive:** `chat.mcp.access: "allowed"` + custom `chat.mcp.gallery.serviceUrl` — developers may still add manual `mcp.json` entries (including localhost sidecars).
- **Strict:** `chat.mcp.access: "registryOnly"` + **`McpGalleryServiceUrl`** via MDM — only servers present in the approved registry run; direct `mcp.json` and localhost sidecars are blocked.

Policy deployment (overrides user settings): Windows ADMX/Intune, macOS `.mobileconfig`, Linux `/etc/vscode/policy.json` (see VS Code enterprise AI documentation).

### GitHub org admin (Copilot Enterprise)

Admins can set the **MCP Registry URL** under **Settings → AI controls → MCP** and optionally **registry-only** enforcement so developers see only approved servers in the gallery. **Limitation (as of research period):** enforcement is largely **name/ID-based**; stricter verification may evolve — see current GitHub Docs on MCP allowlists.

### Other IDEs (Copilot)

- **JetBrains** — Copilot Chat → MCP → MCP Registry URL  
- **Eclipse / Xcode** — similar “MCP Registry URL” fields in Copilot settings (see product version notes)

### Remote HTTP: `Authorization` header and Bearer tokens

Registry entries for **`remotes`** often declare:

```http
Authorization: Bearer <access_token>
```

When a user installs a **remote HTTP** server from the gallery, VS Code can **prompt once** for the secret header value and store it securely. That token is the **OIDC access token** from your IdP (or an API key your gateway accepts), not the z/OS password.

**Browser OAuth for MCP:** For interactive flows, clients may perform OAuth against your IdP and attach the resulting access token to MCP requests. Inspectors and local dev setups are described in **`docs/remote-dev-keycloak.md`**.

### Clients without a gallery registry URL

**Cursor** (as of early 2026) did not ship native `chat.mcp.gallery.serviceUrl`-style catalog support; use project or user MCP config. **Claude Desktop** uses different extension upload models for MCPB — not the v0.1 registry URL. See **`docs/mcp-registry-research.md`** for the assistant comparison table.

---

## z/OS credentials (SSH / native backend)

The native backend uses **Zowe Native Proto over SSH**. There is **no OAuth** on the wire to z/OS.

**Precedence (standalone / server-side resolution)** is implemented in **`packages/zowe-mcp-server/src/zos/native/connection-spec.ts`**: per-connection env vars, then **`ZOWE_MCP_CREDENTIALS`** JSON map, optional **HashiCorp Vault KV**, then MCP elicitation when enabled.

**Registry-friendly env var:** **`ZOWE_MCP_CREDENTIALS`** maps `user@host` (or `user@host:port`) strings to passwords in one JSON object — fits static `server.json` `environmentVariables` and gallery secret prompts. The dynamic pattern **`ZOWE_MCP_PASSWORD_<USER>_<HOST>`** cannot be fully enumerated in metadata; document it in prose or use the JSON map.

**HTTP + JWT:** Central injection (Kubernetes secrets, Vault) for production; optional per-tenant connection files under **`ZOWE_MCP_TENANT_STORE_DIR`** with tools **`addZosConnection`** / **`removeZosConnection`** (see **`AGENTS.md`**). Optional **encrypt-at-rest** for tenant files: **`ZOWE_MCP_TENANT_STORE_KEY`**.

---

## Deployment sketch (HTTP)

```text
Developer IDE (Copilot / MCP client)
        │  HTTPS POST /mcp, Authorization: Bearer …
        ▼
  Reverse proxy — TLS, optional gateway JWT validation, rate limits
        ▼
  Zowe MCP (`--http`) — session via Streamable HTTP, optional in-process JWT validation
        ▼
  z/OS — SSH (ZNP); credentials from platform secrets, not from the OAuth token alone
```

**Per-organization URLs:** On-premises HTTP MCP uses a **different hostname per organization**; there is no single global endpoint. Registry `remotes` and client config both use **your** FQDN.

Step-by-step **registry registration** and **`mcp.json` examples**: **`docs/remote-http-mcp-registry.md`**.

### Dockerfile examples

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
EXPOSE 7542
CMD ["node", "dist/index.js", "--http", "--port", "7542", "--native", \
     "--system", "jsmith@mainframe.example.com"]
```

Or using the published npm package (once on public npmjs.com):

```dockerfile
FROM node:20-slim
RUN npm install -g @zowe/mcp-server
EXPOSE 7542
CMD ["zowe-mcp-server", "--http", "--port", "7542", "--native"]
```

### Kubernetes (sketch)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: zowe-mcp-server
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: zowe-mcp-server
          image: ghcr.io/yourorg/zowe-mcp-server:1.0.0
          ports:
            - containerPort: 7542
          env:
            - name: ZOWE_MCP_CREDENTIALS
              valueFrom:
                secretKeyRef:
                  name: zowe-mcp-credentials
                  key: credentials-json
```

### Example `remotes` entry (private MCP registry)

Each deployment has its **own** base URL — replace the hostname with your FQDN:

```json
{
  "name": "com.example/zowe-mcp-server",
  "title": "Zowe MCP Server",
  "description": "Internal z/OS MCP server — data sets, jobs, USS.",
  "version": "1.0.0",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://zowe-mcp.tools.example.com/mcp",
      "headers": [
        {
          "name": "Authorization",
          "description": "Bearer access token from the OIDC provider (validated as JWT at the MCP server or gateway)",
          "isSecret": true,
          "isRequired": true
        }
      ]
    }
  ]
}
```

---

## Related documentation

| Topic | Document |
| --- | --- |
| MCP registry ecosystem, `server.json`, publishing | **`docs/mcp-registry-research.md`** |
| Remote HTTP topology, `mcp.json`, gallery + Bearer | **`docs/remote-http-mcp-registry.md`** |
| Keycloak dev, HTTPS, Inspector | **`docs/remote-dev-keycloak.md`**, **`docker/remote-https-dev/README.md`** |
| Local OIDC / TinyAuth-style | **`docs/dev-oidc-tinyauth.md`** |
| JWT `sub` vs z/OS user (future) | **`docs/future-zos-identity-mapping.md`** |
| Standalone stdio, env passwords, tools | **`AGENTS.md`** |
