# Manual QA — Zowe MCP with VS Code and GitHub Copilot

Repeatable, human-run checks for **first-run experience**, **Copilot + MCP integration**, **mock vs native** flows, and **observability**. Use with the small workspace at [`manual-test-workspace/`](../../manual-test-workspace/).

**Companion docs:** [Copilot setup guide](../copilot-setup-guide.md) (Gemini, MCP list, outputs), [README — Configuring VS Code Copilot](../../README.md#configuring-vs-code-copilot).

## Procedure index

| Step | Document | Focus |
| --- | --- | --- |
| 00 | [00-prerequisites.md](00-prerequisites.md) | VS Code, Copilot Chat, accounts |
| 01 | [01-profiles-and-clean-machine.md](01-profiles-and-clean-machine.md) | Profiles, `VSCODE_PROFILE`, export ZIPs |
| 02 | [02-install-zowe-mcp-vsix.md](02-install-zowe-mcp-vsix.md) | Install VSIX / `build-and-install` |
| 03 | [03-first-run-and-trust.md](03-first-run-and-trust.md) | Trust, MCP list, two output channels |
| 04 | [04-copilot-tools-picker.md](04-copilot-tools-picker.md) | Tools picker, `getContext` / version; **Copilot + Gemini (BYOK)** |
| 05 | [05-mock-mode-happy-path.md](05-mock-mode-happy-path.md) | Generate Mock Data, chat on mock |
| 06 | [06-native-mode-smoke.md](06-native-mode-smoke.md) | Optional SSH smoke |
| 07 | [07-settings-and-restart-behavior.md](07-settings-and-restart-behavior.md) | Reload vs MCP restart vs live settings |
| 08 | [08-failure-and-recovery.md](08-failure-and-recovery.md) | Reset tools, logs, clear password |
| 09 | [09-automation-strategy.md](09-automation-strategy.md) | Why Copilot UI is manual; optional Gemini+MCP smoke; profiles |

## Profiles and install commands

- **Empty profile**: Create with **Profiles: Create Profile…** (e.g. `ZoweMcpManualClean`) so first-run can be retested; see [01-profiles-and-clean-machine.md](01-profiles-and-clean-machine.md).
- **Install into a named profile** (from repo root):

  ```bash
  VSCODE_PROFILE=ZoweMcpManualClean npm run build-and-install
  ```

  Use `VSCODE_CLONE=cursor` (or `code-insiders`, etc.) if not using the default `code` CLI.

- **Save checkpoints**: **Profiles: Export Profile** → store ZIP under `manual-test-workspace/profile-exports/` (only `README.md` is tracked; `*.zip` is gitignored).

## What is already automated (skip in manual QA)

Manual tests should **not** re-verify tool contracts, transports, or extension host unit behavior that CI already covers.

| Automated area | Where | What it covers |
| --- | --- | --- |
| MCP server + tools | [`packages/zowe-mcp-server/__tests__/`](../../packages/zowe-mcp-server/__tests__/) | Vitest: `common.test.ts` (per transport), datasets, jobs, USS, search, CLI bridge, etc. |
| VS Code extension | [`packages/zowe-mcp-vscode/src/test/extension.test.ts`](../../packages/zowe-mcp-vscode/src/test/extension.test.ts) | Activation, output channel, `provideZoweMcpServerDefinitions` vs `buildServerConfig`, real-settings `nativeConnections` round-trip, registered commands, bundled `server/index.js`, dialog-cancel command paths, `onStartupFinished`, mocked `buildServerConfig` / no-connections notification |
| Extension test runner | [`packages/zowe-mcp-vscode/.vscode-test.mjs`](../../packages/zowe-mcp-vscode/.vscode-test.mjs) | Launches VS Code; Mocha tests in `out/test/` |

**Gap:** Nothing in this repo drives **GitHub Copilot Chat** to invoke MCP tools (see [09 — Why Copilot UI is manual](09-automation-strategy.md)). **`npm run smoke:gemini-zowe-mcp`** automates **Gemini + Zowe MCP** over stdio (mock)—same tool layer as chat, not the VS Code UI.

## Screen capture on failures

On manual run failures, use **screen recording** plus **Output** logs (**Zowe MCP** channel and **MCP: List Servers** → **Show Output** for the server). Official references: [Testing Extensions](https://code.visualstudio.com/docs/extensions/testing-extensions), [MCP in VS Code](https://code.visualstudio.com/docs/copilot/chat/mcp-servers), [MCP developer guide](https://code.visualstudio.com/docs/copilot/guides/mcp-developer-guide).

## Best-practice reminders

- Trust MCP servers only from trusted sources; review prompts before approving tool calls with sensitive parameters.
- Use **MCP: List Servers** and **MCP: Reset Cached Tools** when tool lists look stale ([08-failure-and-recovery.md](08-failure-and-recovery.md)).
