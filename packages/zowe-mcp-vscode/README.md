# Zowe MCP for VS Code

Zowe MCP gives AI assistants in VS Code tools for working with z/OS data sets,
jobs, and z/OS UNIX System Services (USS). The extension contains the Zowe MCP
server and registers it with GitHub Copilot Chat. You configure everything in
VS Code Settings; there are no command-line options or environment variables to
set.

Other MCP clients, such as Claude Code, Kiro, or Roo Code, do not use the
server that this extension registers. For those clients, install the
[standalone server](https://github.com/zowe/zowe-mcp/blob/main/docs/standalone-mcp.md)
instead.

## Requirements

- VS Code 1.101 or later
- GitHub Copilot Chat
- SSH access to z/OS with your own user ID

## Installation

The extension is not yet available from the VS Code Marketplace.

1. Download `zowe-mcp-vscode-<version>.vsix` from the
   [latest release](https://github.com/zowe/zowe-mcp/releases/latest).
2. Run **Extensions: Install from VSIX...** from the Command Palette and select
   the file.

The extension registers an MCP server named **Zowe**. Run **MCP: List Servers**
to confirm that it is listed.

## Connect to z/OS

1. Open Settings and search for **Zowe MCP**.
2. Add one or more connections to **Zowe MCP: Zowex Connections**
   (`zoweMCP.zowexConnections`). A connection is written as `user@host` or
   `user@host:port`, such as `USERID@sys1.example.com`. The default port is 22.

**Backend** (`zoweMCP.backend`) is `zowex` by default, which connects to z/OS
over SSH through [Zowe Remote SSH](https://github.com/zowe/zowex). If the Zowe
Remote SSH server component is not installed on z/OS yet, the first connection
installs it in `~/.zowe-server`.

### Authentication

The server authenticates with the first method that is available:

1. **SSH key (recommended).** If you can already run
   `ssh USERID@sys1.example.com` with a key, the server uses the same key. It
   reads the `IdentityFile` for the host in `~/.ssh/config`, or a default key
   such as `~/.ssh/id_ed25519`. Keys held only in `ssh-agent` are not used.
2. **Password.** When no key works, the extension prompts for your password
   and stores it in VS Code Secret Storage, not in settings. If z/OS rejects a
   stored password, the extension deletes it.

Set `zoweMCP.preferSshKey` to `false` to always use a password.

## Choose what the assistant can do

`zoweMCP.capabilityTier` controls which tools the assistant can use. Use the
lowest tier that the task needs.

| Tier | What the assistant can do |
| --- | --- |
| `read-strict` (default) | Read only. Copilot asks you to confirm each read. |
| `read` | Read only, without confirmation prompts. |
| `update` | Read, create, and modify. |
| `delete` | Read, update, delete, and cancel. |
| `full` | Everything, including job submission and command execution. |

Reload the window after you change the tier. See the
[Safety and security principles](https://github.com/zowe/zowe-mcp/blob/main/docs/mcp-safety-security-principles.md)
for the full security model.

## Try it without a mainframe

1. Run **Zowe MCP: Generate Mock Data** from the Command Palette and select a
   folder.
2. Select **Use as Mock Data** in the notification, and then **Reload Window**.
3. If you have already configured z/OS connections, also set **Backend** to
   `mock`.

Mock mode provides sample data sets and USS files. Job tools are not available
in mock mode.

## Other settings

The Settings UI describes every option, including data set and USS encodings,
the response timeout, job cards, log level, and Zowe CLI plug-in configuration.

## Commands

- **Zowe MCP: Generate Mock Data** — Create a mock data folder and offer to use
  it.
- **Zowe MCP: Clear Stored Password** — Remove the saved SSH password for a
  connection that you select.
- **Zowe MCP: Reset All Settings and State** — Clear the Zowe MCP settings,
  the stored passwords for the configured connections, and the extension state.

## Zowe Explorer integration

When [Zowe Explorer](https://marketplace.visualstudio.com/items?itemName=Zowe.vscode-extension-for-zowe)
is installed, the assistant can open data sets, USS files, and job output in the
editor. These tools use a Zowe Explorer z/OSMF profile. The extension selects
the profile that matches the system, or asks you to choose one, and remembers
the choice for the session.

## Troubleshooting

- **Extension log:** open the Output panel and select **Zowe MCP**.
- **Server log:** run **MCP: List Servers**, select **Zowe**, and select **Show
  Output**.
- **Tools are missing:** check the capability tier, and reload the window after
  you change the backend, the tier, or the SSH key preference.
- **No connections are configured:** the extension shows a notification with an
  **Open Settings** button. Add a connection, or switch to mock mode.

To check that Copilot sees the tools, follow the
[VS Code and GitHub Copilot guide](https://github.com/zowe/zowe-mcp/blob/main/docs/copilot-setup-guide.md).
For the tools, prompts, and resources, see the
[MCP reference](https://github.com/zowe/zowe-mcp/blob/main/docs/mcp-reference.md).

## License

[Eclipse Public License v2.0](https://www.eclipse.org/legal/epl-v20.html)
