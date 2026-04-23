# 07 — Settings vs reload vs MCP restart

## Objective

Build a clear mental model of when to **reload the window**, when to **restart the Zowe MCP server** from **MCP: List Servers**, and when settings apply live—so manual testers file accurate bugs.

## Prerequisites

- Extension installed ([02-install-zowe-mcp-vsix.md](02-install-zowe-mcp-vsix.md)).

## Steps (observe and record)

1. **Mock Data Directory**
   - Set or change the path, then try **Developer: Reload Window** vs **MCP: List Servers** → **Restart** on **Zowe**.
   - Note which action is required for the server to pick up `--mock` and the new directory on your build.

2. **Native connections**
   - Add or change an entry. Watch whether tools reflect the new system **without** reload ([Copilot setup guide](../copilot-setup-guide.md) suggests updates can be sent without restart).
   - Compare with [README](../../README.md) statements about reload.

3. **Log level** (`zoweMCP.logLevel`)
   - Change from **Settings**; confirm whether **Zowe MCP** output verbosity changes **without** reload (extension forwards log level over the pipe per [AGENTS.md](../../AGENTS.md)).

## Expected result

- You document **for your VS Code version**:
  - Reload required: yes/no for mock path changes.
  - MCP restart sufficient: yes/no.
  - Native connection edits: immediate vs reload.

## Failure notes

If documentation in [README](../../README.md) or [copilot-setup-guide.md](../copilot-setup-guide.md) disagrees with observed behavior, file an issue with exact VS Code version, extension version, and steps.
