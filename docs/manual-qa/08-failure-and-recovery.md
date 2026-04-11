# 08 — Failure and recovery

## Objective

Recover from stale tools, bad passwords, or confusing MCP state during manual QA.

## Prerequisites

- Zowe MCP installed; you know where **MCP: List Servers** and **Output** panels are ([03-first-run-and-trust.md](03-first-run-and-trust.md)).

## Steps

1. **Stale tool list in Copilot**
   - Command Palette → **MCP: Reset Cached Tools**.
   - **MCP: List Servers** → **Zowe** → **Restart**.

2. **Server or extension logs too quiet**
   - Settings → **Zowe MCP** → **Log Level** → `debug` (or `trace` if available).
   - Watch **Output → Zowe MCP** and the MCP server output from **MCP: List Servers**.

3. **Wrong or expired SSH password (native)**
   - Command Palette → **Zowe MCP: Clear Stored Password** and follow prompts to pick the connection.
   - Retry the tool; enter the correct password when asked.

4. **Nuclear option (local dev only)**
   - Command Palette → **Zowe MCP: Reset All Settings and State** (if you intend to wipe extension-related state—confirm what it clears before using on a shared machine).

5. **Still broken**
   - **Developer: Reload Window**.
   - Re-verify [04-copilot-tools-picker.md](04-copilot-tools-picker.md) minimal `getContext` prompt.

## Expected result

- After reset + restart, **MCP: List Servers** shows **Zowe** healthy and Copilot can call `getContext` again.

## Failure notes

- Attach **both** log channels, VS Code version, extension version, and whether you use a **profile** or **Settings Sync**.
- Screen recording helps for intermittent UI issues (see [docs/manual-qa/README.md — Playwright](README.md#playwright-automation-and-screen-capture)).
