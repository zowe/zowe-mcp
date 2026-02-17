# Zowe MCP - Agent Instructions

## Project Overview

Zowe MCP is a Model Context Protocol (MCP) server and VS Code extension that provides AI tools for interacting with z/OS systems. It enables LLMs to work with data sets, jobs, and UNIX System Services on one or more z/OS systems.

## Repository Structure

This is an npm workspaces monorepo with two packages:

- `packages/zowe-mcp-server` — Standalone MCP server (ESM, publishable to npm)
- `packages/zowe-mcp-vscode` — VS Code extension that registers the server (CommonJS)

## Key Architectural Decisions

- **Monorepo with npm workspaces**: Two packages share a root `package.json`. The VS Code extension depends on the server package via workspace linking.
- **Transport separation**: Server logic (`server.ts`) is transport-agnostic. Transport implementations live in `src/transports/` (stdio and HTTP Streamable). The entry point (`index.ts`) selects the transport based on CLI args.
- **HTTP multi-session**: The HTTP transport creates a new `McpServer` + `StreamableHTTPServerTransport` per client session. `startHttp` accepts a server factory (`() => McpServer`) rather than a single server instance. Sessions are tracked by `mcp-session-id` header and cleaned up on close.
- **Component-based tools**: Tools are organized under `src/tools/<component>/`. Each component registers its tools via a function that takes an `McpServer` instance. Components: `core` (server info), `context` (system/prefix management), `datasets` (dataset CRUD). Future: `jobs`, `uss`. Use `server.registerTool(name, config, cb)` — the older `server.tool(...)` overloads are deprecated.
- **Tool naming for Copilot**: MCP tool names use **camelCase** (e.g. `listDatasets`, `setSystem`, `getContext`) so they fit VS Code Copilot’s display. Copilot prefixes names with `mcp_<providerId>_`, so a tool named `listDatasets` appears as `mcp_zowe_listDatasets`. Keep names short and avoid redundant `zowe_` prefixes — the provider ID already provides the namespace.
- **ESM for server, CJS for extension**: The MCP SDK requires ESM. VS Code extensions use CommonJS. Each package has its own `tsconfig.json`.
- **Version from package.json**: The server reads its version from `package.json` at runtime using `createRequire`. Keep the version in `package.json` as the single source of truth.
- **Code formatting via Cursor hooks**: All TypeScript, JavaScript, and JSON files are formatted with Prettier (`.prettierrc.json` + `prettier-plugin-organize-imports`). Markdown files are formatted with markdownlint-cli2. A Cursor hook (`.cursor/hooks/format.sh`) auto-formats all file types after every Agent and Tab edit.
- **ESLint with type-checked rules**: ESLint is configured with `typescript-eslint`'s `recommendedTypeChecked` + `stylisticTypeChecked` rulesets, `eslint-plugin-headers` for license headers, and `eslint-plugin-vitest` for test hygiene (server tests only — VS Code extension tests use Mocha). Config is in `eslint.config.mjs`. Each package has a `tsconfig.eslint.json` that includes all lintable files (src, tests, scripts). The Cursor format hook automatically runs `eslint --fix` on `.ts` files.
- **License header enforcement**: All `.ts` files must start with the EPL-2.0 license header. Enforced by `eslint-plugin-headers` via `eslint.config.mjs`. The Cursor format hook automatically inserts missing headers on save. Run `npm run lint` to check all files, `npm run lint:fix` to auto-fix.
- **Structured logging (MCP server)**: The server uses a custom `Logger` class (`src/log.ts`) that writes human-readable messages to stderr and forwards them to the MCP client via `sendLoggingMessage()`. Log levels follow RFC 5424 (debug, info, notice, warning, error, critical, alert, emergency). The `logging` capability is declared in `server.ts` so the SDK allows protocol-level log notifications. No external logging library (pino, winston) is used — the MCP SDK provides the protocol transport, and stderr handles local diagnostics.
- **Event-based extension communication**: The MCP server and VS Code extension communicate bidirectionally over a named pipe (Unix socket / Windows named pipe). The extension creates a per-workspace pipe server on activation and writes a discovery file to `context.globalStorageUri`. The MCP server reads the discovery file (via `MCP_DISCOVERY_DIR` + `WORKSPACE_ID` env vars) and connects. Events are framed as newline-delimited JSON (NDJSON). Event types are defined in `src/events.ts` and split into `ServerToExtensionEvent` (e.g. `log`, `notification`, `request-password`, `password-invalid`) and `ExtensionToServerEvent` (e.g. `log-level`, `password`, `systems-update`). When the env vars are absent (standalone mode), the pipe client is not created and the server operates identically to before.
- **Mock mode via extension setting**: The `zowe-mcp.mockDataDir` VS Code setting specifies an absolute path to a mock data directory. When set, the extension passes `--mock <dir>` to the server process args, enabling the full set of z/OS tools. When empty (default), the server starts without a backend and only the `info` tool is available. Changes require restarting the MCP server.
- **Generate Mock Data command**: The `zowe-mcp.initMockData` VS Code command (palette: "Zowe MCP: Generate Mock Data") runs the bundled server's `init-mock` script. It prompts for an output folder, generates mock data, offers to set `zowe-mcp.mockDataDir`, and offers to reload the window. This is the primary way for extension users to create mock data (they cannot use `npx zowe-mcp-server` since the server is bundled inside the extension).
- **Dynamic log level from VS Code**: The `zowe-mcp.logLevel` VS Code setting controls the MCP server's log verbosity at runtime. Changes are sent as `log-level` events over the named pipe and take effect immediately without restarting the server. The initial level is sent when the server first connects.
- **ZosBackend interface**: All z/OS dataset operations go through the `ZosBackend` interface (`src/zos/backend.ts`). This abstraction boundary decouples tools/resources from the actual z/OS API. Any backend (z/OSMF, Zowe SDK, mock filesystem) can be plugged in. The tool and resource layer is completely backend-agnostic.
- **Per-system working context**: Each z/OS system maintains its own `SystemContext` (user ID, DSN prefix) in a `SessionState` (`src/zos/session.ts`). Switching systems restores that system's context — like separate terminal sessions per machine. The DSN prefix defaults to the active user's ID (standard z/OS HLQ convention).
- **DSN resolution (single-quote convention)**: Dataset names follow the standard TSO/ISPF convention. Unquoted names are relative to the DSN prefix; single-quoted names (`'SYS1.PROCLIB'`) are absolute. The `resolveDsn()` function in `src/zos/dsn.ts` handles resolution, validation (44-char limit, 8-char qualifiers), and case normalization to uppercase.
- **Mock mode**: The server supports a filesystem-backed mock mode (`--mock <dir>` or `ZOWE_MCP_MOCK_DIR` env var). The `FilesystemMockBackend` (`src/zos/mock/`) implements `ZosBackend` using a DSFS-inspired directory layout. Mock data is generated by `init-mock` CLI (`npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data`). ETags use file mtime.
- **Native (SSH) backend**: The server can use the Zowe Native Proto SDK (`src/zos/native/`) to connect to z/OS over SSH. Connection format is `user@host` or `user@host:port`. Only `listDatasets` is implemented; other backend methods throw "not implemented". Standalone: systems from `--config <path>` (JSON `{ "systems": ["user@host", ...] }`) or repeatable `--system`; passwords from env `ZOWE_MCP_PASSWORD_<USER>_<HOST>`. VS Code: systems from `zowe-mcp.nativeSystems` setting; passwords via pipe events (request-password → extension prompts or reads SecretStorage → password event). Shared secret key: `zowe.ssh.password.${user}.${hostNormalized}` (Zowe OSS convention). Invalid passwords are blacklisted (standalone) or deleted from storage (VS Code).
- **Tool annotations**: Read-only tools use `readOnlyHint: true` (skips VS Code confirmation dialog). Destructive tools (`deleteDataset`) use `destructiveHint: true`. This follows VS Code MCP best practices.
- **Prompt naming**: MCP prompts use `camelCase` names per VS Code conventions (e.g. `reviewJcl`, `explainDataset`, `compareMembers`). They appear as `/mcp.zowe.<name>` slash commands.
- **Resource URI scheme**: Dataset resources use `zos-ds://{system}/{dsn}` and `zos-ds://{system}/{dsn}({member})` URI templates with optional `?volser=` for uncataloged datasets.
- **No default user on system**: `ZosSystem` does not have a `defaultUser` property. The default user for a system is determined by the `CredentialProvider` (e.g. the first credential entry in mock mode, or the logged-in user from Zowe config). The `setSystem` tool calls `credentialProvider.getCredentials(systemId)` to get the default user when first connecting.
- **Auto-activation of single system**: When only one system is configured, `createServer()` automatically activates it (calls `setActiveSystem` with the default user from the credential provider). This means the LLM can skip `setSystem` and jump straight to dataset tools in single-system setups.
- **Lazy context initialization**: Dataset tools lazily initialize the system context via `ensureContext()` when the LLM passes an explicit `system` parameter without first calling `setSystem`. This prevents empty results caused by a missing DSN prefix. The `DatasetToolDeps` interface includes `credentialProvider` for this purpose.
- **ISPF-style pattern matching**: The mock backend's `matchPattern()` function treats a trailing lone `*` as `**` (match across any number of qualifiers), following the standard ISPF 3.4 convention. So `USER.*` matches `USER.SRC.COBOL`, `USER.JCL.CNTL`, etc. A `*` in a non-trailing position still matches within a single qualifier only.
- **Response envelope pattern**: All dataset tool responses are wrapped in a `ToolResponseEnvelope` (`src/tools/response.ts`) with `_context` (resolution metadata), `_result` (summary/pagination/windowing metadata), and `data` (the actual payload). The underscore prefix signals metadata. Resolved values (`resolvedPattern`, `resolvedDsn`, `resolvedTargetDsn`) are always fully-qualified, absolute, and single-quoted (e.g. `'USER.SRC.COBOL'`). The `dsnPrefix` field is present when a relative name was resolved, absent for absolute inputs.
- **Pagination for list operations**: `listDatasets` and `listMembers` support `offset` (0-based, default 0) and `limit` (default 500, max 1000) parameters. The backend returns the full list; the tool layer slices it. `_result` includes `count`, `totalAvailable`, `offset`, and `hasMore`. Constants: `DEFAULT_LIST_LIMIT = 500`, `MAX_LIST_LIMIT = 1000`.
- **Line windowing for read operations**: `readDataset` supports `startLine` (1-based, default 1) and `lineCount` parameters. Large files are auto-truncated to `MAX_READ_LINES = 2000` lines when no explicit window is requested. `_result` includes `totalLines`, `startLine`, `returnedLines`, `contentLength`, and `mimeType`. The ETag always reflects the full content, not the window.

## Common Patterns

### Adding a New Tool

1. Create a file under `packages/zowe-mcp-server/src/tools/<component>/`
2. Export a `register<Component>Tools(server: McpServer, deps, logger)` function
3. Import and call it from `packages/zowe-mcp-server/src/server.ts`
4. **Tool names**: Use **camelCase** (e.g. `listDatasets`, `setSystem`) so they fit VS Code Copilot; avoid snake_case.
5. For dataset tools, accept `DatasetToolDeps` (backend, systemRegistry, sessionState, credentialProvider). For context tools, accept `ContextToolDeps` (systemRegistry, sessionState, credentialProvider).
6. Use `readOnlyHint: true` annotation for read-only tools, `destructiveHint: true` for destructive ones.
7. Add tests in `packages/zowe-mcp-server/__tests__/`

### Adding a New Component

1. Create a new directory under `packages/zowe-mcp-server/src/tools/<component>/`
2. Follow the pattern in `src/tools/datasets/dataset-tools.ts` (for z/OS tools) or `src/tools/core/zowe-info.ts` (for simple tools)
3. Register in `server.ts` — z/OS tools go inside the `if (options?.backend)` block
4. Update the `components` array in the `info` tool response

### Response Envelope for Dataset Tools

All dataset tool responses use the envelope from `src/tools/response.ts`:

- **Types**: `ToolResponseEnvelope<T>`, `ResponseContext`, `ListResultMeta`, `ReadResultMeta`, `MutationResultMeta`
- **Helpers**: `buildContext()`, `formatResolved()`, `paginateList()`, `windowContent()`, `wrapResponse()`
- **Constants**: `DEFAULT_LIST_LIMIT` (500), `MAX_LIST_LIMIT` (1000), `MAX_READ_LINES` (2000)

When adding a new dataset tool:

1. Use `buildContext(systemId, prefix, { resolvedDsn: formatResolved(dsn) })` to build `_context`
2. Set `dsnPrefix` to `undefined` for absolute inputs (use `wasAbsolute` from `resolveDsn()`)
3. Use `paginateList()` for list tools, `windowContent()` for read tools
4. Use `wrapResponse(ctx, meta, data)` to assemble the final MCP response
5. For mutation tools, use `MutationResultMeta` with `{ success: true }`

The `resolvedPattern` field is for list tools (`listDatasets`); `resolvedDsn` is for CRUD tools; `resolvedTargetDsn` is for copy/rename operations.

### z/OS Domain Model

- **System identity**: `SystemId` (hostname string) in `src/zos/system.ts`. `SystemRegistry` manages known systems.
- **Credentials**: `CredentialProvider` interface in `src/zos/credentials.ts`. Implementations: `MockCredentialProvider` (reads `systems.json`), future: `ZoweTeamConfigProvider`, `OAuthTokenProvider`.
- **Session state**: `SessionState` in `src/zos/session.ts`. Tracks active system and per-system `SystemContext` (userId, dsnPrefix).
- **DSN utilities**: `src/zos/dsn.ts` — `resolveDsn()`, `validateDsn()`, `validateMember()`, `buildDsUri()`, `inferMimeType()`. Use `dsn` (not `dsname`) as the variable name for dataset names throughout the codebase.
- **Backend**: `ZosBackend` interface in `src/zos/backend.ts`. Implementations: `FilesystemMockBackend` (mock), `NativeBackend` (Zowe Native Proto SDK over SSH; listDatasets and listMembers).

### Mock Mode

- **Starting**: `npx zowe-mcp-server --stdio --mock ./zowe-mcp-mock-data` or `ZOWE_MCP_MOCK_DIR=./zowe-mcp-mock-data`
- **Generating data**: `npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data [--preset minimal|default|large]`
- **Directory layout**: DSFS-inspired — `zowe-mcp-mock-data/{system}/{HLQ}/{dataset-qualifiers}/` with `_meta.json` for attributes
- **Adding mock systems**: Edit `systems.json` in the mock data directory. Each system has `host`, `port`, `description`, optional `defaultUser`, and `credentials` array. If `defaultUser` is omitted, the first credential entry is used as the default.

### Testing

Server tests are organized into **common** (parameterized) and **transport-specific** files:

- **Common tests** (`__tests__/common.test.ts`): Tests that must pass on every transport. They run once per transport provider (in-memory, stdio, HTTP) using the `allProviders` array from `transport-providers.ts`. Add new tool tests here so they are automatically verified across all transports.
- **Transport providers** (`__tests__/transport-providers.ts`): Abstraction that encapsulates setup/teardown for each transport. Implements the `TransportProvider` interface (`setup() → Client`, `teardown()`). When adding a new transport, create a provider here and add it to `allProviders`.
- **In-memory specific** (`__tests__/server.test.ts`): Fast unit tests for behaviour unique to the in-memory transport (e.g. multiple calls on the same connection, server internals).
- **Stdio specific** (`__tests__/stdio.e2e.test.ts`): E2E tests for stdio-only behaviour (e.g. default transport flag, process spawning).
- **HTTP specific** (`__tests__/http.e2e.test.ts`): E2E tests for HTTP-only behaviour (e.g. port binding, custom port flag).
- **VS Code extension tests**: Use `@vscode/test-cli` + `@vscode/test-electron` for integration tests in a real VS Code instance.
- **Quick tool testing**: `npm run call-tool -- <tool-name> [json-args]` for CLI testing.
- **MCP Inspector**: `npm run inspector` launches the web-based inspector at `http://localhost:6274`.

### Code Formatting and License Headers

- **Auto-formatted by Cursor hook**: `.cursor/hooks/format.sh` runs automatically after every Agent and Tab file edit. For `.ts` files it first runs ESLint `--fix` (to insert the license header if missing), then Prettier. JS/JSON files get Prettier only. Markdown files get markdownlint-cli2. No manual formatting needed during development.
- **License header**: Every `.ts` file must begin with the EPL-2.0 block comment. ESLint (`eslint-plugin-headers`) enforces this via `eslint.config.mjs` and auto-fixes with `--fix`. You do not need to manually add the header — the hook does it for you.
- **Manual formatting**: Run `npm run format` to format all TS/JS/JSON files, `npm run check-format` to verify, or `npm run markdownlint <file>` for Markdown.
- **Manual linting**: Run `npm run lint` to check all ESLint rules (type-checked + license headers), `npm run lint:fix` to auto-fix.
- **Config**: `.prettierrc.json` at the repo root. Uses `prettier-plugin-organize-imports` to auto-sort imports. `eslint.config.mjs` at the repo root for license header enforcement.
- **Ignored files**: See `.prettierignore`. Markdown files are excluded from Prettier (handled by markdownlint instead). Build artifacts (`.vscode-test/`, `dist/`, `out/`, `server/`) are excluded from ESLint.

### Logging (MCP Server)

- **Logger class**: `packages/zowe-mcp-server/src/log.ts` exports a `Logger` class with triple output: stderr (always), MCP protocol notifications (when connected), and VS Code extension pipe (when connected). Created as a singleton via `getLogger()` in `server.ts`.
- **Log levels**: RFC 5424 syslog levels — `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`. Default is `info`, overridden by the `ZOWE_MCP_LOG_LEVEL` environment variable or dynamically via `log-level` events from the VS Code extension.
- **Child loggers**: Use `logger.child('name')` to create a named child logger that shares the parent's server attachment, extension client, and level. Each component/transport should create its own child (e.g., `logger.child('http')`, `logger.child('core')`).
- **Usage in tools**: Tool registration functions receive a `Logger` parameter from `server.ts`. Create a child logger and use it for diagnostic messages (e.g., `log.debug('tool called')`).
- **Usage in transports**: Transport functions (`startStdio`, `startHttp`) receive a `Logger` parameter. Create a child logger named after the transport.
- **Do not use `console.log` or `console.error`**: Always use the `Logger` class. For stdio transport, writing to stdout corrupts the JSON-RPC protocol.
- **Stderr format**: `YYYY-MM-DDTHH:mm:ss.sssZ [LEVEL] [name] message {data}`

### Extension Communication (Named Pipe)

- **Pipe server**: `packages/zowe-mcp-vscode/src/pipe-server.ts` creates a `net.Server` on a per-workspace named pipe. The pipe path is `/tmp/zowe-mcp-<workspaceId>.sock` (Unix) or `\\.\pipe\zowe-mcp-<workspaceId>` (Windows). A discovery JSON file is written to `context.globalStorageUri`.
- **Extension client**: `packages/zowe-mcp-server/src/extension-client.ts` reads the discovery file and connects to the pipe. Uses retry logic (up to 10 attempts, 1s delay). Returns `undefined` in standalone mode (env vars absent).
- **Event types**: Defined in `packages/zowe-mcp-server/src/events.ts`. The `McpEvent<T, D>` generic envelope carries a `type`, `data`, and `timestamp`. `ServerToExtensionEvent` includes `log` and `notification`; `ExtensionToServerEvent` includes `log-level`.
- **Event handler**: `packages/zowe-mcp-vscode/src/event-handler.ts` dispatches incoming server events to VS Code APIs (e.g. `log` events → `LogOutputChannel`, `notification` events → `vscode.window.showWarningMessage` / `showErrorMessage` / `showInformationMessage` with an "Open Settings" button).
- **Adding a new event type**: (1) Add the event data interface and type alias to `events.ts`. (2) Add it to the appropriate union (`ServerToExtensionEvent` or `ExtensionToServerEvent`). (3) Handle it in `event-handler.ts` (server→extension) or register a handler via `extensionClient.onEvent()` (extension→server).
- **Env vars**: `MCP_DISCOVERY_DIR` and `WORKSPACE_ID` are passed to the MCP server via `McpStdioServerDefinition`'s `env` parameter. They are set automatically by the extension — no manual configuration needed.

### Logging (VS Code Extension)

- **Output channel**: The extension creates a `LogOutputChannel` named "Zowe MCP" (visible in the VS Code Output panel). It is initialized in `src/log.ts` via `initLog(context)` and accessed elsewhere via `getLog()`.
- **Startup log**: `src/startup-log.ts` logs environment info at activation: extension version, VS Code version, GitHub Copilot Chat status (`GitHub.copilot-chat`), and Zowe Explorer status (`Zowe.vscode-extension-for-zowe`).
- **Usage**: Import `getLog()` from `./log` and call `.info()`, `.warn()`, `.error()`, `.debug()`, or `.trace()`. Do not use `console.log` in the extension.

### MCP SDK Import Paths

Always use the full subpath imports from the SDK:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
```

## Things to Remember

- The MCP SDK v1.x is the stable branch. The `main` branch of the SDK repo is v2 pre-alpha — do not use it.
- The VS Code extension uses `@vscode/dts` to download VS Code type definitions. The `vscode.d.ts` file is auto-generated and should not be edited.
- The `mcpServerDefinitionProviders` contribution point in the VS Code extension `package.json` must have an `id` matching the one passed to `registerMcpServerDefinitionProvider`.
- VS Code extension tests require a display to run (they launch a real VS Code instance). They won't work in headless CI without `xvfb` or similar.
- The server's `bin` field in `package.json` points to `dist/index.js` — always build before testing E2E or using the inspector.
- Express v5 is used for the HTTP transport.
- ESLint uses type-checked rules (`recommendedTypeChecked` + `stylisticTypeChecked`). Avoid `any` — use `as` type assertions on `JSON.parse()` and `require()` results. Prefer `T[]` over `Array<T>`, `interface` over `type` alias, and `??` over `||` for nullish values. Each package has a `tsconfig.eslint.json` that covers all lintable files (src, tests, scripts, config).
- Vitest test rules (`eslint-plugin-vitest`) apply only to `packages/zowe-mcp-server/__tests__/`. VS Code extension tests use Mocha (not Vitest) and are excluded from vitest rules.
- Never use `console.log` or `console.error` in the MCP server — use the `Logger` class from `src/log.ts`. For stdio transport, stdout is reserved for JSON-RPC protocol messages.
- The `logging` capability must be declared in the `McpServer` constructor options for `sendLoggingMessage()` to work. This is done in `server.ts`.
- The extension pipe tests (`__tests__/extension-client.test.ts`) create real Unix sockets in `/tmp/`. The "missing discovery file" test takes ~9s due to retry logic (10 attempts × 1s delay).
- Event types are defined in the server package (`src/events.ts`) and imported by the VS Code extension from `zowe-mcp-server/dist/events.js`. The server must be built before the extension can compile.
- The `createServer()` function in `server.ts` accepts optional `CreateServerOptions` with `backend` and `systemRegistry`. When no backend is provided, only core tools (info) are registered and a warning is logged. When a backend is provided, all z/OS tools, resources, and prompts are registered. The `info` tool response includes `backend` (connected backend type, e.g. `"mock"`, `"native"`, or `null`) and a `notice` field explaining how to configure a backend when none is present.
- When the server starts without a backend and the extension pipe is connected, it sends a `notification` event that causes VS Code to show a warning dialog with an "Open Settings" button pointing to `zowe-mcp.mockDataDir`.
- Dataset tools resolve names using the z/OS single-quote convention via `resolveDsn()`. Always test with both relative names (e.g. `"SRC.COBOL"`) and absolute names (e.g. `"'SYS1.PROCLIB'"`).
- All resolved values in tool responses (`resolvedPattern`, `resolvedDsn`, `resolvedTargetDsn`) are always fully-qualified, absolute, and wrapped in single quotes. This is the z/OS convention. The `dsnPrefix` field in `_context` indicates whether a prefix was applied (present = relative input, absent = absolute input).
- Tool descriptions for `listDatasets`, `listMembers`, and `readDataset` mention pagination/windowing limits so the LLM agent knows upfront that results may be partial and how to request more.
- Parameter descriptions for all dataset/pattern inputs explicitly document the single-quote convention with examples (e.g. `"SRC.COBOL"` for relative, `"'USER.SRC.COBOL'"` for absolute).
- The mock backend stores files as UTF-8 and ignores the `codepage` parameter. Real backends must handle EBCDIC-to-UTF-8 conversion.
- Mock ETags are derived from file modification timestamps (`mtime`). Real backends should use the ETag mechanism provided by their API (e.g. z/OSMF `ETag` header).
- The `init-mock` CLI supports presets (`minimal`, `default`, `large`) and custom scale parameters (`--systems`, `--users-per-system`, `--datasets-per-user`, `--members-per-pds`).

## Scripts Reference

| Script | Description |
| --- | --- |
| `npm run build` | Build all packages |
| `npm test` | Run server tests (Vitest) |
| `npm run test:all` | Run all tests (server + VS Code extension) |
| `npm run test:vscode` | Run VS Code extension tests (auto-builds first via `pretest`) |
| `npm run call-tool -- <name>` | Call a tool from CLI |
| `npm run inspector` | Launch MCP Inspector |
| `npm run lint` | Run ESLint (type-checked rules + license headers) |
| `npm run lint:fix` | Auto-fix ESLint issues (including missing headers) |
| `npm run format` | Format all TS/JS/JSON files with Prettier |
| `npm run check-format` | Check formatting without modifying files |
| `npm run markdownlint <file>` | Fix markdown lint issues |
| `npx zowe-mcp-server init-mock --output <dir>` | Generate mock data directory |
