# <img src="packages/zowe-mcp-vscode/resources/icon.svg" alt="Zowe MCP" style="height:1.2em; vertical-align: text-top;" /> Zowe MCP

Model Context Protocol (MCP) server and VS Code extension that gives AI
assistants tools for working with z/OS systems -- data sets, jobs, and UNIX
System Services.

## Repository layout

```text
zowe-mcp/                       # npm workspaces monorepo
  packages/
    zowe-mcp-server/            # Standalone MCP server (ESM)
    zowe-mcp-vscode/            # VS Code extension (CommonJS)
```

## Prerequisites

- **Node.js** >= 22 (LTS recommended)
- **npm** >= 10 (ships with Node 22+)
- **VS Code** >= 1.101 (for the extension)
- **GitHub Copilot Chat** extension installed in VS Code

## Quick start

```bash
# 1. Install dependencies (both packages are linked automatically)
npm install

# 2. Build everything
npm run build

# 3. Generate mock z/OS data
npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data

# 4. Build and install the VS Code extension
npm run build-and-install
```

After step 4, reload VS Code and the Zowe MCP tools will be available in
GitHub Copilot Chat.

## Building

### Full build (all packages)

```bash
npm run build
```

This compiles both `zowe-mcp-server` and `zowe-mcp-vscode`. The server must
be built first because the extension imports types from it.

### Server only

```bash
npm run build -w packages/zowe-mcp-server
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
npm run dev -w packages/zowe-mcp-server

# Extension — recompiles on file changes (in a second terminal)
npm run dev -w packages/zowe-mcp-vscode
```

## Mock mode

The server includes a filesystem-backed mock z/OS backend so you can develop
and test without a real mainframe.

### Generating mock data

```bash
# Default preset (2 systems, 2 users each, ~8 datasets per user)
npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data

# Minimal (1 system, 1 user, 5 datasets)
npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data --preset minimal

# Large (5 systems, 3 users each, 20 datasets per user)
npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data --preset large

# Custom scale
npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data \
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

```bash
# Via CLI flag
npx zowe-mcp-server --stdio --mock ./zowe-mcp-mock-data

# Via environment variable
ZOWE_MCP_MOCK_DIR=./zowe-mcp-mock-data npx zowe-mcp-server --stdio
```

## Native (SSH) backend

The server can connect to real z/OS systems over SSH using the Zowe Native Proto
SDK. Only **listDatasets** is implemented in this backend; other dataset tools
are planned.

Connection format is `user@hostname` or `user@hostname:port` (default port 22),
same as SSH.

### Standalone mode

Systems come from a config file or CLI:

```bash
# Config file (JSON with "systems" array)
npx zowe-mcp-server --stdio --native --config ./native-config.json

# CLI (repeatable)
npx zowe-mcp-server --stdio --native --system USERID@sys1.example.com
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

Passwords are read from environment variables:
`ZOWE_MCP_PASSWORD_<USER>_<HOST>` (user and host uppercase, dots in host
replaced by `_`). Example for `USERID@sys1.example.com`:

```bash
export ZOWE_MCP_PASSWORD_USERID_SYS1_EXAMPLE_COM=password
npx zowe-mcp-server --stdio --native --system USERID@sys1.example.com
```

If a password is invalid, the server will not retry it for the rest of the
process.

### VS Code extension

1. Open Settings and search for **Zowe MCP**
2. Set **Native Systems** to an array of connection specs, e.g.
   `["USERID@sys1.example.com"]`
3. Reload the window so the MCP server restarts with `--native`

When the server needs a password it sends a request to the extension; the
extension prompts (or reads from VS Code Secret Storage) and sends the password
back. Passwords are stored under the shared Zowe OSS key
`zowe.ssh.password.<user>.<hostNormalized>` so other Zowe extensions can reuse
them. If a password is invalid the extension deletes it from storage.

You cannot use both mock mode and native mode; if both are configured, native
wins.

## Configuring VS Code Copilot

There are two ways to use Zowe MCP with GitHub Copilot in VS Code:

### Option A: Install the VS Code extension (recommended)

The extension automatically registers the MCP server with Copilot. It also
provides a bidirectional communication channel for log forwarding and dynamic
configuration.

```bash
# Build and install in one step
npm run build-and-install

# Or, to install into Cursor / VS Code Insiders / Codium:
VSCODE_CLONE=cursor npm run build-and-install
```

After installation, reload VS Code. The extension activates on startup and
registers a "Zowe" MCP server provider.

#### Enabling mock mode in the extension

By default the extension starts the server without a z/OS backend, so only
the `info` tool is available. A warning notification will appear with buttons
to help you configure mock data.

Use the built-in command (easiest):

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run **Zowe MCP: Generate Mock Data**
3. Select a folder where mock data should be created
4. The command generates the data, configures the setting, and offers to
   reload the window

Or point at an existing mock data directory:

1. Open VS Code Settings (Ctrl+, / Cmd+,)
2. Search for **Zowe MCP**
3. Set **Mock Data Dir** to the absolute path of your mock data directory
4. Restart the MCP server (reload VS Code or run the
   "MCP: List Servers" command and restart "Zowe")

Or add this to your `settings.json`:

```jsonc
{
  "zowe-mcp.mockDataDir": "/absolute/path/to/zowe-mcp-mock-data"
}
```

Once configured, the server starts with the full set of tools (dataset
listing, reading, writing, context management, etc.).

### Option B: Configure as a standalone MCP server in VS Code settings

This approach lets you pass the `--mock` flag directly. Add the following to
your VS Code `settings.json` (user or workspace):

```jsonc
{
  "github.copilot.chat.mcp.servers": {
    "zowe": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
        "--stdio",
        "--mock",
        "/absolute/path/to/zowe-mcp/zowe-mcp-mock-data"
      ]
    }
  }
}
```

Replace the paths with the actual absolute paths on your machine. For
example, if you cloned the repo to `~/workspace/zowe-mcp` and generated mock
data in `~/workspace/zowe-mcp/zowe-mcp-mock-data`:

```jsonc
{
  "github.copilot.chat.mcp.servers": {
    "zowe": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/me/workspace/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
        "--stdio",
        "--mock",
        "/Users/me/workspace/zowe-mcp/zowe-mcp-mock-data"
      ]
    }
  }
}
```

You can also use the environment variable form:

```jsonc
{
  "github.copilot.chat.mcp.servers": {
    "zowe": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
        "--stdio"
      ],
      "env": {
        "ZOWE_MCP_MOCK_DIR": "/absolute/path/to/zowe-mcp/zowe-mcp-mock-data"
      }
    }
  }
}
```

After saving `settings.json`, reload VS Code. The MCP server will appear in
Copilot's tool list.

### Verifying the setup

Open GitHub Copilot Chat (Ctrl+Shift+I / Cmd+Shift+I) and try:

```text
Use the info tool to show the Zowe MCP server version.
```

If mock mode is active, you can also try:

```text
List the available z/OS systems.
```

```text
Set the active system to mainframe-dev.example.com and list datasets matching USER.**
```

Tool names use camelCase; in Copilot they appear prefixed with `mcp_zowe_` (e.g.
`mcp_zowe_info`, `mcp_zowe_listDatasets`, `mcp_zowe_setSystem`).

## Testing

```bash
# Server unit tests (Vitest)
npm test

# All tests (server + VS Code extension)
npm run test:all

# VS Code extension tests only (launches a real VS Code instance)
npm run test:vscode
```

### Quick tool testing from the CLI

```bash
# Call a tool directly
npm run call-tool -- info
npm run call-tool -- listSystems
```

### MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
provides a web UI for interacting with the server (opens at <http://localhost:6274>).
Use the script that matches how you want to run the server:

| Script | Backend | Use when |
| --- | --- | --- |
| `npm run inspector` | None | Quick check: only core tools (e.g. `info`) are available; no z/OS systems. |
| `npm run inspector:mock` | Mock (filesystem) | Try dataset tools without a real z/OS: uses `./zowe-mcp-mock-data`. Generate mock data first with `npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data`. |
| `npm run inspector:native` | Native (SSH) | Connect to real z/OS via SSH. Needs `native-config.json` (systems) and `.env` (passwords). Copy `native-config.example.json` → `native-config.json` and `.env.example` → `.env`, then set `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (see [Standalone mode](#standalone-mode)). |

```bash
npm run inspector          # no backend
npm run inspector:mock     # mock data in ./zowe-mcp-mock-data
npm run inspector:native   # SSH via native-config.json + .env
```

## Linting and formatting

```bash
npm run lint          # Check all ESLint rules
npm run lint:fix      # Auto-fix ESLint issues
npm run format        # Format all TS/JS/JSON files with Prettier
npm run check-format  # Check formatting without modifying files
```

## Scripts reference

| Script | Description |
| --- | --- |
| `npm run build` | Build all packages |
| `npm test` | Run server tests (Vitest) |
| `npm run test:all` | Run all tests (server + VS Code extension) |
| `npm run test:vscode` | Run VS Code extension tests |
| `npm run build-and-install` | Package and install the VS Code extension |
| `npm run call-tool -- <name>` | Call a tool from the CLI |
| `npm run inspector` | Launch MCP Inspector (no backend) |
| `npm run inspector:mock` | Launch MCP Inspector with mock data (`./zowe-mcp-mock-data`) |
| `npm run inspector:native` | Launch MCP Inspector with native SSH (`native-config.json` + `.env`) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format all files with Prettier |
| `npx zowe-mcp-server init-mock --output <dir>` | Generate mock data |

## License

[Eclipse Public License v2.0](https://www.eclipse.org/legal/epl-v20.html)
