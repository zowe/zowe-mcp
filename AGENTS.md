# Zowe MCP

Zowe MCP is an MCP server that gives AI assistants tools for z/OS (data sets,
jobs, z/OS UNIX), plus a VS Code extension that bundles it. This file holds
the rules and traps that you cannot infer from the code. Everything else is in
the code, the `package.json` scripts, and the documents linked at the end.

## Commands

```bash
node scripts/sdk-switch.js pin --no-install   # once per clone, BEFORE npm install
npm install
npm run build                                 # all packages; common builds first
npm run typecheck                             # covers tests; `build` does not
npm run lint                                  # ESLint and license headers
npm run check-format && npm run lint:md
npm test -- --no-file-parallelism             # server tests; parallel runs can stall locally
npx vitest run <file>                         # one test file, from packages/zowe-mcp-server
npm run generate-docs                         # after any tool, prompt, or resource change
```

- Run `typecheck`, `lint`, and the affected tests before you report a change as
  done. Say which of them you did not run.
- After `generate-docs`, commit `docs/mcp-reference.md` and
  `vendor/zowe/docs/mcp-reference-vendor.md`. CI fails when they are stale.
- Never edit `dist/`, `out/`, `packages/zowe-mcp-vscode/server/`, or
  `vscode*.d.ts`. They are generated.

## Packages

| Package | Module type | Role |
| --- | --- | --- |
| `packages/zowe-mcp-common` | CommonJS | Shared utilities. Builds first. |
| `packages/zowe-mcp-server` | ESM | The MCP server, `@zowe/mcp-server` |
| `packages/zowe-mcp-vscode` | CommonJS | VS Code extension. Imports event types from the built server. |
| `packages/zowe-mcp-evals` | ESM | Evaluation harness |
| `packages/zowe-mcp-e2e` | ESM | VS Code and Copilot end-to-end tests |

## Server rules

- Import the MCP SDK by full subpath with the `.js` suffix, for example
  `@modelcontextprotocol/sdk/server/mcp.js`.
- Log with `Logger` from `src/log.ts`. Never use `console.log` or
  `console.error`: stdout carries the JSON-RPC protocol in stdio mode.
- Tools call z/OS only through the `ZosBackend` interface. Transport code stays
  in `src/transports/`.
- Read the server version from its `package.json`. Do not add another version
  constant.
- Reuse the shared helpers for system resolution, data set names, response
  envelopes, pagination, progress, encoding, command safety, and caching. Do not
  write a second implementation.
- Avoid `any`. Prefer `T[]`, `interface`, and `??`.

## Adding or changing a tool

1. Register with `server.registerTool()` under `src/tools/<component>/`. Names
   are short camelCase without a `zowe` prefix.
2. Declare `_meta: { resourceEffectLevel: ResourceEffect.X }`. Never set
   `annotations` by hand; the capability filter derives them.
3. Start the description with one complete summary sentence. It becomes the row
   in the generated reference. For paginated tools, add `withPaginationNote()`
   instead of describing the protocol.
4. Declare an `outputSchema` and return success through `wrapResponse()`.
   Return failures as `{ content, isError: true }` without `structuredContent`.
5. Resolve data set names with `resolveDsn()` or `resolvePattern()`, and the
   optional `system` parameter with `resolveSystemForTool()` and
   `SYSTEM_PARAM_DESCRIPTION`. Put resolved names in `_context` only when
   resolution changed the input.
6. Report progress with `createToolProgress()`.
7. Register a new z/OS component inside the backend-enabled section of
   `src/server.ts`, and add it to the `getContext` component list.
8. Add the test to `__tests__/common.test.ts` so that it runs on every
   transport.
9. A change that an AI assistant can see (tool, description, parameter,
   prompt) needs evaluation results. See `CONTRIBUTING.md`.

## Terminology in user-facing text

- **data set** is two words. Identifiers use `dataset`, and `dsn`, not `dsname`.
- **PDS** and **PDS/E**; both together are "PDS or PDS/E". `PDSE` is accepted
  as input and never written. **PO-E** is only the DSORG value.

## VS Code extension

- Events shared with the server are defined in
  `packages/zowe-mcp-server/src/events.ts`. For a new event, update its union
  and the handler on the receiving side.
- `vscode.cursor` is not part of the VS Code API. Guard every use.

## Traps that the tests do not catch

- **The mock backend is plain files.** It cannot show record-format, block-size,
  or encoding defects. Verify those on a real z/OS system, or say that you did
  not.
- **Mock mode has no jobs.** Job tools need the mock z/OS host
  (`docs/mock-zos-host.md`) or a real system.
- **`call-tool` defaults to the `read-strict` tier.** Set
  `ZOWE_MCP_CAPABILITY_TIER=full` to reach mutating tools; otherwise they are
  "not found".
- **TSO accepts any unambiguous prefix of an operand keyword.** A command
  safety pattern that matches only the full keyword can be bypassed. Match
  every abbreviation, and match operand keywords only at the top level.
- **Tool descriptions stay neutral about the security product** (RACF, ACF2,
  Top Secret). Evaluation sets that need product knowledge state it in
  `config.systemPromptAddition`.
- **SSH keys in tests** come from `__tests__/helpers/ssh-test-keys.ts`. Keys
  from `ssh2.utils.generateKeyPairSync` are sometimes unparseable, and the
  failure then appears as a missing password.
- **`*-commands.yaml` files are not plug-in definitions.** Loading one as a
  tools file stops the server at startup.
- **ESLint findings silenced with `eslint-disable` still fail the `ESLint`
  code-scanning check** on lines that a pull request touches. In tests, assert
  on a local `vi.fn()` instead of `expect(obj.method)`.
- **Do not add `bundledDependencies` to a committed `package.json`.** The pack
  script adds it temporarily.
- **TypeScript stays below 6.0** until the `moduleResolution` migration.
- **USS command validation passes `platform: null`** to `hardstop-patterns`. USS
  is z/OS UNIX, not the operating system of the machine that runs the tests.
- **Never commit z/OSMF OpenAPI files** from `resources/zosmf/`. They belong to
  IBM.

## Working in this repository

- Sign off every commit (`git commit -s`).
- Keep this file short. Add a line only for a rule or trap that an agent would
  get wrong without it. Put explanations in `docs/` and area-specific rules in
  the nearest nested `AGENTS.md`.

## More

- `CONTRIBUTING.md`: setup, required checks, pull request and evaluation policy
- `docs/README.md`: index of all documentation
- `docs/how-to-add-cli-plugin.md`: Zowe CLI plug-ins as MCP tools
- `packages/zowe-mcp-evals/README.md`: evaluation method and model limits
- `vendor/zowe/AGENTS.md`: Db2 plug-in and vendor content
