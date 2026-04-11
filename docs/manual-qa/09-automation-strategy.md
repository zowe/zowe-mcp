# 09 — Automation strategy (try first, then manual)

## Objective

Define what we **attempt to automate** for Copilot, **Manage Models**, and **MCP: List Servers** UI, what stays **manual**, and how **profile checkpoints** support semi-automated runs. If automation proves unreliable, **fall back** to the numbered manual steps ([00](00-prerequisites.md)–[08](08-failure-and-recovery.md)) without blocking releases.

## Authentication: GitHub Copilot vs Gemini API key

- **GitHub Copilot Chat** requires a normal **GitHub sign-in** to the Copilot service (subscription or trial as applicable). That is separate from model add-ons.
- **Gemini** (or other BYOK models) is configured in Copilot **Manage Models** / **Add Models** and is **stored by VS Code/Copilot**, not by setting `GEMINI_API_KEY` alone for in-editor chat. You may still use `GEMINI_API_KEY` for **other tooling** (e.g. repo eval scripts)—do not assume it replaces Copilot login for VS Code.

## What to try automating (in order)

1. **Playwright `_electron`** (best practices: `downloadAndUnzipVSCode()` from `@vscode/test-electron`, stable `args`, single VS Code instance, consider Insiders if Stable flakes—see [Playwright Electron](https://playwright.dev/docs/api/class-electron), [VS Code issue #22351](https://github.com/microsoft/playwright/issues/22351)):
   - Smoke: Extension Development Host launches and a window stays open.
   - Optional: Command Palette opens and a **Zowe MCP** command string is discoverable (may be **locale-fragile**).

2. **Deep UI (Copilot login, Manage Models, MCP: List Servers)**  
   - **Try:** drive keyboard shortcuts to Command Palette, type **MCP: List Servers**, **Manage Models**, with waits for UI that may not expose stable selectors.  
   - **Expect:** failures on **first-time trust**, **OAuth**, **2FA**, or **Copilot entitlement** checks.  
   - **Fallback:** keep [03-first-run-and-trust.md](03-first-run-and-trust.md), [04-copilot-tools-picker.md](04-copilot-tools-picker.md), and [Copilot setup guide §1–§5](../copilot-setup-guide.md) as the **source of truth** for manual verification.

3. **Semi-automated profile workflow**  
   - **Manual once:** Sign in to GitHub for Copilot; add Gemini in **Manage Models** if required.  
   - **Checkpoint:** **Profiles: Export Profile** → save ZIP under `manual-test-workspace/profile-exports/` (gitignored).  
   - **Later runs:** duplicate or import that profile for tests that need a logged-in editor; **never commit** profile ZIPs or secrets.

## What stays automated without Copilot UI (`@vscode/test-electron`)

Extension integration tests (see [`packages/zowe-mcp-vscode/src/test/extension.test.ts`](../../packages/zowe-mcp-vscode/src/test/extension.test.ts)) should cover **activation**, **registered commands**, **bundled server path**, and **`buildServerConfig`** behavior—see **README** section [What is already automated](README.md#what-is-already-automated-skip-in-manual-qa). These run in CI and do **not** open Copilot Chat.

## Decision rule

| Outcome | Action |
| --- | --- |
| Electron smoke + extension tests green | Ship; manual QA for Copilot/MCP UI on a release candidate or cadence. |
| Playwright Copilot/MCP UI flaky or auth-blocked | Document and **stop** investing; rely on manual [03](03-first-run-and-trust.md)/[04](04-copilot-tools-picker.md) + profile checkpoints. |

## References

- [Testing Extensions](https://code.visualstudio.com/docs/extensions/testing-extensions)  
- [MCP in VS Code](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)  
- [Copilot setup guide](../copilot-setup-guide.md)  
