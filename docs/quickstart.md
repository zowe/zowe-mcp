# Quickstart

Try Zowe MCP in about five minutes, **without a mainframe**, using built-in mock data. Pick the path that matches your tool:

- [Option 1 — Standalone MCP server](#option-1--standalone-mcp-server) for Claude Code, Codex, Roo, Cursor and other MCP clients.
- [Option 2 — VS Code extension (VSIX)](#option-2--vs-code-extension-vsix) for GitHub Copilot Chat in VS Code.

You need **Node.js 24+** for Option 1 (the version Zowe MCP is built and tested against; this guide was run on Node 26).

This guide is verified against the latest release, **v0.10.0**. The code on `main` has moved on in a few ways that affect setup, so check [Version notes](#version-notes-0100-vs-newer) if you installed something newer or are reading the `main` docs.

## Option 1 — Standalone MCP server

`@zowe/mcp-server` is **not yet on public npm**, so install from a tarball. Download `zowe-mcp-server-<version>.tgz` from the [GitHub Releases page](https://github.com/zowe/zowe-mcp/releases) (each release also has the `.vsix`). Other sources: the `zowe-mcp-server-npm` artifact of a CI run, or `npm run pack:server` in a clone. See [Getting the `.tgz`](claude-code-mcp.md#getting-the-tgz).

```bash
# 1. Install (puts `zowe-mcp-server` on your PATH)
npm install -g ./zowe-mcp-server-<version>.tgz

# 2. Generate mock z/OS data
zowe-mcp-server init-mock --output ~/zowe-mcp-mock-data --preset minimal

# 3. Register it with your client (Claude Code shown; paths must be absolute)
claude mcp add zowe-mock --scope project -- \
  zowe-mcp-server --stdio --mock "$HOME/zowe-mcp-mock-data" --capability-tier read-strict
```

Start `claude` in that directory, approve the server, run `/mcp` to confirm it is **connected**, then ask: *"List the data sets under USER.\*"*

**Codex CLI** uses its own commands, and has no project scope (the entry is global in `~/.codex/config.toml`):

```bash
codex mcp add zowe-mock -- zowe-mcp-server --stdio --mock "$HOME/zowe-mcp-mock-data" --capability-tier read-strict
codex mcp list      # shows the entry; it does not show connection status
```

Other clients take the same command and args in their own config file: see [Claude Code](claude-code-mcp.md), [Roo or standalone](roo-or-standalone-mcp.md), or [Kiro](kiro-mcp.md).

**Gotchas**

- If you already have a server named `zowe` in another scope, pick a different name (as above) to avoid a conflict.
- Claude Code does not expand `~` in `.mcp.json`, so use absolute paths.
- The default capability tier is `read-strict` (read-only). Raise it with `--capability-tier` to try writes: [Capability tier](claude-code-mcp.md#capability-tier).
- The 0.10.0 tarball is 32 MB (about 16,500 files, 147 MB installed), so `npm install` takes about a minute, and the VSIX is 71 MB. Newer builds are much smaller. With `npm install --prefix ./global ...` instead of `-g`, the binary is `./global/node_modules/.bin/zowe-mcp-server`, which is not on your `PATH`: use its **absolute path** as the command in every command above.
- `claude mcp list` may show a failing server from another project or scope. That is unrelated to this setup. A new project-scoped server shows `Pending approval` until you run `claude` and approve it.

### Let your AI agent do it

An AI coding agent such as Claude Code can do the whole setup for you, including downloading the release. Start it in an empty folder and use a prompt like this:

> Help me install Zowe MCP in this directory. Follow the "For AI agents" section of <https://github.com/zowe/zowe-mcp/blob/main/docs/quickstart.md>, and ask me its questions before you install anything.

If you already know your answers, add them to the prompt (for example: "Claude Code, mock data, read-strict tier") and the agent will confirm them instead of asking. The agent installs into the folder, registers the server, checks it over stdio, and then tells you the one step it can't do itself: start your client there and approve the server.

This was tested with Claude Code and the 0.10.0 release. For Codex, only the registration (`codex mcp add`) and a stdio handshake were tested, not a live Codex session.

## Option 2 — VS Code extension (VSIX)

The extension registers the server with Copilot Chat for you and handles password prompts through VS Code. It is not on the Marketplace yet. It needs VS Code 1.101 or later and GitHub Copilot Chat with MCP support. The server is bundled, so you don't need Node.js.

1. Download `zowe-mcp-vscode-<version>.vsix` from the [GitHub Releases page](https://github.com/zowe/zowe-mcp/releases) (or a CI run), then run **Extensions: Install from VSIX…** in VS Code and reload.
2. Run **Zowe MCP: Generate Mock Data** from the Command Palette and pick a folder; this saves `zoweMCP.mockDataDirectory`. Then set `zoweMCP.backend` to `mock` in Settings (the default, `zowex`, is the real SSH backend and ignores the mock folder), and run **Developer: Reload Window**. Accept VS Code's one-time prompt to trust the MCP server.
3. Check it is running: Command Palette, **MCP: List Servers**, **Zowe** should be running. In Copilot Chat, switch to **agent mode** and make sure the Zowe tools are enabled in the tools picker, then ask: *"List the data sets under USER.\*"*

The default tier, `read-strict`, makes Copilot ask you to confirm each read, so expect a prompt. To change it, set `zoweMCP.capabilityTier` (`read-strict`, `read`, `update`, `delete`, `full`) and run **Developer: Reload Window**.

Details and screenshots: [Copilot setup guide](copilot-setup-guide.md). Building the VSIX from source: [README — VS Code extension](../README.md#vs-code-extension-optional).

## Connect to a real z/OS system

Zowe MCP talks to z/OS over **SSH**. On first connect it deploys the Zowe Remote SSH server (`zowex`) to `~/.zowe-server` in your z/OS home directory, so the first request is slower, and it redeploys when a newer Zowe MCP ships a newer server. You need an SSH login (`user@host`, optional `:port`) on the target system. It replaces mock mode: choose one or the other, not both.

### 1. Tell the server which systems to use

**Standalone.** List the systems in a `systems.json` next to `.mcp.json`, and point the server at it with `--config`:

```json
{ "systems": ["USERID@zos.example.com"] }
```

```bash
claude mcp add zowe-zos --scope project -e ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1 -- \
  zowe-mcp-server --stdio --native --config "$PWD/systems.json" --capability-tier read-strict
```

To add a system later, add another `user@host[:port]` entry and restart the server (`/mcp`, reconnect). `ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1` makes requests name the system once there is more than one, instead of quietly using the first. (The mock data folder has its own `systems.json` for fake systems; that is a different file.)

**VS Code.** In Settings, add `USERID@zos.example.com` (or `USERID@host:port`) to `zoweMCP.zowexConnections`, make sure `zoweMCP.backend` is not set to `mock` (the default, `zowex`, is the real SSH backend), then run **Developer: Reload Window**. Accept VS Code's one-time prompt to trust the MCP server.

### 2. Authenticate (recommended order)

The server tries each method in turn: **SSH key, then password from the environment (or Vault), then an interactive prompt.**

**Recommended: SSH key.** If you already log in to z/OS with a key, there is nothing to configure. The server uses the `IdentityFile` from the `~/.ssh/config` entry whose `Host` or `HostName` matches the host in your connection, or falls back to `~/.ssh/id_ed25519`, `id_rsa`, `id_ecdsa`, `id_dsa`:

```text
Host zos
  HostName zos.example.com
  User USERID
  IdentityFile ~/.ssh/id_mainframe
```

Limits:

- The `Host` entry is used **only to find the key**. The server does not read `Port` from it and does not resolve a `Host` alias to its `HostName` (tested: `USER1@zos` fails with a DNS error). Always use the real hostname, plus `:port` when it isn't 22: `USERID@zos.example.com:2222`.
- Key files on disk only (ssh-agent is not used).
- An encrypted key needs `ZOWE_MCP_KEY_PASSPHRASE_<USER>_<HOST>` because the server can't ask for it. To check whether a key is encrypted, run `ssh-keygen -y -P "" -f <key>`: it fails for an encrypted key.

Details: [Authenticate to z/OS](claude-code-mcp.md#3-authenticate-to-zos).

**Alternative: let the client prompt for a password.** If no key works, the server asks for the password through MCP elicitation, and the prompt is shown by your client, so nothing goes in a config file.

- **VS Code extension:** works out of the box. You get a masked prompt, and the password is kept in VS Code Secret Storage.
- **Claude Code:** works. Tested with 0.10.0 over stdio against a real system: Claude Code showed a password prompt on the first request, with no key and no password variable set.
- **Other standalone clients (Codex and others):** works only if the client supports MCP elicitation, which is untested here. If your client doesn't, the tool call fails with `Missing password for USER@host` (or, in 0.10.0, `was not received in time`), and you should use a key or an env var instead.

**Fallback: password in the environment.** Export `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (user uppercased, dots in host become `_`; port is not part of the name) in your shell before starting the client, for example `ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM`. Avoid putting it in a committed `.mcp.json`.

### 3. Try it

Ask: *"List the data sets under `USERID.*`"*. Start with the default `read-strict` tier before enabling writes or job submission ([Capability tier](claude-code-mcp.md#capability-tier)).

SSH key and `ZOWE_MCP_PASSWORD_*` lookups use the environment of the process that starts the server, so the variable must be exported in the shell that launches your client. The host part of the variable name works for IP addresses too: `USER1@127.0.0.1` becomes `ZOWE_MCP_PASSWORD_USER1_127_0_0_1`.

### 4. Optional: customize after setup

Manual steps, after the first install works; restart the server afterwards.

- **zowex location on z/OS:** add `--zowex-server-path <z/OS path>` to the args in `.mcp.json` (default `~/.zowe-server`; applies to every system).
- **Job cards** for `submitJob`: add a `jobCards` object to `systems.json` ([Job cards and multiple systems](claude-code-mcp.md#job-cards-and-multiple-systems)).
- **Capability tier:** change `--capability-tier` in `.mcp.json`.

For a full local dry run of this path without a mainframe, see [Mock z/OS host](mock-zos-host.md), a real SSH daemon backed by fixtures.

## Next steps

- **What can it do:** [Use cases](use-cases.md). The [tool reference on `main`](mcp-reference.md) describes the newest code; for 0.10.0 use the `mcp-reference.md` asset on the [v0.10.0 release](https://github.com/zowe/zowe-mcp/releases/tag/v0.10.0).
- **Safety model:** [Safety and security principles](mcp-safety-security-principles.md).

## Version notes: 0.10.0 vs newer

The tool counts were measured by running the 0.10.0 release and a recent development build side by side (the other rows come from the changelog and the source). The setup steps in this guide were run against 0.10.0; the newer column was not re-tested end to end.

| Topic | 0.10.0 (latest release) | Newer builds / `main` |
| --- | --- | --- |
| Tools per tier (`read-strict` / `read`, `update`, `delete`, `full`) | 31, 56, 63, 68 | 34, 59, 66, 72. Every tier adds `display` (operator `DISPLAY` commands), `queryTso` (read-only TSO queries) and `listParmlib`. Nothing is removed and the tier rules are unchanged |
| Console commands | No `runConsoleCommand`, even at `full` | `runConsoleCommand` at `full` (needs zowex 0.9.0+ on the host, the separately installed APF-authorized `zoweax`, and OPERCMDS authorization) |
| Binary transfer | Not available | `binary` option on data set and USS read and write |
| Package size | 32 MB tarball, 71 MB VSIX, about a minute to install | About 8 MB tarball and 27 MB VSIX, much faster |
| Startup log | Says `"mockMode":true` even with `--native`; ignore it, check `getContext` `server.backend` instead | Fixed |
| Failure logs | Some fatal `call-tool` errors log as `{}` | Message and stack are logged |
| `mock-zos` subcommands | Also start a stdio MCP server, so you may see stray JSON notifications in the output | Fixed |
| z/OS-side server | Older zowex build | Newer build with a renamed binary; the first connect redeploys it to `~/.zowe-server` |
| Setting and flag names | `zoweMCP.zowexConnections`, `zoweMCP.backend` (`zowex` or `mock`), `--capability-tier`, `ZOWE_MCP_CAPABILITY_TIER`, `ZOWE_MCP_PASSWORD_<USER>_<HOST>`, SSH key and passphrase variables | Same |

Docs on `main` that still say `zoweMCP.nativeConnections` or `backend = native` are out of date for both versions: use `zowexConnections` and `zowex`.

## For AI agents: setting up Zowe MCP for a user

Use this guide as the source of truth. Ask these one at a time, with your recommendation, and confirm anything the user already told you instead of asking again:

1. **Which client?** Claude Code, Codex or another MCP client: continue below. Copilot Chat in VS Code: give the user the [Option 2](#option-2--vs-code-extension-vsix) steps and the VS Code settings from [Connect to a real z/OS system](#connect-to-a-real-zos-system); don't try to install a VSIX yourself.
2. **Which z/OS system?** `user@host`, plus the port if it isn't 22. (No mainframe? Use the mock steps in [Option 1](#option-1--standalone-mcp-server).)
3. **How do you log in?** An SSH key already in `~/.ssh/config` (recommended; check the entry exists), or a password prompt from the client (works in Claude Code). Never ask for the password in chat.
4. **Which capability tier?** `read-strict` (look only, confirm each read; the default), `read` (look only), `update` (also write), `delete` (also delete), `full` (also submit jobs and run commands as that user). Recommend the lowest that fits, and get an explicit yes before `full`.

Then, in the user's project folder:

```bash
# 1. Install the release (not on npm), into the folder
curl -fLO https://github.com/zowe/zowe-mcp/releases/download/v0.10.0/zowe-mcp-server-0.10.0.tgz
npm install --prefix ./zowe-mcp ./zowe-mcp-server-0.10.0.tgz       # about a minute
BIN="$PWD/zowe-mcp/node_modules/.bin/zowe-mcp-server"; "$BIN" --version   # 0.10.0

# 2. List the system
echo '{ "systems": ["<user>@<host>[:port]"] }' > systems.json

# 3. Register (check `claude mcp list` first; pick another name if zowe-zos is taken)
claude mcp add zowe-zos --scope project -e ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1 -- \
  "$BIN" --stdio --native --config "$PWD/systems.json" --capability-tier <tier>
# Codex: codex mcp add zowe-zos --env ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1 -- <same command and args>

# 4. Check the connection (key users get data sets back; password-prompt users get
#    "Missing password", which is expected because this check has no prompt)
"$BIN" call-tool --native --config "$PWD/systems.json" listDatasets system=<host> dsnPattern='<USER>.*'
```

Finally, tell the user to start `claude` in the folder, approve `zowe-zos`, run `/mcp` to see it connected, and ask for their data sets. Don't say it's connected before `/mcp` shows it.

**Rules:** never put a password in a file or the chat; use absolute paths in client config; never raise the tier beyond what the user picked; leave `--zowex-server-path` at its default (see [Optional: customize after setup](#4-optional-customize-after-setup)); to add a system later, edit `systems.json` and ask the user to restart the server.

**If it fails:** port 22 in the log, or `ENOTFOUND` for a short name: use the real hostname and `:port` in `systems.json`. `Missing password` with a key: the key isn't in `~/.ssh/config` for that host, or it's encrypted (`ssh-keygen -y -P "" -f <key>` fails) and needs `ZOWE_MCP_KEY_PASSPHRASE_<USER>_<HOST>`. No reason given: re-run with `ZOWE_MCP_LOG_LEVEL=debug`. More: [Claude Code troubleshooting](claude-code-mcp.md#troubleshooting).
