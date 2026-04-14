# 04 — Copilot tools picker and minimal tool call

## Objective

Confirm GitHub Copilot Chat exposes **Zowe** tools and can invoke a minimal tool (`getContext`) that does not require a z/OS backend.

## Prerequisites

- [03-first-run-and-trust.md](03-first-run-and-trust.md) complete.
- Copilot Chat works with your chosen model ([00-prerequisites.md](00-prerequisites.md)).

## Copilot Chat with Gemini selected (BYOK)

This is the normal Copilot Chat UI—not a separate script. If your org uses **Gemini** via **Manage Models**:

1. Complete [Copilot setup §1](../copilot-setup-guide.md#1-use-byok-or-additional-model-providers-in-copilot) (add your model provider and API key in **Manage Models** per your org).
2. Stay signed in to **GitHub** with **Copilot** entitlement; Gemini does not replace that requirement.
3. In the Copilot Chat **header**, open the **model** dropdown and select your **Gemini** model for this session.
4. Follow **Steps** below. MCP tool names stay `mcp_zowe_*`; only the **chat model** changes.

To exercise **list data sets** with Gemini, continue to [05-mock-mode-happy-path.md](05-mock-mode-happy-path.md) after this document passes (mock backend required for a useful answer without SSH).

### Optional: automate the Gemini + MCP layer (not Copilot UI)

If you want a **scripted** check that **Gemini** can call **`listDatasets`** on the Zowe MCP server (mock data, no VS Code), use **`npm run smoke:gemini-zowe-mcp`** with **`GEMINI_API_KEY`**—see [09 — Why Copilot UI is manual](09-automation-strategy.md) (*Automated Gemini + Zowe MCP (stdio smoke)*). Use it as a complement to manual Copilot steps, not a replacement for signing in and trying chat.

## Steps

1. Open **GitHub Copilot Chat** (e.g. **Ctrl+Shift+I** / **Cmd+Shift+I** where configured).
2. If you use **Gemini**, confirm it is **selected** in the chat header model dropdown ([§ Copilot + Gemini](#copilot-chat-with-gemini-selected-byok) above).
3. Open the **tools** or **participants** UI in the chat header (exact labels depend on VS Code version) and ensure tools from the **Zowe** MCP server are **enabled**.
4. Send a prompt that forces a tool call, for example:
   - *“Use the getContext tool (Zowe MCP) and tell me the Zowe MCP server version from the response.”*

   In Copilot, tool names are typically prefixed like `mcp_zowe_getContext` (see [README](../../README.md#configuring-vs-code-copilot)).

## Expected result

- Chat shows an approved or executed tool call for **getContext** / `mcp_zowe_getContext`.
- The assistant’s answer includes a **version string** matching your installed server (from `getContext` → `server.version` in the structured result).

## Failure notes

- If tools are missing: **MCP: Reset Cached Tools**, restart the **Zowe** server from **MCP: List Servers**, reload the window—see [08-failure-and-recovery.md](08-failure-and-recovery.md).
- If the model refuses to call tools, confirm the correct model is selected in the chat header.
