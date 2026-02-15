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
- **Component-based tools**: Tools are organized under `src/tools/<component>/`. Each component registers its tools via a function that takes an `McpServer` instance. Currently only `core` exists; future components include `datasets`, `jobs`, `uss`. Use `server.registerTool(name, config, cb)` — the older `server.tool(...)` overloads are deprecated.
- **Tool naming for Copilot**: VS Code Copilot prefixes MCP tool names with `mcp_<providerId>_`. The VS Code extension provider ID is `zowe`, so a tool named `info` appears as `mcp_zowe_info` in Copilot. Keep tool names short and avoid redundant `zowe_` prefixes — the provider ID already provides the namespace.
- **ESM for server, CJS for extension**: The MCP SDK requires ESM. VS Code extensions use CommonJS. Each package has its own `tsconfig.json`.
- **Version from package.json**: The server reads its version from `package.json` at runtime using `createRequire`. Keep the version in `package.json` as the single source of truth.
- **Code formatting via Cursor hooks**: All TypeScript, JavaScript, and JSON files are formatted with Prettier (`.prettierrc.json` + `prettier-plugin-organize-imports`). Markdown files are formatted with markdownlint-cli2. A Cursor hook (`.cursor/hooks/format.sh`) auto-formats all file types after every Agent and Tab edit.
- **ESLint with type-checked rules**: ESLint is configured with `typescript-eslint`'s `recommendedTypeChecked` + `stylisticTypeChecked` rulesets, `eslint-plugin-headers` for license headers, and `eslint-plugin-vitest` for test hygiene (server tests only — VS Code extension tests use Mocha). Config is in `eslint.config.mjs`. Each package has a `tsconfig.eslint.json` that includes all lintable files (src, tests, scripts). The Cursor format hook automatically runs `eslint --fix` on `.ts` files.
- **License header enforcement**: All `.ts` files must start with the EPL-2.0 license header. Enforced by `eslint-plugin-headers` via `eslint.config.mjs`. The Cursor format hook automatically inserts missing headers on save. Run `npm run lint` to check all files, `npm run lint:fix` to auto-fix.
- **Structured logging (MCP server)**: The server uses a custom `Logger` class (`src/log.ts`) that writes human-readable messages to stderr and forwards them to the MCP client via `sendLoggingMessage()`. Log levels follow RFC 5424 (debug, info, notice, warning, error, critical, alert, emergency). The `logging` capability is declared in `server.ts` so the SDK allows protocol-level log notifications. No external logging library (pino, winston) is used — the MCP SDK provides the protocol transport, and stderr handles local diagnostics.

## Common Patterns

### Adding a New Tool

1. Create a file under `packages/zowe-mcp-server/src/tools/<component>/`
2. Export a `register<Component>Tools(server: McpServer)` function
3. Import and call it from `packages/zowe-mcp-server/src/server.ts`
4. Add tests in `packages/zowe-mcp-server/__tests__/`

### Adding a New Component

1. Create a new directory under `packages/zowe-mcp-server/src/tools/<component>/`
2. Follow the pattern in `src/tools/core/zowe-info.ts`
3. Register in `server.ts`
4. Update the `components` array in the `info` tool response

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

- **Logger class**: `packages/zowe-mcp-server/src/log.ts` exports a `Logger` class with dual output: stderr (always) and MCP protocol notifications (when connected). Created as a singleton via `getLogger()` in `server.ts`.
- **Log levels**: RFC 5424 syslog levels — `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`. Default is `info`, overridden by the `ZOWE_MCP_LOG_LEVEL` environment variable.
- **Child loggers**: Use `logger.child('name')` to create a named child logger that shares the parent's server attachment and level. Each component/transport should create its own child (e.g., `logger.child('http')`, `logger.child('core')`).
- **Usage in tools**: Tool registration functions receive a `Logger` parameter from `server.ts`. Create a child logger and use it for diagnostic messages (e.g., `log.debug('tool called')`).
- **Usage in transports**: Transport functions (`startStdio`, `startHttp`) receive a `Logger` parameter. Create a child logger named after the transport.
- **Do not use `console.log` or `console.error`**: Always use the `Logger` class. For stdio transport, writing to stdout corrupts the JSON-RPC protocol.
- **Stderr format**: `YYYY-MM-DDTHH:mm:ss.sssZ [LEVEL] [name] message {data}`

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
