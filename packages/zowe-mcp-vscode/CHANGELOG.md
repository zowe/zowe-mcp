<!-- markdownlint-disable MD024 -->

# Change Log

All notable changes to the Zowe MCP extension will be documented in this file.

## `0.8.0`

### New features and enhancements

#### MCP server (stdio, extension-embedded, and standalone)

These behaviors apply whenever you run **`@zowe/mcp-server`** — including **VS Code** (bundled server), **`npx @zowe/mcp-server`**, and **shared HTTP** deployments.

- **Job card elicitation**: When `submitJob` receives JCL without a JOB statement and no configured card, the server can **elicit** a job card (template placeholders and per-tenant storage where applicable). Configured cards are merged into settings-backed storage when the client supports it.
- **Zowe CLI plugin bridge**: **Zowe CLI plugin packages are not shipped** with the MCP server or VSIX — install the plugins you need in your environment (see **`docs/how-to-add-cli-plugin.md`**). The bridge **discovers** installed plugins and exposes their commands as MCP tools. Restrict which plugins load with **`--cli-plugin-enable`** (standalone CLI) or **`zoweMCP.enabledCliPlugins`** (VS Code); **omit both** to load all **discovered** plugins. Named connection/location profiles: **`--cli-plugin-configuration plugin=file`** or **`zoweMCP.cliPluginConfiguration`**. Passwords are not stored in settings or profile files; use `ZOWE_MCP_PASSWORD_<USER>_<HOST>` env vars as documented. The legacy **`zoweMCP.cliPlugins`** setting was removed — use the new settings or CLI flags instead.
- **CLI plugin tooling**: Metadata-driven YAML, **hot-reload** of plugin configuration, pagination and content windowing for plugin-backed tools, **`valueMap`** parameter mapping, **JSON Schema** for plugin tool definitions, optional **CLI commands YAML generator**, and **pattern-based** error classification (e.g. connection vs retryable).
- **Package name and offline installs**: The npm package is **`@zowe/mcp-server`** (formerly **`zowe-mcp-server`**). Builds use **production-style dependencies** suitable for **airgapped/offline** `npm pack` / install where supported. The VS Code extension **embeds** this package in the VSIX.
- **Zowe Remote SSH SDK**: Native SSH uses **`zowex-sdk` 0.4.0** (replaces the former **`zowe-native-proto-sdk`** package name). **`scripts/sdk-switch.js`** supports switching SDK sources for development.
- **USS home**: **`getUssHome`** resolves the user’s home via **`echo $HOME`** on USS. Heuristic path probing when **`echo $HOME`** was unavailable has been **removed** in favor of the SDK’s **`uss.issueCmd`** support; if home cannot be determined, the server **fails clearly** instead of guessing a path.
- **Local workspace files**: Tools to **upload** and **download** between the client workspace and **data sets**, **USS**, and **job spool** files, with paths constrained to **MCP `roots`** (and related env/fallbacks).

#### VS Code extension only

- **Job card UI**: Elicitation uses one **input box**; paste multiple lines or separate `//` lines with whitespace. Accepted cards are merged into **`zoweMCP.jobCards`** when possible.
- **Settings → MCP server**: Editing **`zoweMCP`** in `settings.json` (or the Settings UI) forwards **job cards**, **native connections** (including legacy **`nativeSystems`**), **native SSH options**, **encodings**, **log level**, and **CLI plugin configuration** to already-connected MCP server processes on the next tick so reads are not stale.
- **Log level**: Log levels are **validated** and **kept in sync** between the extension and the MCP server when you change **`zoweMCP.logLevel`**.
- **Backend setting**: New **`zoweMCP.backend`** selects **`native`** (SSH / Zowe Remote SSH) or **`mock`** (local mock data). Mock mode no longer depends only on an empty native connection list; the mock data directory applies when the backend is **mock**. If you previously relied on “mock when native list is empty,” the extension can **auto-migrate** to `backend: mock` when a mock directory is set and native connections are empty. Changing the backend prompts you to **reload the window**; the status bar resets appropriately.
- **CLI plugin runtime UX**: Updates to **`zoweMCP.cliPluginConfiguration`** are sent to the running MCP server so new profiles can take effect **without** a full restart for that path; the **status bar** can show active CLI plugin connection/location profiles. **Fatal** CLI bridge errors open a notification with **Open Settings** targeted at **`zoweMCP.cliPluginConfiguration`** (no “Generate Mock Data” on those errors). Tools that add or remove named profiles can **persist** back into user settings and globalStorage via server → extension sync.
- **Server spawn reliability**: The MCP server is started with **`process.execPath`** so the correct **Node/Electron** runtime is used inside VS Code.

#### MCP server — remote HTTP and credentials

Applies to **standalone** / **shared** HTTP deployments. See **`docs/mcp-authentication-oauth.md`**, **`docs/roo-or-standalone-mcp.md`**, and related guides.

- **HTTP transport — OAuth and JWT**: Optional **Bearer JWT** validation for **`POST /mcp`**, **OAuth 2.0 protected-resource metadata**, URL/password elicitation for standalone HTTP, and **multi-session** behavior. Configure with environment variables such as **`ZOWE_MCP_JWT_*`**, **`ZOWE_MCP_OAUTH_*`**, **`ZOWE_MCP_PUBLIC_BASE_URL`** as documented.
- **Credentials**: **`ZOWE_MCP_CREDENTIALS`** JSON map for standalone SSH passwords; optional **Vault KV** integration for native credentials where configured.

### Bug fixes

- **Jobs**: Return codes shown with a **`CC` prefix** are handled correctly in validation and progress messages.

### Other

- **Vendor CLI plugin definitions**: Some builds can **ship extra plugin tool YAML** under a **`vendor/`** layout in the VSIX (tool metadata only — **not** the upstream Zowe CLI plugin npm packages). Install the corresponding **Zowe CLI plugins** separately to execute those commands.

## `0.7.0`

### New features and enhancements

- **Data set list detail levels**: `listDatasets` now supports a `detail` parameter (`minimal`, `basic`, `full`) to control response verbosity. Default is `basic`; `minimal` returns only essential fields (dsn, dsorg, dsntype); `full` includes all attributes including dates, SMS classes, and volume serials.
- **Merged `info` into `getContext`**: The `getContext` tool now includes server information (name, version, backend type, available components), replacing the separate `info` tool. One fewer tool call for the AI agent to discover server capabilities.
- **Improved tool descriptions**: Standardized system parameter descriptions across all tools, placed pagination notes after the first sentence for better readability, and expanded z/OS terminology in parameter descriptions to help AI models select correct parameters.
- **Scoped output schemas**: Tool response `_context` is now narrowed per component (datasets, USS, jobs, TSO) so AI clients see only the relevant fields for each tool, reducing noise.

## `0.6.0`

### New features and enhancements

- **SMS allocation parameters**: `createDataset` and `createTempDataset` now accept SMS parameters — `volser`, `dataclass`, `storclass`, and `mgmtclass` — for site-managed storage allocation.
- **Restore migrated data sets**: New `restoreDataset` tool recalls migrated (HSM) data sets.
- **Copy USS files**: New `copyUssFile` tool copies USS files or directories with options for recursive, follow symlinks, preserve attributes, and force.
- **Search context lines**: `searchInDataset` supports `includeContextLines` option to return surrounding lines (±6) for each match, powered by SuperC LPSF.
- **Auto-redeploy Zowe Remote SSH z/OS server**: When the remote z/OS server is outdated (checksum mismatch with the local SDK), the server automatically redeploys and reconnects.
- **Improved tool descriptions**: Dataset creation parameters include expanded z/OS terminology (e.g. "Record Format (RECFM)", "Logical Record Length (LRECL) in bytes") to help AI models select correct parameters.
- **MCP server instructions**: The server sends pagination protocol instructions at initialization so AI clients understand how to page through large results.
- **Generate MCP reference docs**: New `generate-docs` command auto-generates a Markdown reference of all MCP tools, prompts, resources, and resource templates.

## `0.5.0`

### New features and enhancements

- **Status bar**: Active Zowe MCP connection is shown in the VS Code status bar; the extension notifies when the active connection changes.
- **Startup notification**: When no Zowe MCP connections (native or mock) are configured, a notification is shown to help you set up.
- **submitJob wait**: `submitJob` can wait for the job to reach OUTPUT with optional `wait: true` and `timeoutSeconds`; the former `executeJob` flow is merged into `submitJob`.
- **DSN(MEMBER) syntax**: Data set tools accept fully qualified names in the form `USER.DSN(MEMBER)` so you can pass data set and member in a single parameter.
- **Abend handling and CEEDUMP**: When the Zowe Remote SSH z/OS server abends, the MCP server detects it, collects the CEEDUMP to a local file, and notifies the extension; you can open the dump from the notification.
- **Improvement prompt**: New prompt for reflecting on Zowe MCP usage (e.g. in Cursor or Copilot).
- **Reset command**: New command **Zowe MCP: Reset All Settings and State** to clear stored passwords and reset extension state.
- **Zowe Remote SSH**: Extended SSH response timeout for initial connections to allow more time to auto-deploy the z/OS server when it is not yet installed.

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
- **Zowe Remote SSH options**: Configurable response timeout for the native SSH backend (CLI, env, or `zoweMCP.nativeResponseTimeout`). Connection locking and request timeouts to avoid hangs.
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
- **Zowe Remote SSH server options**: New settings to control the remote z/OS server — install path (`zoweMCP.zoweNativeServerPath`) and optional auto-install when the server is not found (`zoweMCP.installZoweNativeServerAutomatically`). Changes are sent to the MCP server and apply to future connections.
- **Default HTTP port**: When using the HTTP transport, the default port is now **7542** (Zowe 75xx range).
- **Documentation**: Copilot setup guide added to the repo.

## `0.1.0`

### New features and enhancements

- Initial release. Registers the Zowe MCP server so AI assistants (e.g. GitHub Copilot Chat) can use z/OS tools for data sets.
- Native (SSH) connection to z/OS: add systems in **Native Systems** (e.g. `USERID@host`) and enter your password when prompted; passwords are stored in VS Code Secret Storage.
- Mock mode: try the tools without a mainframe. Use the **Zowe MCP: Generate Mock Data** command to create mock data, or set the Mock Data Directory in settings.
