# Claude Code

This guide shows how to use the **Zowe MCP server** with [Claude Code](https://docs.claude.com/en/docs/claude-code/mcp) — Anthropic’s terminal-based coding agent. It is self-contained: you do not need to read any other Zowe MCP doc to follow it.

Claude Code loads MCP servers from its own configuration (project-scope `.mcp.json` at the repo root, or user-scope via `claude mcp add --scope user`). It does **not** use VS Code’s `vscode.lm.registerMcpServerDefinitionProvider`, so the Zowe MCP VS Code extension does not register the server for it — you point Claude Code at the `@zowe/mcp-server` npm package directly.

## What you need

- **Node.js 24+** (the version Zowe MCP is built against).
- **Claude Code** installed and authenticated (`claude --version` should work).
- Access to a **z/OS system over SSH** (for the real `--native` backend), or skip ahead to [Mock mode](#mock-mode) to try the server without a mainframe.

## 1. Install the `@zowe/mcp-server` package

The server ships as an npm package named **`@zowe/mcp-server`**. After install, the executable on `PATH` is **`zowe-mcp-server`** (that is the package’s `bin` name — not the scoped npm name).

Pick one install method:

| Method                 | Command                                                                       | When to use                                                   |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Global (best)**      | `npm install -g @zowe/mcp-server`                                             | `zowe-mcp-server` ends up on `PATH`; simplest for daily use.  |
| **Project-local**      | `npm install @zowe/mcp-server`                                                | Pin the version per project. Binary at `node_modules/.bin/zowe-mcp-server`. |
| **Ephemeral via npx**  | `npx -y @zowe/mcp-server …`                                                   | No install; downloads on each run. Pin a version in production. **Requires the package to be published to npm or mirrored in a registry your `npm` can resolve `@zowe/*` from — not the case while `@zowe/mcp-server` is unpublished. Until then, use the tarball-npx form in [Getting the `.tgz`](#getting-the-tgz).** |
| **From a `.tgz`**      | `npm install -g ./zowe-mcp-server-<version>.tgz`                              | Offline / air-gapped, or when not published to a public registry. |

Your npm registry must be able to resolve `@zowe/*` (the public npm registry or your organisation’s mirror).

### Getting the `.tgz`

- **GitHub Actions:** a successful CI run uploads an artifact named `zowe-mcp-server-npm` containing `zowe-mcp-server-<version>.tgz`.
- **From a clone of this repo:** `npm run pack:server` writes `zowe-mcp-server-<version>.tgz` at the repo root.
- **Run from a tarball without installing:**

  ```bash
  npx --package=file:/absolute/path/to/zowe-mcp-server-0.x.y.tgz \
    zowe-mcp-server --stdio --native --system USERID@zos.example.com
  ```

  The argument after `--package=…` is the **bin name** (`zowe-mcp-server`), not the scoped package name.

### Verify the install

```bash
zowe-mcp-server --version    # prints e.g. 0.10.0
which zowe-mcp-server        # confirms it is on PATH
```

## 2. Add the server to Claude Code

You can configure the server three ways. Pick **one**.

### Option A — `.mcp.json` (project scope, recommended)

Create `.mcp.json` at the root of the project where you run Claude Code. This file is normally committed so the whole team shares the config; Claude Code will prompt you to approve the server the first time it starts.

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": [
        "--stdio",
        "--native",
        "--system",
        "USERID@zos.example.com"
      ],
      "env": {
        "ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM": "replace-with-secret"
      }
    }
  }
}
```

A ready-to-edit copy is at [`examples/claude-code-mcp.json`](examples/claude-code-mcp.json).

**Notes**

- `--stdio --native` selects stdio transport with the real SSH backend.
- `--system USERID@zos.example.com` is the connection spec (replace `USERID` and the host).
- Put **only server flags** in `args` — do **not** pass `npx`, `-y`, or `@zowe/mcp-server` when you used a real install.
- If `zowe-mcp-server` is not on `PATH` (for example after a project-local install, or because Claude Code runs in a shell without your nvm Node), set `"command"` to the **absolute path** to the binary, e.g. `/Users/you/.nvm/versions/node/v24.15.0/bin/zowe-mcp-server`, or `./node_modules/.bin/zowe-mcp-server`.
- **Do not commit real passwords.** See [Authenticate to z/OS](#3-authenticate-to-zos) below.

### Option B — `claude mcp add` (CLI)

```bash
claude mcp add zowe \
  --scope project \
  --env ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM=replace-with-secret \
  -- zowe-mcp-server --stdio --native --system USERID@zos.example.com
```

Everything after `--` is the command and its arguments, spawned verbatim. Scopes:

- `--scope local` (default) — only this Claude Code instance / your machine.
- `--scope project` — writes `.mcp.json` at the repo root.
- `--scope user` — shared across all your projects (stored in `~/.claude.json`).

### Option C — `claude mcp add-json` (CLI, full JSON)

When you want full control over `env`, `args`, etc. without escaping shell:

```bash
claude mcp add-json zowe --scope project '{
  "command": "zowe-mcp-server",
  "args": ["--stdio", "--native", "--system", "USERID@zos.example.com"],
  "env": { "ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM": "replace-with-secret" }
}'
```

## 3. Authenticate to z/OS

The server authenticates each connection in this order, falling back automatically:
**SSH key → password env var → Vault KV.**

### Preferred — SSH key (most secure, zero-config)

If you already reach z/OS with an SSH key, you don't need to set any password env
var: the server automatically uses your existing `~/.ssh` setup — a matching
`Host` entry's `IdentityFile` in `~/.ssh/config`, or a default `~/.ssh/id_*` key.
A private key (ideally passphrase-protected) is more secure than a password in an
environment variable, which can leak via process listings, shell history, and
crash dumps.

If your key is encrypted, supply its passphrase (the server cannot prompt under
Claude Code), or pin a specific key:

```bash
export ZOWE_MCP_KEY_PASSPHRASE_USERID_ZOS_EXAMPLE_COM='key passphrase'
export ZOWE_MCP_PRIVATE_KEY_USERID_ZOS_EXAMPLE_COM=~/.ssh/id_mainframe   # optional override
```

Set `ZOWE_MCP_DISABLE_SSH_KEY=1` to skip key auth and always use a password.
ssh-agent keys are not supported in this release — only key files on disk.

### Fallback — password

When no usable key is found, the server needs the z/OS password to open the SSH
session. Claude Code has no built-in “prompt for password” pipe, so you supply it
via an environment variable. Two equivalent options:

#### Option 1 — Per-connection env var (simplest)

**Format:** `ZOWE_MCP_PASSWORD_<USER>_<HOST>`

- User: uppercased.
- Host: dots replaced with underscores.

Example: `USERID@zos.example.com` → `ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM`.

Set it in `.mcp.json` `env` (as shown above), or export it in your shell so it is inherited by Claude Code.

#### Option 2 — Single JSON env var `ZOWE_MCP_CREDENTIALS`

A single environment variable whose value is a JSON object keyed by `user@host` (or `user@host:port`):

```jsonc
{
  "userid@zos.example.com": "your-password",
  "otheruser@other.host.example.com:2222": "other-password"
}
```

In `.mcp.json` you pass the JSON as a **string** (the inner quotes must be escaped):

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": ["--stdio", "--native", "--system", "USERID@zos.example.com"],
      "env": {
        "ZOWE_MCP_CREDENTIALS": "{\"userid@zos.example.com\":\"replace-with-secret\"}"
      }
    }
  }
}
```

Use this form when:

- You connect to multiple systems from one config.
- You inject the secret from a vault / CI / Kubernetes `Secret` that prefers a single, stable variable name.
- You publish to an MCP registry, where the per-connection name cannot be enumerated ahead of time.

**Precedence:** If both `ZOWE_MCP_PASSWORD_<USER>_<HOST>` and an entry in `ZOWE_MCP_CREDENTIALS` exist for the same connection, the per-connection variable wins.

**Keep secrets out of source control.** Prefer exporting the variable in your shell (or from a vault) and leaving it out of `.mcp.json` if `.mcp.json` is committed.

## 4. Verify and manage the server

From a shell:

```bash
claude mcp list          # list configured servers and their scope
claude mcp get zowe      # show the resolved configuration
claude mcp remove zowe   # remove the server from its scope
```

From inside a running Claude Code session, run the **`/mcp`** slash command to:

- See each server’s status (connected, failed, disconnected).
- Inspect the tools it exposes.
- Restart a server after a config change.
- Authenticate for HTTP/OAuth servers.

A successful connection means the next prompt can use Zowe tools like `dataset.list`, `jobs.list`, `uss.read`, etc.

## Streamable HTTP (remote URL with OAuth or Bearer JWT)

If you run the Zowe MCP server as a hosted HTTP endpoint (for example behind Keycloak), point Claude Code at the URL instead of spawning a process. Two ways to authenticate:

### Option A — OAuth (recommended; no pasted tokens)

Claude Code is an OAuth-capable MCP client. When the MCP server advertises **OAuth 2.0 Protected Resource Metadata** ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) at `/.well-known/oauth-protected-resource`, Claude Code:

1. Discovers the authorization server (your IdP — e.g. Keycloak) automatically.
2. Performs **Dynamic Client Registration** (when the IdP supports it) **or** uses an OAuth client you pre-registered.
3. Runs the authorization-code flow in your browser the first time you connect.
4. Stores tokens in the OS keychain and **refreshes them automatically** — you don't paste access tokens.

The Zowe MCP server serves the discovery document when started with `ZOWE_MCP_JWT_ISSUER` / `ZOWE_MCP_JWKS_URI` set — both [`remote-dev-keycloak.md`](remote-dev-keycloak.md) and the one-command HTTPS dev script (`npm run start:remote-https-dev-native-zos`) set those for you.

**Recommended: pre-registered client.** Production IdP deployments almost always use a pre-registered service principal with the right scopes already attached. Use the same shape here:

```json
{
  "mcpServers": {
    "zowe-remote": {
      "type": "http",
      "url": "https://your-host.example.com:7542/mcp",
      "oauth": {
        "clientId": "demo",
        "callbackPort": 8089
      }
    }
  }
}
```

For the bundled local Keycloak dev realm, the static client is named **`demo`**; `callbackPort: 8089` is the port the dev redirect-URI list ([`scripts/patch-keycloak-mcp-dev-redirects.mjs`](../scripts/patch-keycloak-mcp-dev-redirects.mjs)) registers. The realm bootstrap ([`docker/remote-dev/init-keycloak.sh`](../docker/remote-dev/init-keycloak.sh)) attaches `offline_access` and the other standard scopes to that client, so Claude Code's refresh-token flow works out of the box.

Equivalent CLI form:

```bash
claude mcp add zowe-remote \
  --scope project \
  --transport http \
  --client-id demo \
  --callback-port 8089 \
  https://your-host.example.com:7542/mcp
```

If your IdP issues a client secret, also pass `--client-secret` (it prompts interactively) or set it in the `oauth` block (see the Claude Code docs for `oauth.clientId` / `oauth.callbackPort` / `oauth.authServerMetadataUrl` / `oauth.scopes`).

**Pure Dynamic Client Registration (no `oauth` block).** Claude Code will auto-register itself with the IdP. This works when the IdP attaches enough scopes to DCR-created clients to support the authorize-time scope set — including `offline_access` if `scopes_supported` advertises it. For the Keycloak dev realm here, that is not the case, so prefer the pre-registered form above.

```json
{
  "mcpServers": {
    "zowe-remote": {
      "type": "http",
      "url": "https://your-host.example.com:7542/mcp"
    }
  }
}
```

Start a Claude Code session in that directory; the first time the server is touched, your browser opens the IdP login page. After approval, the `/mcp` slash command shows `zowe-remote` as connected.

**Limiting scopes.** Set `oauth.scopes` to pin the exact scope list Claude Code requests:

```json
"oauth": {
  "clientId": "demo",
  "callbackPort": 8089,
  "scopes": "openid profile email"
}
```

Caveat ([Claude Code docs](https://code.claude.com/docs/en/mcp)): "If the authorization server advertises `offline_access` in `scopes_supported`, Claude Code appends it to the pinned scopes." Setting `oauth.scopes` does **not** drop `offline_access` if the IdP advertises it. To truly suppress it, either remove it from your IdP's `scopes_supported` or front discovery with an `authServerMetadataUrl` that omits it.

### Option B — Static Bearer header (fallback / automation)

Use this when you cannot run the OAuth browser flow (CI, headless boxes), or when you want a quick smoke test with a token you already obtained.

```bash
claude mcp add zowe-remote \
  --scope project \
  --transport http \
  --header "Authorization: Bearer <obtain-from-keycloak-token-endpoint>" \
  https://your-host.example.com:7542/mcp
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "zowe-remote": {
      "type": "http",
      "url": "https://your-host.example.com:7542/mcp",
      "headers": {
        "Authorization": "Bearer <obtain-from-keycloak-token-endpoint>"
      }
    }
  }
}
```

Caveats:

- Access tokens expire (the local Keycloak dev realm defaults to ~5 minutes). Claude Code does **not** refresh static headers — you re-fetch and rewrite the header by hand.
- The header sits in `.mcp.json`, which is normally committed. Don't push real tokens; use OAuth for shared configs.

End-to-end Keycloak / nginx / HTTPS setup is documented in [`remote-dev-keycloak.md`](remote-dev-keycloak.md).

## Job cards and multiple systems

For multiple z/OS systems, or to customise JCL job cards, pass `--config /absolute/path/to/native-config.json` in `args` instead of (or alongside) `--system`. The config file looks like:

```json
{
  "systems": ["user@host", "user2@host2.example.com:22"],
  "jobCards": {
    "user@host": [
      "//{jobname}  JOB (ACCT),'{programmer}',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID",
      "/*JOBPARM S=*"
    ]
  }
}
```

`.mcp.json` snippet:

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": [
        "--stdio",
        "--native",
        "--config",
        "/absolute/path/to/native-config.json"
      ]
    }
  }
}
```

Set per-connection passwords (`ZOWE_MCP_PASSWORD_<USER>_<HOST>`) or `ZOWE_MCP_CREDENTIALS` for **every** system listed.

## Mock mode

Mock mode replaces the SSH backend with fixture data — useful for trying the server with Claude Code without a mainframe.

1. Generate a sample mock-data folder:

   ```bash
   zowe-mcp-server init-mock --output ./zowe-mcp-mock-data
   ```

2. Point `.mcp.json` at it (note: **no** `--native`, **no** `--system`):

   ```json
   {
     "mcpServers": {
       "zowe": {
         "command": "zowe-mcp-server",
         "args": [
           "--stdio",
           "--mock",
           "/absolute/path/to/zowe-mcp-mock-data"
         ]
       }
     }
   }
   ```

You can also set `ZOWE_MCP_MOCK_DIR` in `env` instead of the `--mock` flag.

### End-to-end walkthrough (no mainframe needed)

This is the fastest path from zero to a working Claude Code + Zowe MCP setup.

1. **Install the server** (any of the methods in [section 1](#1-install-the-zowemcp-server-package)). For example, from a clone of this repo:

   ```bash
   npm run pack:server                                # writes zowe-mcp-server-<version>.tgz
   npm install -g ./zowe-mcp-server-0.10.0-dev.tgz    # adjust the version
   zowe-mcp-server --version                          # sanity-check
   ```

2. **Generate mock data** into your home directory (any path works):

   ```bash
   mkdir -p ~/zowe-mcp
   zowe-mcp-server init-mock --output ~/zowe-mcp/zowe-mcp-mock-data
   ```

3. **Create a test project** and point Claude Code at the mock data:

   ```bash
   mkdir -p ~/workspace/zowe-claude-test
   cat > ~/workspace/zowe-claude-test/.mcp.json <<'JSON'
   {
     "mcpServers": {
       "zowe": {
         "command": "zowe-mcp-server",
         "args": [
           "--stdio",
           "--mock",
           "/Users/me/zowe-mcp/zowe-mcp-mock-data"
         ]
       }
     }
   }
   JSON
   ```

   Replace `/Users/me/...` with the **absolute** expansion of `~` (Claude Code does not expand `~` inside `.mcp.json`).

4. **Launch Claude Code** in that directory and approve the server:

   ```bash
   cd ~/workspace/zowe-claude-test
   claude
   ```

   On first launch Claude Code prompts you to approve the `zowe` server. After approval, run `/mcp` and check that `zowe` is **connected**. Then ask, for example, *"list data sets under USER.\*"* — answers come from the mock fixtures.

## Capability tier

The server enforces a **capability tier** that limits which categories of z/OS operations are exposed as MCP tools. From lowest to highest:

| Tier            | What is allowed                                                          | Typical use                                       |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| `read-strict`   | Read-only; clients are asked to confirm each read.                       | First contact with a new system.                  |
| `read`          | Read-only; reads auto-approved.                                          | Browsing data sets / jobs / USS.                  |
| `update`        | Read + create / write / modify resources.                                | Editing members, uploading files.                 |
| `delete`        | Read + update + delete resources.                                        | Cleanup workflows.                                |
| `full`          | All of the above + execute (submit jobs, run TSO/USS commands).          | Trusted environments only.                        |

**Default:** `read-strict`. Anything beyond that is opt-in.

You set the tier two ways (CLI flag wins over env var):

### Option 1 — `--capability-tier` flag in `.mcp.json`

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": [
        "--stdio",
        "--mock",
        "/Users/me/zowe-mcp/zowe-mcp-mock-data",
        "--capability-tier",
        "update"
      ]
    }
  }
}
```

### Option 2 — `ZOWE_MCP_CAPABILITY_TIER` env var

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": ["--stdio", "--native", "--system", "USERID@zos.example.com"],
      "env": {
        "ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM": "replace-with-secret",
        "ZOWE_MCP_CAPABILITY_TIER": "delete"
      }
    }
  }
}
```

**Tips**

- After editing the tier, restart the server via `/mcp` (or restart Claude Code). Tools are filtered at registration time, not per-call.
- If you ask the agent to do something the current tier disallows (e.g. submit a job under `read`), it will tell you the operation is not available and ask you to raise the tier instead of working around it.
- For mock-mode demos that show write/delete behaviour, use at least `update` (writes) or `delete` (deletes); raise to `full` to demonstrate job submission.

## Local file tools (upload / download)

Some Zowe MCP tools resolve workspace-relative paths. Claude Code does not advertise MCP “workspace roots” to servers, so set `ZOWE_MCP_WORKSPACE_DIR` in `env` to the directory you want those tools to treat as the workspace root:

```json
"env": {
  "ZOWE_MCP_WORKSPACE_DIR": "/absolute/path/to/your/project"
}
```

## Troubleshooting

- **`zowe-mcp-server: command not found` in Claude Code, but works in your shell.** Claude Code may spawn a shell that does not load your nvm / Node setup. Use an absolute path in `"command"`, e.g. `/Users/you/.nvm/versions/node/v24.15.0/bin/zowe-mcp-server`.
- **Server shows as *failed* in `/mcp`.** Open `/mcp` → select the server → view logs. Common causes: bad `--system` spec, missing password env var (check the exact name: `ZOWE_MCP_PASSWORD_<USER>_<HOST>` with dots → underscores), unreachable host.
- **Authentication fails on the SSH side.** Verify the password by SSH-ing manually to the same `user@host`. The server uses the same credentials.
- **Changes to `.mcp.json` ignored.** Restart Claude Code, or run `/mcp` → restart the server. CLI changes via `claude mcp add` take effect on the next session start.
- **`@zowe/*` not found by npm.** Configure your registry (public npm or your organisation’s mirror). Or use a tarball: `npm install -g ./zowe-mcp-server-<version>.tgz`.
- **OAuth login does not open the browser / loops on `/mcp`.** Confirm the server is serving discovery metadata: `curl -sS https://<host>/.well-known/oauth-protected-resource | jq`. Ensure your IdP allows the Claude Code redirect URI (or pass `--callback-port` when registering the server). The first time, run `/mcp` → select the server → choose the **Authenticate** action.
- **`invalid_scope: Invalid scopes: openid profile email offline_access`.** The OAuth client Claude Code is using does not have all four scopes attached. For pre-registered clients, attach `offline_access` (and the other requested scopes) to the client in the IdP. For Dynamic Client Registration, prefer the pre-registered-client form (`oauth.clientId` / `oauth.callbackPort` in `.mcp.json`) — IdPs typically do not auto-attach realm-default optional scopes to DCR-created clients. Setting `oauth.scopes` to a smaller list does **not** drop `offline_access` if the IdP advertises it in `scopes_supported`.
- **OAuth token expired / want to re-authenticate.** Inside Claude Code run `/mcp` → select the server → sign out (or remove and re-add via `claude mcp remove zowe-remote`). Tokens are kept in the OS keychain on macOS.

## See also

- [Copilot setup guide](copilot-setup-guide.md) — extension-based setup in VS Code with Copilot (skip this guide if you use the VS Code extension instead).
- [Remote dev with Keycloak](remote-dev-keycloak.md) — Streamable HTTP with Bearer JWT in detail.
- Official: [Claude Code — Connect to local & remote MCP servers](https://docs.claude.com/en/docs/claude-code/mcp).
