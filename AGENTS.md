# Zowe MCP

ZOWE MCP gives AI assistants tools for working with z/OS systems.

## Project Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md): pull request, AI usage, evaluation, dependency, and security policies.
- [README.md](README.md): installation and user-facing behavior.
- [RELEASING.md](RELEASING.md): release preparation, publishing, and recovery procedure.
- [docs/mcp-reference.md](docs/mcp-reference.md): generated MCP tool, prompt, and resource reference.
- [docs/mcp-safety-security-principles.md](docs/mcp-safety-security-principles.md): capability tiers and safety model.
- [docs/how-to-add-cli-plugin.md](docs/how-to-add-cli-plugin.md): CLI bridge plugin workflow.
- Root and workspace `package.json` files: canonical scripts and dependencies.

## Package ownership

This is an npm workspaces monorepo:

- `packages/zowe-mcp-common`: shared CommonJS utilities.
- `packages/zowe-mcp-server`: ESM MCP server published as `@zowe/mcp-server`.
- `packages/zowe-mcp-vscode`: CommonJS VS Code extension.
- `packages/zowe-mcp-evals`: ESM AI evaluation harness.
- `packages/zowe-mcp-e2e`: ESM end-to-end test support.

Keep server behavior transport-independent. Transport implementations belong in `packages/zowe-mcp-server/src/transports/`. z/OS operations must go through the `ZosBackend` interface rather than calling a concrete backend from a tool.

## MCP server rules

- Use full MCP SDK subpath imports, including the `.js` suffix. For example:

  ```typescript
  import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  ```

- Use `Logger` from `packages/zowe-mcp-server/src/log.ts` for logging. Never use `console.log` or `console.error` in the server.
- Read the server version from its `package.json`; do not add another version constant.
- Keep MCP tool, prompt, and resource names concise and camelCase. Do not add a redundant `zowe` prefix.
- Use existing shared helpers for system resolution, data set name resolution, response envelopes, pagination, progress, encoding, command safety, and caching. Do not create parallel implementations.

## Adding or changing tools

Tool components live under `packages/zowe-mcp-server/src/tools/<component>/`.

When adding or changing a tool:

1. Register it with `server.registerTool()`.
2. Declare `_meta.resourceEffectLevel` with the appropriate `ResourceEffect`. Do not set MCP read-only or destructive annotations manually; the capability filter derives them.
3. For backend I/O, report progress through `createToolProgress()` and pass the backend progress callback.
4. Start the description with a clear, complete summary sentence. The generated reference uses that sentence in its tools table.
5. Use `withPaginationNote()` for paginated descriptions. Do not duplicate the full pagination protocol in individual descriptions.
6. Follow the evaluation requirements in `CONTRIBUTING.md` when a change can affect LLM tool selection or arguments.

Register new z/OS-backed components inside the backend-enabled section of `packages/zowe-mcp-server/src/server.ts`, and expose the component through `getContext` when appropriate.

## Responses and data set handling

- When a tool returns structured success responses, provide an `outputSchema`. Use the component's scoped context schema and `wrapResponse()` so `content` and `structuredContent` agree.
- Return execution failures with `isError: true` and text content only. Do not attach `structuredContent` to an error.
- Use the response helpers in `packages/zowe-mcp-server/src/tools/response.ts` instead of constructing response envelopes manually.
- Include resolved data set values in `_context` only when normalization changed the input.
- Resolve and validate data set names with `resolveDsn()` or `resolvePattern()` from `packages/zowe-mcp-server/src/zos/dsn.ts`. Tool inputs use fully qualified data set names.
- Use the shared `SYSTEM_PARAM_DESCRIPTION` and `resolveSystemForTool()` for optional system selection.
- Apply line windowing and list pagination in the tool layer using the existing helpers. Respect `_result.hasMore` and continuation messages.

## Terminology

- In user-facing text, write **data set** as two words. Code identifiers use `dataset`.
- Use `dsn` for data set name identifiers, not `dsname`.
- Write **PDS** and **PDS/E**. When referring to both, write **PDS or PDS/E**. `PDSE` may remain an accepted input alias but must not appear in user-facing descriptions.
- Use **PO-E** only when referring to the DSORG value; explain it as PDS/E when needed.

## VS Code extension

- Event types shared by the server and extension are defined in `packages/zowe-mcp-server/src/events.ts`. When adding an event, update its union and the receiving side's handler.
- The Cursor MCP API is optional and is not part of the VS Code API. Guard calls through `vscode.cursor` before use.
- Do not edit generated `vscode.d.ts` or `vscode.proposed.*.d.ts` files.
- Build the server before compiling the extension when shared server types or events change.

## Generated files and validation

- Do not edit generated build output under `dist/`, `out/`, or the extension's bundled `server/` directory.
- `docs/mcp-reference.md` and `vendor/zowe/docs/mcp-reference-vendor.md` are generated. After changing MCP definitions, run `npm run generate-docs` and commit both results when they change.
- Use the root and workspace `package.json` scripts for validation. Follow the contribution and evaluation policies in `CONTRIBUTING.md`.
