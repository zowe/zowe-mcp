# Kiro

This guide configures the **Zowe MCP server** in [Kiro](https://kiro.dev) — an AWS agentic IDE forked from VS Code. It focuses on the Zowe-specific bits (connections, passwords, job cards, capability tier); for everything else about Kiro MCP support, see [kiro.dev/docs/mcp/configuration](https://kiro.dev/docs/mcp/configuration/).

## Kiro MCP in 30 seconds

- **Config files** (`mcpServers` object, same shape as Claude Desktop):
  - User scope: `~/.kiro/settings/mcp.json` — applies to every workspace.
  - Workspace scope: `<workspace>/.kiro/settings/mcp.json` — overrides user scope on conflict.
- **Supported fields per server:** `command`, `args`, `env`, `disabled`, `autoApprove`, `disabledTools` (and `url` / `headers` for remote HTTP).
- **Variable substitution:** only `${VAR_NAME}` — Kiro expands environment variables from the shell it was launched with. There is **no** `${input:…}`, no `${secret:…}`, and no built-in password vault referenced from `mcp.json`. To keep a secret off disk, export it in the shell and reference it with `${VAR}`.

## 1. Install the server

```bash
npm install -g @zowe/mcp-server          # public registry, when published
# or, from this repo (offline / pre-release):
npm run pack:server
npm install -g ./zowe-mcp-server-<version>.tgz
zowe-mcp-server --version                 # sanity check
```

Full install matrix (global, project-local, tarball, npx) is in [claude-code-mcp.md](claude-code-mcp.md#1-install-the-zowemcp-server-package). Everything there applies — Kiro just consumes the same `zowe-mcp-server` binary over stdio.

## 2. Connect to one z/OS system

`~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "zowe": {
      "command": "/opt/homebrew/bin/zowe-mcp-server",
      "args": [
        "--stdio",
        "--native",
        "--system",
        "USERID@zos.example.com",
        "--capability-tier",
        "read"
      ],
      "env": {
        "ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM": "${ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM}"
      },
      "autoApprove": ["getContext", "listDatasets"]
    }
  }
}
```

- Use the **absolute path** for `command` — Kiro spawns the server from a shell that may not have your `nvm` / Node setup. `which zowe-mcp-server` after a global install gives you the right value.
- `--capability-tier` controls which categories of tools the server exposes: `read-strict` (default, reads ask for confirmation), `read`, `update`, `delete`, `full`. See [README.md](../README.md) for the full matrix.
- `autoApprove` is Kiro-specific (not a server flag) — list tool names you don't want to confirm per call, or `"*"` for all.

## 3. Passwords

The server needs the z/OS password to open SSH. Kiro itself does not prompt for or store secrets, so you supply it through the environment.

### Per-connection variable (recommended)

**Format:** `ZOWE_MCP_PASSWORD_<USER>_<HOST>` — uppercase the user, replace dots in the host with underscores. `IBMUSER@mainframe.acme.com` → `ZOWE_MCP_PASSWORD_IBMUSER_MAINFRAME_ACME_COM`.

Two equivalent ways to deliver it:

1. **Export in the shell, reference with `${…}`** (keeps the secret out of `mcp.json`):

   ```bash
   export ZOWE_MCP_PASSWORD_IBMUSER_MAINFRAME_ACME_COM='…'
   open -a Kiro
   ```

   Then in `mcp.json` either reference it explicitly (as shown above) or omit the `env` block entirely — Kiro inherits the launching shell's environment.

2. **Inline in `mcp.json`** (convenient, plaintext on disk):

   ```json
   "env": { "ZOWE_MCP_PASSWORD_IBMUSER_MAINFRAME_ACME_COM": "your-password" }
   ```

### One JSON env var for many connections

If you connect to multiple systems, set a single `ZOWE_MCP_CREDENTIALS` env var to a JSON object keyed by `user@host`:

```jsonc
{
  "userid@zos.example.com": "pw1",
  "other@host.example.com:2222": "pw2"
}
```

Per-connection `ZOWE_MCP_PASSWORD_…` wins over an entry in `ZOWE_MCP_CREDENTIALS` for the same key.

## 4. Multiple systems and job cards

Replace `--system` with `--config /abs/path/to/native-config.json`:

```json
"args": ["--stdio", "--native", "--config", "/Users/me/zowe/native-config.json"]
```

`native-config.json`:

```json
{
  "systems": ["userid@zos1.example.com", "userid@zos2.example.com:2222"],
  "defaultSystem": "userid@zos1.example.com",
  "jobCards": {
    "userid@zos1.example.com": [
      "//{jobname}  JOB (ACCT),'{programmer}',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID",
      "/*JOBPARM S=*"
    ]
  }
}
```

Set `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (or a `ZOWE_MCP_CREDENTIALS` entry) for **every** system listed. Placeholders `{jobname}` and `{programmer}` are filled in by the server at submit time.

## 5. Mock mode (no mainframe)

```json
"args": ["--stdio", "--mock", "/Users/me/zowe-mcp/zowe-mcp-mock-data"]
```

Generate the fixture folder once with `zowe-mcp-server init-mock --output ~/zowe-mcp/zowe-mcp-mock-data`. No `--native`, no `--system`, no password.

## 6. Verify and manage

- Open the **MCP** panel in Kiro's sidebar — the `zowe` server should appear and show as connected. Right-click to stop / restart / view logs.
- Use the bottom panel's **OUTPUT** dropdown → `Kiro - MCP Logs` to see stderr from the server (auth errors, SSH failures, dataset calls).
- Editing `mcp.json` triggers a reload; if a server stays stale, restart it from the MCP panel.

## Troubleshooting (Zowe-specific)

- **`getaddrinfo ENOTFOUND <host>`** — the `--system` host doesn't resolve from your machine. Check VPN / DNS.
- **Auth fails with the right password** — the env-var name must match the `--system` value exactly: uppercase user, dots → underscores. Confirm with `env | grep ZOWE_MCP_PASSWORD` in the same shell that launched Kiro.
- **`zowe-mcp-server` not found** — Kiro spawns from a non-interactive shell. Set `command` to the absolute path (`which zowe-mcp-server`).
- **`${VAR}` not expanded** — Kiro must have been launched from a shell where that variable was already exported. Running `open -a Kiro` from the dock or Finder will **not** see your shell's exports; relaunch from the terminal after `export`.
- **Tools missing in the agent** — capability tier filters them out. Raise `--capability-tier` to `update`, `delete`, or `full` and restart the server.

## See also

- [Kiro MCP configuration reference](https://kiro.dev/docs/mcp/configuration/) — full Kiro schema, remote/HTTP servers, security defaults.
- [Claude Code MCP](claude-code-mcp.md) — same `mcpServers` shape, plus OAuth / streamable-HTTP details that apply to any client speaking MCP over HTTP.
- [Roo / standalone MCP](roo-or-standalone-mcp.md) — pattern for any client that loads MCP from its own JSON instead of VS Code's registration API.
