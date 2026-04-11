# Zowe MCP – Setup guide for GitHub Copilot

This guide helps you get the Zowe MCP extension running with GitHub Copilot in VS Code so you can use AI tools for z/OS (data sets, context, etc.).

## Who can use Copilot with Zowe MCP

- **Broadcom users**: You can use Copilot with Zowe MCP only if:
  1. You are included in the **OneTrust approval for Zowe MCP**, and
  2. You have a **Gemini API key** (used when your org requires “bring your own” model access).
- **Others**: If your Copilot subscription already includes chat and MCP, you can use the extension with the default models; you may still add Gemini via “Add Models” if you prefer.

## 1. Use Gemini API key in Copilot (Broadcom / BYOK)

If your organization uses “Bring Your Own Key” (BYOK) and you need Gemini:

1. Open **GitHub Copilot Chat** (e.g. **View → Copilot Chat** or <kbd>Ctrl+Shift+I</kbd> / <kbd>Cmd+Shift+I</kbd>).
2. Click the **model name** in the chat header (e.g. “Auto” or the current model).
3. Choose **Manage Models…** (or **Add Models…**).
4. Add **Google** as a provider and enter your **Gemini API key** when prompted.
5. Enable the Gemini model(s) you want to use.
6. In the model dropdown, select the Gemini model so Copilot uses it for chat (and thus for MCP tools like Zowe).

Your API key is stored by VS Code/Copilot and used only for your chat requests. You can get a key from your org’s GenAI champion.

## 2. Download and install the Zowe MCP extension

The extension is not on the Marketplace yet. Install from the **VSIX** published on GitHub:

1. Go to the [Releases](https://github.com/plavjanik/zowe-mcp/releases) page of this repository.
2. Open the latest release (e.g. **v0.1.0**).
3. Download the **`.vsix`** asset (e.g. `zowe-mcp-vscode-0.1.0.vsix`). You must be signed in and have read access to the repo.
4. In VS Code:
   - **Extensions** view (<kbd>Ctrl+Shift+X</kbd> / <kbd>Cmd+Shift+X</kbd>) → **Views and More Actions** (⋯) → **Install from VSIX…**,
   - or run **Extensions: Install from VSIX** from the Command Palette (<kbd>Ctrl+Shift+P</kbd> / <kbd>Cmd+Shift+P</kbd>).
5. Select the downloaded `.vsix` file and install.

The **Zowe** MCP server is registered with Copilot.

## 3. Define your z/OS system

To connect to real z/OS systems over SSH (native backend):

1. Open **Settings** (<kbd>Ctrl+,</kbd> / <kbd>Cmd+,</kbd>) and search for **Zowe MCP**.
2. Find **Native connections**.
3. Add connection specs as `user@host` or `user@host:port`, e.g.:
   - `USERID@sys1.example.com`
   - `USERID@host.example.com:22`
   Each entry is one connection; you can have multiple connections to the same z/OS system (e.g. different user IDs).
4. In the JSON editor it looks like:

   ```json
   "zoweMCP.nativeConnections": [
     "USERID@sys1.example.com"
   ]
   ```

5. The native backend is active by default. New or changed **Native connections** are sent to the server automatically; no restart needed. When the server needs a password, the extension will prompt you; it is stored in VS Code Secret Storage under the shared Zowe key. Restart the Zowe MCP server only when switching to mock mode (e.g. after setting **Mock Data Directory**).

To use **mock data** instead of a real system (no mainframe), use **Zowe MCP: Generate Mock Data** from the Command Palette or set **Mock Data Directory** to an existing mock data directory. If both **Mock Data Directory** and **Native connections** are set, **Native connections** is used.

## 4. Check that Copilot sees the Zowe tools

1. Open **Copilot Chat** (<kbd>Ctrl+Shift+I</kbd> / <kbd>Cmd+Shift+I</kbd>).
2. In the chat header, open the **tools** (or context) picker and ensure **Zowe** (or the Zowe MCP server) is enabled so its tools are available.
3. Try a prompt, for example:
   - *“Use the info tool to show the Zowe MCP server version.”*
   - With native/mock configured: *“List the available z/OS systems.”* or *“Set the active system to &lt;your-host&gt; and list data sets matching USER.\*”*

Tool names in Copilot are prefixed with `mcp_zowe_` (e.g. `mcp_zowe_info`, `mcp_zowe_listDatasets`, `mcp_zowe_setSystem`).

## 5. Copilot and MCP tips

### List MCP servers

- **Command Palette** (<kbd>Ctrl+Shift+P</kbd> / <kbd>Cmd+Shift+P</kbd>) → **MCP: List Servers**.
  You’ll see all configured MCP servers (including **Zowe** from this extension).

### Restart an MCP server

- Run **MCP: List Servers**, select **Zowe** (or the server you want), then choose **Restart** (or the equivalent action).
  Needed when switching to mock mode (e.g. after setting **Mock Data Directory**). **Native connections** changes are sent to the server automatically.

### See MCP server output (Zowe MCP server process)

- **MCP: List Servers** → select **Zowe** → **Show Output**.
  This shows the Zowe MCP server’s logs (stdio/stderr and any logging sent over the protocol).

### See the Zowe MCP extension output

- Open the **Output** panel (**View → Output**).
- In the dropdown on the right, select **Zowe MCP**.
  This is the extension’s own log (activation, settings, pipe, etc.), separate from the server process output above.

### Clear cached MCP tools

- If new or updated tools don’t appear, run **MCP: Reset Cached Tools** from the Command Palette, then restart the Zowe MCP server.

### Trust and configuration

- The first time an MCP server runs, VS Code may ask you to confirm that you trust it. You must accept for the Zowe server to start.
- Zowe MCP is registered by the extension (not via `mcp.json`). Its settings are under **Zowe MCP** in VS Code Settings.

## Summary

| Step | Action |
| ---- | ------ |
| 1 | (Broadcom) Get OneTrust approval and Gemini API key; add Gemini in Copilot **Manage Models** and select it. |
| 2 | Download the `.vsix` from [Releases](https://github.com/plavjanik/zowe-mcp/releases) and **Install from VSIX** in VS Code; reload. |
| 3 | Set **Zowe MCP → Native connections** to `["user@host"]` (or use **Mock Data Directory** for mock mode; restart the server when switching to mock). |
| 4 | In Copilot Chat, ensure Zowe tools are enabled and try *“Use the info tool to show the Zowe MCP server version.”* |
| 5 | Use **MCP: List Servers** to restart the Zowe MCP server or **Show Output**; use **Output → Zowe MCP** for extension logs. |

For development, mock mode, and native (SSH) details, see the main [README](../README.md) and [Configuring VS Code Copilot](../README.md#configuring-vs-code-copilot). Step-by-step manual test procedures (profiles, tools picker, mock path) are in [Manual QA](manual-qa/README.md). For attempts to automate Copilot/MCP UI, profile checkpoints, and fallbacks, see [Automation strategy](manual-qa/09-automation-strategy.md).
