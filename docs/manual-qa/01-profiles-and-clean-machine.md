# 01 — Profiles and clean machine

## Objective

Use isolated VS Code **profiles** (and optional **export ZIPs**) so you can repeat “first install” of Zowe MCP and save time on later regression passes.

## Prerequisites

- [00-prerequisites.md](00-prerequisites.md) satisfied.

## Steps

### A. Create a dedicated empty profile

1. Open the Command Palette (**Ctrl+Shift+P** / **Cmd+Shift+P**).
2. Run **Profiles: Create Profile…**.
3. Name it (e.g. `ZoweMcpManualClean`).
4. Choose a minimal template or empty starting point if offered.
5. Ensure **GitHub Copilot Chat** is installed in this profile and you are signed in (re-install extensions if the new profile is bare).

### B. Optional: “Post–model” checkpoint

1. Configure **Manage Models** (e.g. add **Google** / Gemini API key) if required by your org.
2. Send one test message in Copilot Chat to confirm the model works.
3. Run **Profiles: Export Profile**, save the ZIP to `manual-test-workspace/profile-exports/` (gitignored)—name it e.g. `post-gemini.zip`.

### C. Install Zowe MCP into this profile (developers)

**Order matters:** complete **step A** first so the profile **already exists**. The VS Code CLI (`code --install-extension … --profile <Name>`) returns `Profile '<Name>' not found` if the profile has never been created in that editor.

From the **repository root** (after `npm install` if needed):

```bash
VSCODE_PROFILE=ZoweMcpManualClean npm run build-and-install
```

Adjust the profile name to match yours. To install into the **default** profile instead, omit `VSCODE_PROFILE`.

Alternatively install from a release **.vsix** via **Extensions: Install from VSIX…** (see [02-install-zowe-mcp-vsix.md](02-install-zowe-mcp-vsix.md)).

### D. Optional: “Post–Zowe baseline” snapshot

After mock data exists **or** native connections are set (see later steps), export again (e.g. `post-zowe-mock.zip`) for quick restore before chat-only regressions.

## Expected result

- You can switch profiles (**Profiles: Switch Profile…**) and return to a known state.
- Exported ZIPs remain **local**; never commit them (the repo gitignores `manual-test-workspace/profile-exports/*.zip`).

## Failure notes

If the profile name has spaces, quote the environment value in your shell.

If you see **`Profile '…' not found`** during install, create the profile with **Profiles: Create Profile…** (step A), or install without `VSCODE_PROFILE` and then switch profiles in the UI.
