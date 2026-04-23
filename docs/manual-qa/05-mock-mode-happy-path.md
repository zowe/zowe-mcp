# 05 — Mock mode happy path

## Objective

Validate the **Generate Mock Data** flow, reload/restart behavior, and a short Copilot session against **filesystem mock** z/OS data (no SSH).

## Prerequisites

- [04-copilot-tools-picker.md](04-copilot-tools-picker.md) complete (including [BYOK / added provider](../copilot-setup-guide.md#1-use-byok-or-additional-model-providers-in-copilot) if you test with a non-default chat model—keep that model selected in the header; same Zowe tools).
- You can use a folder under the repo (e.g. `../../zowe-mcp-mock-data` at repo root) or another path; default mock dir name is gitignored at repo root per [.gitignore](../../.gitignore).

## Steps

1. Command Palette → **Zowe MCP: Generate Mock Data** (category **Zowe MCP**).
2. Pick an output folder (empty or new). Accept defaults or choose a preset if prompted.
3. When offered, allow the extension to set **Mock Data Directory** and **reload** the window.
4. After reload, run **MCP: List Servers** → restart **Zowe** if the full tool set does not appear (see [07-settings-and-restart-behavior.md](07-settings-and-restart-behavior.md)).
5. In Copilot Chat (any selected model, including **Gemini** from Manage Models), ask for something that requires z/OS tools, for example:
   - *“List my data sets”* or *“List z/OS systems available in Zowe MCP and list data sets matching `USER.*` on the mock system.”*

## Expected result

- Settings show **Mock Data Directory** populated and **Native connections** empty (mock wins only when native list is empty; if both are set, **native wins**—see [README](../../README.md)).
- Copilot runs tools such as `listSystems` / `listDatasets` (names may show as `mcp_zowe_listSystems`, `mcp_zowe_listDatasets`) and returns plausible mock content.

## Failure notes

Capture whether **backend** in settings is `mock` or `native`, the **Zowe MCP** output channel, and **MCP** server output. If mock data is missing files, re-run **Generate Mock Data** or `npx @zowe/mcp-server init-mock` per [README](../../README.md).
