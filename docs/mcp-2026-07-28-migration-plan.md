# Plan: MCP 2026-07-28 and TypeScript SDK v2

Status: draft for review, 2026-11-24. No code has changed.

This plan moves Zowe MCP from `@modelcontextprotocol/sdk` 1.x to the v2 SDK packages, and then to the [2026-07-28 revision](https://modelcontextprotocol.io/specification/2026-07-28) of the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). The work splits into two steps that ship separately.

## Summary

- **Step 1** replaces the SDK packages and keeps the wire protocol at 2025-11-25. It is mostly mechanical. Target: merged before 2027-01-27.
- **Step 2** makes the server speak 2026-07-28. It changes how tools ask the user for input and how HTTP keeps state. It has no fixed date.
- **One decision is open:** how HTTP keeps per-user state once sessions are gone. See [Open decisions](#open-decisions).

## Timing

- **SDK 1.x support.** The [v2 SDK README](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/README.md) promises fixes for 1.x "for at least six months after the v2 release (2026-07-27)". The guarantee ends on 2027-01-27. Zowe MCP is on `^1.32.1`.
- **Wire protocol.** A v2 server built the way Zowe MCP builds it today keeps speaking 2025-11-25. The 2026-07-28 revision is an explicit opt-in through new entry points.
- **Deprecations.** Logging, Roots and Sampling are deprecated by [SEP-2577](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2577) and stay in the specification for at least twelve months from 2026-07-28.
- **Clients.** Which protocol generation VS Code Copilot and Claude Code negotiate is unconfirmed. Settle it by measurement before step 2c: probe a live session with `server/discover`, or connect the v2 client SDK and read `getProtocolEra()`. Record the client versions tested.

## Step 1: SDK v1 to v2 on the same wire protocol

### Scope

- 51 files import the SDK: 25 server sources, 25 server tests, 1 file in `packages/zowe-mcp-evals`. The VS Code extension imports none.
- Zod `^4.6.2` and Node 24 already meet the v2 requirements (Zod 4.2 or later, Node 20 or later).
- The v2 packages resolve through the Zowe Artifactory registry in `.npmrc` (checked: `@modelcontextprotocol/server` 2.4.0).

### Work

- **Run the codemod** at the repository root: `npx @modelcontextprotocol/codemod@latest v1-to-v2 .`. It rewrites import paths and renames the handler argument `extra` to `ctx` (52 reads of `extra._meta?.progressToken`).
- **Edit workspace manifests by hand.** The codemod rewrites one `package.json` and lists what the others need.
- **Move the HTTP transport** to `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`. The session map in `transports/http.ts` stays as it is.
- **Re-check the bundle.** `@modelcontextprotocol/node` brings in `hono` and `@hono/node-server`. Run `npm run test:airgap:build` and compare the tarball and VSIX sizes.
- **Resolve every `@mcp-codemod-error` marker** the codemod leaves behind.

### Guards to add in step 1

- **Tools registered after connect.** The Zowe Explorer tools register at runtime on stdio. The SDK throws `Cannot register capabilities after connecting to transport` when the first tool, prompt or resource of a kind is registered after connect, because that is when it declares the capability. Zowe MCP always registers `getContext` before connect, so `tools` with `listChanged: true` is already declared and later tools register normally. Add a stdio test that registers a tool after connect and expects the list-changed notification, so the upgrade proves it. A server that registers nothing before connect needs a placeholder tool that it removes before connecting.
- **Response size on stdio.** The client's `ReadBuffer` closes the connection when one message passes 10 MB. This is the client's default in SDK 1.x and v2, and the server cannot raise it. `wrapResponse()` sends the payload twice, in `content` and in `structuredContent`, so the wire size is about twice the visible size. Measure the serialized result in one place and return an `isError` result that asks for a smaller window when it passes 8 MB. Check `getJobOutput`, `readJobFile`, `runSafeTsoCommand` and the CLI bridge results first.
- **Zod floor.** v2 needs Zod 4.2 or later. With Zod 4.0 or 4.1 the server still starts, and the `.describe()` text of every parameter is dropped from `tools/list` with only a one-time console warning. Zowe MCP is on `^4.6.2`. Add a test that reads `tools/list` and expects a known parameter description, so a lockfile regression fails CI.

### Behavior changes to expect in tests and evals

| Change in v2 | Where it shows in Zowe MCP |
| --- | --- |
| A call to an unknown or disabled tool is rejected with `-32602`. In v1 it returned a result with `isError: true`. | Tools hidden by the capability tier; `call-tool`; eval runs where the model calls a hidden tool. |
| `listChanged: true` is advertised for tools, prompts and resources by default. | Tests that pin the capabilities in the initialize result. |
| Error messages no longer start with `MCP error <code>:`. | Tests and evals that match error text. |
| The client `listTools()` fetches every page in one call. | The eval harness and tests that page by hand. |
| Handlers that are still running are aborted when the transport closes. | Long-running tools such as `submitJob` with `wait: true`. |

### Done when

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:vscode` pass.
- `npm run test:airgap:build` passes and the size change is recorded in the pull request.
- `npm run generate-docs` produces no diff.
- A native smoke test passes on a real z/OS system, including a password prompt.

## Step 2: serve 2026-07-28

The v2 SDK serves 2026-07-28 through two entry points. Each takes a factory that builds the server, and each also serves 2025 clients.

- **stdio:** `serveStdio(factory)` replaces `server.connect(new StdioServerTransport())`. One server instance stays pinned to the connection.
- **HTTP:** `createMcpHandler(factory)` builds a fresh server for every request. There is no `Mcp-Session-Id`.

The differences between the two protocol generations are in one table in the SDK's [Protocol versions](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/protocol-versions.md) page. The details behind this step are in [Supporting protocol revision 2026-07-28](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/migration/support-2026-07-28.md).

### 2a. Asking the user for input

The 2026-07-28 revision removes requests from server to client. A handler that needs input returns `inputRequired(...)`. The client collects the answers and calls the tool again, and the handler runs from the top with the answers in `ctx.mcpReq.inputResponses`.

Zowe MCP awaits `elicitInput()` in the middle of a handler in nine places:

| Prompt | File | Raised from |
| --- | --- | --- |
| Password (form and URL mode) | `zos/native/password-elicitation.ts`, `index.ts` | The credential provider, below any tool |
| Job card | `index.ts` | The job card resolver, below `submitJob` |
| Command approval | `tools/tso/tso-tools.ts`, `tools/console/console-tools.ts`, `tools/uss/uss-tools.ts` (two) | The tool handler |
| Too many results | `tools/cli-bridge/cli-tool-loader.ts` | The cache fetch callback, after the CLI has run |

Plan:

- **Handler-level prompts** (command approval) return `inputRequired(...)` directly.
- **Deep prompts** (password, job card) throw an internal "input needed" signal. The existing `registerTool` wrapper in `server.ts` catches it and returns `inputRequired(...)`.
- **Re-entry must be safe.** The password, job card and approval prompts are raised before the z/OS action, so a second run repeats nothing. The CLI bridge prompt is raised after the CLI call, so its result must be kept for the second round or the call runs twice.
- **State between rounds** travels in `requestState`, signed with the SDK's `createRequestStateCodec`. It holds no secrets: the client can read it.
- **URL-mode password prompts** move to `inputRequired.elicitUrl(...)`. The browser page at `/zowe-mcp/password-elicit/:id` stays. `createElicitationCompletionNotifier` is used only for 2025 clients.
- **Workspace roots** in `tools/local-files/local-file-tools.ts` use `inputRequired.listRoots()`, with `ZOWE_MCP_WORKSPACE_DIR` and `--local-files-root` as the path that lasts, because Roots is deprecated.

- **A decline is not always a person saying no.** Claude Code declares the elicitation capability and answers every request with `decline` in some sessions ([anthropics/claude-code#79174](https://github.com/anthropics/claude-code/issues/79174), closed as not planned). The server cannot tell that from a user's refusal. This affects the command-approval prompts and is tracked in [#155](https://github.com/zowe/zowe-mcp/issues/155). The rewrite keeps one code path for "declined" and words the tool error so that it is correct in both cases.

The SDK serves handlers written this way to 2025 clients too, on stdio and on HTTP with sessions. This part can therefore ship and be tested with today's clients, before 2b and 2c.

### 2b. Client identity and logging

- **Client identity.** `getClientCapabilities()` and `getClientVersion()` are read in nine files. On a 2026-07-28 request both return `undefined`, and the values arrive per request in `ctx.mcpReq.envelope`. Add one helper that reads either source and use it at every site, including the VS Code detection in `password-elicitation.ts`.
- **Logging to the client.** A 2026-07-28 client receives log notifications only for requests that carry a log level. stderr and the VS Code pipe remain the record, as `docs/mcp-server-logging-guidelines.md` recommends. Replace the process-wide `logger.attach(server)` with logging through the request context.

### 2c. Entry points and state

- **stdio.** Switch to `serveStdio`. Keep a reference to the pinned server so the Zowe Explorer tools can still be registered at runtime; the SDK forwards the resulting change notifications to clients that subscribed.
- **HTTP.** Switch to `createMcpHandler` behind the existing [JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519) check and the DNS-rebinding guard. Per-tenant backends, credentials and job cards are already keyed by the token subject and need no change.
- **Session state.** `SessionState` holds the active system, the user per system, the encoding overrides and the z/OS UNIX working directory. It is created once per MCP session today. With a server per request it must live somewhere else. This is the open decision below.
- **Cache hints.** Every cacheable 2026-07-28 result carries `ttlMs` and `cacheScope`. Keep `cacheScope: 'private'`, because the tool list depends on the tenant and the capability tier, and set a short `ttlMs` for `tools/list`.

### 2d. Tests

- `InMemoryTransport` connects 2025-era instances only. It is used in 12 test files and stays for them.
- Add two providers to `__tests__/transport-providers.ts`: `createMcpHandler` driven through its `fetch` function, and a spawned `serveStdio` process. `common.test.ts` then runs on both protocol generations.
- Add a round-trip test for each prompt in 2a: first call returns `input_required`, second call completes, and the z/OS action runs once.
- Add the decline cases for each prompt: a client that declines at once without showing anything, and a user who cancels. The z/OS action must not run in either.

### Release gate

- **Test with a real older client before switching.** The specification does not say what a 2025 client sees from a 2026-07-28 server, so the SDK's behavior is the only definition. Before a release that switches an entry point, run the stdio and HTTP smoke tests with a released client that speaks 2025-11-25, including one password prompt and one command approval.
- **Record the result of the client probe** from [Timing](#timing) in the pull request.

## Open decisions

### HTTP state without sessions

Deferred on 2026-11-24. It blocks 2c for HTTP and nothing else.

| Option | Effect |
| --- | --- |
| Key the state by token subject | `setSystem` and `changeUssDirectory` keep working. Two chat windows of one user share an active system. HTTP without authentication gets one shared state. |
| Stateless HTTP tools | Callers pass `system` on every call and paths are absolute. Tool behavior and descriptions differ between stdio and HTTP. |
| Keep both paths | Today's transport with sessions serves 2025 clients, routed with `isLegacyRequest`. A second path serves 2026-07-28 with state keyed by subject. Two HTTP code paths to maintain. |

## Order of work

1. Step 1, as one pull request.
2. Step 2a, still on the 2025-11-25 wire protocol.
3. Step 2b.
4. Decide the HTTP state model.
5. Step 2c and 2d.

## Out of scope

- The tool manifest and the shared SDK in `docs/mainframe-mcp-sdk-plan.md`.
- Server cards and `server/discover` tuning beyond what the SDK sends by default.
- The Skills extension added in SDK 2.4.0.
- New authorization features of the v2 SDK. Zowe MCP keeps its own JWT validation.

## Sources

- [MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) and its [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- TypeScript SDK at tag `v2.4.0`: [migration guides](https://github.com/modelcontextprotocol/typescript-sdk/tree/v2.4.0/docs/migration), [upgrade references](https://github.com/modelcontextprotocol/typescript-sdk/tree/v2.4.0/skills/mcp-typescript-sdk-upgrade-to-v2/references), [input_required](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/servers/input-required.md), [legacy clients](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/serving/legacy-clients.md), [server changelog](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/packages/server/CHANGELOG.md)
- File counts come from a search of `main` at `eed33dd`. The codemod has not been run.
