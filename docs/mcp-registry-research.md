# MCP Registry Research

> **Status:** Research document — March 2026. The MCP Registry ecosystem is moving fast; features marked "preview" are expected to reach GA by end of 2026.

---

## Table of Contents

1. [What is an MCP Registry?](#1-what-is-an-mcp-registry)
2. [The Registry Ecosystem](#2-the-registry-ecosystem)
3. [Public Registries and Aggregators](#3-public-registries-and-aggregators)
4. [Registry Entry Format (server.json)](#4-registry-entry-format-serverjson)
5. [Versioning and Prereleases](#5-versioning-and-prereleases)
6. [Remote HTTP Streamable vs stdio Servers in the Registry](#6-remote-http-streamable-vs-stdio-servers-in-the-registry)
7. [Publishing the Zowe MCP Server](#7-publishing-the-zowe-mcp-server)
8. [Getting Listed on github.com/mcp](#8-getting-listed-on-githubcommcp)
9. [Private and Self-Hosted Registries](#9-private-and-self-hosted-registries)
10. [AI Assistants That Support a Private Registry URL](#10-ai-assistants-that-support-a-private-registry-url)
11. [Enterprise Governance: Limiting Which Servers Can Be Used](#11-enterprise-governance-limiting-which-servers-can-be-used)
12. [Deploying the Zowe MCP Server as an HTTP Streamable Service](#12-deploying-the-zowe-mcp-server-as-an-http-streamable-service)
13. [Using github.com/mcp Servers Internally Under a Registry-Only Policy](#13-using-githubcommcp-servers-internally-under-a-registry-only-policy)

---

## 1. What is an MCP Registry?

An MCP registry is a **metadata catalog** — it does not host code or binaries. Think of it as the index layer of a package manager (like what npmjs.com's search index is to npm packages), applied to MCP servers.

A registry stores `server.json` files describing:

- **Name** — a unique reverse-DNS identifier, e.g. `io.github.zowe/zowe-mcp-server`
- **Where the artifact lives** — pointer to an npm package, PyPI package, Docker image, GitHub release binary, or a remote HTTP URL
- **How to run it** — CLI command, args, environment variables, transport type (`stdio` or `streamable-http`/`sse`)
- **Discovery metadata** — description, tags, repository link, license

A registry is primarily consumed by IDE tooling and aggregator sites, not directly by end users. When a developer types `@mcp` in VS Code Extensions search, VS Code calls the registry API and shows the results.

**Key distinction from package registries:**

| | Package registry (npm, PyPI, Docker Hub) | MCP registry |
| --- | --- | --- |
| Hosts | Actual code / binaries | Metadata only |
| Examples | npmjs.com, pypi.org, ghcr.io | registry.modelcontextprotocol.io |
| Relationship | Artifact source | Points to artifact source |

A single MCP registry entry (a `server.json`) can list multiple deployment targets — e.g. an npm package (for stdio install) _and_ a remote HTTPS URL (for direct HTTP Streamable access).

---

## 2. The Registry Ecosystem

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Official MCP Registry  registry.modelcontextprotocol.io            │
│  (Anthropic / GitHub / PulseMCP / Microsoft steering committee)      │
│  Hosts server.json metadata. References packages on:                 │
│  npmjs.com · pypi.org · nuget.org · Docker Hub/GHCR · GitHub releases│
└───────────────────────┬─────────────────────────────────────────────┘
                        │ aggregators poll via REST API
          ┌─────────────┼──────────────────┐
          ▼             ▼                  ▼
   github.com/mcp   PulseMCP (~7k)     Glama (~9k) / mcp.so (~17k)
   (91 curated)     (official mirror)  Smithery (~3k gateway)
          │
          ▼  (chat.mcp.gallery.serviceUrl — v0.1 spec only)
   VS Code Extensions @mcp gallery
   JetBrains / Eclipse / Xcode MCP panel
          │
          ▼
   Private enterprise registry  (self-hosted Docker / Azure API Center /
          │                       ToolHive / Bedrock AgentCore Gateway)
          │ chat.mcp.gallery.serviceUrl
          ▼
   Developer's VS Code (registryOnly policy applied)
```

The official registry is backed by Anthropic, GitHub, PulseMCP, and Microsoft. It is currently **in preview** (API frozen at v0.1 since October 2025, GA not yet announced).

---

## 3. Public Registries and Aggregators

### Official MCP Registry

**URL:** `https://registry.modelcontextprotocol.io`
**GitHub:** `github.com/modelcontextprotocol/registry`

The authoritative source. Downstream aggregators poll it hourly. Publishing here propagates automatically to all major aggregators and to the VS Code Extensions gallery.

### github.com/mcp

**URL:** `https://github.com/mcp`

A **curated hand-picked list** of ~91 servers maintained by GitHub (March 2026). Features one-click "Install in VS Code" buttons. Includes servers from Microsoft, HashiCorp, Stripe, MongoDB, Figma, GitHub, Notion, and other prominent organizations. It pulls from the official registry but GitHub manually approves which servers appear here.

To be listed: publish to the official registry first, then email `partnerships@github.com`. GitHub reviews and approves.

### Aggregators and Marketplaces

The MCP ecosystem has two fundamentally different types of public sites. Understanding the distinction matters for enterprise governance and Copilot integration:

| Type | Description | Example |
| --- | --- | --- |
| **v0.1-spec registry** | Implements the MCP registry REST API (`GET /v0.1/servers`, `/versions/latest`). Works as `chat.mcp.gallery.serviceUrl` in VS Code Copilot. | Official registry, Azure API Center, ToolHive |
| **Marketplace / directory** | Own API and UI. Richer features (hosting, chat, VM isolation, monetization). NOT compatible with `chat.mcp.gallery.serviceUrl`. | Smithery, Glama, mcp.so, PulseMCP |

#### Discovery directories (no hosting)

| Site | Servers | Key features | Copilot gallery? |
| --- | --- | --- | --- |
| **mcp.so** | 17,186+ | Largest catalog; multi-language (EN/CN/JP); built-in playground for testing servers; community submissions | No |
| **PulseMCP** (`pulsemcp.com`) | 6,970+ | Founding member of MCP Steering Committee; weekly newsletter; REST API; mirrors official registry | No (own API) |
| **Cursor Directory** (`cursor.directory`) | 1,800+ | Cursor IDE community hub; combines MCP + cursor rules + job board; 44,600+ community members | No |

#### Marketplaces with hosting

| Site | Servers | Model | Security | Copilot gallery? |
| --- | --- | --- | --- | --- |
| **Smithery** (`smithery.ai`) | 3,300+ verified | Proxy/gateway — Smithery proxies your HTTPS server; brings your own hosting or use CLI deploy | Own security model; 2025 had a breach exposing 3,000+ server configs | No — own API |
| **Glama** (`glama.ai`) | 9,000+ | Hosting + directory; Firecracker VM isolation for all hosted servers; AI chat interface; sub-registry architecture (can mirror official registry) | Firecracker VMs, best in class | No (sub-registry mirrors, but own API) |
| **Apify** (`apify.com`) | 7,000+ | Specialized in web scraping / automation MCP servers (Actors); 80% revenue share; 20–30% affiliate commissions | Standard | No |
| **MCPize** (`mcpize.com`) | 100+ | OpenAPI → native MCP conversion; 85% revenue share; monetization-first; CLI + templates | Standard | No |
| **RapidAPI MCP** (`rapid-mcp.com`) | 2M+ APIs | Runtime conversion of existing REST APIs to MCP on-the-fly; zero-code; 10+ endpoints can overflow context window | Standard | No |

#### How Smithery and Glama relate to the official registry

**Smithery** is a CDN/gateway that proxies HTTP Streamable servers. Publishing to Smithery is separate from and unrelated to the official MCP registry — Smithery has its own CLI and API. A server can be in both. Smithery is not compatible with `chat.mcp.gallery.serviceUrl`.

**Glama** implements a "sub-registry" concept — a layer built on top of the official registry that can curate, filter, and augment official entries. Glama's private sub-registry product lets enterprises create an internal catalog populated from the official registry plus their own servers. This is architecturally interesting but uses Glama's own API, not the v0.1 spec.

**PulseMCP** is the most tightly integrated with the official registry — it is a founding Steering Committee member and mirrors official registry data, making it useful for monitoring new server publications.

Publishing to the official registry automatically propagates metadata to PulseMCP, Glama, and mcp.so within a few hours. Smithery requires a separate publish step.

---

## 4. Registry Entry Format (server.json)

Full schema: `github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/server.schema.json`

### Core fields

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.zowe/zowe-mcp-server",
  "title": "Zowe MCP Server",
  "description": "MCP server for z/OS — data sets, jobs, and USS via SSH.",
  "version": "1.0.0",
  "repository": {
    "url": "https://github.com/zowe/zowe-mcp",
    "source": "github"
  },
  "license": "EPL-2.0",
  "packages": [ ... ],
  "remotes": [ ... ]
}
```

### stdio package entry

```json
"packages": [
  {
    "registryType": "npm",
    "identifier": "@zowe/mcp-server",
    "version": "1.0.0",
    "transport": { "type": "stdio" },
    "arguments": [
      {
        "description": "Transport type",
        "value": "--stdio",
        "isRequired": true
      },
      {
        "description": "Connection spec (user@host or user@host:port)",
        "name": "--system",
        "isRequired": false
      }
    ],
    "environmentVariables": [
      {
        "name": "ZOWE_MCP_PASSWORD_USER_HOST",
        "description": "Password for a z/OS connection. Variable name follows the pattern ZOWE_MCP_PASSWORD_<USER>_<HOST> (uppercase, dots replaced with underscores). Example: ZOWE_MCP_PASSWORD_JSMITH_MAINFRAME_EXAMPLE_COM",
        "isSecret": true,
        "isRequired": false
      }
    ]
  }
]
```

### Remote HTTP Streamable entry

```json
"remotes": [
  {
    "type": "streamable-http",
    "url": "https://zowe-mcp.internal.example.com/mcp",
    "headers": [
      {
        "name": "Authorization",
        "description": "Bearer token or API key",
        "isSecret": true,
        "isRequired": true
      }
    ]
  }
]
```

Both `packages` and `remotes` can coexist in a single entry, letting clients choose their preferred installation method.

### Authentication / secrets in server.json

The registry entry declares **what credentials are needed**, not the credentials themselves:

- `isSecret: true` — the client knows to mask this value in the UI and store it securely
- `isRequired: false` — marks optional credentials
- `format` — hints the data type (`"string"`, `"url"`, etc.)

There is **no enforcement mechanism** in the registry itself — it is metadata only.

### The per-host password env var pattern

The Zowe MCP server uses a dynamic env var naming convention:
`ZOWE_MCP_PASSWORD_<USER>_<HOST>` (uppercased, dots/colons/dashes replaced with underscores).

**This pattern cannot be fully enumerated in `server.json`** because the variable name depends on which z/OS systems the user has configured — that information is not known at publish time.

The registry `environmentVariables` array expects a **static, fixed list** of names. Two practical options for the registry metadata:

**Option A — Document the pattern (current approach)**
Declare one representative `environmentVariables` entry with a `description` that explains the naming convention. MCP clients will prompt for that value by name; the user must also set any additional `ZOWE_MCP_PASSWORD_*` vars manually.

**Option B — Single consolidated credentials env var (registry-friendly)**
Add support for a single env var (e.g. `ZOWE_MCP_CONNECTIONS`) containing all credentials as a compact JSON string:

```json
{ "jsmith@mainframe.example.com": "s3cret", "jsmith@dev.example.com": "dev123" }
```

This is a fixed, statically-declared env var name that works naturally with the registry schema and with MCP client secret prompting. The server would parse it on startup. This is the approach other multi-connection MCP servers use.

The registry strongly prefers Option B because:

- MCP client UIs (VS Code input prompts, Claude Desktop, etc.) can present a single secret field
- Enterprise secret managers (Vault, Doppler) map cleanly to fixed env var names
- `isSecret: true` on a single var triggers consistent masking in all compliant clients

---

## 5. Versioning and Prereleases

Versions are **immutable** once published. Rules:

| Version string | Type | Status |
| --- | --- | --- |
| `1.0.0` | Semantic | Recommended |
| `1.0.0-beta.1` | Semver prerelease | Recommended — sorts before `1.0.0`, won't steal "latest" |
| `1.0.0-rc.2` | Semver prerelease | Recommended |
| `2025.11.25` | Date-based | Recommended |
| `v1.0` | Prefixed | Allowed |
| `^1.2.3` / `~1.2.3` / `1.x` | Version ranges | Prohibited |

**Key behaviors:**

- Publishing `1.0.0-beta.1` after `1.0.0` will **not** replace "latest" because prereleases sort below their release version in semver
- There is currently **no unpublish** — once a version is published it stays (open issue, under discussion)
- To update metadata without changing the underlying package version, use registry-only version bumps: publish `server.json` at version `1.0.0-2` pointing to npm `1.0.0`
- Align `server.json` version with npm package version to avoid confusion

---

## 6. Remote HTTP Streamable vs stdio Servers in the Registry

| Aspect | stdio (local) | Remote HTTP Streamable |
| --- | --- | --- |
| `server.json` key | `packages[]` | `remotes[]` |
| Transport types | `stdio` | `streamable-http` or `sse` |
| Artifact location | npm / PyPI / Docker / MCPB binary | Publicly accessible HTTPS URL |
| Developer prerequisite | Node.js / Python / Docker on their machine | Nothing — connects over HTTP |
| Authentication | env vars (`isSecret: true`) | OAuth 2.1 or HTTP header API key |
| Multi-tenant | One instance per machine | URL template variables `{tenant_id}` for different endpoints |
| Enterprise governance | Allowlist enforced by server name/ID | Same allowlist; additionally OAuth at HTTP layer |
| Data privacy | Process runs locally on developer machine | All requests reach the remote server |
| Scalability | One user per process | Horizontally scalable; shared by many users |
| Public registry requirement | Package must be on a **public** registry (npmjs.com, pypi.org) | Remote URL must be **publicly accessible** |

**For the official MCP registry, remote servers must have a publicly reachable URL.** An intranet-only URL (`https://zowe-mcp.internal`) cannot be published to the public registry. It can, however, be published to a **private enterprise registry**.

---

## 7. Publishing the Zowe MCP Server

### Current blocker: npm registry

`@zowe/mcp-server` is currently published only to **Zowe Artifactory** (`zowe.jfrog.io/artifactory/api/npm/npm-release/`). The official MCP registry supports **only `registry.npmjs.org`** (the public npmjs.com).

To publish to the official registry, `@zowe/mcp-server` must also be published to **public npmjs.com**.

### Step-by-step for the official registry

1. **Publish to public npmjs.com**

   ```bash
   npm publish --access public --registry https://registry.npmjs.org
   ```

   (In addition to Artifactory; both can coexist via the CI pipeline.)

2. **Add `mcpName` to `package.json`**

   ```json
   {
     "name": "@zowe/mcp-server",
     "mcpName": "io.github.zowe/zowe-mcp-server"
   }
   ```

   The registry cross-checks this field to verify ownership.

3. **Create `server.json`** (in the repo root or a `registry/` directory)

   ```json
   {
     "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
     "name": "io.github.zowe/zowe-mcp-server",
     "title": "Zowe MCP Server",
     "description": "MCP server for IBM z/OS. Provides AI tools for browsing data sets, running jobs, USS file operations, and TSO/console commands via SSH.",
     "version": "1.0.0",
     "repository": {
       "url": "https://github.com/zowe/zowe-mcp",
       "source": "github"
     },
     "license": "EPL-2.0",
     "packages": [
       {
         "registryType": "npm",
         "identifier": "@zowe/mcp-server",
         "version": "1.0.0",
         "transport": { "type": "stdio" },
         "arguments": [
           { "value": "--stdio", "isRequired": true, "description": "Use stdio transport" },
           { "value": "--native", "isRequired": false, "description": "Use native z/OS backend (SSH)" },
           { "value": "--mock", "isRequired": false, "description": "Use filesystem mock backend" }
         ],
         "environmentVariables": [
           {
             "name": "ZOWE_MCP_CONNECTIONS",
             "description": "JSON object mapping connection specs (user@host) to passwords. Example: {\"jsmith@mainframe.example.com\":\"s3cret\"}",
             "isSecret": true,
             "isRequired": false
           },
           {
             "name": "ZOWE_MCP_MOCK_DIR",
             "description": "Path to the mock data directory (use with --mock)",
             "isRequired": false
           }
         ]
       }
     ]
   }
   ```

4. **Authenticate with GitHub OAuth**

   ```bash
   brew install mcp-publisher  # v1.5.0+ available via Homebrew
   mcp-publisher login github
   # Opens browser → authorize the Zowe GitHub org
   ```

   **GitHub org membership must be public.** The registry checks your GitHub org membership
   to authorize the `io.github.<org>/` namespace. If your membership in `github.com/zowe` is
   set to "Private", the publish will fail with:

   ```text
   403: You do not have permission to publish this server.
   You have permission to publish: io.github.<your-username>/*.
   ```

   Fix: go to `https://github.com/orgs/zowe/people`, find yourself, and change visibility
   to "Public". Then re-run `mcp-publisher login github` and publish.

   The registry verifies public membership via the GitHub API endpoint
   `GET /orgs/{org}/public_members/{username}` (returns 204 when public). Note that
   `GET /orgs/{org}/members/{username}` always returns 302 for non-org-admins and is
   **not** the right endpoint to check — use `/public_members/` to verify visibility
   yourself before troubleshooting.

   After making membership public you **must re-login** — the existing JWT was issued
   before the visibility change and the registry will keep returning 403 until a new token
   is issued.

   Alternatively, any individual member can publish under their personal namespace
   (`io.github.<username>/`) without org membership visibility — useful for personal forks
   or testing before the org is ready.

5. **Publish**

   ```bash
   mcp-publisher publish
   ```

   To publish to a **local test registry** instead (e.g. before the npm package is on public npmjs.com), use the `--registry=` flag with `none` auth:

   ```bash
   mcp-publisher login none --registry=http://localhost:8085
   mcp-publisher publish --registry=http://localhost:8085
   ```

   Note: anonymous publishing requires the `server.json` `name` to start with `io.modelcontextprotocol.anonymous/`. See [`docs/local-registry-setup.md`](local-registry-setup.md) for the full local registry runbook.

6. **Automate via GitHub Actions** (on every release tag)

   ```yaml
   - name: Publish to MCP Registry
     run: |
       ./mcp-publisher login github-oidc
       ./mcp-publisher publish
   ```

### Namespace choices

| Namespace | Format | Auth method | Notes |
| --- | --- | --- | --- |
| `io.github.zowe/zowe-mcp-server` | GitHub-based | GitHub OAuth | Simplest; tied to `github.com/zowe` org |
| `org.zowe/mcp-server` | Domain-based | DNS TXT record on `zowe.org` | More authoritative; requires DNS control |

---

## 8. Getting Listed on github.com/mcp

`github.com/mcp` is **not the same** as the official MCP registry — it is GitHub's own curated subset (~91 servers as of March 2026), shown with one-click "Install" buttons in VS Code.

**Process:**

1. Complete the official registry publication steps above
2. Email **`partnerships@github.com`** requesting inclusion, noting:
   - Open Mainframe Project / Linux Foundation affiliation
   - Enterprise z/OS use case
   - Stable, non-preview release

**Likely requirements (based on currently listed servers):**

- Server published to official registry
- Public GitHub repository
- Well-known organization (verified org badge helps)
- Stable, production-quality server

There is no self-service submission — GitHub reviews manually.

---

## 9. Private and Self-Hosted Registries

Private registries are needed when:

- Your MCP servers are only available on an internal package registry (Artifactory)
- Your remote MCP server is only accessible on an intranet
- You want to curate a company-approved subset of public servers

### Option comparison

| Option | Copilot gallery? | Infra to run | Cost | Best for |
| --- | --- | --- | --- | --- |
| **A** Self-hosted Docker image | Yes (v0.1 spec) | Container + PostgreSQL | Free (open source) | Full control, local testing |
| **B** Azure API Center | Yes (v0.1 spec) | None (SaaS) | Free tier | Azure shops, Copilot Enterprise |
| **C** Stacklok / ToolHive | Yes (v0.1 spec) | Container / SaaS | Open source + Enterprise | Cursor-heavy orgs, supply-chain security |
| **D** Docker MCP Catalog | Indirectly (Docker Desktop) | Docker Desktop | Free | Container-native orgs |
| **E** Build your own | Yes (v0.1 spec) | Any (nginx, Express) | Free | Minimal needs, static JSON |
| **F** Amazon Bedrock AgentCore | No (own API) | None (SaaS) | AWS pricing | AWS-native shops, serverless |
| **G** Cloudflare Workers | Hosting only (not registry) | None (SaaS edge) | Free tier | Edge-hosted HTTP Streamable servers |
| **H** Archestra | Yes (v0.1 spec) | None (SaaS) | Commercial | Enterprise, no infra overhead |

### Option A: Official registry Docker image (simplest)

The MCP project ships a pre-built Docker image (`ghcr.io/modelcontextprotocol/registry:latest`) to GHCR — no Go toolchain or `ko` builder needed. It requires a PostgreSQL sidecar.

**Verified working `docker-compose.yml`:**

```yaml
services:
  registry:
    image: ghcr.io/modelcontextprotocol/registry:latest
    container_name: mcp-registry
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      MCP_REGISTRY_DATABASE_URL: postgres://mcpregistry:mcpregistry@postgres:5432/mcp-registry
      # Public dev credentials from upstream .env.example — no real privileges, safe to commit
      MCP_REGISTRY_GITHUB_CLIENT_ID: Iv23licy3GSiM9Km5jtd
      MCP_REGISTRY_GITHUB_CLIENT_SECRET: 0e8db54879b02c29adef51795586f3c510a9341d
      MCP_REGISTRY_JWT_PRIVATE_KEY: bb2c6b424005acd5df47a9e2c87f446def86dd740c888ea3efb825b23f7ef47c
      # Enable anonymous publishing to io.modelcontextprotocol.anonymous/* (dev/test only)
      MCP_REGISTRY_ENABLE_ANONYMOUS_AUTH: "true"
      # Disable npm-registry existence checks (needed when package is not yet on npmjs.com)
      MCP_REGISTRY_ENABLE_REGISTRY_VALIDATION: "false"
      # Blank = start empty; set to https://registry.modelcontextprotocol.io/v0/servers to mirror
      MCP_REGISTRY_SEED_FROM: ""
    ports:
      - "8085:8080"   # use any free port; 8080 is often occupied
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: mcp-registry-postgres
    environment:
      POSTGRES_DB: mcp-registry
      POSTGRES_USER: mcpregistry
      POSTGRES_PASSWORD: mcpregistry
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mcpregistry -d mcp-registry"]
      interval: 1s
      retries: 30
    restart: unless-stopped
```

```bash
docker compose up -d
# Verify (empty on first start):
curl -s http://localhost:8085/v0.1/servers
# → {"servers":[],"metadata":{"count":0}}
```

**Publish a server (anonymous, for local testing):**

```bash
# mcp-publisher 1.5.0+ available via brew
brew install mcp-publisher

# "none" is the CLI method name for anonymous auth (not "anonymous")
mcp-publisher login none --registry=http://localhost:8085
mcp-publisher publish --registry=http://localhost:8085
```

The `server.json` `name` must start with `io.modelcontextprotocol.anonymous/` when using anonymous auth, e.g. `io.modelcontextprotocol.anonymous/my-mcp-server`.

**Important practical notes:**

- Port 8080 is commonly occupied (dev servers, other tools). Use any free port via the `ports` mapping — the `--registry=` flag on `mcp-publisher` accepts any URL.
- `MCP_REGISTRY_ENABLE_ANONYMOUS_AUTH: "true"` is already the default in the upstream `docker-compose.yml`. Omitting it defaults to `true` in dev mode.
- `MCP_REGISTRY_ENABLE_REGISTRY_VALIDATION: "false"` skips the npm-registry check. This is what allows publishing a server whose npm package is on Artifactory (not public npmjs.com) to a local test registry.
- **GitHub org membership must be public for org namespaces.** When using `mcp-publisher login github`, the registry checks your org membership to authorize `io.github.<org>/` namespaces. If your membership in the org is "Private", publishing will fail with a 403 (`"You have permission to publish: io.github.<your-username>/*"`). Fix at `https://github.com/orgs/<org>/people`. After making it public, you **must re-login** — the existing JWT was issued before the change and will keep returning 403. Verify propagation with `curl https://api.github.com/orgs/<org>/public_members/<username>` (204 = public, 404 = not public). Note: `/orgs/<org>/members/<username>` always returns 302 for non-admins and is not a useful check. Your personal namespace (`io.github.<username>/`) always works without this requirement.
- The published entry includes a `_meta` field with `publishedAt`, `updatedAt`, `isLatest` from the registry itself — useful for verifying the entry landed correctly.
- A ready-to-use `docker-compose.yml` is at [`infrastructure/local-registry/docker-compose.yml`](../infrastructure/local-registry/docker-compose.yml) with step-by-step instructions in [`docs/local-registry-setup.md`](local-registry-setup.md).

**Note:** The registry maintainers do not officially support self-hosting — if you fork it, you maintain it independently.

Minimum infrastructure: PostgreSQL database + the registry container. Accessible at `http://localhost:8085` locally or behind a reverse proxy with TLS for production.

### Option B: Azure API Center (managed, no PostgreSQL)

Microsoft positions Azure API Center as the turnkey option — no database to manage, automatic CORS, built-in governance, and native integration with GitHub Copilot Enterprise. Free tier is sufficient for basic use.

**Setup:**

1. Create an Azure API Center instance in the Azure portal
2. Register MCP servers using the MCP asset type (Portal → APIs → Add API → MCP)
3. Enable **anonymous access** (Portal → Settings → Save + Publish) — required for Copilot to fetch the registry without additional auth
4. Note the **data-plane endpoint** (not the portal URL): `https://<name>.data.<region>.azure-apicenter.ms`

**Connecting to VS Code / GitHub Copilot:**
Use only the base data-plane URL — do NOT append `/workspaces/default` or `/v0.1/servers`:

```json
"chat.mcp.gallery.serviceUrl": "https://<name>.data.<region>.azure-apicenter.ms"
```

Or in GitHub org settings: **Settings → AI controls → MCP → MCP Registry URL** → paste the same base URL.

**Benefits vs. self-hosted Docker:**

| | Self-hosted Docker | Azure API Center |
| --- | --- | --- |
| PostgreSQL required | Yes | No |
| CORS configuration | Manual | Automatic |
| Infrastructure cost | Container + DB | Free tier available |
| GitHub Copilot Enterprise integration | Manual | Native |
| Audit logs | DIY | Azure Monitor |

### Option C: Stacklok / ToolHive (enterprise governance platform)

[Stacklok](https://stacklok.com) provides a full MCP governance stack as open source:

- **Private curated registry** — admin-controlled "app store" for AI tools
- **Secure runtime** — servers run in isolated containers with encrypted secrets
- **Intelligent gateway** — enforces org policies, centralized audit logging (OpenTelemetry)
- **Cursor Hooks integration** — `beforeMCPExecution` event blocks unapproved tool calls in Cursor

The open source project is called **ToolHive** (`github.com/stacklok`). Best option for Cursor-heavy shops.

### Option D: Docker MCP Catalog (container-native)

Fork `docker/mcp-registry`, point to your internal container registry (Harbor, GHCR private, ECR). Docker Desktop's MCP Toolkit GUI manages servers as containers. 300+ servers available in the public catalog; companies can add private servers alongside public ones.

### Option E: Build your own (minimal)

A valid registry needs only 3 REST endpoints + CORS headers. This can be a static JSON file behind nginx or a 50-line Express/FastAPI app:

```text
GET /v0.1/servers               → list of server objects
GET /v0.1/servers/{name}/versions/latest   → latest version detail
GET /v0.1/servers/{name}/versions/{ver}    → specific version detail
```

Required CORS headers on all endpoints:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

This is enough to work with `chat.mcp.gallery.serviceUrl` in VS Code.

### Option F: Amazon Bedrock AgentCore Gateway (AWS-native)

AWS offers an MCP gateway as part of Amazon Bedrock AgentCore. Rather than a registry-in-the-traditional-sense, it is a **centralized proxy** between MCP clients and servers:

- A single endpoint that agents connect to; Bedrock routes to individual MCP servers behind it
- Native semantic search across registered tools — agents can discover relevant tools without listing everything
- Authentication and authorization managed centrally (IAM-based); servers behind the gateway do not need to handle auth individually
- Servers registered as Bedrock resources; tool catalog updates propagate to connected agents without restarts

**When to use:** AWS-native shops that want serverless MCP infrastructure without running a registry container. The gateway replaces both the registry (discovery) and the auth layer.

**Not compatible** with `chat.mcp.gallery.serviceUrl` — Bedrock AgentCore uses its own API, not the v0.1 registry spec.

AWS prescriptive guidance: `docs.aws.amazon.com/prescriptive-guidance/latest/mcp-strategies/`

### Option G: Cloudflare Workers (edge-hosted MCP servers)

Cloudflare is not a registry itself, but it is a popular hosting platform for HTTP Streamable MCP servers:

- **Agents SDK + `workers-mcp`** packages for building MCP servers on Workers
- 300+ edge locations, sub-50ms latency globally, zero cold starts (V8 isolates)
- Free tier: 100,000 requests/day; paid from $5/month
- Persistent storage via KV and Durable Objects (for session state)
- Built-in OAuth support through Cloudflare Access

A Cloudflare-hosted MCP server is just a `remotes` URL in a `server.json` — it can be published to any v0.1-spec registry (official, Azure API Center, self-hosted) and used via `chat.mcp.gallery.serviceUrl`.

### Option H: Archestra Private MCP Registry (enterprise platform)

[Archestra](https://archestra.ai) provides a managed private MCP registry platform:

- Single UI to add, configure, and manage both remote and local MCP servers
- Version control, authentication management (OAuth, API keys, browser-based auth)
- Local servers running as containers within Kubernetes clusters
- Server organization through labels (by category, environment, or team)
- SaaS model — no infrastructure to manage

Positioned for enterprises that want the governance of a private registry without the operational overhead of running the Docker image + PostgreSQL themselves.

---

## 10. AI Assistants That Support a Private Registry URL

Only **GitHub Copilot** (across multiple IDEs) natively supports pointing to a custom/private MCP registry URL as a discoverable catalog. All other major clients lack this feature today.

### GitHub Copilot — Full support

**VS Code** (minimum version **1.101**, released May/June 2025):

| Setting / Policy | Purpose | Where to set |
| --- | --- | --- |
| `chat.mcp.gallery.serviceUrl` / policy `McpGalleryServiceUrl` | Points VS Code at your private registry; replaces the GitHub gallery in the `@mcp` Extensions search | Direct edit of `settings.json` JSON file (individual), or enterprise policy (IT admin) |
| `chat.mcp.access` / policy `ChatMCP` | Values: `allowed` (default), `registryOnly`, `off` | VS Code user settings, or enterprise policy |

**Confirmed working (verified March 2026):** Add `"chat.mcp.gallery.serviceUrl": "http://localhost:8085"` **directly to the `settings.json` JSON file** (`Cmd+Shift+P` → "Preferences: Open User Settings (JSON)"). VS Code reads the setting immediately — no window reload required. The Copilot Chat gallery then calls `GET <url>/v0.1/servers` to populate the server list.

> **Note — greyed out in Settings UI**: `chat.mcp.gallery.serviceUrl` is intentionally **disabled in the graphical Settings editor** on all VS Code editions (stable and Insiders). It does not appear as a user-editable field because Microsoft reserves the UI pathway for enterprise policy (`McpGalleryServiceUrl` via MDM/GPO/plist). Individual developers still get the runtime behaviour by editing `settings.json` as JSON directly — VS Code respects the key even though it does not render an input field for it. This applies to regular GitHub Copilot (no plan) as well as paid plans.

### `chat.mcp.access` modes and what they block

The three access values have meaningfully different effects depending on how a server is configured:

| Server type | `allowed` (default) | `registryOnly` |
| --- | --- | --- |
| Installed from registry — stdio (npm package) | Allowed | Allowed |
| Installed from registry — remote HTTP | Allowed | Allowed |
| Direct `mcp.json` entry — remote HTTP | Allowed | Blocked |
| Direct `mcp.json` entry — localhost HTTP (sidecar) | Allowed | Blocked |
| Direct `mcp.json` entry — stdio | Allowed | Blocked |

**Localhost URLs cannot be published to a registry `remotes` entry.** The `mcp-publisher` CLI validates that `remotes[].url` is a real network endpoint and rejects `http://localhost:*` addresses with: `invalid remote URL: http://localhost:…`. This is by design — a localhost URL is meaningless to any machine other than the developer's. It means a locally running HTTP Streamable sidecar server (e.g. a VS Code extension that starts an HTTP server on `http://localhost:62124/mcp`) **cannot be listed in any MCP registry**; it can only be used via a direct `mcp.json` entry, which requires `access: "allowed"`.

This creates two distinct enterprise postures:

#### Permissive posture — developer tooling allowed

`chat.mcp.access: "allowed"` + custom `chat.mcp.gallery.serviceUrl`

Developers browse and install curated servers from the private gallery **and** may use localhost sidecar servers (VS Code extension sidecars, locally running tools). The gallery constrains what is visible and easy to install; it does not block manual `mcp.json` entries. Appropriate when developer tooling is trusted and the primary governance goal is discoverability rather than hard enforcement.

#### Strict posture — only approved servers

`chat.mcp.access: "registryOnly"` + `McpGalleryServiceUrl` deployed via MDM

Only servers in the approved registry can run. Localhost sidecars and any direct `mcp.json` entry are blocked at runtime. For a server to work in this environment it must be one of:

- **stdio**: npm package published to a registry accessible from the developer's machine (public npmjs.com or a proxied internal mirror), with a `packages` entry in the MCP registry; VS Code fetches and runs the package locally as a subprocess.
- **remote HTTP**: deployed at a real network URL (internal corporate domain or cloud endpoint), with a `remotes` entry in the MCP registry pointing to that URL.

**Implication for MCP server developers**: if your users include enterprises with a strict posture, a localhost-only HTTP Streamable sidecar is invisible to those environments. You must support stdio (published npm package) or a deployable HTTP endpoint to be usable there.

Enterprise policy deployment (overrides user settings, enforced via MDM):

- **Windows** — ADMX/ADML group policy deployed via Intune or Active Directory (`vscode.admx` ships with VS Code since v1.69)
- **macOS** — `.mobileconfig` profile deployed via Intune or Apple Business Manager (since v1.99)
- **Linux** — `/etc/vscode/policy.json` (since v1.106)

Example `policy.json` for Linux:

```json
{
  "McpGalleryServiceUrl": "https://mcp-registry.internal.example.com",
  "ChatMCP": "registryOnly"
}
```

**JetBrains IDEs** (GitHub Copilot, nightly build):
Copilot Chat → MCP icon → settings → "MCP Registry URL" field

**Eclipse** (GitHub Copilot, pre-release):
Copilot Chat → MCP icon → "Configure Registry URL"

**Xcode** (GitHub Copilot, pre-release):
Copilot Chat settings → Tools tab → "MCP Registry URL (Optional)"

### Claude Desktop — Limited, enterprise only

Anthropic Team and Enterprise plans support uploading custom desktop extensions (MCPB binary format) as an org-internal catalog via Settings → Extensions → Advanced settings. This is **not** a standard registry URL — it is a proprietary upload mechanism for MCPB packages only.

### Cursor — No native registry support (March 2026)

A community feature request exists (October 2025) with no official response or timeline. Current governance options:

- `permissions.json` — allowlist of `server:tool` pairs, enforced via Cursor team dashboard
- **Stacklok** — installs a Cursor Hook via MDM that intercepts every `beforeMCPExecution` event and denies anything not in the Stacklok-hosted catalog

### Windsurf — No native registry support

Manual `~/.codeium/windsurf/mcp_config.json` configuration only. No governance controls.

### Summary

| AI Assistant | Private registry URL | Enforcement | How |
| --- | --- | --- | --- |
| VS Code (Copilot) | Yes — since v1.101 | `registryOnly` policy | `McpGalleryServiceUrl` + MDM policies |
| JetBrains (Copilot) | Yes — preview | Via GitHub org setting | Copilot Chat UI |
| Eclipse (Copilot) | Yes — preview | Via GitHub org setting | Copilot Chat UI |
| Xcode (Copilot) | Yes — preview | Via GitHub org setting | Copilot Chat UI |
| Claude Desktop | No — upload-only (MCPB) | Org allowlist (Team/Enterprise) | Settings upload |
| Cursor | No — requested, not shipped | Via `permissions.json` + Stacklok | Third-party only |
| Windsurf | No | None built-in | — |

---

## 11. Enterprise Governance: Limiting Which Servers Can Be Used

### GitHub Copilot Enterprise / Business (admin-level)

1. Admin creates a private registry (Options A–E above)
2. Admin adds approved server entries to the registry
3. Admin sets the registry URL in GitHub org settings: **Settings → AI controls → MCP → MCP Registry URL**
4. Admin sets enforcement policy: **Registry only**
5. Developers see only approved servers in the `@mcp` gallery; others are blocked at runtime

**Current limitation:** Enforcement is name/ID-matching only — a developer can bypass it by manually editing `.vscode/mcp.json` with a raw server config. Stricter enforcement (verifying command path, args, env vars) is planned for October 2026.

For the highest security today: disable MCP entirely (`chat.mcp.access: "off"`) until strict enforcement ships.

### VS Code enterprise policies (IT admin via MDM)

Two policies together constitute a locked-down setup:

```json
{
  "McpGalleryServiceUrl": "https://mcp-registry.internal.example.com",
  "ChatMCP": "registryOnly"
}
```

Deployed via Intune/Active Directory/MDM to all developer machines. Does not require each developer to have Copilot Enterprise — the VS Code policy layer is independent.

**Which servers work under `registryOnly`:** only servers whose `name` resolves in the registry — either as a `packages` (stdio) entry installed locally, or as a `remotes` (HTTP) entry pointing to a real network URL. Localhost HTTP sidecars are blocked. See section 10 for the full access-mode matrix and posture discussion.

### Cursor (via Stacklok)

Stacklok installs a [Cursor Hook](https://github.com/StacklokLabs/cursor-hooks) via your existing MDM solution. The hook script intercepts every `beforeMCPExecution` event:

- Returns `approve` for servers hosted by Stacklok
- Returns `deny` with an explanation for everything else
- All traffic logged via OpenTelemetry (Grafana, Splunk, etc.)

### Other approaches

| Method | Works for | Notes |
| --- | --- | --- |
| **Network firewall** | Remote HTTP servers | Block outbound connections to non-approved remote MCP URLs at the network layer |
| **MDM-deployed `mcp.json`** | VS Code, Cursor | Deploy a read-only `.vscode/mcp.json` / `~/.cursor/mcp.json` via Intune/Jamf |
| **VDI / remote development** | All clients | Only pre-approved servers are installed in the VM/container image |
| **Docker MCP Gateway** | All HTTP clients | All MCP traffic proxied through a controlled gateway; unapproved tools silently dropped |
| **Disable MCP entirely** | All clients | `ChatMCP: "off"` policy in VS Code, or disable in Cursor dashboard |

---

## 12. Deploying the Zowe MCP Server as an HTTP Streamable Service

The Zowe MCP server already has an HTTP Streamable transport (`startHttp` in `src/transports/`). Companies can deploy it as a shared internal service so developers do not need to run it locally.

### Advantages of HTTP Streamable vs local stdio

- Developers need no local Node.js or Zowe configuration — they connect to a URL
- Credentials (z/OS passwords) are managed centrally on the server, not on developer laptops
- A single deployment serves the whole team; updates are transparent
- Works naturally with remote development environments (GitHub Codespaces, DevContainers)
- Can be registered in a private MCP registry as a `remotes` entry with a fixed internal URL

### Deployment architecture

```text
Developer's VS Code (HTTP MCP client)
        │  HTTPS POST /mcp
        ▼
  Reverse proxy (nginx / API Gateway)
  TLS termination · Auth middleware · Rate limiting
        │
        ▼
  Zowe MCP Server container (HTTP Streamable, port 7542)
  Sessions tracked per client via mcp-session-id header
        │
        ▼
  z/OS system (SSH via ZNP)
```

### Dockerfile example

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
EXPOSE 7542
CMD ["node", "dist/index.js", "--http", "--port", "7542", "--native", \
     "--system", "jsmith@mainframe.example.com"]
```

Or using the published npm package (once on npmjs.com):

```dockerfile
FROM node:20-slim
RUN npm install -g @zowe/mcp-server
EXPOSE 7542
CMD ["zowe-mcp-server", "--http", "--port", "7542", "--native"]
```

### Kubernetes deployment sketch

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
            - name: ZOWE_MCP_CONNECTIONS
              valueFrom:
                secretKeyRef:
                  name: zowe-mcp-credentials
                  key: connections-json
```

### Authentication options for the HTTP endpoint

| Method | How | Notes |
| --- | --- | --- |
| **OAuth 2.1** | API Gateway / Istio handles OIDC; passes user identity to server | Best practice per MCP spec; supports per-user z/OS credentials |
| **API key (per-team)** | Clients send `Authorization: Bearer <token>` header | Simplest; token declared in `server.json` `headers[].isSecret` |
| **mTLS** | Client certificates issued by company CA | Network-layer, no MCP-level credential needed |
| **VPN / network boundary** | Internal URL only reachable inside corporate network | No auth in MCP layer; rely on network access control |

### Registering in a private MCP registry

Once deployed, add the server to your private registry's `server.json` store:

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
          "description": "Bearer token from the internal identity provider",
          "isSecret": true,
          "isRequired": true
        }
      ]
    }
  ]
}
```

Developers who configure `chat.mcp.gallery.serviceUrl` to point at the company registry will see "Zowe MCP Server" in the `@mcp` gallery and can install it with one click. VS Code will prompt them for the `Authorization` header value the first time and store it securely.

### Multi-system / multi-tenant considerations

The Zowe MCP server currently tracks the "active system" as session state, scoped per MCP client session (via `mcp-session-id`). In a shared HTTP deployment, each developer connects with their own session and can use `setSystem` / `listSystems` to switch between configured z/OS connections, independently of other users' sessions.

z/OS passwords in the shared deployment are managed as a central secret (Kubernetes Secret, Vault, AWS Secrets Manager) rather than per-developer env vars.

---

## 13. Using github.com/mcp Servers Internally Under a Registry-Only Policy

A company that sets `registryOnly` enforcement must list every approved server in their private registry. For servers that are on `github.com/mcp` and distributed via npmjs.com (stdio), the approach depends on internet access and security posture.

### Scenario A: Developers have internet access (most common)

The simplest case. The company:

1. Self-hosts a private registry (Option A–E from section 9)
2. Populates it with `server.json` entries that are **exact copies** of the official entries for approved servers (same `name`, same npm identifiers)
3. Sets `chat.mcp.gallery.serviceUrl` to the private registry + `registryOnly` enforcement
4. Developers install Playwright, GitHub MCP server, etc. from the private gallery — VS Code fetches the package from npmjs.com as normal

The `registryOnly` policy only controls **which servers can run** (by name/ID), not **where packages are fetched from**. npm still pulls from npmjs.com. The private registry is just the approved list.

### Scenario B: Restricted internet access (Artifactory npm proxy)

Companies with a controlled npm proxy (Artifactory, Nexus) that proxies npmjs.com:

1. The private registry `server.json` entries reference the same npm package names (e.g. `@playwright/mcp`)
2. Developer machines have `.npmrc` pointing to Artifactory (`registry=https://artifactory.internal/npm`)
3. When VS Code installs the server via `npx`, npm pulls from Artifactory (which proxies npmjs.com and caches approved packages)
4. Security team controls which npm packages are available in Artifactory

No change to the server.json entries needed — the npm identifier is the same; only the registry source differs via `.npmrc`.

### Scenario C: Air-gapped environment (no internet)

1. Security team pre-downloads approved server packages (npm tarballs or Docker images) and stores them in the internal Artifactory / Harbor
2. The private registry `server.json` entries are modified to reference the **internal** package location:
   - For npm: use the `--registry` flag in the `arguments` array
   - For Docker: reference the internal container registry image tag
3. Or: pre-install servers as VSIX-style bundles or pre-built binaries (MCPB format) distributed via endpoint management (Intune)

Example entry overriding the npm registry:

```json
{
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@playwright/mcp",
      "version": "1.2.0",
      "transport": { "type": "stdio" },
      "arguments": [
        { "value": "--registry=https://artifactory.internal/npm", "isRequired": true }
      ]
    }
  ]
}
```

### Scenario D: Remote-only servers (preferred by security-conscious companies)

Some companies prefer that **no MCP servers run locally** at all. Instead, all approved servers are deployed as shared HTTP Streamable services on internal infrastructure:

1. Playwright MCP → deployed as a container on internal Kubernetes, accessible at `https://playwright-mcp.tools.example.com/mcp`
2. GitHub MCP server → deployed with a GitHub App token for the enterprise GitHub instance
3. Zowe MCP server → deployed as described in section 12
4. All listed in the private registry as `remotes` entries
5. `registryOnly` policy ensures only these pre-deployed endpoints are used

This approach eliminates local npm package downloads entirely and gives the security team full control over what code runs.

### Summary of approaches

| Scenario | Internet access | Server execution | Governance burden |
| --- | --- | --- | --- |
| A: Copy entries to private registry | Full npm access | Local stdio (npx from npmjs.com) | Low |
| B: Artifactory npm proxy | Controlled via proxy | Local stdio (npx from Artifactory) | Medium |
| C: Air-gapped | None | Local stdio (pre-packaged) | High |
| D: All-remote deployment | HTTP only | Shared HTTP Streamable services | High upfront, low ongoing |

---

## Appendix: Useful Links

| Resource | URL |
| --- | --- |
| Official MCP Registry | <https://registry.modelcontextprotocol.io> |
| Registry GitHub repo | <https://github.com/modelcontextprotocol/registry> |
| Publishing quickstart | <https://modelcontextprotocol.io/registry/quickstart> |
| Authentication guide | <https://modelcontextprotocol.io/registry/authentication> |
| Versioning guide | <https://modelcontextprotocol.io/registry/versioning> |
| Remote servers guide | <https://modelcontextprotocol.io/registry/remote-servers> |
| Package types guide | <https://modelcontextprotocol.io/registry/package-types> |
| github.com/mcp curated list | <https://github.com/mcp> |
| GitHub Blog: GitHub MCP Registry | <https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/> |
| VS Code enterprise AI settings | <https://code.visualstudio.com/docs/enterprise/ai-settings> |
| VS Code MCP configuration ref | <https://code.visualstudio.com/docs/copilot/reference/mcp-configuration> |
| GitHub Docs: configure MCP registry | <https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-registry> |
| GitHub Docs: MCP allowlist enforcement | <https://docs.github.com/en/copilot/reference/mcp-allowlist-enforcement> |
| Stacklok / ToolHive | <https://stacklok.com> / <https://github.com/stacklok> |
| Self-hosting blog post | <https://www.domstamand.com/self-hosting-a-mcp-registry-for-discovery-using-modelcontextprotocol-io-registry/> |
| Docker MCP Catalog | <https://docs.docker.com/ai/mcp-catalog-and-toolkit/> |
| Azure API Center MCP | <https://learn.microsoft.com/azure/api-center/register-discover-mcp-server> |
