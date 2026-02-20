# Zowe MCP

Zowe MCP brings mainframe z/OS capabilities to AI assistants in VS Code. It registers a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server so tools like **GitHub Copilot Chat** can work with data sets, jobs, and UNIX System Services on your z/OS systems.

[Zowe](https://www.zowe.org/) is a project hosted by the [Open Mainframe Project](https://www.openmainframeproject.org/).

## Requirements

- **VS Code** 1.101 or later
- **GitHub Copilot Chat** (or another MCP-enabled AI chat extension) installed

## What You Get

When the extension is configured with a backend (mock or native), your AI assistant can:

- **Data sets** — List, read, write, copy, rename, and delete data sets and PDS members
- **Context** — Switch between z/OS systems
- **Slash commands** — Use prompts such as “review JCL” or “explain data set” in chat

Without a backend, only the server **info** tool is available; the extension will prompt you to set up mock data or a connection.

## Installation

The extension is not yet on the Marketplace. For build and install instructions, see the [repository README](https://github.com/zowe/zowe-mcp). After installation, reload VS Code; the extension registers a **Zowe** MCP server — ensure it is enabled for your AI chat (e.g. in Copilot settings).

## Configuration

### Option 1: Mock data (no mainframe)

Use mock data to try the tools without connecting to z/OS:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Zowe MCP: Generate Mock Data**.
3. Choose a folder for the mock data. The command creates the data, sets the path in settings, and can reload the window.

Or set the path manually:

- Open Settings and search for **Zowe MCP**.
- Set **Mock Data Dir** to the absolute path of your mock data directory.
- Reload the window so the MCP server restarts.

### Option 2: Native (SSH) connection to z/OS

To connect to real z/OS systems over SSH:

1. Open Settings and search for **Zowe MCP**.
2. Set **Native Systems** to an array of connection specs, e.g. `["USERID@sys1.example.com"]` or `["USERID@host:22"]`.
3. Reload the window.

When the server needs a password, the extension will prompt you. Passwords are stored in VS Code Secret Storage under the shared Zowe key so other Zowe extensions can reuse them.

**Note:** If both Mock Data Dir and Native Systems are set, the native backend is used.

## Settings

| Setting | Description |
| --- | --- |
| **Native Systems** | Connection specs for SSH: `user@host` or `user@host:port` (e.g. `USERID@sys1.example.com`). With default configuration the server runs in native (SSH) mode; add systems here to connect. Passwords are stored in VS Code Secret Storage (Zowe namespace). Changes require reloading the window. |
| **Log Level** | Minimum log level (e.g. `info`, `debug`). Takes effect immediately without restart. |
| **Install Zowe Native Server Automatically** | When enabled (default), the extension automatically installs the Zowe Native server on the host when "Server not found" is detected. Disable to use a pre-installed server only. Changes are sent to the server and apply to future connections. |
| **Zowe Native Server Path** | Remote path for the Zowe Native server on the host (default: `~/.zowe-server`). Changes are sent to the server and apply to future connections. |
| **Mock Data Directory** | Absolute path to a mock data directory. When set **and** Native Systems is empty, the server uses mock z/OS data. Leave empty to use native (SSH) mode. Changes require reloading the window. |

**Mode behavior:** With default configuration (empty Mock Data Directory and empty Native Systems), the server runs in **native** mode with no systems; add entries to Native Systems to connect. Mock mode is active only when Mock Data Directory is set and Native Systems is empty.

## User-facing options reference

All options that affect the MCP server are documented below. The extension uses the **VS Code settings**; when running the server standalone you use **CLI options** and **environment variables**.

### VS Code settings (Zowe MCP)

| Setting ID | Type | Default | Description |
| --- | --- | --- | --- |
| `zoweMCP.nativeSystems` | array of string | `[]` | Connection specs: `user@host` or `user@host:port`. Format is validated in Settings UI. |
| `zoweMCP.logLevel` | string | `"info"` | Log level: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`. |
| `zoweMCP.installZoweNativeServerAutomatically` | boolean | `true` | Auto-install Zowe Native server on host when "Server not found". |
| `zoweMCP.zoweNativeServerPath` | string | `"~/.zowe-server"` | Remote path for Zowe Native server install/run. |
| `zoweMCP.mockDataDirectory` | string | `""` | Absolute path to mock data directory. Mock mode only when set and Native Systems is empty. |

### Server CLI options (standalone)

When running `npx zowe-mcp-server` (or the bundled server) outside VS Code:

- **Transport:** `--stdio` (default), `--http`, `--port <N>` (default 7542 for HTTP)
- **Backend:** `--mock <dir>`, `--native`, `--config <path>`, `--system <spec>` (repeatable)
- **Native:** `--native-server-auto-install=true|false` (default: true), `--native-server-path <path>`
- **Response cache:** `--response-cache-disable`, `--response-cache-ttl-minutes N`, `--response-cache-max-mb N`
- **Help:** `-h`, `--help`

### Environment variables (standalone)

- `ZOWE_MCP_MOCK_DIR` — Mock data directory (same as `--mock <dir>`)
- `ZOWE_MCP_LOG_LEVEL` — Log level (e.g. `info`, `debug`)
- `ZOWE_MCP_NATIVE_SERVER_AUTO_INSTALL` — `false` or `0` to disable auto-install
- `ZOWE_MCP_NATIVE_SERVER_PATH` — Remote path for Zowe Native server
- `ZOWE_MCP_RESPONSE_CACHE_DISABLE` — `1` or `true` to disable response cache
- `ZOWE_MCP_RESPONSE_CACHE_TTL_MINUTES` — Cache entry TTL in minutes (default 10). Legacy: `ZOWE_MCP_RESPONSE_CACHE_TTL_MS` (milliseconds) is still supported.
- `ZOWE_MCP_RESPONSE_CACHE_MAX_BYTES` — Max cache size in bytes
- `ZOWE_MCP_PASSWORD_<USER>_<HOST>` — Password for native SSH (e.g. `ZOWE_MCP_PASSWORD_MYUSER_MYHOST_EXAMPLE_COM`)

## Commands

- **Zowe MCP: Generate Mock Data** — Creates a mock z/OS data directory, configures the Mock Data Dir setting, and optionally reloads the window.

## Documentation and Contributing

- For development, build, and technical details, see the [repository README](https://github.com/zowe/zowe-mcp).
- To contribute or report issues, use the [Zowe MCP repository](https://github.com/zowe/zowe-mcp).
