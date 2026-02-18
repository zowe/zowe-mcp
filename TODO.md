# TODO

Items to address later. Not ordered by priority.

## Zowe Native / SDK

- **Deploy ZNP via ZSshUtils**: Use `ZSshUtils.installServer` to deploy the Zowe Native Protocol (znp) to systems where it does not exist yet.
- **listDatasets member-name pattern**: The Zowe Native SDK does not expose a member-name pattern parameter; pattern filtering is done client-side after the RPC (with `*` and `%`). Discuss with Dan if we want to support it at the native level.
- **listDatasets error messages**: Confirm whether listDatasets returns useful error messages (e.g. invalid dataset name or invalid pattern). Good error messages help the AI agent or human fix parameters. Can be done in the MCP server, but native-level support is the desired choice for everyone.
- **listDatasets attributes**: Follow up with Dan: attributes are not returned by Zowe Native listDatasets. Exposing them would help the AI agent reason about datasets (e.g. type, format).

## Security / Infrastructure

- **Pipe path security**: Review `/tmp` usage for named pipes — ensure the path is secure and the name is really unique (e.g. `/tmp/zowe-mcp-<workspaceId>.sock`).

## Testing

- **Copilot resources and prompts**: Test how the current resources and prompts work in GitHub Copilot.
- **Windows**: Test on Windows — mainly the named pipe behavior.
- **Other AI assistants**: Test with Cline (VS Code) and with Claude Desktop / Claude Code.
- **Password error messages**: Validate that the password error messages match what really happens when errors occur.
- **Tool description quality**: Evaluate tool descriptions; see how Code4z Assistant does it for reference.
- **z/OS integration tests**: Add or run z/OS integration tests.

## VS Code / UX

- **Language Model API and Chat Participant API**: Consider using VS Code’s Language Model API and Chat Participant API for a better user experience.

## Authentication / UX

- **Re-prompt on invalid password**: When the password is invalid, prompt to enter the password again in the same way as when the password is missing in VS Code — ideally before failing the action. Standalone MCP server should keep invalid passwords blacklisted. Research MCP elicitation for obtaining a new password.
- **Remote server with Zowe API ML and OIDC**: Support authentication in remote MCP server scenarios using Zowe API Mediation Layer and OIDC.
- **Remote MCP credentials**: Research ways for a remote MCP server to request credentials without giving them to the LLM or storing them insecurely.

## Features / Components

- **Jobs component**: Implement `jobs` tool component (submit job, list jobs, get job output, etc.) as in AGENTS.md; register in server when backend supports it.
- **USS component**: Implement `uss` (UNIX System Services) tool component for file/path operations on z/OS; register in server when backend supports it.
- **Native backend — full ZosBackend**: Implement remaining `ZosBackend` methods in `NativeBackend`: `readDataset`, `writeDataset`, `createDataset`, `deleteDataset`, `getAttributes`, `copyDataset`, `renameDataset`. Currently only `listDatasets` and `listMembers` are implemented; others throw "Not implemented".
- **z/OSMF backend**: Add a `ZosBackend` implementation using z/OSMF REST APIs (e.g. Data Set and File REST) for environments where SSH/native is not desired.
- **Credential providers**: Implement `ZoweTeamConfigProvider` and/or `OAuthTokenProvider` (see `src/zos/credentials.ts`); currently only mock and native credential providers exist.

## HTTP Transport

- **HTTP transport auth**: Add authentication/authorization for the HTTP transport (`POST /mcp`) so remote clients cannot use the server without credentials.
- **HTTP session cleanup**: Consider session timeout or max-session limits so long-lived or abandoned sessions do not accumulate indefinitely.

## Documentation & Maintenance

- **MCP SDK v2**: MCP SDK v1.x is stable and SDK `main` is v2 pre-alpha. When v2 is stable, evaluate migration and update dependencies.
- **Mock config hot-reload**: Currently changing `zowe-mcp.mockDataDir` requires restarting the MCP server; consider supporting config/systems change without full restart if feasible.
