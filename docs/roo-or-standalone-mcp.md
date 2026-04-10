# Roo Code and other standalone MCP clients

Some AI clients (for example [Roo Code](https://docs.roocode.com/features/mcp/using-mcp-in-roo)) load MCP servers only from **their own** configuration (e.g. project `.roo/mcp.json` or global `mcp_settings.json` with an `mcpServers` object). They do **not** use VS Code’s `vscode.lm.registerMcpServerDefinitionProvider`, so the Zowe MCP VS Code extension does not register the server for them.

Use the `**@zowe/mcp-server`** npm package in **stdio** mode: `command` + `args` (+ optional `env`), the same as any MCP client that spawns a process.

For **Streamable HTTP** (Bearer JWT, local Keycloak, or any remote URL), Roo supports **`type`: `streamable-http`** with **`url`** and optional **`headers`** — see **`docs/remote-dev-keycloak.md`** (Copilot / Cursor / Roo examples).

## Package identity

| Item                 | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| **npm package**      | `@zowe/mcp-server`                                                   |
| **CLI / `bin` name** | `zowe-mcp-server` (what you run after `npm install -g` or via `npx`) |
| `**npx`**            | `npx @zowe/mcp-server …` or `npx -y @zowe/mcp-server@<version> …`    |

## Install the server

1. **Ephemeral** — `npx -y @zowe/mcp-server` (pin a version in production).
2. **Project-local** — `npm install @zowe/mcp-server` → `node_modules/.bin/zowe-mcp-server`.
3. **Global** — `npm install -g @zowe/mcp-server` → run `zowe-mcp-server` (on `PATH`).

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

Copy or adapt [examples/roo-mcp.json](examples/roo-mcp.json).

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

## Passwords (standalone)

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

The shipped [`server.json`](../packages/zowe-mcp-server/server.json) documents `ZOWE_MCP_CREDENTIALS` for that reason. More background: [`mcp-authentication-oauth.md`](mcp-authentication-oauth.md) (credentials and HTTP auth), [`mcp-registry-research.md`](mcp-registry-research.md) (registry metadata).

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

Add `--mock` / `ZOWE_MCP_MOCK_DIR`, or pass `"--mock", "/absolute/path/to/mock-data"` in `args`. Generate mock data:

```bash
# If zowe-mcp-server is installed (globally or project-local):
zowe-mcp-server init-mock --output ./zowe-mcp-mock-data

# Or from a local tarball (see "Obtaining the .tgz" above):
npx --package=file:/absolute/path/to/zowe-mcp-server-0.8.0-dev.tgz zowe-mcp-server init-mock --output ./zowe-mcp-mock-data
```

## Local file tools

If the client does not expose MCP workspace roots, set `**ZOWE_MCP_WORKSPACE_DIR**` in `env` to your workspace folder so upload/download tools can resolve paths.

## See also

- [README.md](../README.md) — Standalone mode, `native-config.json`, VS Code `.vscode/mcp.json`
- [COPILOT-SETUP.md](COPILOT-SETUP.md) — Extension-based setup with Copilot
