# <img src="packages/zowe-mcp-vscode/resources/icon.svg" alt="Zowe MCP" style="height:1.2em; vertical-align: text-top;" /> Zowe MCP

Model Context Protocol (MCP) server that gives AI assistants tools for working
with z/OS systems -- data sets, jobs, and UNIX System Services. Works with any
MCP-capable client (Claude Code, Cursor, GitHub Copilot, Codex, OpenCode, IBM Bob, etc.)

An optional [VS Code extension](#vs-code-extension-optional) is also included.

## Use cases

The AI can combine multiple tools and reason over results to:

- **AI-assisted development** — Browse, search, read, and open data sets and USS in natural language; get explanations and open in editor.
- **Job failure diagnostics** — "Why did this job fail?" The assistant fetches status and spool, finds errors/ABENDs, and explains cause and next steps.
- **Search and trace** — Find where a program, copybook, or string is used or defined across libraries; get a short report and suggested next reads.

## Safety and security

Zowe MCP provides these security and safety controls:

1. **Capability tiers** control which tools are registered based on their
  resource effects.

   | Tier | What the agent can do |
   | --- | --- |
   | `read-strict` (default) | Read only, with client confirmation prompts |
   | `read` | Read only, auto-approved |
   | `update` | Read + create/write/modify |
   | `delete` | Read + update + delete/cancel |
   | `full` | Everything including job submit and command execution |

   Configure via `--capability-tier <tier>`, env `ZOWE_MCP_CAPABILITY_TIER`,
   or VS Code setting `zoweMCP.capabilityTier`.

2. **Command and path gates** block dangerous TSO and USS operations, request
  approval for sensitive operations, and constrain local file access to MCP
  workspace roots or configured directories.
3. **Tool-result data marking** identifies mainframe content as untrusted data in
  server instructions to defend against prompt injection attacks.
  It is enabled by default and can be disabled with `ZOWE_MCP_DATA_MARKING=0`.

See [Safety and security principles](docs/mcp-safety-security-principles.md) for
configuration details and deployment recommendations.

## Prerequisites

- **Node.js** >= 22 (LTS recommended)
- **npm** >= 10 (ships with Node 22+)
- An MCP client such as OpenCode
- SSH access to z/OS for native operation

## Installation from source

> **Registry status / running outside the repo:** `@zowe/mcp-server` is not yet on a public npm registry.
> To install without a source checkout, use a tarball from `npm run pack:server`
> or the `zowe-mcp-server-npm` CI artifact. See
> [Standalone MCP clients](docs/standalone-mcp.md#obtaining-the-tgz).

```bash
# 1. Stage the pinned Zowe Remote SSH SDK
node scripts/sdk-switch.js pin --no-install

# 2. Install dependencies
npm install

# 3. Build the shared package and server
npm run build -w packages/zowe-mcp-common
npm run build -w @zowe/mcp-server
```

The server entry point is
`packages/zowe-mcp-server/dist/index.js`. The SDK pin identifies the tested
[`@zowe/zowex-for-zowe-sdk`](https://github.com/zowe/zowex) build; run
`node scripts/sdk-switch.js` without arguments to list other supported SDK
sources.

Continue with [Native SSH configuration](#native-ssh-backend). To test without
a mainframe, see [Mock mode](docs/mock-mode.md).

## Native (SSH) backend

The server connects to z/OS over SSH using
`@zowe/zowex-for-zowe-sdk`. See the generated
[MCP reference](docs/mcp-reference.md) for the current tools and operations.

Connection format is `user@hostname` or `user@hostname:port` (default port 22),
the same as SSH.

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
configured connection. Call `setSystem` to target a different one. Set
`ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1` to require an explicit system instead —
recommended for multi-environment deployments.

#### Authentication

If no explicit authentication method is set, the server will attempt these methods in order:

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
password in an environment variable. Optional overrides:

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

**2. Password.** When no usable key is found (or key auth fails),
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
<summary><b>Claude Code</b></summary>

Add the standard config from above to `.mcp.json` in your project root, or
use the CLI:

```bash
claude mcp add zowe -- node /absolute/path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js --stdio --native --system USERID@sys1.example.com
```

See [Claude Code](docs/claude-code-mcp.md) for client scopes, `/mcp`, path
handling, and remote OAuth.

</details>

<details>
<summary><b>Cursor</b></summary>

Add the standard config from above to `~/.cursor/mcp.json` (global) or
`.cursor/mcp.json` (project).

</details>

<details>
<summary><b>Kiro</b></summary>

Add the standard config to `~/.kiro/settings/mcp.json` or
`.kiro/settings/mcp.json`. See [Kiro](docs/kiro-mcp.md) for environment-variable
approval, `autoApprove`, and extension compatibility.

</details>

<details>
<summary><b>Other clients</b></summary>

Check your client's MCP documentation for the correct config file and syntax.
See [Standalone MCP clients](docs/standalone-mcp.md) for shared installation,
authentication, and configuration guidance.
</details>

For testing without a z/OS system, see [Mock mode](docs/mock-mode.md).

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

## VS Code extension (optional)

The repository also includes a VS Code extension that registers the MCP server
with GitHub Copilot Chat automatically and adds a bidirectional channel for log
forwarding, dynamic configuration, and password prompts via VS Code Secret
Storage. If you configure the server through `mcp.json` as described below,
you do not need the extension.

VS Code integration requires VS Code 1.101 or later and the GitHub Copilot Chat
extension.

### Configure VS Code without the extension

Create or edit `.vscode/mcp.json` in your workspace using the standard client
configuration above, with `"servers"` as the top-level key instead of
`"mcpServers"`. New to Copilot and MCP? See the
[Copilot setup guide](docs/copilot-setup-guide.md) and
[Manual QA checklist](docs/manual-qa.md).

Tool names use camelCase. In Copilot they appear prefixed with `mcp_zowe_`, such
as `mcp_zowe_getContext`, `mcp_zowe_listDatasets`, and
`mcp_zowe_setSystem`.

### Install the extension

```bash
# Build and install in one step
npm run build-and-install

# Or, to install into Cursor / VS Code Insiders / Codium:
VSCODE_CLONE=cursor npm run build-and-install
```

After installation, reload VS Code. The extension activates on startup,
registers a "Zowe" MCP server provider, and exposes the capability tier through
the `zoweMCP.capabilityTier` setting.

### Zowe Remote SSH connections and authentication

1. Open Settings and search for **Zowe MCP**.
2. Set **Backend** to `zowex`.
3. Set **Zowe Remote SSH: Zowex Connections** to an array of SSH connection
   specs, such as `["USERID@sys1.example.com"]`. Each entry is one connection
   (`user@host` or `user@host:port`); you can have multiple connections to the
   same z/OS system with different user IDs.
4. Reload the window.

As in standalone mode, the server first tries **SSH key authentication** using
your existing `~/.ssh` setup and only falls back to a password when no usable
key is found or the key is rejected. Set `zoweMCP.preferSshKey` to `false` to
disable key authentication and always use a password.

When the server needs a password, it sends a request to the extension. The
extension prompts for it or reads it from VS Code Secret Storage. Passwords are
stored under the shared Zowe OSS key
`zowe.ssh.password.<user>.<hostNormalized>` so other Zowe extensions can reuse
them. If a password is invalid, the extension deletes it from storage.

Server and extension logs include a **passwordHash** containing the first 16
hexadecimal characters of the password's UTF-8 SHA-256 hash. This allows log
correlation without exposing the password. To reproduce it, omit the trailing
newline and take the first 16 characters:

```bash
echo -n 'YOUR_EXACT_PASSWORD' | sha256sum
```

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

Or set **Backend** to `mock` and point at an existing directory with **Mock
Data Directory**. In `settings.json`:

```jsonc
{
  "zoweMCP.backend": "mock",
  "zoweMCP.mockDataDirectory": "/absolute/path/to/zowe-mcp-mock-data"
}
```

Once configured, the server starts with the full set of tools (dataset listing,
reading, writing, context management, etc.).

## License

[Eclipse Public License v2.0](https://www.eclipse.org/legal/epl-v20.html)
