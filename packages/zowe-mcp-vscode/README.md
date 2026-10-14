# Zowe MCP for VS Code

Zowe MCP gives AI assistants in VS Code tools for working with z/OS data sets,
jobs, and UNIX System Services. The extension bundles and registers the Zowe
MCP server, manages its configuration, prompts for SSH passwords, and forwards
runtime events between VS Code and the server.

The extension also supports Cursor when its optional MCP registration API is
available. Other MCP clients should run
[`@zowe/mcp-server`](https://github.com/zowe/zowe-mcp/blob/main/docs/standalone-mcp.md)
directly.

## Requirements

- VS Code 1.101 or later
- GitHub Copilot Chat or another MCP-enabled chat extension
- SSH access to z/OS when using the Zowe Remote SSH backend

## Installation

The extension is not yet available from the VS Code Marketplace. Build and
install the VSIX from a repository checkout as described in the
[repository README](https://github.com/zowe/zowe-mcp#install-the-extension).
Reload VS Code after installation.

The extension registers an MCP server named **Zowe**. Confirm that it is running
with **MCP: List Servers**.

## Configuration

Open VS Code Settings and search for **Zowe MCP**.

### Capability tier

`zoweMCP.capabilityTier` controls which tools the assistant can use. The default
is `read-strict`, which exposes read-only tools and asks the client to confirm
reads.

| Tier | Allowed operations |
| --- | --- |
| `read-strict` | Read only, with confirmation prompts |
| `read` | Read only, automatically approved |
| `update` | Read, create, and modify |
| `delete` | Read, update, delete, and cancel |
| `full` | All tools, including job submission and command execution |

Use the lowest tier needed for the task. See the
[Safety and security principles](https://github.com/zowe/zowe-mcp/blob/main/docs/mcp-safety-security-principles.md)
for the full security model.

### Connect through Zowe Remote SSH

1. Set **Backend** (`zoweMCP.backend`) to `zowex`.
2. Add one or more `user@host` or `user@host:port` values under **Zowe Remote
   SSH: Zowex Connections** (`zoweMCP.zowexConnections`).
3. Reload the window.

The server tries SSH keys from your existing `~/.ssh` configuration before
requesting a password. Set `zoweMCP.preferSshKey` to `false` to require password
authentication. Passwords entered through the extension are stored in VS Code
Secret Storage, not in settings.

### Use mock data

1. Set **Backend** to `mock`.
2. Run **Zowe MCP: Generate Mock Data** from the Command Palette, or set
   `zoweMCP.mockDataDirectory` to an existing mock-data directory.
3. Reload the window.

Mock mode is intended for testing without a mainframe. See
[Mock mode](https://github.com/zowe/zowe-mcp/blob/main/docs/mock-mode.md) for the
standalone workflow and fixture layout.

The Settings UI is the authoritative reference for all extension options,
including encodings, response timeouts, job cards, log level, and CLI bridge
plugin configuration.

## Commands

- **Zowe MCP: Generate Mock Data** — Generate fixtures and configure their
  directory.
- **Zowe MCP: Clear Stored Password** — Remove the saved SSH password for a
  selected connection.
- **Zowe MCP: Reset All Settings and State** — Clear Zowe MCP settings, stored
  passwords for configured connections, and extension state.

## Zowe Explorer integration

When [Zowe Explorer](https://marketplace.visualstudio.com/items?itemName=Zowe.vscode-extension-for-zowe)
is installed, the MCP server can register tools that open data sets, USS files,
and job output in the editor. The extension resolves the applicable Zowe
Explorer profile and remembers the selection for the current session.

## Themes

The extension includes Zowe and ISPF color themes and the **Zowe Mainframe**,
**ISPF**, and **ISPF Modern** file icon themes. Select them with the standard VS
Code theme commands.

## Troubleshooting

- Open **View: Toggle Output** and select **Zowe MCP** for extension logs.
- Use **MCP: List Servers**, select **Zowe**, and open its output for MCP server
  logs.
- Reload the window after changing the backend, connections, capability tier,
  SSH key preference, or other startup settings.

For setup checks, see the
[manual QA guide](https://github.com/zowe/zowe-mcp/blob/main/docs/manual-qa.md).
For the current tools, prompts, and resources, see the generated
[MCP reference](https://github.com/zowe/zowe-mcp/blob/main/docs/mcp-reference.md).

## License

[Eclipse Public License v2.0](https://www.eclipse.org/legal/epl-2.0/)
