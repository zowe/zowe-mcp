# Standalone MCP clients

Standalone MCP clients start `@zowe/mcp-server` directly from their own
configuration instead of relying on the optional VS Code extension to register
the server. Use stdio mode with `command`, `args`, and optional `env` fields, as
shown below.

For **Streamable HTTP** with Bearer JWT, local Keycloak, or another remote URL,
see [Remote development with Keycloak](remote-dev-keycloak.md).

## Package identity

| Item                 | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| **npm package**      | `@zowe/mcp-server`                                                   |
| **CLI / `bin` name** | `zowe-mcp-server` (what you run after `npm install -g` or via `npx`) |
| `**npx`**            | `npx @zowe/mcp-server …` or `npx -y @zowe/mcp-server@<version> …`    |

## Install the server

1. **Ephemeral** — `npx -y @zowe/mcp-server` (pin a version in production). **Requires the package to be published to npm or mirrored in a registry your `npm` can resolve `@zowe/*` from — not the case while `@zowe/mcp-server` is unpublished. Until then, use the tarball-npx form in [Obtaining the `.tgz`](#obtaining-the-tgz).**
2. **Project-local** — `npm install @zowe/mcp-server` → `node_modules/.bin/zowe-mcp-server`. Same publication requirement as above; otherwise install from the `.tgz`.
3. **Global** — `npm install -g @zowe/mcp-server` → run `zowe-mcp-server` (on `PATH`). Same publication requirement as above; otherwise install the `.tgz` globally (`npm install -g ./zowe-mcp-server-<version>.tgz`).

Ensure your npm registry can resolve `@zowe/*` (public npm or your org’s mirror; see root `.npmrc` if applicable).

## Obtaining the `.tgz`

- **CI** — Successful [GitHub Actions](../.github/workflows/ci.yml) runs upload `**zowe-mcp-server-npm`** (`zowe-mcp-server-*.tgz`). Download from the workflow run’s **Artifacts**.
- **From a clone** — `npm run pack:server` at the repo root writes `zowe-mcp-server-<version>.tgz` (gitignored).
- **Install from tarball** — `npm install -g ./zowe-mcp-server-0.x.y.tgz` or `npm install ./zowe-mcp-server-*.tgz`.

Run from a local tarball without publishing:

```bash
npx --package=file:/absolute/path/to/zowe-mcp-server-0.8.0-dev.tgz zowe-mcp-server --stdio --native --system USER@host
```

The argument after the package is the `**bin` name** (`zowe-mcp-server`), not the scoped package name.

## Roo Code: `.roo/mcp.json` (native SSH)

Roo Code loads MCP servers from its own configuration and does not use VS
Code's `vscode.lm.registerMcpServerDefinitionProvider`. If the Zowe MCP VS Code
extension is installed only for Roo, uninstall it and use the server package
directly through Roo's `mcp.json`. The extension's helper commands are thin
wrappers around equivalent server CLI subcommands.

**Prefer the installed binary** (no `npx`, no registry): if `@zowe/mcp-server` is already installed globally or in a project, run the `**zowe-mcp-server`** executable directly. Put only server flags in `args` — do **not** pass `npx`, `-y`, or `@zowe/mcp-server`.

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
      },
      "timeout": 120
    }
  }
}
```

If `zowe-mcp-server` is not on `PATH`, set `"command"` to the **absolute path** to the binary (for example `.../node_modules/.bin/zowe-mcp-server` after a project install, or your global npm bin from `npm prefix -g` + `/bin/zowe-mcp-server` on Unix).

**Optional — `npx`:** only when you want npm to download/run the package each time; requires a registry that can resolve `@zowe/mcp-server`.

## Authentication (standalone)

The server authenticates in this order, falling back automatically:
**SSH key → password env var → Vault KV → interactive prompt (when supported).**

### Preferred: SSH key (most secure, zero-config)

If you already use an SSH key to reach z/OS, the server uses it automatically from
your existing `~/.ssh` setup (a `~/.ssh/config` `IdentityFile` for the host, or a
default `~/.ssh/id_*` key) — no password env var needed. A private key, especially
a passphrase-protected one, is safer than a password in an environment variable.

```bash
# Optional overrides (only if needed)
export ZOWE_MCP_PRIVATE_KEY_USERID_ZOS_EXAMPLE_COM=~/.ssh/id_mainframe
export ZOWE_MCP_KEY_PASSPHRASE_USERID_ZOS_EXAMPLE_COM='key passphrase'
export ZOWE_MCP_DISABLE_SSH_KEY=1   # disable key auth, always use a password
```

ssh-agent keys are not supported in this release — only key files on disk.

### Fallback: passwords

Without the VS Code extension, passwords are not collected via the extension pipe. Use one or both of the following.

### Per-connection env vars: `ZOWE_MCP_PASSWORD_<USER>_<HOST>`

**Format:** `ZOWE_MCP_PASSWORD_<USER>_<HOST>`

- User: uppercased; host: dots replaced with underscores (see [`connection-spec.ts`](../packages/zowe-mcp-server/src/zos/native/connection-spec.ts) — `toPasswordEnvVarName`).

Example: `USERID@zos.example.com` → `ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM`.

### Alternative: `ZOWE_MCP_CREDENTIALS` (JSON)

Set a **single** env var to a JSON object whose keys are connection specs (`user@host` or `user@host:port`) and whose values are passwords:

```json
{
  "userid@zos.example.com": "your-password",
  "otheruser@other.host.example.com:2222": "other-password"
}
```

In `.roo/mcp.json`, pass the JSON as a **string** value (escape quotes as required by JSON):

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": ["--stdio", "--native", "--system", "USERID@zos.example.com"],
      "env": {
        "ZOWE_MCP_CREDENTIALS": "{\"userid@zos.example.com\":\"replace-with-secret\"}"
      },
      "timeout": 120
    }
  }
}
```

**Precedence:** If both are set for the same connection, `ZOWE_MCP_PASSWORD_<USER>_<HOST>` wins; otherwise the server looks up the connection in `ZOWE_MCP_CREDENTIALS`. Implementation: `getStandalonePasswordFromEnv()` in [`connection-spec.ts`](../packages/zowe-mcp-server/src/zos/native/connection-spec.ts).

### Why `ZOWE_MCP_CREDENTIALS` matters for MCP registries

[MCP registry](https://github.com/modelcontextprotocol/registry) entries (`server.json`) list **fixed** environment variable names so IDEs and installers can show “required secrets” and prompt users. The per-connection pattern `ZOWE_MCP_PASSWORD_*` **cannot be fully enumerated** in that metadata: the suffix depends on each site’s `user@host`, which the registry does not know at publish time.

`ZOWE_MCP_CREDENTIALS` is a **single, stable name** that:

- Fits registry schemas and “one secret field” UIs (VS Code gallery, Copilot, Claude Desktop, etc.).
- Maps cleanly to enterprise secret stores (inject one variable from Vault, Kubernetes `Secret`, CI, etc.).
- Covers **multiple** connections in one value when you use `--config` with several systems.

The shipped [`server.json`](../packages/zowe-mcp-server/server.json) documents `ZOWE_MCP_CREDENTIALS` for that reason. For more background on credentials and HTTP authentication, see
[`mcp-authentication-oauth.md`](mcp-authentication-oauth.md).

Prefer injecting secrets from the OS or a vault; do not commit real passwords into `.roo/mcp.json`.

## Job cards and multiple systems (no extension)

The VS Code extension can send job cards over a pipe. In standalone mode, use `**--config`** with a JSON file:

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

Then add to your MCP `args`: `"--config", "/absolute/path/to/native-config.json"`.

See the server CLI in `[index.ts](../packages/zowe-mcp-server/src/index.ts)` (`--native`, `--system`, `--config`).

## Mock mode

For standalone testing without a mainframe, see [Mock mode](mock-mode.md).

## Local file tools

If the client does not expose MCP workspace roots, set `**ZOWE_MCP_WORKSPACE_DIR**` in `env` to your workspace folder so upload/download tools can resolve paths.

## See also

- [README.md](../README.md) — Standalone mode, `native-config.json`, VS Code `.vscode/mcp.json`
- [copilot-setup-guide.md](copilot-setup-guide.md) — Extension-based setup with Copilot
