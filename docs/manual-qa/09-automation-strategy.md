# 09 — Why Copilot UI is manual (and what we automate instead)

## Objective

**GitHub Copilot Chat** and related VS Code UI (**Manage Models**, **MCP: List Servers**, trust dialogs) are verified with the **numbered manual procedures** ([00](00-prerequisites.md)–[08](08-failure-and-recovery.md)) and optional **profile checkpoints**. This document explains **why** those flows are **not** automated in this repository, and what **is** automated for confidence before manual Copilot checks.

## Why we do not automate Copilot / VS Code UI tests here

Automating **Copilot Chat** or driving **desktop VS Code** for MCP verification hits recurring blockers:

| Difficulty | Detail |
| --- | --- |
| **Authentication** | Copilot requires a **GitHub account** with **Copilot entitlement**; sessions involve **OAuth**, **2FA**, and org policies. CI cannot rely on long-lived tokens in-repo. |
| **First-run UI** | **Workspace trust**, MCP server trust, and **first-time** Copilot prompts are interactive and vary by VS Code version and locale. |
| **BYOK / Manage Models** | Adding **Gemini** (or other API keys) is a **settings UI** flow with no stable, documented automation API for tests. |
| **Selectors & churn** | Chat, palette, and webview UI **change between releases**; Playwright/Electron experiments against VS Code are **fragile** and costly to maintain. |
| **Org registry** | Optional tooling (e.g. Playwright for Electron) may not live on the default Zowe Artifactory registry; pinning and mirroring add ops overhead for little gain versus **manual QA**. |

**Practical summary:** Use **[Copilot setup guide](../copilot-setup-guide.md)** and **[04](04-copilot-tools-picker.md)** / **[05](05-mock-mode-happy-path.md)** for real Copilot + Zowe MCP validation. Use **profile export** ([01](01-profiles-and-clean-machine.md)) to repeat a known-good editor state when helpful.

## Authentication: GitHub Copilot vs Gemini API key (reminder)

**`GEMINI_API_KEY` alone** does **not** replace **GitHub sign-in** for **Copilot Chat**. For BYOK, add Gemini in **Manage Models**, stay signed in with Copilot, then select a Gemini model in the chat header—see [Copilot setup §1](../copilot-setup-guide.md#1-use-gemini-api-key-in-copilot-broadcom--byok).

## Automated Gemini + Zowe MCP (stdio smoke)

**Not Copilot UI:** `npm run smoke:gemini-zowe-mcp` runs **Google Gemini** against the **Zowe MCP server** over **stdio** with **mock** data (same AI/MCP stack as `npm run evals`). Default prompt is *“List data sets matching USER.\*\*”* (only the `listDatasets` tool is exposed to the model); the script fails unless **`listDatasets`** is invoked. Default model is **`gemini-2.5-flash`** (override with **`GEMINI_ZOWE_MCP_SMOKE_MODEL`** if your API does not serve that id).

Use it for **local or CI** checks (with **`GEMINI_API_KEY`** as a secret) that the **model + MCP tools** work end-to-end **before** you repeat prompts in Copilot Chat.

```bash
export GEMINI_API_KEY=your_key
npm run smoke:gemini-zowe-mcp
```

Optional: **`GEMINI_ZOWE_MCP_SMOKE_MODEL`**, **`GEMINI_ZOWE_MCP_SMOKE_PROMPT`**; **`GOOGLE_API_KEY`** is accepted as an alias for **`GEMINI_API_KEY`**. Dotenv loads **`.env`** / **`.env.local`** at the repo root (same discovery as evals).

## Semi-automated profile workflow

- **Manual once:** Sign in to GitHub for Copilot; add keys in **Manage Models** if required.
- **Checkpoint:** **Profiles: Export Profile** → save ZIP under `manual-test-workspace/profile-exports/` (gitignored).
- **Later runs:** import or duplicate that profile; **never commit** profile ZIPs or secrets.

## What stays automated without Copilot UI

| Area | Where |
| --- | --- |
| MCP server + tools | [`packages/zowe-mcp-server/__tests__/`](../../packages/zowe-mcp-server/__tests__/)(Vitest) |
| VS Code extension | [`packages/zowe-mcp-vscode/src/test/extension.test.ts`](../../packages/zowe-mcp-vscode/src/test/extension.test.ts) (`vscode-test`) |
| Gemini + MCP (stdio) | `npm run smoke:gemini-zowe-mcp` (see above) |

## Screen capture on failures

Prefer **screen recording** plus **Output** logs (**Zowe MCP** channel; **MCP: List Servers** → **Show Output** for the server) when manual steps fail.

## References

- [Testing Extensions](https://code.visualstudio.com/docs/extensions/testing-extensions)  
- [MCP in VS Code](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)  
- [Copilot setup guide](../copilot-setup-guide.md)  
