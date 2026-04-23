# 02 — Install Zowe MCP (VSIX)

## Objective

Install the **Zowe MCP** extension so it registers the **Zowe** MCP server with Copilot.

## Prerequisites

- [01-profiles-and-clean-machine.md](01-profiles-and-clean-machine.md) (profile chosen or default).
- A built `.vsix` (local build or release asset).

## Steps

### Option A — From the repo (developers)

1. At the repository root, run `npm run build-and-install` (see [README — Option A](../../README.md#option-a-install-the-vs-code-extension-recommended)). The script builds the extension and server, packages a `.vsix`, and runs the editor CLI to install it—the first run can take **one to several minutes**.
2. Optional: `VSCODE_PROFILE=YourProfile npm run build-and-install` to target a [named profile](01-profiles-and-clean-machine.md) (**the profile must already exist**—see step 01-C).
3. Reload the window when prompted or run **Developer: Reload Window**.

### Option B — Install from a downloaded VSIX

1. Download the `.vsix` from your release process (see [Copilot setup guide §2](../copilot-setup-guide.md#2-download-and-install-the-zowe-mcp-extension)).
2. **Extensions** view → **⋯** → **Install from VSIX…**, or Command Palette → **Extensions: Install from VSIX…**.
3. Select the file and confirm installation.
4. **Developer: Reload Window**.

## Expected result

- Under **Extensions**, **Zowe MCP** (publisher **Zowe**) appears and is enabled.
- After reload, the extension activates (`onStartupFinished`).

## Failure notes

- If installation fails, capture the Extensions view error and confirm VS Code engine version matches the extension’s requirement.
- Do not confuse this with adding a server only via `mcp.json`; the **recommended** path is extension registration ([README](../../README.md#option-a-install-the-vs-code-extension-recommended)). Standalone `mcp.json` is [Option B](../../README.md#option-b-configure-as-a-standalone-mcp-server-in-vs-code).
