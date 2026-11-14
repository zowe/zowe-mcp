# Claude Code

This page is for people who use Zowe MCP with
[Claude Code](https://docs.claude.com/en/docs/claude-code/overview). Claude
Code starts the Zowe MCP server itself. Installation, authentication, and
server options are in the [standalone server guide](standalone-mcp.md). This
page covers only what is specific to Claude Code.

## Configure a local stdio server

First, [install the server](standalone-mcp.md#install-the-server).

For project scope, create `.mcp.json` in the project root:

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
      ]
    }
  }
}
```

You can create the same project-scoped entry with the CLI:

```bash
claude mcp add zowe \
  --scope project \
  -- zowe-mcp-server --stdio --native --system USERID@zos.example.com
```

Use `--scope user` for a user-wide entry in `~/.claude.json`. Use
`--scope local` for a machine-local entry.

Authenticate with an SSH key or the environment variables described under
[Authentication](standalone-mcp.md#authentication). Do
not commit passwords to `.mcp.json`.

## Claude Code-specific behavior

- Claude Code does not use the server that the Zowe MCP VS Code extension
  registers.
- It does not expand `~` in `.mcp.json`; use absolute paths.
- Its MCP process may not inherit an nvm-configured `PATH`. If
  `zowe-mcp-server` works in your terminal but not in Claude Code, set
  `command` to the absolute binary path.
- Use `claude mcp list`, `claude mcp get zowe`, and
  `claude mcp remove zowe` to manage entries.
- Inside Claude Code, use `/mcp` to inspect status, view tools, restart the
  server, or authenticate a remote server.

For multiple systems or custom job cards, add `--config` as described in
[Multiple systems and job cards](standalone-mcp.md#multiple-systems-and-job-cards).
For testing without z/OS, use [Mock mode](mock-mode.md).

## Remote HTTP and OAuth

Claude Code can connect to a [remote Zowe MCP server](remote-mcp-server.md).
Ask the server administrator for the URL and the OAuth client ID. The example
below is for the
[test environment with Keycloak](remote-dev-keycloak.md) in this repository,
which has a pre-registered `demo` client and uses callback port `8089`:

```json
{
  "mcpServers": {
    "zowe-remote": {
      "type": "http",
      "url": "https://zowe-mcp.example.com/mcp",
      "oauth": {
        "clientId": "demo",
        "callbackPort": 8089
      }
    }
  }
}
```

Claude Code can use Dynamic Client Registration when an identity provider
supports it. The development Keycloak realm does not automatically attach all
scopes required by Claude Code, including `offline_access`, to dynamically
registered clients. Use the static `demo` client for that environment.

Do not commit static Bearer tokens to `.mcp.json`.

## Local file tools

If Claude Code does not advertise MCP workspace roots, set
`ZOWE_MCP_WORKSPACE_DIR` in the server's `env` block to the absolute workspace
path.

## Troubleshooting

- **Command not found:** use the absolute `zowe-mcp-server` path.
- **Configuration changes are ignored:** restart the server through `/mcp` or
  restart Claude Code.
- **SSH authentication fails:** verify the same `user@host` with `ssh`, then
  check the environment-variable name described in the standalone guide.
- **OAuth returns `invalid_scope`:** use the pre-registered client and ensure
  the identity provider attaches the requested scopes, including
  `offline_access` when advertised.

## See also

- [Standalone server guide](standalone-mcp.md)
- [Remote server guide](remote-mcp-server.md)
- [Official Claude Code MCP documentation](https://docs.claude.com/en/docs/claude-code/mcp)
