# Manual test workspace

Use this folder as the VS Code workspace when running [manual QA procedures](../docs/manual-qa/README.md) for Zowe MCP with GitHub Copilot.

- Open **File → Open Folder…** and select this directory (`manual-test-workspace`), or run `code . --profile <YourProfile>` from here.
- `sample-notes.md` is harmless filler so Copilot chat has trivial workspace context; it is not a test script.
- Optional: install [recommended extensions](.vscode/extensions.json) when prompted.

Profile export ZIPs (if you use **Profiles: Export Profile**) belong under `profile-exports/`; that directory is set up so `*.zip` files stay untracked—see `profile-exports/README.md`.
