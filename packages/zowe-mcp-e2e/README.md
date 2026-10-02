# Zowe MCP end-to-end test support

This private workspace tests the VS Code extension through a real VS Code and
GitHub Copilot Chat process. It also provides a deterministic fake model server
that implements the Ollama- and OpenAI-compatible APIs used by the tests.

The default suite does not call an external model provider or require a GitHub
sign-in. It uses a scripted model and mock z/OS backends.

## Scenarios

| Scenario | Model | Backend | Coverage |
| --- | --- | --- | --- |
| S1 | Fake | None | Fresh profile, VSIX installation, BYOK activation, and ask-mode chat |
| S2 | Fake | Filesystem mock | Agent mode, MCP discovery, `listDatasets`, and tool-result flow |
| S3 | Fake | Mock z/OS SSH host | Production Zowe Remote SSH RPC path through a throwaway SSH key |
| S4 | Local Ollama | Filesystem mock | Optional, non-deterministic tool call with a real local model |

S1–S3 are hermetic and suitable for automation. S4 is opt-in and intended for
local validation.

## How the harness works

- `src/portable-profile.ts` creates an isolated VS Code portable profile under a
  system temporary directory and installs the built VSIX.
- `src/activation.ts` launches VS Code through Playwright and activates the
  Copilot BYOK model provider.
- `src/chat-session.ts` runs `code chat`, reads the persisted session JSONL, and
  identifies tool invocations and final responses.
- `src/mock-backends.ts` starts the filesystem mock or mock z/OS SSH daemon.
- `src/fake-model-server.ts` returns scripted chat and tool-call responses.
- `src/vscode-settings.ts` creates the required BYOK and Zowe MCP settings.

Implementation-specific behavior and reverse-engineered VS Code details belong
in the source comments beside these modules.

## Prerequisites

- Node.js and npm versions supported by the repository
- VS Code installed locally, or explicit paths to downloaded VS Code binaries
- `sqlite3` on `PATH`
- `ssh-keygen` on `PATH` for S3

On Debian or Ubuntu, install `sqlite3` before running the suite. Linux also
requires a display, such as `xvfb-run`.

## Build and run

From the repository root:

```bash
node scripts/sdk-switch.js pin --no-install
npm install
npm run build -w packages/zowe-mcp-common
npm run build -w @zowe/mcp-server
npm run package -w zowe-mcp-vscode
npm run build -w zowe-mcp-e2e
npm run e2e -w zowe-mcp-e2e
```

Run the optional Ollama scenario with a local Ollama server and a model that
supports tool calling:

```bash
ZOWE_E2E_OLLAMA=1 \
ZOWE_E2E_OLLAMA_MODEL=<model> \
npm run e2e:ollama -w zowe-mcp-e2e
```

Small models may produce tool syntax as ordinary text instead of making a tool
call. Select a stronger tool-capable model when S4 fails for that reason.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VSCODE_E2E_APP` | Installed macOS VS Code binary | Electron binary launched by Playwright |
| `VSCODE_E2E_CLI` | `code` | VS Code CLI used for extension installation and `code chat` |
| `VSCODE_E2E_SQLITE3` | `sqlite3` | SQLite executable used to seed isolated VS Code state |
| `VSCODE_E2E_KEEP_SCRATCH` | Unset | Set to `1` to retain profiles, logs, sessions, and screenshots |
| `ZOWE_E2E_OLLAMA` | Unset | Set to `1` to enable S4 |
| `ZOWE_E2E_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint for S4 |
| `ZOWE_E2E_OLLAMA_MODEL` | `phi4-mini:latest` | Ollama model selected for S4 |

## Isolation and cleanup

Every portable profile is created under `/tmp`, `/private/tmp`, or the platform
system temporary directory. Destructive file operations verify that boundary
before running. `VSCODE_PORTABLE` is set for every VS Code process, so the
harness does not use the developer's normal VS Code profile or `~/.ssh`.

The test teardown must retain both cleanup mechanisms:

1. Kill processes whose command line contains the portable profile path.
2. Kill the detached `code chat` worker PIDs returned by `runChatPrompt()`.

Do not replace either mechanism with an unscoped process command such as
`pkill -f code`.

Screenshots are copied to `packages/zowe-mcp-e2e/e2e-screenshots/` before
normal scratch cleanup. Set `VSCODE_E2E_KEEP_SCRATCH=1` when full VS Code logs
and session files are needed.

## Known gotchas

- Run scenarios sequentially. The process detection and UI automation assume
  one controlled VS Code instance at a time.
- Keep portable-profile paths short. VS Code's Unix-domain socket path can
  exceed the macOS limit when placed under a long temporary path.
- The tests use the `read` capability tier to keep the available tool count
  below Copilot's tool-grouping threshold in profiles without GitHub access.
- A fresh profile requires the activation flow in `activation.ts`; starting VS
  Code alone does not reliably activate the BYOK provider.
- Global tool auto-approval requires both a setting and a value seeded into VS
  Code's SQLite state. `portable-profile.ts` handles both.
- Fake Ollama metadata must advertise a sufficient context length and a
  supported Ollama version. See `src/ollama-api.ts`.

## Fake model server

Run its unit tests:

```bash
npm test -w zowe-mcp-e2e
```

Run the standalone server after building the workspace:

```bash
node packages/zowe-mcp-e2e/dist/cli.js --port 0 --log-file ./fake-model-server.log
```

The CLI prints `{"port": ..., "url": ...}` to standard output and supports
`--port`, `--host`, `--model-id`, `--log-file`, `--tool-pattern`, and
`--dataset-pattern`.

## CI

`.github/workflows/copilot-e2e.yml` runs S1–S3 in Linux under Xvfb and uploads
screenshots and failure artifacts. It is intentionally separate from the
required CI gate while the suite builds a stability record.
