# 06 — Native mode smoke (optional)

## Objective

Smoke-test **SSH / Zowe Remote SSH** backend: connection string, password or stored secret, and one **read-only** MCP tool (e.g. list data sets).

## Prerequisites

- z/OS host reachable by SSH with credentials you may use.
- [04-copilot-tools-picker.md](04-copilot-tools-picker.md) complete.
- Prefer clearing mock mode: leave **Mock Data Directory** empty and set **Native connections** (see [README](../../README.md)).

## Steps

1. **Settings** → search **Zowe MCP** → **Native connections** → set JSON array, e.g. `["USERID@host.example.com"]` (use your real `user@host`; do not commit secrets).
2. Reload the window if required by your VS Code build (native connection updates may apply without reload—observe actual behavior; see [07-settings-and-restart-behavior.md](07-settings-and-restart-behavior.md)).
3. When a tool first needs SSH, complete the **password** prompt if shown; the extension may store it under the shared Zowe key ([README](../../README.md#configuring-vs-code-copilot)).
4. In Copilot Chat, ask for a **read-only** action, e.g. *“Set the active system to my configured connection and list data sets matching `SYS1.*`”* (adjust pattern to something valid on your system).

## Expected result

- No fatal MCP error; `listDatasets` or `getContext` reflects an active system when appropriate.
- Password is not echoed in chat; extension output may show `passwordHash` fragments only ([README](../../README.md#configuring-vs-code-copilot)).

## Failure notes

- Invalid password: extension may clear stored secret—retry after **Zowe MCP: Clear Stored Password** if needed ([08-failure-and-recovery.md](08-failure-and-recovery.md)).
- Skip this entire section in air-gapped or no-mainframe environments.
