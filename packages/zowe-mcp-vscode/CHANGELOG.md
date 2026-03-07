# Change Log

All notable changes to the Zowe MCP extension will be documented in this file.

## `0.6.0`

### New features and enhancements

- **SMS allocation parameters**: `createDataset` and `createTempDataset` now accept SMS parameters — `volser`, `dataclass`, `storclass`, and `mgmtclass` — for site-managed storage allocation.
- **Restore migrated data sets**: New `restoreDataset` tool recalls migrated (HSM) data sets.
- **Copy USS files**: New `copyUssFile` tool copies USS files or directories with options for recursive, follow symlinks, preserve attributes, and force.
- **Search context lines**: `searchInDataset` supports `includeContextLines` option to return surrounding lines (±6) for each match, powered by SuperC LPSF.
- **Auto-redeploy Zowe Native server**: When the remote z/OS server is outdated (checksum mismatch with the local SDK), the server automatically redeploys and reconnects.
- **Improved tool descriptions**: Dataset creation parameters include expanded z/OS terminology (e.g. "Record Format (RECFM)", "Logical Record Length (LRECL) in bytes") to help AI models select correct parameters.
- **MCP server instructions**: The server sends pagination protocol instructions at initialization so AI clients understand how to page through large results.
- **Generate MCP reference docs**: New `generate-docs` command auto-generates a Markdown reference of all MCP tools, prompts, resources, and resource templates.

## `0.5.0`

### New features and enhancements

- **Status bar**: Active Zowe MCP connection is shown in the VS Code status bar; the extension notifies when the active connection changes.
- **Startup notification**: When no Zowe MCP connections (native or mock) are configured, a notification is shown to help you set up.
- **submitJob wait**: `submitJob` can wait for the job to reach OUTPUT with optional `wait: true` and `timeoutSeconds`; the former `executeJob` flow is merged into `submitJob`.
- **DSN(MEMBER) syntax**: Data set tools accept fully qualified names in the form `USER.DSN(MEMBER)` so you can pass data set and member in a single parameter.
- **Abend handling and CEEDUMP**: When the Zowe Native server on z/OS abends, the MCP server detects it, collects the CEEDUMP to a local file, and notifies the extension; you can open the dump from the notification.
- **Improvement prompt**: New prompt for reflecting on Zowe MCP usage (e.g. in Cursor or Copilot).
- **Reset command**: New command **Zowe MCP: Reset All Settings and State** to clear stored passwords and reset extension state.
- **Zowe Native**: Extended SSH response timeout for initial connections to allow more time to auto-deploy the Zowe Native server when it is not yet installed.

## `0.4.0`

### New features and enhancements

- **Cursor IDE support**: The extension automatically registers the Zowe MCP server when used in Cursor, so MCP tools are available without extra setup.
- **MCP output schemas**: All tools now declare structured output schemas so AI clients can validate and use tool responses reliably.
- **Dynamic Zowe Explorer tools**: Open-in-editor tools (data set, USS file, job) are registered when Zowe Explorer is installed or activated; no need to restart the MCP server.
- **Tool-call logging**: Optional logging of full tool request and response (enabled via server option or `ZOWE_MCP_LOG_TOOL_CALLS=1`) for debugging.

## `0.3.0`

### New features and enhancements

- **Zowe Explorer — open in editor**: Open data set members, USS files, and job output in the VS Code editor from MCP tools (e.g. “open this data set in the editor”). Requires Zowe Explorer; profile resolution is cached per system.
- **TSO command tools**: New `runSafeTsoCommand` tool runs TSO commands with safety validation (block/elicit/safe). Dangerous commands are blocked; others may require user confirmation. Output is paginated.
- **Jobs tools**: Submit jobs, get status, list jobs and job files, read and search job output, get JCL, and cancel/hold/release/delete jobs. Job card can be configured per connection (VS Code setting or config file); when JCL has no JOB card, the server prepends it. `executeJob` submits and waits for OUTPUT with configurable timeout.
- **USS (UNIX System Services) tools**: List, read, write, create, and delete USS files; run safe USS commands; temp file/dir helpers; get USS home; change current directory. Paths can be absolute or relative to the current USS directory.
- **Temporary dataset tools**: Create and delete temporary data sets (prefix, unique name, create temp PS, PDS, or PDS/E, delete under prefix) for short-lived workflows.
- **Progress and UX**: MCP progress notifications for long-running operations; progress titles show operation context (e.g. dataset name, TSO command). Mock data presets (minimal, default, large, inventory, pagination) and streaming progress in the extension.
- **Zowe Native options**: Configurable response timeout for the Zowe Native Protocol (CLI, env, or `zoweMCP.nativeResponseTimeout`). Connection locking and request timeouts to avoid hangs.
- **Themes and icons**: Eight color themes — **Zowe Dark (Classic)**, **Zowe Light (Classic)**, **Zowe Dark (Official)**, **Zowe Light (Official)**, **ISPF Classic (Dark)**, **ISPF Green (Dark)**, **ISPF Modern (Dark)**, **ISPF Modern (Light)** — and three file icon themes — **Zowe Mainframe**, **ISPF**, **ISPF Modern**. File type–specific icons for common languages and formats are included.
- **Encoding and search**: Mainframe encoding (EBCDIC) configurable (MVS and USS defaults) via settings or per-system; updates apply at runtime. `searchInDataset` tool to search for text in data sets with options (case, COBOL sequence, comments).
- **Other**: Log level setting no longer exposes critical/alert/emergency. Improved singular/plural wording in tool messages. Standardized “data set” terminology in docs and prompts.

## `0.2.0`

### Breaking changes

- **Setting renamed**: `zoweMCP.nativeSystems` has been renamed to `zoweMCP.nativeConnections`. The extension migrates existing values from the old key to the new key on first read (so your connections are preserved). Update any scripts or docs that reference the old name.
- **Pipe event renamed**: The event sent from the extension to the server when the connection list changes is now `connections-update` (payload: `{ connections: string[] }`) instead of `systems-update` (`{ systems: string[] }`). Server and extension both use the new event.

### New features and enhancements

- **Connection vs system terminology**: Settings and tool outputs now distinguish **connections** (user@host — what you configure) from **z/OS systems** (hosts). You can have multiple connections to the same system. `listSystems` returns each system with an optional `connections` list; `getContext` includes `activeConnection` (user@host). The `system` parameter in tools accepts a host or a connection spec (user@host); when multiple connections exist for a host, you must pass the connection spec or the tool fails with valid values.
- **VS Code settings renamed to `zoweMCP.*`**: All extension settings now use the `zoweMCP` prefix (e.g. `zoweMCP.nativeConnections`, `zoweMCP.mockDataDirectory`, `zoweMCP.logLevel`). Existing configurations using the old names must be updated.
- **Zowe Native server options**: New settings to control the remote Zowe Native server — install path (`zoweMCP.zoweNativeServerPath`) and optional auto-install when the server is not found (`zoweMCP.installZoweNativeServerAutomatically`). Changes are sent to the MCP server and apply to future connections.
- **Default HTTP port**: When using the HTTP transport, the default port is now **7542** (Zowe 75xx range).
- **Documentation**: Copilot setup guide added to the repo.

## `0.1.0`

### New features and enhancements

- Initial release. Registers the Zowe MCP server so AI assistants (e.g. GitHub Copilot Chat) can use z/OS tools for data sets.
- Native (SSH) connection to z/OS: add systems in **Native Systems** (e.g. `USERID@host`) and enter your password when prompted; passwords are stored in VS Code Secret Storage.
- Mock mode: try the tools without a mainframe. Use the **Zowe MCP: Generate Mock Data** command to create mock data, or set the Mock Data Directory in settings.
