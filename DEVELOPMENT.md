# Developing Zowe MCP

This guide covers building, testing, and developing Zowe MCP. For
installation and usage, see the [README](README.md). For contribution
conventions (commit sign-off, pull request and AI evaluation requirements,
code style), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

```text
zowe-mcp/                       # npm workspaces monorepo
  packages/
    zowe-mcp-server/            # Server package (npm: @zowe/mcp-server, ESM)
    zowe-mcp-vscode/            # VS Code extension (CommonJS)
    zowe-mcp-evals/             # AI evaluations (LLM agent + MCP tools)
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

## Zowe Remote SSH SDK

The npm package is **`zowex-sdk`** (Zowe Remote SSH SDK). Nightly builds are
under Artifactory `org/zowe/zowex/SDK/Nightly`.

The server depends on the
[Zowe Remote SSH](https://github.com/zowe/zowex) SDK for
connecting to z/OS over SSH. Use the scripts below to fetch the `zowex-sdk`
tarball (Zowe Artifactory or in-repo fallback).

| Script | Source | Description |
| --- | --- | --- |
| `npm run sdk:release` | Artifactory npm | Latest stable release |
| `npm run sdk:release -- <version>` | Artifactory npm | Specific release when published (e.g. `0.4.0`) |
| `npm run sdk:fallback` | In-repo | Fallback resource for CI and when nightly is unavailable |
| `npm run sdk:nightly` | Artifactory / GitHub | Latest nightly build (recommended for development) |
| `npm run sdk:pr -- <pr-number>` | GitHub Actions | Build from a specific pull request |
| `npm run sdk:branch -- <branch>` | GitHub Actions | Latest successful build for a branch |
| `npm run sdk:local -- <path>` | Local filesystem | A `.tgz` file or a Zowe Remote SSH SDK (`zowex`) repo directory |

After switching, rebuild (`npm run build`) and run tests (`npm test`) to
verify compatibility. The SDK tarball is stored in `resources/`.

Requires [GitHub CLI](https://cli.github.com/) (`gh`) for the `pr`, `branch`,
and `nightly` (fallback) modes.

## Testing

```bash
# Server unit tests (Vitest)
npm test

# All tests (server + VS Code extension)
npm run test:all

# VS Code extension tests only (launches a real VS Code instance)
npm run test:vscode
```

Server tests are organized into common (parameterized across transports) and
transport-specific files. See `packages/zowe-mcp-server/__tests__/` for
examples.

### Quick tool testing from the CLI

Build the server first (`npm run build`), then use the `call-tool` command of
the server binary. For usage, options, and examples see the script source:
[`packages/zowe-mcp-server/src/scripts/call-tool.ts`](packages/zowe-mcp-server/src/scripts/call-tool.ts).

```bash
node packages/zowe-mcp-server/dist/index.js call-tool [--mock=<dir>] [<tool-name> [key=value ...]]
```

### MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
provides a web UI for interacting with the server (opens at <http://localhost:6274>).
Use the script that matches how you want to run the server:

| Script | Backend | Use when |
| --- | --- | --- |
| `npm run inspector` | None | Quick check: only core tools (e.g. `getContext`) are available; no z/OS systems. |
| `npm run inspector:mock` | Mock (filesystem) | Try dataset tools without a real z/OS: uses `./zowe-mcp-mock-data`. Generate mock data first (see [Mock mode](README.md#mock-mode)). |
| `npm run inspector:native` | Native (SSH) | Connect to real z/OS via SSH. Needs `native-config.json` (systems) and `.env` (passwords). Copy `native-config.example.json` → `native-config.json` and `.env.example` → `.env`, then set `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (see [Connect to z/OS](README.md#connect-to-zos-native-backend)). |

```bash
npm run inspector          # no backend
npm run inspector:mock     # mock data in ./zowe-mcp-mock-data
npm run inspector:native   # SSH via native-config.json + .env
```

## Running evaluations

The **evals** package runs an LLM agent against the MCP server (mock or
native) and checks that tool calls and answers match expectations. Use it to
validate that AI assistants use the Zowe MCP tools correctly. For when evals
are *required* and how results are recorded in the scoreboard, see
[AI Evaluation Requirements](CONTRIBUTING.md#ai-evaluation-requirements).

1. **Config** (at repo root): copy `evals.config.example.json` to
   `evals.config.json` and set your LLM provider (vLLM, Gemini, or LM Studio).
   See [packages/zowe-mcp-evals/README.md](packages/zowe-mcp-evals/README.md).
2. **Run** from repo root:

```bash
npm run evals                    # all question sets
npm run evals -- --set datasets  # one set
npm run evals -- --set datasets --number 1   # one question
```

Reports are written to `evals-report/report.md` and `evals-report/failures.md`.

## Linting and formatting

See [Code Style](CONTRIBUTING.md#code-style) for conventions and tooling.

```bash
npm run lint          # Check all ESLint rules
npm run lint:fix      # Auto-fix ESLint issues
npm run format        # Prettier (TS/JS/JSON/YAML/CSS/HTML, etc.) + shfmt on tracked shell scripts
npm run check-format  # Same checks without modifying files
```

## Releases and CI artifacts

To publish a VSIX to GitHub Releases from your machine (no GitHub Actions):
run `npm run release-vsix` (tag defaults to `v` + extension version) or
`npm run release-vsix -- v0.1.0`. Or run `./scripts/release-vsix.sh [TAG]`
directly. Requires [GitHub CLI](https://cli.github.com/) (`gh`) and
`gh auth login`. Builds the extension, creates/updates the release for the
tag, and uploads the VSIX.

### CI artifacts

[CI](.github/workflows/ci.yml) uploads build artifacts for every successful
run: the VSIX, the MCP reference doc, and an **`npm pack`** tarball of
**`@zowe/mcp-server`** (artifact name `zowe-mcp-server-npm`, file pattern
`zowe-mcp-server-*.tgz`). Download from the workflow run's **Artifacts**
section. Install locally with `npm install ./zowe-mcp-server-0.x.y.tgz` (or
use `npm run pack:server` to build and pack from your clone).

The packed tarball **bundles all dependencies** (including workspace package
`zowe-mcp-common` and file-based `zowex-sdk`) so it can be installed
standalone without requiring the monorepo or external file dependencies. The
`prepack` script automatically bundles these dependencies before packing and
adds `bundledDependencies` dynamically so npm includes them in the tarball.

### Airgapped installation tests

- `npm run test:airgap` — uses existing tarball (requires `npm run pack:server` first)
- `npm run test:airgap:build` — builds and packs the server, then tests installation

The test simulates an airgapped system using an empty cache, invalid registry
(`http://localhost`), and 5ms timeout to verify no network access is
required. It also verifies the binary works after installation with detailed
error output if it fails.

## Vendor extensions

Private or enterprise content (CLI plugin definitions, eval question sets,
E2E tests, documentation) can live in a `vendor/` directory at the repo root
without touching the upstream codebase. The server, docs generator, and eval
harness auto-discover anything placed there — no configuration required.

### Directory layout

```text
vendor/<name>/
  cli-bridge-plugins/   ← *.yaml CLI plugin definitions (auto-loaded at server startup)
  eval-questions/       ← *.yaml eval question sets (referenced as "<name>/set-name")
  e2e-tests/            ← *.test.ts E2E tests (picked up by Vitest automatically)
  docs/                 ← private documentation
```

The `vendor/` directory is kept out of the upstream repo by a
`vendor/.gitignore` containing `*` that the extract script creates
automatically — the root `.gitignore` is the same on all branches. To
populate it from a private branch that tracks vendor content:

```bash
VENDOR_REMOTE=<git-remote> VENDOR_BRANCH=<branch> npm run vendor:extract
```

This fetches the branch, extracts the `vendor/` directory into your working
tree, and writes `vendor/.gitignore` so git treats the whole directory as
ignored. To remove it:

```bash
npm run vendor:clean
```
