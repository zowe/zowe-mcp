# Kiro

This guide configures the **Zowe MCP server** in [Kiro](https://kiro.dev) — an AWS agentic IDE forked from VS Code. It focuses on the Zowe-specific bits (connections, passwords, job cards, capability tier); for everything else about Kiro MCP support, see [kiro.dev/docs/mcp/configuration](https://kiro.dev/docs/mcp/configuration/).

## Kiro MCP in 30 seconds

- **Config files** (`mcpServers` object, same shape as Claude Desktop):
  - User scope: `~/.kiro/settings/mcp.json` — applies to every workspace.
  - Workspace scope: `<workspace>/.kiro/settings/mcp.json` — overrides user scope on conflict.
- **Supported fields per server:** `command`, `args`, `env`, `disabled`, `autoApprove`, `disabledTools` (and `url` / `headers` for remote HTTP).
- **Variable substitution:** only `${VAR_NAME}` — Kiro expands environment variables from the shell it was launched with. There is **no** `${input:…}`, no `${secret:…}`, and no built-in password vault referenced from `mcp.json`. To keep a secret off disk, export it in the shell and reference it with `${VAR}`.
- **Two-step gate for `${VAR}`:** (1) Kiro shows a **Security Warning** toast the first time it sees an unrecognised variable name in `mcp.json` and waits for **Approve & Allow** (approvals persist in `kiroAgent.mcpApprovedEnvVars` inside Kiro's user `settings.json`); (2) the variable must actually exist in the env Kiro inherits. If approved but unset, the literal `${VAR}` text is passed through to the server — see [§3 Passwords](#3-passwords).

## 1. Install the server

```bash
npm install -g @zowe/mcp-server          # public registry, when published
# or, from this repo (offline / pre-release):
npm run pack:server
npm install -g ./zowe-mcp-server-<version>.tgz
zowe-mcp-server --version                 # sanity check
```

Full install matrix (global, project-local, tarball, npx) is in [claude-code-mcp.md](claude-code-mcp.md#1-install-the-zowemcp-server-package). Everything there applies — Kiro just consumes the same `zowe-mcp-server` binary over stdio.

### Note about the Zowe MCP VS Code extension

If you already have the Zowe MCP VS Code extension (VSIX) installed: **uninstall it for Kiro and use the `@zowe/mcp-server` npm package directly via `mcp.json`** (this guide). The extension installs cleanly in Kiro and its `zoweMCP.*` settings UI is functional, but **its MCP-server registration is not consumed by Kiro** — the extension calls `vscode.lm.registerMcpServerDefinitionProvider('zowe', …)` (the VS Code MCP-provider API used by Copilot Chat) and Kiro inherits the API types from upstream VS Code so the call doesn't error, but Kiro's MCP host is a parallel implementation that only honours servers declared in `mcp.json` (and an internal `powers.mcpServers` namespace). The MCP SERVERS panel will not show a server contributed by the extension, and Kiro's agent will not see its tools. Leaving the extension installed alongside an `mcp.json` entry just adds a stale Settings UI and a misleading log channel.

Uninstall via Kiro's Extensions view, or:

```bash
/Applications/Kiro.app/Contents/Resources/app/bin/code --uninstall-extension zowe.zowe-mcp-vscode
```

The extension's helper commands (`zowe-mcp.initMockData`, etc.) are thin wrappers around CLI subcommands — `zowe-mcp-server init-mock --output …` is equivalent and works after the extension is gone.

## 2. Connect to one z/OS system

`~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "zowe": {
      "command": "/opt/homebrew/bin/zowe-mcp-server",
      "args": [
        "--stdio",
        "--native",
        "--system",
        "USERID@zos.example.com",
        "--capability-tier",
        "read"
      ],
      "env": {
        "ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM": "${ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM}"
      },
      "autoApprove": ["getContext", "listDatasets"]
    }
  }
}
```

- Use the **absolute path** for `command` — Kiro spawns the server from a shell that may not have your `nvm` / Node setup. `which zowe-mcp-server` after a global install gives you the right value.
- `--capability-tier` controls which categories of tools the server exposes: `read-strict` (default, reads ask for confirmation), `read`, `update`, `delete`, `full`. See [README.md](../README.md) for the full matrix.
- `autoApprove` is Kiro-specific (not a server flag) — list tool names you don't want to confirm per call, or `"*"` for all. When a tool is not on the list, Kiro shows a per-call **Reject / Trust / Run** prompt in chat: **Run** approves this one call, **Trust** approves it and stops prompting for the same tool, **Reject** cancels. The server's log records the choice as `Consent Mechanism: user` (prompted) or `auto` (matched `autoApprove`).

## 3. Passwords

The server needs the z/OS password to open SSH. Kiro itself does not prompt for or store secrets, so you supply it through the environment.

### Security Warning: the env-var approval gate

The first time `mcp.json` references a `${VAR}` Kiro hasn't seen before, Kiro shows a **Security Warning** toast in the bottom-right corner naming the variable(s) and asks you to click **Approve & Allow**. Until you click it, Kiro passes the literal `${VAR}` text to the server (you'll see this in the server log as a non-empty `passwordHash` of `${VAR…}`-style input, and SSH will fail authentication).

Approval is a one-time per-variable action; the approved name is persisted to `kiroAgent.mcpApprovedEnvVars` in Kiro's user `settings.json` (`~/Library/Application Support/Kiro/User/settings.json` on macOS). Remove an entry from that list to revoke approval.

**Approval is an authorization policy, not a value provider.** If the variable is approved but not set in Kiro's parent environment, substitution produces the empty string — and the server will fail with an empty password. Always export the variable in the shell that launches Kiro:

```bash
export ZOWE_MCP_PASSWORD_IBMUSER_MAINFRAME_ACME_COM='…'
open -a Kiro    # must inherit this shell's env
```

### Per-connection variable (recommended)

**Format:** `ZOWE_MCP_PASSWORD_<USER>_<HOST>` — uppercase the user, replace dots in the host with underscores. `IBMUSER@mainframe.acme.com` → `ZOWE_MCP_PASSWORD_IBMUSER_MAINFRAME_ACME_COM`.

Two equivalent ways to deliver it:

1. **Export in the shell, reference with `${…}`** (keeps the secret out of `mcp.json`):

   ```bash
   export ZOWE_MCP_PASSWORD_IBMUSER_MAINFRAME_ACME_COM='…'
   open -a Kiro
   ```

   Then in `mcp.json` either reference it explicitly (as shown above) or omit the `env` block entirely — Kiro inherits the launching shell's environment.

2. **Inline in `mcp.json`** (convenient, plaintext on disk):

   ```json
   "env": { "ZOWE_MCP_PASSWORD_IBMUSER_MAINFRAME_ACME_COM": "your-password" }
   ```

### One JSON env var for many connections

If you connect to multiple systems, set a single `ZOWE_MCP_CREDENTIALS` env var to a JSON object keyed by `user@host`:

```jsonc
{
  "userid@zos.example.com": "pw1",
  "other@host.example.com:2222": "pw2"
}
```

Per-connection `ZOWE_MCP_PASSWORD_…` wins over an entry in `ZOWE_MCP_CREDENTIALS` for the same key.

## 4. Multiple systems and job cards

Replace `--system` with `--config /abs/path/to/native-config.json`:

```json
"args": ["--stdio", "--native", "--config", "/Users/me/zowe/native-config.json"]
```

`native-config.json`:

```json
{
  "systems": ["userid@zos1.example.com", "userid@zos2.example.com:2222"],
  "defaultSystem": "userid@zos1.example.com",
  "jobCards": {
    "userid@zos1.example.com": [
      "//{jobname}  JOB (ACCT),'{programmer}',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID",
      "/*JOBPARM S=*"
    ]
  }
}
```

Set `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (or a `ZOWE_MCP_CREDENTIALS` entry) for **every** system listed. Placeholders `{jobname}` and `{programmer}` are filled in by the server at submit time.

## 5. Mock mode (no mainframe)

Mock mode replaces the SSH backend with fixture data — useful for trying the server with Kiro before you have credentials or VPN access.

### Setup

```bash
zowe-mcp-server init-mock --output ~/zowe-mcp/mock-data
```

Then point `mcp.json` at it (no `--native`, no `--system`, no password block needed):

```json
{
  "mcpServers": {
    "zowe": {
      "command": "/opt/homebrew/bin/zowe-mcp-server",
      "args": [
        "--stdio",
        "--mock",
        "/Users/me/zowe-mcp/mock-data",
        "--capability-tier",
        "read"
      ],
      "autoApprove": ["listSystems", "getContext", "listDatasets"]
    }
  }
}
```

### Walkthrough

After saving the file (and **Developer: Reload Window**), the server starts and the Kiro view's **MCP SERVERS** panel shows `zowe — Connected (26 tools)`. The default fixture exposes two systems (`mainframe-dev.example.com`, `mainframe-test.example.com`) with no default selected.

In chat, ask *"List my data sets on z/OS"*. Kiro will:

1. Call `listSystems` (auto-approved) → discovers two systems.
2. Ask you which one to use. Reply with the name (e.g. *"Use mainframe-dev.example.com"*).
3. Call `setSystem` — this one is **not** in `autoApprove`, so the per-tool consent prompt appears. Click **Run** (or **Trust** to skip the prompt next time).
4. Call `listDatasets {"dsnPattern":"USER.**"}` (auto-approved) → returns a table of mock data sets.

The MCP server log (Output panel → `Kiro - MCP Logs`) records each call with its `Consent Mechanism` (`auto` for `autoApprove`-matched tools, `user` for prompted ones).

## 6. Verify and manage

### Where the MCP UI lives in Kiro

MCP servers are **not** in the standard Explorer view. Click the **Kiro** icon (the purple ghost at the top of the activity bar) to open the Kiro view. Sections from top to bottom: **SPECS**, **AGENT HOOKS**, **AGENT STEERING & SKILLS**, **MCP SERVERS**. The last section is the one you want.

Each configured server appears with a status badge — e.g. `zowe — Connected (26 tools)` with a green check. Expand the server to see every tool with its description (`listSystems`, `setSystem`, `getContext`, `listDatasets`, `listMembers`, `searchInDataset`, `readDataset`, …). This is the same list the agent has access to from chat.

### Logs and reloads

- **Output panel → `Kiro - MCP Logs`** — Kiro's view of every server: startup, tool calls (with `Consent Mechanism`), errors.
- **Output panel → `Zowe MCP`** — the Zowe MCP VS Code extension's own logs, if you installed the VSIX. Useful for debugging the extension itself, but not for MCP tool calls — see the [extension note in §1](#note-about-the-zowe-mcp-vs-code-extension).
- Editing `mcp.json` is picked up automatically. If a server stays stale, use **Developer: Reload Window** from the command palette, or stop/start the server from the MCP SERVERS panel.

## Troubleshooting (Zowe-specific)

- **`getaddrinfo ENOTFOUND <host>`** — the `--system` host doesn't resolve from your machine. Check VPN / DNS.
- **Auth fails with the right password** — the env-var name must match the `--system` value exactly: uppercase user, dots → underscores. Confirm with `env | grep ZOWE_MCP_PASSWORD` in the same shell that launched Kiro.
- **`zowe-mcp-server` not found** — Kiro spawns from a non-interactive shell. Set `command` to the absolute path (`which zowe-mcp-server`).
- **`${VAR}` not expanded** — two possible causes: (a) the variable is not in `kiroAgent.mcpApprovedEnvVars` — re-trigger the Security Warning toast (delete the entry from `~/Library/Application Support/Kiro/User/settings.json` and reload), or (b) the variable is approved but not set in Kiro's parent env. Running `open -a Kiro` from the dock or Finder will **not** see your shell's exports; relaunch from a terminal after `export VAR=…`.
- **No password prompt appeared, but the server starts** — Kiro does not prompt for the value of `${VAR}` at any point. It either expands the variable from its inherited environment or passes the literal `${VAR}` text through. If you expected a prompt, you may have been thinking of VS Code's `${input:…}` mechanism, which Kiro does **not** support.
- **Tools missing in the agent** — capability tier filters them out. Raise `--capability-tier` to `update`, `delete`, or `full` and restart the server.

## See also

- [Kiro MCP configuration reference](https://kiro.dev/docs/mcp/configuration/) — full Kiro schema, remote/HTTP servers, security defaults.
- [Claude Code MCP](claude-code-mcp.md) — same `mcpServers` shape, plus OAuth / streamable-HTTP details that apply to any client speaking MCP over HTTP.
- [Roo / standalone MCP](roo-or-standalone-mcp.md) — pattern for any client that loads MCP from its own JSON instead of VS Code's registration API.
