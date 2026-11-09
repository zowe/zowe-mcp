# Kiro

This page is for people who use Zowe MCP with [Kiro](https://kiro.dev). Kiro
starts the Zowe MCP server from its own MCP configuration. It does not use the
server that the Zowe MCP VS Code extension registers. Installation,
authentication, and server options are in the
[standalone server guide](standalone-mcp.md). This page covers only what is
specific to Kiro.

## Configure Zowe MCP

Kiro reads MCP configuration from:

- User scope: `~/.kiro/settings/mcp.json`
- Workspace scope: `<workspace>/.kiro/settings/mcp.json`

A native SSH configuration looks like this:

```json
{
  "mcpServers": {
    "zowe": {
      "command": "/absolute/path/to/zowe-mcp-server",
      "args": [
        "--stdio",
        "--native",
        "--system",
        "USERID@zos.example.com"
      ],
      "env": {
        "ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM": "${ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM}"
      },
      "autoApprove": ["getContext", "listDatasets"]
    }
  }
}
```

Use an absolute `command` path because Kiro may start the process without your
interactive shell's nvm or `PATH` configuration. Install the binary as
described in [Install the server](standalone-mcp.md#install-the-server).

`autoApprove` is a Kiro setting, not a Zowe MCP option. List only the tools you
want Kiro to run without a per-call confirmation. Zowe MCP's capability tier
still controls which tools are available; see [Safety and
security](../README.md#safety-and-security).

## Environment-variable approval

Kiro supports `${VAR_NAME}` substitution in `mcp.json`. The first time it sees
an unrecognized variable, it displays a security warning and requires
**Approve & Allow**. Approval permits substitution but does not supply the
value.

The variable must exist in the environment inherited by Kiro. For example:

```bash
export ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM='password'
open -a Kiro
```

If the variable is unapproved or unavailable, Kiro may pass the literal
placeholder or an empty value to the server. Do not put passwords directly in
a committed `mcp.json`. An SSH key needs no password variable at all. See
[Authentication](standalone-mcp.md#authentication).

## Extension compatibility

Installing the Zowe MCP VS Code extension in Kiro does not register the server
with Kiro's MCP host. Configure the standalone server as shown above. If the
extension is installed only for Kiro, uninstall it to avoid an unused settings
UI and log channel.

The extension's helper commands have server CLI equivalents. For example,
`zowe-mcp-server init-mock --output …` replaces the extension's mock-data
command. See [Mock mode](mock-mode.md).

## Verify and manage

Open Kiro's **MCP SERVERS** panel to inspect server status and available tools.
Kiro writes server startup and tool-call information to **Kiro - MCP Logs** in
the Output panel. After changing configuration, restart the server from the
panel or run **Developer: Reload Window**.

Kiro also supports remote MCP URLs and headers. See the
[Kiro MCP configuration reference](https://kiro.dev/docs/mcp/configuration/) for
its client schema and the [remote server guide](remote-mcp-server.md) for
Zowe MCP over HTTP.

## Troubleshooting

- **Command not found:** use the absolute binary path.
- **`${VAR}` is not expanded:** approve the variable and launch Kiro from an
  environment where it is set.
- **Tools are missing:** check the configured capability tier and restart the
  server.
- **SSH fails:** verify VPN, DNS, the connection spec, and the corresponding
  password-variable name.
