# TODO

Items to address later. Not ordered by priority.

## Zowe Native / SDK

- ✅ **Deploy ZNP via ZSshUtils**: Implemented in `ssh-client-cache.ts` — auto-redeploy via `ZSshUtils.installServer` when remote checksums mismatch.
- ✅ **listDatasets member-name pattern**: Implemented client-side in `native-backend.ts` using `memberPatternToRegExp()` after the RPC; also passes `pattern` to ZNP `listDsMembers` for server-side filtering.
- **listDatasets error messages**: Confirm whether listDatasets returns useful error messages (e.g. invalid data set name or invalid pattern). Good error messages help the AI agent or human fix parameters. Can be done in the MCP server, but native-level support is the desired choice for everyone.
- ✅ **listDatasets attributes**: Follow up with Dan: attributes are not returned by Zowe Native listDatasets. Exposing them would help the AI agent reason about data sets (e.g. type, format)
- List the first segments (names of catalogs).

## Security / Infrastructure

- **Pipe path security**: Review `/tmp` usage for named pipes — ensure the path is secure and the name is really unique (e.g. `/tmp/zowe-mcp-<workspaceId>.sock`).

## Testing

- **Copilot resources and prompts**: Test how the current resources and prompts work in GitHub Copilot.
- **Windows**: Test on Windows — mainly the named pipe behavior.
- **Other AI assistants**: Test with Cline (VS Code) and with Claude Desktop / Claude Code.
- ✅ **Password error messages**: Validate that the password error messages match what really happens when errors occur.
- ✅ **Tool description quality**: Evaluate tool descriptions; see how Code4z Assistant does it for reference.
- ✅ **z/OS integration tests**: Add or run z/OS integration tests. (Native stdio E2E tests)

## VS Code / UX

- **Language Model API and Chat Participant API**: Consider using VS Code's Language Model API and Chat Participant API for a better user experience.
- ✅ **Zowe Explorer integration — open in editor**: Integrate with Zowe Explorer so the AI (or user) can open z/OS artifacts in the VS Code editor for manual view/edit. For example: "open this data set/member in the editor" or "show me that job's output" could trigger opening the data set member, USS file, or job/job file in Zowe Explorer's editor. Ideas: MCP tools or extension commands that resolve a DSN/member, USS path, or job/spool ID and then invoke Zowe Explorer's "open" behavior (e.g. via VS Code API or Zowe Explorer's own commands/URI scheme), so the user can inspect or edit in the existing Zowe Explorer experience instead of only in chat.

## Authentication / UX

- ✅ **Re-prompt on invalid password**: When the password is invalid, prompt to enter the password again in the same way as when the password is missing in VS Code — ideally before failing the action. Standalone MCP server should keep invalid passwords blacklisted. Research MCP elicitation for obtaining a new password.
- **Remote server with Zowe API ML and OIDC**: Support authentication in remote MCP server scenarios using Zowe API Mediation Layer and OIDC.
- **Remote MCP credentials**: Research ways for a remote MCP server to request credentials without giving them to the LLM or storing them insecurely.

## Pagination, search & editing

- ✅  **Consider removing relative DSN and dsnPrefix**: The concept of DSN relative to a dsnPrefix (and the dsnPrefix itself) may be confusing models; e.g. Qwen3 needs several tool calls to get it right. Consider removing relative-DSN resolution and dsnPrefix from the MCP tools so that data set names are always fully qualified (e.g. require `'USER.SRC.COBOL'`-style input only). The model that add quotes to the parameters and get quoted DSNs as output still change it back to unquoted absolute names in the response.
- ✅ **Pagination — review and Copilot usability**: Review how pagination is implemented (`listDatasets` / `listMembers` offset, limit, `hasMore`) and whether Copilot can effectively use it. Key question: *When the user asks for a data set that is not on the first page (or not matched by wildcards alone), does the agent reliably use offset/limit and `hasMore` to keep fetching until it finds the target or exhausts results?* Validate with real Copilot sessions and improve tool descriptions or response shape if needed.
- **Search tools**: Add tool(s) to find data sets that contain a specific member (e.g. by name or pattern). Inputs: list of data sets and/or DSN/member wildcards; output: data sets that have matching members.
- **Multi-dataset search**: Support searching for a string across multiple data sets in a single tool call (e.g. provide a list of DSNs or a DSN pattern and search all matching data sets).
- **Working set**: Introduce a concept of a working set — a defined set of data sets (with optional member subset or wildcards) that can be reused as input for search or other operations (e.g. "search in my working set").
- **Efficient editing**: Support efficient, targeted edits similar to Ansible's `ansible.builtin.replace` (change multiple similar lines by pattern) and `ansible.builtin.blockinfile` (insert/update/remove a block of lines). Avoid full read–edit–write when only a few lines or one block change; reduce risk of corrupting large data sets.
- **Viewing binary files (hex mode)**: Support viewing binary data sets and USS files in hex mode (e.g. hex dump or hex+ASCII) so the AI or user can inspect non-text content (load modules, binary data) without corrupting or misinterpreting bytes as text.
- **Editing files with unprintable characters**: Support reading and editing data set members or USS files that contain unprintable/control characters (e.g. EBCDIC control chars, mixed binary and text). Today unprintables are replaced with `.` for display; allow a mode or encoding that preserves or represents them for safe round-trip edit (e.g. escape sequences, hex in place, or binary-safe read/write path).

## Features / Components

- ✅ **System parameter: accept FQDN or unqualified**: All tools that take a system parameter should accept both fully qualified hostnames (FQDN) or unqualified hostnames, consistent with `setSystem` behavior, so the agent can use either form.
- ✅ **Jobs component**: Implement `jobs` tool component (submit job, list jobs, get job output, etc.) as in AGENTS.md; register in server when backend supports it.
- **Job step results (CC per step)**: Check if there is a way to get condition codes (CC) for each job step to help focus on failed steps.
- ✅ **USS component**: Implement `uss` (UNIX System Services) tool component for file/path operations on z/OS; register in server when backend supports it.
- ✅ **Native backend — full ZosBackend**: Implement remaining `ZosBackend` methods in `NativeBackend`: `readDataset`, `writeDataset`, `createDataset`, `deleteDataset`, `getAttributes`, `copyDataset`, `renameDataset`. Currently only `listDatasets` and `listMembers` are implemented; others throw "Not implemented".
- **Upload from local filesystem**: Add tool(s) to upload files and data sets from the local filesystem to z/OS — e.g. upload a local file to a USS path, upload a local file or directory to a PDS or PDS/E (multiple members), upload a local file to a sequential data set. Enables "copy from my machine to mainframe" workflows for single files, directories, and multi-member datasets.
- **z/OSMF backend**: Add a `ZosBackend` implementation using z/OSMF REST APIs (e.g. Data Set and File REST) for environments where SSH/native is not desired.
- **Credential providers**: Implement `ZoweTeamConfigProvider` and/or `OAuthTokenProvider` (see `src/zos/credentials.ts`); currently only mock and native credential providers exist.

## HTTP Transport

- **HTTP transport auth**: Add authentication/authorization for the HTTP transport (`POST /mcp`) so remote clients cannot use the server without credentials.
- **HTTP session cleanup**: Consider session timeout or max-session limits so long-lived or abandoned sessions do not accumulate indefinitely.

## Documentation & Maintenance

- **MCP SDK v2**: MCP SDK v1.x is stable and SDK `main` is v2 pre-alpha. When v2 is stable, evaluate migration and update dependencies.
- **Mock config hot-reload**: Currently changing `zoweMCP.mockDataDirectory` requires restarting the MCP server; consider supporting config/systems change without full restart if feasible.
- ✅ **Format tables in generated doc**: The `generate-docs` script now formats all Markdown tables consistently using `markdown-table-prettify` (via the `markdown-table-formatter` devDependency).

## Code Quality / Refactoring

- ✅ **Extract `extensionClient?` conditions**: Extracted to `buildNativeExtensionCallbacks()` (loadNative callback options) and `setupExtensionEventHandlers()` (single consolidated event dispatch) in `index.ts`.
- ✅ **Extract `withCache()` helper**: Added `withCache()` to `response-cache.ts`; replaced 4 ternaries in `dataset-tools.ts`, 2 in `uss-tools.ts`, and simplified the TSO execute-or-cache block in `tso-tools.ts`.
- **Shared utils package**: `plural()` and logger formatting exist in both `zowe-mcp-server` and `zowe-mcp-evals`; consider a shared `zowe-mcp-common` package or import from server.
- **Code duplication detection**: Find or build a tool that AI agents can use to detect code duplication (exact or intent-based) across the codebase.

## Tool Design & Agent UX

- **Dynamic tool definitions**: Update tools dynamically to include current defaults and known systems/connections in tool descriptions, so the LLM has full context without needing to call `getContext` first.
- **Configurable safety for TSO/USS/JCL**: Make command safety patterns (block/elicit/safe) configurable per user or environment, so organizations can customize what commands require approval.
- **TSO command reference/discovery**: Help agents discover available TSO commands and their syntax — provide a reference tool, prompt, or resource so the agent does not have to guess.
- ✅ **Merge `info` with `getContext`**: Merged — `getContext` now includes a `server` object (name, version, description, components, backend) and is always registered. The `info` tool and `src/tools/core/zowe-info.ts` have been removed.
- **Dev/test vs production system awareness**: Allow systems to be tagged as dev/test or production so the server (or agent) can apply different safety levels or warnings for production systems with financial or health data.
- ✅ **Monolithic context refactoring**: Scoped `_context` output schemas per component: `baseContextSchema` (jobs/TSO/console — system only), `datasetContextSchema` (datasets — system + resolvedPattern/resolvedDsn/resolvedTargetDsn), `ussContextSchema` (USS — system + resolvedPath/currentDirectory/listedDirectory). Runtime code unchanged; only Zod output schemas narrowed.
- ✅ **PDS/E naming consistency / glossary**: Ensure consistent naming across all tools and docs (user ID, PDS/E vs PDSE, USS vs z/OS USS). Consider adding a glossary resource or prompt.

## Evals

- **LLM-as-a-judge assertion**: Add an assertion type that uses a different (potentially stronger) model to judge whether the answer is correct, beyond simple pattern matching.
- **Eval self-reflection step**: When an assertion fails, call the same or a stronger model to investigate why — suggest improvements to assertions, descriptions, or tools. Context: chat session, tool defs, model thinking, question, assertions, and error.
- **Explicit tool calls for eval setup**: Add explicit tool calls for setup or data-fetching in assertions (similar to how Ansible can access results of commands), so evals can verify state before and after.
- ✅ **Document eval-compare**: Documented in `packages/zowe-mcp-evals/README.md` — CLI options, examples, outputs (comparison report + scoreboard), typical workflow, and key findings.
- **Case-insensitive pattern matching in eval assertions**: Support case-insensitive matching for command argument assertions (e.g. `D T` vs `d t` in console commands).
- **`validDsn` assertion directive**: Add a special assertion directive for validating data set names in eval assertions, so questions don't need to enumerate all valid forms.
