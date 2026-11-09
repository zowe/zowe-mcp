# VS Code and GitHub Copilot

This page is for people who use Zowe MCP with GitHub Copilot Chat in VS Code.
It walks through the Copilot side of the setup. The
[extension README](../packages/zowe-mcp-vscode/README.md) describes the
extension's settings.

## Who can use Copilot with Zowe MCP

You need VS Code 1.101 or later and an MCP-capable GitHub Copilot Chat
installation. Follow your organization's policies for AI tools, extensions,
model providers, and z/OS access.

## 1. Use BYOK or additional model providers in Copilot

If your organization requires a specific model provider:

1. Open GitHub Copilot Chat.
2. Select the model name in the chat header.
3. Choose **Manage Models** or **Add Models**.
4. Add the provider and credentials supplied by your organization.
5. Select that model for the chat session.

This changes the chat model, not the Zowe MCP tools registered with Copilot.

## 2. Download and install the Zowe MCP extension

The extension is not yet on the VS Code Marketplace.

1. Download `zowe-mcp-vscode-<version>.vsix` from the
   [latest release](https://github.com/zowe/zowe-mcp/releases/latest).
2. Run **Extensions: Install from VSIX...** from the Command Palette and select
   the file.

The extension registers an MCP server named **Zowe**.

## 3. Define your z/OS system

Open Settings and search for **Zowe MCP**.

Add `user@host` or `user@host:port` entries under **Zowe MCP: Zowex
Connections** (`zoweMCP.zowexConnections`).

The server uses your SSH key when you have one. Otherwise, the extension
prompts for your password and stores it in VS Code Secret Storage.

To try Zowe MCP without z/OS, run **Zowe MCP: Generate Mock Data**. See
[Try it without a mainframe](../packages/zowe-mcp-vscode/README.md#try-it-without-a-mainframe).

## 4. Check that Copilot sees the Zowe tools

1. Open GitHub Copilot Chat.
2. Open the tools picker and ensure the **Zowe** server is enabled.
3. Ask: *“Use the getContext tool to show the Zowe MCP server version.”*

The tools are listed under the **Zowe** server, with names such as
`getContext` and `listDatasets`. In logs and chat session files, Copilot adds a
prefix to the name, such as `mcp_zowe-mcp-serv_listDatasets`.

## 5. Copilot and MCP tips

- Run **MCP: List Servers** to inspect, restart, or show output for **Zowe**.
- Use **Output → Zowe MCP** for extension logs. MCP server output is available
  through **MCP: List Servers**.
- Accept the MCP trust prompt the first time the server starts.
- If updated tools do not appear, restart the server. Use **MCP: Reset Cached
  Tools** when restarting is insufficient.

To control what the assistant can do, see
[Choose what the assistant can do](../packages/zowe-mcp-vscode/README.md#choose-what-the-assistant-can-do).
