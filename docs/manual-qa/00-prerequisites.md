# 00 — Prerequisites

## Objective

Confirm the machine and accounts are ready before creating profiles or installing Zowe MCP.

## Prerequisites

- macOS, Windows, or Linux with a supported **Visual Studio Code** build (see [engines in the extension manifest](../../packages/zowe-mcp-vscode/package.json): `vscode` `^1.101.0` or newer).
- **GitHub Copilot** subscription or trial that includes **GitHub Copilot Chat** and MCP-capable chat (see [Copilot setup guide](../copilot-setup-guide.md#who-can-use-copilot-with-zowe-mcp) for org-specific notes, e.g. approval, BYOK, and model providers).
- Access to this repository if you will run `npm run build-and-install`, or a downloaded `.vsix` from your release process.
- For **native (SSH)** smoke tests later: a z/OS system you may use, `user@host`, and permission to enter credentials (optional for mock-only runs).

## Steps

1. Install **Visual Studio Code**.
2. Install the **GitHub Copilot** and **GitHub Copilot Chat** extensions from the Marketplace (or your editor’s equivalent).
3. Sign in to GitHub from VS Code when prompted so Copilot Chat is active.
4. (Optional) If your organization uses **BYOK** or a specific model provider, complete **Manage Models** / **Add Models** per [Copilot setup guide §1](../copilot-setup-guide.md#1-use-byok-or-additional-model-providers-in-copilot) before relying on Zowe tools in chat.

To open chat if the menu path differs by version: Command Palette (**Ctrl+Shift+P** / **Cmd+Shift+P**) → type **Copilot** or **Chat** → choose the action that opens **GitHub Copilot Chat** (wording varies slightly by VS Code release).

## Expected result

- Copilot Chat opens (e.g. **View → Chat** with Copilot, or **View → Copilot Chat**, or via the Command Palette as above).
- You can send a simple message and get a reply (proves chat and model path work before Zowe MCP).

## Failure notes

If Copilot does not respond, fix that **before** installing Zowe MCP; capture the Copilot output channel and VS Code version (**Help → About**).
