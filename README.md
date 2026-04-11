# <img src="packages/zowe-mcp-vscode/resources/icon.svg" alt="Zowe MCP" style="height:1.2em; vertical-align: text-top;" /> Zowe MCP

Model Context Protocol (MCP) server and VS Code extension that gives AI
assistants tools for working with z/OS systems -- data sets, jobs, and UNIX
System Services.

## Use case examples

The AI can combine multiple tools and reason over results to:

- **AI-assisted development** — Browse, search, read, and open data sets and USS in natural language; get explanations and open in editor.
- **Job failure diagnostics** — "Why did this job fail?" The assistant fetches status and spool, finds errors/ABENDs, and explains cause and next steps.
- **Search and trace** — Find where a program, copybook, or string is used or defined across libraries; get a short report and suggested next reads.

See [Use cases](docs/use-cases.md) for the full list and more detail.

## Repository layout

```text
zowe-mcp/                       # npm workspaces monorepo
  packages/
    zowe-mcp-server/            # Server package (npm: @zowe/mcp-server, ESM)
    zowe-mcp-vscode/            # VS Code extension (CommonJS)
    zowe-mcp-evals/             # AI evaluations (LLM agent + MCP tools)
```

## Prerequisites

- **Node.js** >= 22 (LTS recommended)
- **npm** >= 10 (ships with Node 22+)
- **VS Code** >= 1.101 (for the extension)
- **GitHub Copilot Chat** extension installed in VS Code

## Quick start (building from source)

```bash
# 1. Install dependencies (both packages are linked automatically)
npm install

# 2. Fetch the Zowe Native Proto SDK (required for the native backend)
npm run sdk:nightly

# 3. Build everything
npm run build

# 4. Build and install the VS Code extension
npm run build-and-install
```

Step 2 fetches the latest nightly build of the
[Zowe Native Proto](https://github.com/zowe/zowe-native-proto) SDK. Use
`npm run sdk:release` for the latest stable release instead. See
[Zowe Native Proto SDK](#zowe-native-proto-sdk) for all options.

After step 4, reload VS Code and the Zowe MCP tools will be available in
GitHub Copilot Chat.

To use the tools you need a z/OS backend — either a real system
([native mode](#native-ssh-backend)) or mock data ([mock mode](#mock-mode)).
Mock data is **not** required for building; generate it only when you want to
test without a mainframe:

```bash
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data
```

## Building

### Full build (all packages)

```bash
npm run build
```

This compiles both `@zowe/mcp-server` and `zowe-mcp-vscode`. The server must
be built first because the extension imports types from it.

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

```bash
# Via CLI flag
npx @zowe/mcp-server --stdio --mock ./zowe-mcp-mock-data

# Via environment variable
ZOWE_MCP_MOCK_DIR=./zowe-mcp-mock-data npx @zowe/mcp-server --stdio
```

## Zowe Native Proto SDK

The server depends on the
[Zowe Native Proto](https://github.com/zowe/zowe-native-proto) SDK for
connecting to z/OS over SSH. The SDK is not published to the public npm
registry; use one of the scripts below to fetch it.

| Script | Source | Description |
| --- | --- | --- |
| `npm run sdk:release` | Artifactory npm | Latest stable release |
| `npm run sdk:release -- <version>` | Artifactory npm | Specific release (e.g. `0.3.0`) |
| `npm run sdk:fallback` | In-repo | Fallback resource for CI and when nightly is unavailable |
| `npm run sdk:nightly` | Artifactory / GitHub | Latest nightly build (recommended for development) |
| `npm run sdk:pr -- <pr-number>` | GitHub Actions | Build from a specific pull request |
| `npm run sdk:branch -- <branch>` | GitHub Actions | Latest successful build for a branch |
| `npm run sdk:local -- <path>` | Local filesystem | A `.tgz` file or a `zowe-native-proto` repo directory |

After switching, rebuild (`npm run build`) and run tests (`npm test`) to
verify compatibility. The SDK tarball is stored in `deps/` (gitignored).

Requires [GitHub CLI](https://cli.github.com/) (`gh`) for the `pr`, `branch`,
and `nightly` (fallback) modes.

## Native (SSH) backend

The server can connect to real z/OS systems over SSH using the Zowe Native Proto
SDK. The native backend implements the full set of z/OS operations: data set
CRUD (list, read, write, create, delete, copy, rename, restore, search,
attributes), USS file operations (list, read, write, create, delete, chmod,
chown, chtag, copy), TSO and console commands, and job management (submit,
status, list, output, cancel, hold, release, delete).

Connection format is `user@hostname` or `user@hostname:port` (default port 22),
same as SSH.

### Standalone mode

Systems come from a config file or CLI:

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

Passwords are read from environment variables:
`ZOWE_MCP_PASSWORD_<USER>_<HOST>` (user and host uppercase, dots in host
replaced by `_`). Example for `USERID@sys1.example.com`:

```bash
export ZOWE_MCP_PASSWORD_USERID_SYS1_EXAMPLE_COM=password
npx @zowe/mcp-server --stdio --native --system USERID@sys1.example.com
```

If a password is invalid, the server will not retry it for the rest of the
process.

### VS Code extension

1. Open Settings and search for **Zowe MCP**
2. Set **Native connections** to an array of SSH connection specs, e.g.
   `["USERID@sys1.example.com"]`. Each entry is one connection (user@host or user@host:port); you can have multiple connections to the same z/OS system (e.g. different user IDs).
3. Reload the window so the MCP server restarts with `--native`

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

## Configuring VS Code Copilot

**New to Zowe MCP?** See **[Copilot setup guide](docs/copilot-setup-guide.md)** for installing the extension from a VSIX, configuring Gemini (e.g. for Broadcom), defining `user@host`, and Copilot/MCP tips (list servers, restart, view output). For hands-on checklists (profiles, Copilot tools, mock/native), see **[Manual QA](docs/manual-qa/README.md)**.

**Clients that do not use VS Code–registered MCP servers** (for example Roo Code with `.roo/mcp.json`): use the **`@zowe/mcp-server`** package in stdio mode — see **[Roo and standalone MCP](docs/roo-or-standalone-mcp.md)** (install, tarball, passwords, job cards via `--config`, example JSON).

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
  "zoweMCP.mockDataDirectory": "/absolute/path/to/zowe-mcp-mock-data"
}
```

Once configured, the server starts with the full set of tools (dataset
listing, reading, writing, context management, etc.).

### Option B: Configure as a standalone MCP server in VS Code

This approach lets you pass the `--mock` flag directly. Create or edit
`.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
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

Build the server first (`npm run build`), then use `npx @zowe/mcp-server call-tool`. For usage, options, and examples see the script source: [`packages/zowe-mcp-server/src/scripts/call-tool.ts`](packages/zowe-mcp-server/src/scripts/call-tool.ts).

### MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
provides a web UI for interacting with the server (opens at <http://localhost:6274>).
Use the script that matches how you want to run the server:

| Script | Backend | Use when |
| --- | --- | --- |
| `npm run inspector` | None | Quick check: only core tools (e.g. `info`) are available; no z/OS systems. |
| `npm run inspector:mock` | Mock (filesystem) | Try dataset tools without a real z/OS: uses `./zowe-mcp-mock-data`. Generate mock data first with `npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data`. |
| `npm run inspector:native` | Native (SSH) | Connect to real z/OS via SSH. Needs `native-config.json` (systems) and `.env` (passwords). Copy `native-config.example.json` → `native-config.json` and `.env.example` → `.env`, then set `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (see [Standalone mode](#standalone-mode)). |

```bash
npm run inspector          # no backend
npm run inspector:mock     # mock data in ./zowe-mcp-mock-data
npm run inspector:native   # SSH via native-config.json + .env
```

## Evaluations

The **evals** package runs an LLM agent against the MCP server (mock or native) and checks that tool calls and answers match expectations. Use it to validate that AI assistants use the Zowe MCP tools correctly.

1. **Config** (at repo root): copy `evals.config.example.json` to `evals.config.json` and set your LLM provider (vLLM, Gemini, or LM Studio). See [packages/zowe-mcp-evals/README.md](packages/zowe-mcp-evals/README.md).
2. **Run** from repo root:

```bash
npm run evals                    # all question sets
npm run evals -- --set datasets  # one set
npm run evals -- --set datasets --number 1   # one question
```

Reports are written to `evals-report/report.md` and `evals-report/failures.md`.

## Vendor extensions

Private or enterprise content (CLI plugin definitions, eval question sets, E2E tests, documentation) can live in a `vendor/` directory at the repo root without touching the upstream codebase. The server, docs generator, and eval harness auto-discover anything placed there — no configuration required.

### Directory layout

```text
vendor/<name>/
  cli-bridge-plugins/   ← *.yaml CLI plugin definitions (auto-loaded at server startup)
  eval-questions/       ← *.yaml eval question sets (referenced as "<name>/set-name")
  e2e-tests/            ← *.test.ts E2E tests (picked up by Vitest automatically)
  docs/                 ← private documentation
```

The `vendor/` directory is kept out of the upstream repo by a `vendor/.gitignore` containing `*` that the extract script creates automatically — the root `.gitignore` is the same on all branches. To populate it from a private branch that tracks vendor content:

```bash
VENDOR_REMOTE=<git-remote> VENDOR_BRANCH=<branch> npm run vendor:extract
```

This fetches the branch, extracts the `vendor/` directory into your working tree, and writes `vendor/.gitignore` so git treats the whole directory as ignored. To remove it:

```bash
npm run vendor:clean
```

## Linting and formatting

```bash
npm run lint          # Check all ESLint rules
npm run lint:fix      # Auto-fix ESLint issues
npm run format        # Format all TS/JS/JSON files with Prettier
npm run check-format  # Check formatting without modifying files
```

## Scripts reference

To publish a VSIX to GitHub Releases from your machine (no GitHub Actions): run `npm run release-vsix` (tag defaults to `v` + extension version) or `npm run release-vsix -- v0.1.0`. Or run `./scripts/release-vsix.sh [TAG]` directly. Requires [GitHub CLI](https://cli.github.com/) (`gh`) and `gh auth login`. Builds the extension, creates/updates the release for the tag, and uploads the VSIX.

[CI](.github/workflows/ci.yml) uploads build artifacts for every successful run: the VSIX, the MCP reference doc, and an **`npm pack`** tarball of **`@zowe/mcp-server`** (artifact name `zowe-mcp-server-npm`, file pattern `zowe-mcp-server-*.tgz`). Download from the workflow run’s **Artifacts** section. Install locally with `npm install ./zowe-mcp-server-0.x.y.tgz` (or use `npm run pack:server` to build and pack from your clone).

The packed tarball **bundles all dependencies** (including workspace package `zowe-mcp-common` and file-based `zowe-native-proto-sdk`) so it can be installed standalone without requiring the monorepo or external file dependencies. The `prepack` script automatically bundles these dependencies before packing, and `bundledDependencies` in `package.json` ensures npm includes them in the tarball.

Test airgapped/offline installation:

- `npm run test:airgap` — uses existing tarball (requires `npm run pack:server` first)
- `npm run test:airgap:build` — builds and packs the server, then tests installation

The test simulates an airgapped system using an empty cache, invalid registry (`http://localhost`), and 5ms timeout to verify no network access is required. It also verifies the binary works after installation with detailed error output if it fails.

| Script | Description |
| --- | --- |
| `npm run build` | Build all packages |
| `npm run pack:server` | Build the server and create `zowe-mcp-server-<version>.tgz` in the repo root (same contents as CI npm artifact) |
| `npm run test:airgap` | Test that the packed tarball installs in airgapped mode (uses existing tarball) |
| `npm run test:airgap:build` | Build, pack, and test airgapped installation (all-in-one) |
| `npm test` | Run server tests (Vitest) |
| `npm run test:all` | Run all tests (server + VS Code extension) |
| `npm run test:vscode` | Run VS Code extension tests |
| `npm run build-and-install` | Package and install the VS Code extension |
| `npm run inspector` | Launch MCP Inspector (no backend) |
| `npm run inspector:mock` | Launch MCP Inspector with mock data (`./zowe-mcp-mock-data`) |
| `npm run inspector:native` | Launch MCP Inspector with native SSH (`native-config.json` + `.env`) |
| `npm run evals` | Run AI evals (builds server + evals first). Pass options after `--`: `--set`, `--number`, `--id`, `--filter`. Requires `evals.config.json` at root. |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format all files with Prettier |
| `npx @zowe/mcp-server init-mock --output <dir>` | Generate mock data |
| `npx @zowe/mcp-server call-tool [--mock=<dir>] [<tool-name> [key=value ...]]` | Call a tool from the CLI |
| `npm run sdk:release [-- version]` | Fetch latest (or specific) SDK release from Zowe Artifactory |
| `npm run sdk:fallback` | Use in-repo fallback SDK (for CI and when nightly is unavailable) |
| `npm run sdk:nightly` | Fetch latest nightly SDK build |
| `npm run sdk:pr -- <pr-number>` | Fetch SDK from a specific PR build (requires `gh`) |
| `npm run sdk:branch -- <branch>` | Fetch SDK from the latest successful build for a branch (requires `gh`) |
| `npm run sdk:local -- <path>` | Use a local `.tgz` or ZNP repo directory |
| `npm run release-vsix [-- TAG]` | Build VSIX and create/update GitHub Release (requires `gh`). Optional tag after `--`, e.g. `v0.1.0`; default from extension version. |
| `VENDOR_REMOTE=… VENDOR_BRANCH=… npm run vendor:extract` | Fetch and extract the `vendor/` directory from a private branch into the current checkout (gitignored) |
| `npm run vendor:clean` | Remove the local `vendor/` directory |

## License

[Eclipse Public License v2.0](https://www.eclipse.org/legal/epl-v20.html)
