# VS Code and GitHub Copilot

The optional Zowe MCP VS Code extension registers the MCP server with GitHub
Copilot Chat and manages settings, logs, and password prompts. The extension's
canonical configuration reference is
[`packages/zowe-mcp-vscode/README.md`](../packages/zowe-mcp-vscode/README.md).
This page covers the Copilot setup flow.

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

The extension is not yet on the VS Code Marketplace. Either:

- follow the [source build and installation
  instructions](../README.md#install-the-extension), or
- download the `.vsix` from a repository release and run **Extensions: Install
  from VSIX** from the Command Palette.

Reload VS Code after installation. The extension registers a **Zowe** MCP
server.

## 3. Define your z/OS system

Open Settings and search for **Zowe MCP**.

For native SSH access:

1. Set **Backend** to `zowex`.
2. Add `user@host` or `user@host:port` entries under **Zowe Remote SSH: Zowex
   Connections** (`zoweMCP.zowexConnections`).
3. Reload the window when prompted.

The extension requests a password when needed and stores it in VS Code Secret
Storage. SSH keys are preferred when available.

For testing without z/OS, set **Backend** to `mock` and run **Zowe MCP:
Generate Mock Data**, or select an existing mock-data directory.

## 4. Check that Copilot sees the Zowe tools

1. Open GitHub Copilot Chat.
2. Open the tools picker and ensure the **Zowe** server is enabled.
3. Ask: *“Use the getContext tool to show the Zowe MCP server version.”*

Tool names appear with an `mcp_zowe_` prefix in Copilot, such as
`mcp_zowe_getContext` and `mcp_zowe_listDatasets`.

## 5. Copilot and MCP tips

- Run **MCP: List Servers** to inspect, restart, or show output for **Zowe**.
- Use **Output → Zowe MCP** for extension logs. MCP server output is available
  through **MCP: List Servers**.
- Accept the MCP trust prompt the first time the server starts.
- If updated tools do not appear, restart the server. Use **MCP: Reset Cached
  Tools** when restarting is insufficient.

For repeatable human test procedures, see the [Manual QA
checklist](manual-qa.md). For general safety guidance, see [Safety and
security](mcp-safety-security-principles.md).
