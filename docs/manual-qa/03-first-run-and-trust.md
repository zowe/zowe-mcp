# 03 — First run, trust, and logs

## Objective

Verify the MCP server starts, trust/consent flows work if shown, and you can find **both** the extension log and the **Zowe** MCP server process log.

## Prerequisites

- [02-install-zowe-mcp-vsix.md](02-install-zowe-mcp-vsix.md) complete.

## Steps

1. Open a **trusted** workspace folder if prompted (**Restricted Mode** can block extensions). Use **Manage Workspace Trust** if needed.
2. Reload VS Code if you have not since installing the extension.
3. If VS Code shows a **trust** or **MCP server** consent prompt for **Zowe**, accept it so the server can start (see [VS Code MCP guidance](https://code.visualstudio.com/docs/copilot/chat/mcp-servers) on trusting servers).
4. Open the Command Palette → **MCP: List Servers** (requires a recent VS Code; MCP chat integration must be available).
5. Select **Zowe** (label from the extension’s MCP provider).
6. Open **Show Output** (or equivalent) for that server—this is the **MCP server process** log (stdio / protocol diagnostics).
7. Open **View → Output**, choose **Zowe MCP** in the dropdown—this is the **extension** log (activation, pipe, settings), separate from step 6.

## Expected result

- **MCP: List Servers** lists **Zowe** and the server can show output without crashing.
- You can tell the two channels apart: **Zowe MCP** (extension) vs **Zowe** MCP server output from the MCP list action (see also [Copilot setup guide §5](../copilot-setup-guide.md#5-copilot-and-mcp-tips)).

## Failure notes

- If the server never starts, copy **both** outputs and the **Help → About** details.
- Workspace trust: if the window is restricted, try a trusted folder or review VS Code trust settings.
- If **MCP: List Servers** does not appear in the Command Palette, confirm VS Code meets the extension engine version ([`engines.vscode`](../../packages/zowe-mcp-vscode/package.json)) and that Copilot/MCP features are enabled for your build.
