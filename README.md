# <img src="packages/zowe-mcp-vscode/resources/icon.svg" alt="Zowe MCP" style="height:1.2em; vertical-align: text-top;" /> Zowe MCP

Model Context Protocol (MCP) server that gives AI assistants tools for working
with z/OS systems -- data sets, jobs, and UNIX System Services. Works with any
MCP-capable client (Claude Code, Cursor, VS Code, Zed, Roo Code, and others).
An optional VS Code extension is also included.

## Use case examples

The AI can combine multiple tools and reason over results to:

- **AI-assisted development** — Browse, search, read, and open data sets and USS in natural language; get explanations and open in editor.
- **Job failure diagnostics** — "Why did this job fail?" The assistant fetches status and spool, finds errors/ABENDs, and explains cause and next steps.
- **Search and trace** — Find where a program, copybook, or string is used or defined across libraries; get a short report and suggested next reads.

See [Use cases](docs/use-cases.md) for the full list and more detail.

## Safety and security

AI agents can make mistakes. When an agent has tools that modify or delete
mainframe resources, an incorrect action can cause real damage. Zowe MCP
provides multiple layers of protection — use them together.

**Read the full guide:** [Safety & Security principles](docs/mcp-safety-security-principles.md)

### Key recommendations

1. **Principle of least privilege** — Grant only the capability tier needed for
   the task. Start with `read-strict` (the default) and raise it only when
   required. A narrower tier limits the blast radius of any mistake.

2. **Progressive capability tiers** — Each tool declares a *resource effect
   level* (none → read → update → delete → execute). The operator-configured
   *capability tier* controls which tools register and how MCP clients treat
   them:

   | Tier | What the agent can do |
   | --- | --- |
   | `read-strict` (default) | Read only, with client confirmation prompts |
   | `read` | Read only, auto-approved |
   | `update` | Read + create/write/modify |
   | `delete` | Read + update + delete/cancel |
   | `full` | Everything including job submit and command execution |

   Configure via `--capability-tier <tier>`, env `ZOWE_MCP_CAPABILITY_TIER`,
   or VS Code setting `zoweMCP.capabilityTier`.

3. **Dedicated z/OS credentials** — Use a dedicated SSH user with the minimum
   SAF / RACF authority needed. The z/OS security system is the ultimate
   enforcement boundary — even if the MCP layer or the AI model fails, SAF
   ensures the agent cannot exceed its authority. Prefer **SSH key
   authentication** (ideally passphrase-protected) over passwords: a key — and
   especially a passphrase-protected one — is more secure than a password in an
   environment variable, which can leak via process listings, shell history, and
   crash dumps. See [Native (SSH) backend](#native-ssh-backend).

4. **Command safety gates** — TSO and USS command tools use pattern-based
   evaluation (block / elicit / allow) to catch dangerous commands before
   execution.

5. **Data trust boundary** — Server instructions mark all tool-result content
   (data set/USS contents, job output, search results, console output) as
   untrusted data, so the model treats it as data to read rather than
   instructions to follow — a defense-in-depth layer against prompt injection
   carried through mainframe content. Enabled by default; set
   `ZOWE_MCP_DATA_MARKING=0` to omit it (used to A/B evaluate the directive's
   effect on injection resistance).

6. **Mock mode for learning** — Use the mock backend for exploration and
   CI — no real z/OS resources are at risk.

7. **Safety is not security** — Client hints, confirmation dialogs, and
   command gates reduce *accidents*. Only z/OS access controls (SAF, USS
   ACLs, scheduler exits) and credential management *enforce* real
   boundaries.

## Repository layout

```text
zowe-mcp/                       # npm workspaces monorepo
  packages/
    zowe-mcp-common/            # Shared CommonJS utilities
    zowe-mcp-server/            # Server package (npm: @zowe/mcp-server, ESM)
    zowe-mcp-vscode/            # VS Code extension (CommonJS)
    zowe-mcp-evals/             # AI evaluations (LLM agent + MCP tools)
    zowe-mcp-e2e/               # End-to-end test support (ESM)
```

## Prerequisites

- **Node.js** >= 22 (LTS recommended)
- **npm** >= 10 (ships with Node 22+)
- **VS Code** >= 1.101 (for the extension)
- **GitHub Copilot Chat** extension installed in VS Code

## Quick start (building from source)

```bash
# 1. Stage the pinned Zowe Remote SSH SDK
node scripts/sdk-switch.js pin --no-install

# 2. Install dependencies (workspaces are linked automatically)
npm install

# 3. Build everything
npm run build

# 4. Build and install the VS Code extension
npm run build-and-install
```

The pin identifies the tested
[`@zowe/zowex-for-zowe-sdk`](https://github.com/zowe/zowex) build. Run
`node scripts/sdk-switch.js` without arguments to list other supported SDK
sources and their usage.

After step 4, reload VS Code and the Zowe MCP tools will be available in
GitHub Copilot Chat.

To use the tools you need a z/OS backend — either a real system
([native mode](#native-ssh-backend)) or mock data ([mock mode](#mock-mode)).
Mock data is **not** required for building; generate it only when you want to
test without a mainframe:

```bash
# Inside this repo (after `npm install`) — npm workspaces resolve @zowe/mcp-server.
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data
```

> **Running outside the repo?** `@zowe/mcp-server` is not yet on a public npm
> registry, so `npx @zowe/mcp-server …` and `npm install @zowe/mcp-server`
> fail with a 404. Install from a tarball produced by `npm run pack:server`
> (or a CI `zowe-mcp-server-npm` artifact) — see
> [Roo and standalone MCP § Obtaining the `.tgz`](docs/roo-or-standalone-mcp.md#obtaining-the-tgz).
> Every `npx @zowe/mcp-server …` snippet below assumes the in-repo form;
> the equivalent post-install command is `zowe-mcp-server …`.

## Building

The root and workspace `package.json` files are the canonical command
reference.

### Full build (all packages)

```bash
npm run build
```

This builds every workspace package. The server must be built before the
extension because the extension imports types from it.

### Server only

```bash
npm run build -w @zowe/mcp-server
```

### Extension only

The extension build has two stages: it bundles the server dist into a
`server/` directory, then compiles the extension TypeScript.

```bash
# Build server + bundle + compile extension
npm run build:all -w packages/zowe-mcp-vscode
```

### Watch mode (development)

```bash
# Server — recompiles on file changes
npm run dev -w @zowe/mcp-server

# Extension — recompiles on file changes (in a second terminal)
npm run dev -w packages/zowe-mcp-vscode
```

## Mock mode

The server includes a filesystem-backed mock z/OS backend so you can develop
and test without a real mainframe.

### Generating mock data

```bash
# Default preset (2 systems, 2 users each, ~8 datasets per user)
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data

# Minimal (1 system, 1 user, 5 datasets)
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data --preset minimal

# Large (5 systems, 3 users each, 20 datasets per user)
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data --preset large

# Custom scale
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data \
  --systems 3 --users-per-system 2 --datasets-per-user 10 --members-per-pds 8
```

The generated directory looks like:

```text
zowe-mcp-mock-data/
  systems.json                          # System definitions + credentials
  mainframe-dev.example.com/            # One directory per system
    USER/                            # HLQ directory
      SRC.COBOL/                        # PDS — directory with members
        HELLO.cbl                       # Member file
        _meta.json                      # Dataset attributes
      LOAD.JCL                          # Sequential dataset — plain file
```

### Running the server standalone with mock data

Inside this repo (after `npm install`):

```bash
# Via CLI flag
npx @zowe/mcp-server --stdio --mock ./zowe-mcp-mock-data

# Via environment variable
ZOWE_MCP_MOCK_DIR=./zowe-mcp-mock-data npx @zowe/mcp-server --stdio
```

Outside this repo — `@zowe/mcp-server` is unpublished, so install from a
tarball first ([Obtaining the `.tgz`](docs/roo-or-standalone-mcp.md#obtaining-the-tgz)),
then run the installed binary directly:

```bash
zowe-mcp-server --stdio --mock ./zowe-mcp-mock-data
# or ephemeral from the tarball:
npx --package=file:/abs/path/to/zowe-mcp-server-<version>.tgz \
  zowe-mcp-server --stdio --mock ./zowe-mcp-mock-data
```

## Zowe Remote SSH SDK

The server depends on
[`@zowe/zowex-for-zowe-sdk`](https://github.com/zowe/zowex). Source builds use
the exact SDK build recorded in `resources/zowex-pin.json`; the downloaded
tarball is staged under `resources/` and is not committed. Run
`node scripts/sdk-switch.js` without arguments to list SDK switching options.

## Native (SSH) backend

The server can connect to real z/OS systems over SSH using the Zowe Remote SSH
SDK (`@zowe/zowex-for-zowe-sdk`). The native backend implements the full set of z/OS operations: data set
CRUD (list, read, write, create, delete, copy, rename, restore, search,
attributes), USS file operations (list, read, write, create, delete, chmod,
chown, chtag, copy), TSO and console commands, and job management (submit,
status, list, output, cancel, hold, release, delete).

Connection format is `user@hostname` or `user@hostname:port` (default port 22),
same as SSH.

### Standalone mode

Systems come from a config file or CLI (in-repo form shown; outside this
repo, replace `npx @zowe/mcp-server` with the installed binary
`zowe-mcp-server` — see the "Running outside the repo" callout near the top
of this README):

```bash
# Config file (JSON with "systems" array)
npx @zowe/mcp-server --stdio --native --config ./native-config.json

# CLI (repeatable)
npx @zowe/mcp-server --stdio --native --system USERID@sys1.example.com
```

Config file format:

```json
{
  "systems": [
    "user1@host1.example.com",
    "user2@host2.example.com:22"
  ]
}
```

When multiple systems are configured and a tool is called with no `system`
parameter and no active system yet, the server defaults to the first
configured connection (rather than erroring) and reports which system it used
in the response context; call `setSystem` to target a different one. Set
`ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1` to require an explicit system instead —
recommended for multi-environment deployments (e.g. dev vs prod) where
silently defaulting could target the wrong system.

#### Authentication (in order of preference)

The server authenticates each connection in this order, automatically falling
back to the next method when one is unavailable or fails:

**SSH key → password env var → Vault KV → interactive prompt.**

**1. SSH key (recommended, zero-config).** If you already use SSH keys to reach
z/OS, the server uses them automatically — no Zowe MCP configuration and no
password environment variables required. It leverages your existing workstation
SSH setup:

- A `Host` entry in `~/.ssh/config` whose alias or `HostName` matches, using its
  `IdentityFile`; otherwise
- the default identity files in `~/.ssh` (`id_ed25519`, `id_rsa`, `id_ecdsa`,
  `id_dsa`).

A private key — especially a passphrase-protected one — is more secure than a
password in an environment variable. Optional overrides (rarely needed):

```bash
# Pin a specific key / passphrase for one connection (USER and HOST uppercase, dots → _)
export ZOWE_MCP_PRIVATE_KEY_USERID_SYS1_EXAMPLE_COM=~/.ssh/id_mainframe
export ZOWE_MCP_KEY_PASSPHRASE_USERID_SYS1_EXAMPLE_COM='key passphrase'   # only if the key is encrypted

# Turn SSH key auth off and always use a password
export ZOWE_MCP_DISABLE_SSH_KEY=1
```

> ssh-agent (`SSH_AUTH_SOCK`) is not used in this release — only key files on
> disk are supported. An encrypted key needs its passphrase via
> `ZOWE_MCP_KEY_PASSPHRASE_*`; otherwise the server falls back to a password.

**2. Password (fallback).** When no usable key is found (or key auth fails),
passwords are read from environment variables:
`ZOWE_MCP_PASSWORD_<USER>_<HOST>` (user and host uppercase, dots in host
replaced by `_`). Example for `USERID@sys1.example.com`:

```bash
export ZOWE_MCP_PASSWORD_USERID_SYS1_EXAMPLE_COM=password
npx @zowe/mcp-server --stdio --native --system USERID@sys1.example.com
```

You can also set `ZOWE_MCP_CREDENTIALS` (a JSON map of `user@host` to password).
If a password is invalid, the server will not retry it for the rest of the
process.

### VS Code extension

1. Open Settings and search for **Zowe MCP**
2. Set **Native connections** to an array of SSH connection specs, e.g.
   `["USERID@sys1.example.com"]`. Each entry is one connection (user@host or user@host:port); you can have multiple connections to the same z/OS system (e.g. different user IDs).
3. Reload the window so the MCP server restarts with `--native`

As in standalone mode, the server first tries **SSH key authentication** using
your existing `~/.ssh` setup (most secure, zero-config) and only falls back to a
password when no usable key is found or the key is rejected. Set
`zoweMCP.preferSshKey` to `false` to disable key auth and always use a password.

When the server needs a password it sends a request to the extension; the
extension prompts (or reads from VS Code Secret Storage) and sends the password
back. Passwords are stored under the shared Zowe OSS key
`zowe.ssh.password.<user>.<hostNormalized>` so other Zowe extensions can reuse
them. If a password is invalid the extension deletes it from storage.

Server and extension logs include a **passwordHash** (first 16 hex characters of
SHA-256 of the password in UTF-8) so you can correlate log lines without
exposing the password. To verify or reproduce the hash from the command line
(use `-n` so no newline is included):

```bash
echo -n 'YOUR_EXACT_PASSWORD' | sha256sum
```

Take the first 16 characters of the output; they should match the `passwordHash`
in the logs when the same password is used.

You cannot use both mock mode and native mode; if both are configured, native
wins.

## Configure your MCP client

Zowe MCP works with any MCP-capable client. Add the following config to your
client, replacing the path with the absolute path to your built `dist/index.js`:

```json
{
  "mcpServers": {
    "zowe": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
        "--stdio",
        "--native",
        "--system",
        "USERID@sys1.example.com"
      ]
    }
  }
}
```

<details>
<summary><b>VS Code</b></summary>

Create or edit `.vscode/mcp.json` in your workspace using the standard config
from above, with `"servers"` as the top-level key instead of `"mcpServers"`.
New to Copilot + MCP? See the
[Copilot setup guide](docs/copilot-setup-guide.md) and the
[Manual QA checklists](docs/manual-qa/README.md). The optional VS Code
extension (below) can register the server for you instead.

</details>

<details>
<summary><b>Claude Code</b></summary>

Add the standard config from above to `.mcp.json` in your project root, or
use the CLI:

```bash
claude mcp add zowe -- node /absolute/path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js --stdio --native --system USERID@sys1.example.com
```

See also [Claude Code MCP](docs/claude-code-mcp.md) (tarball install, passwords,
and job cards via `--config`).

</details>

<details>
<summary><b>Cursor</b></summary>

Add the standard config from above to `~/.cursor/mcp.json` (global) or
`.cursor/mcp.json` (project).

</details>

<details>
<summary><b>Roo Code</b></summary>

Add the standard config from above to `.roo/mcp.json`. See also
[Roo and standalone MCP](docs/roo-or-standalone-mcp.md).

</details>

<details>
<summary><b>Other clients</b></summary>

Check your client's MCP documentation for the config file location and
whether it expects `mcpServers` or `servers` as the top-level key. The server
block is the same either way. If your client does not forward your shell
environment, pass the password variable in an `env` block instead — only in a
local, uncommitted config file:

```json
      "env": {
        "ZOWE_MCP_PASSWORD_USERID_SYS1_EXAMPLE_COM": "password"
      }
```

</details>

To run against **mock data** instead of a real z/OS system (no SSH needed), swap
the `--native --system …` arguments for `--mock` and the absolute path to a
generated mock-data directory (see [Mock mode](#mock-mode)):

```jsonc
"args": [
  "/absolute/path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
  "--stdio",
  "--mock",
  "/absolute/path/to/zowe-mcp/zowe-mcp-mock-data"
]
```

### Verifying the setup

After reloading your editor, open your assistant's chat and confirm the server
is connected:

```text
Use the getContext tool to show the Zowe MCP server version.
```

If mock or native data is available, you can also try:

```text
List the available z/OS systems.
```

```text
Set the active system to mainframe-dev.example.com and list datasets matching USER.**
```

Tool names use camelCase; in Copilot they appear prefixed with `mcp_zowe_` (e.g.
`mcp_zowe_getContext`, `mcp_zowe_listDatasets`, `mcp_zowe_setSystem`).

## VS Code extension (optional)

The repository also includes a VS Code extension that registers the MCP server
with GitHub Copilot Chat automatically and adds a bidirectional channel for log
forwarding, dynamic configuration, and password prompts via VS Code Secret
Storage. If you configured the server through `mcp.json` above, you do not need
it. Native (SSH) connections through the extension are covered under
[Native (SSH) backend](#native-ssh-backend); this section covers install and
mock mode.

### Install

```bash
# Build and install in one step
npm run build-and-install

# Or, to install into Cursor / VS Code Insiders / Codium:
VSCODE_CLONE=cursor npm run build-and-install
```

After installation, reload VS Code. The extension activates on startup and
registers a "Zowe" MCP server provider.

### Mock mode in the extension

By default the extension starts the server without a z/OS backend, so only the
`getContext` tool is available. A warning notification will appear with buttons
to help you configure mock data.

Use the built-in command (easiest):

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run **Zowe MCP: Generate Mock Data**
3. Select a folder where mock data should be created
4. The command generates the data, configures the setting, and offers to
   reload the window

Or point at an existing mock data directory via the **Mock Data Dir** setting,
or in `settings.json`:

```jsonc
{
  "zoweMCP.mockDataDirectory": "/absolute/path/to/zowe-mcp-mock-data"
}
```

Once configured, the server starts with the full set of tools (dataset listing,
reading, writing, context management, etc.).

## Development utilities

### Quick tool testing from the CLI

Build the server first (`npm run build`), then use `npx @zowe/mcp-server call-tool`. For usage, options, and examples see the script source: [`packages/zowe-mcp-server/src/scripts/call-tool.ts`](packages/zowe-mcp-server/src/scripts/call-tool.ts).

### MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
provides a web UI for interacting with the server (opens at <http://localhost:6274>).
Use the script that matches how you want to run the server:

| Script | Backend | Use when |
| --- | --- | --- |
| `npm run inspector` | None | Quick check: only core tools (e.g. `getContext`) are available; no z/OS systems. |
| `npm run inspector:mock` | Mock (filesystem) | Try dataset tools without a real z/OS: uses `./zowe-mcp-mock-data`. Generate mock data first with `npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data`. |
| `npm run inspector:native` | Native (SSH) | Connect to real z/OS via SSH. Needs `native-config.json` (systems) and `.env` (passwords). Copy `native-config.example.json` → `native-config.json` and `.env.example` → `.env`, then set `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (see [Standalone mode](#standalone-mode)). |

```bash
npm run inspector          # no backend
npm run inspector:mock     # mock data in ./zowe-mcp-mock-data
npm run inspector:native   # SSH via native-config.json + .env
```

## License

[Eclipse Public License v2.0](https://www.eclipse.org/legal/epl-v20.html)
