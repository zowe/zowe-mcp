# 04 — Copilot tools picker and minimal tool call

## Objective

Confirm GitHub Copilot Chat exposes **Zowe** tools and can invoke a minimal tool (`getContext`) that does not require a z/OS backend.

## Prerequisites

- [03-first-run-and-trust.md](03-first-run-and-trust.md) complete.
- Copilot Chat works with your chosen model ([00-prerequisites.md](00-prerequisites.md)).

## Steps

1. Open **GitHub Copilot Chat** (e.g. **Ctrl+Shift+I** / **Cmd+Shift+I** where configured).
2. Open the **tools** or **participants** UI in the chat header (exact labels depend on VS Code version) and ensure tools from the **Zowe** MCP server are **enabled**.
3. Send a prompt that forces a tool call, for example:
   - *“Use the getContext tool (Zowe MCP) and tell me the Zowe MCP server version from the response.”*

   In Copilot, tool names are typically prefixed like `mcp_zowe_getContext` (see [README](../../README.md#configuring-vs-code-copilot)).

## Expected result

- Chat shows an approved or executed tool call for **getContext** / `mcp_zowe_getContext`.
- The assistant’s answer includes a **version string** matching your installed server (from `getContext` → `server.version` in the structured result).

## Failure notes

- If tools are missing: **MCP: Reset Cached Tools**, restart the **Zowe** server from **MCP: List Servers**, reload the window—see [08-failure-and-recovery.md](08-failure-and-recovery.md).
- If the model refuses to call tools, confirm the correct model is selected in the chat header.
