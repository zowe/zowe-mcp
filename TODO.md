# TODO

Items to address later. Not ordered by priority.

## Zowe Native / SDK

- **Deploy ZNP via ZSshUtils**: Use `ZSshUtils.installServer` to deploy the Zowe Native Protocol (znp) to systems where it does not exist yet.
- **listDatasets member-name pattern**: The Zowe Native SDK does not expose a member-name pattern parameter; pattern filtering is done client-side after the RPC (with `*` and `%`). Discuss with Dan if we want to support it at the native level.
- **listDatasets error messages**: Confirm whether listDatasets returns useful error messages (e.g. invalid dataset name or invalid pattern). Good error messages help the AI agent or human fix parameters. Can be done in the MCP server, but native-level support is the desired choice for everyone.
- ✅ **listDatasets attributes**: Follow up with Dan: attributes are not returned by Zowe Native listDatasets. Exposing them would help the AI agent reason about datasets (e.g. type, format)
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

- **Language Model API and Chat Participant API**: Consider using VS Code’s Language Model API and Chat Participant API for a better user experience.
- **Zowe Explorer integration — open in editor**: Integrate with Zowe Explorer so the AI (or user) can open z/OS artifacts in the VS Code editor for manual view/edit. For example: "open this dataset/member in the editor" or "show me that job's output" could trigger opening the dataset member, USS file, or job/job file in Zowe Explorer's editor. Ideas: MCP tools or extension commands that resolve a DSN/member, USS path, or job/spool ID and then invoke Zowe Explorer's "open" behavior (e.g. via VS Code API or Zowe Explorer's own commands/URI scheme), so the user can inspect or edit in the existing Zowe Explorer experience instead of only in chat.

## Authentication / UX

- ✅ **Re-prompt on invalid password**: When the password is invalid, prompt to enter the password again in the same way as when the password is missing in VS Code — ideally before failing the action. Standalone MCP server should keep invalid passwords blacklisted. Research MCP elicitation for obtaining a new password.
- **Remote server with Zowe API ML and OIDC**: Support authentication in remote MCP server scenarios using Zowe API Mediation Layer and OIDC.
- **Remote MCP credentials**: Research ways for a remote MCP server to request credentials without giving them to the LLM or storing them insecurely.

## Pagination, search & editing

- ✅  **Consider removing relative DSN and dsnPrefix**: The concept of DSN relative to a dsnPrefix (and the dsnPrefix itself) may be confusing models; e.g. Qwen3 needs several tool calls to get it right. Consider removing relative-DSN resolution and dsnPrefix from the MCP tools so that dataset names are always fully qualified (e.g. require `'USER.SRC.COBOL'`-style input only). The model that add quotes to the parameters and get quoted DSNs as output still change it back to unquoted absolute names in the response.
- ✅ **Pagination — review and Copilot usability**: Review how pagination is implemented (`listDatasets` / `listMembers` offset, limit, `hasMore`) and whether Copilot can effectively use it. Key question: *When the user asks for a dataset that is not on the first page (or not matched by wildcards alone), does the agent reliably use offset/limit and `hasMore` to keep fetching until it finds the target or exhausts results?* Validate with real Copilot sessions and improve tool descriptions or response shape if needed.
- **Search tools**: Add tool(s) to find datasets that contain a specific member (e.g. by name or pattern). Inputs: list of datasets and/or DSN/member wildcards; output: datasets that have matching members.
- **Working set**: Introduce a concept of a working set — a defined set of datasets (with optional member subset or wildcards) that can be reused as input for search or other operations (e.g. “search in my working set”).
- **Efficient editing**: Support efficient, targeted edits similar to Ansible’s `ansible.builtin.replace` (change multiple similar lines by pattern) and `ansible.builtin.blockinfile` (insert/update/remove a block of lines). Avoid full read–edit–write when only a few lines or one block change; reduce risk of corrupting large datasets.
- **Viewing binary files (hex mode)**: Support viewing binary datasets and USS files in hex mode (e.g. hex dump or hex+ASCII) so the AI or user can inspect non-text content (load modules, binary data) without corrupting or misinterpreting bytes as text.
- **Editing files with unprintable characters**: Support reading and editing dataset members or USS files that contain unprintable/control characters (e.g. EBCDIC control chars, mixed binary and text). Today unprintables are replaced with `.` for display; allow a mode or encoding that preserves or represents them for safe round-trip edit (e.g. escape sequences, hex in place, or binary-safe read/write path).

## Features / Components

- ✅ **System parameter: accept FQDN or unqualified**: All tools that take a system parameter should accept both fully qualified hostnames (FQDN) or unqualified hostnames, consistent with `setSystem` behavior, so the agent can use either form.
- ✅ **Jobs component**: Implement `jobs` tool component (submit job, list jobs, get job output, etc.) as in AGENTS.md; register in server when backend supports it.
- ✅ **USS component**: Implement `uss` (UNIX System Services) tool component for file/path operations on z/OS; register in server when backend supports it.
- ✅ **Native backend — full ZosBackend**: Implement remaining `ZosBackend` methods in `NativeBackend`: `readDataset`, `writeDataset`, `createDataset`, `deleteDataset`, `getAttributes`, `copyDataset`, `renameDataset`. Currently only `listDatasets` and `listMembers` are implemented; others throw "Not implemented".
- **Upload from local filesystem**: Add tool(s) to upload files and datasets from the local filesystem to z/OS — e.g. upload a local file to a USS path, upload a local file or directory to a PDS/PDSE (multiple members), upload a local file to a sequential dataset. Enables “copy from my machine to mainframe” workflows for single files, directories, and multi-member datasets.
- **z/OSMF backend**: Add a `ZosBackend` implementation using z/OSMF REST APIs (e.g. Data Set and File REST) for environments where SSH/native is not desired.
- **Credential providers**: Implement `ZoweTeamConfigProvider` and/or `OAuthTokenProvider` (see `src/zos/credentials.ts`); currently only mock and native credential providers exist.

## HTTP Transport

- **HTTP transport auth**: Add authentication/authorization for the HTTP transport (`POST /mcp`) so remote clients cannot use the server without credentials.
- **HTTP session cleanup**: Consider session timeout or max-session limits so long-lived or abandoned sessions do not accumulate indefinitely.

## Documentation & Maintenance

- **MCP SDK v2**: MCP SDK v1.x is stable and SDK `main` is v2 pre-alpha. When v2 is stable, evaluate migration and update dependencies.
- **Mock config hot-reload**: Currently changing `zoweMCP.mockDataDirectory` requires restarting the MCP server; consider supporting config/systems change without full restart if feasible.
