# Zowe MCP

Zowe MCP brings mainframe z/OS capabilities to AI assistants in VS Code. It registers a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server so tools like **GitHub Copilot Chat** can work with data sets, jobs, and UNIX System Services on your z/OS systems.

[Zowe](https://www.zowe.org/) is a project hosted by the [Open Mainframe Project](https://www.openmainframeproject.org/).

## Requirements

- **VS Code** 1.101 or later
- **GitHub Copilot Chat** (or another MCP-enabled AI chat extension) installed

## What You Get

When the extension is configured with a backend (mock or native), your AI assistant can:

- **Data sets** — List, read, write, copy, rename, and delete data sets and PDS members
- **Context** — Switch between z/OS systems and set data set name prefixes (HLQ)
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
| **Mock Data Dir** | Absolute path to a mock data directory. When set, the server uses mock z/OS data. Leave empty to disable. |
| **Native Systems** | Connection specs for SSH: `user@host` or `user@host:port`. When non-empty, the server uses the native backend. |
| **Log Level** | Minimum log level (e.g. `info`, `debug`). Takes effect immediately. |

Changes to Mock Data Dir or Native Systems require reloading the window (or restarting the Zowe MCP server).

## Commands

- **Zowe MCP: Generate Mock Data** — Creates a mock z/OS data directory, configures the Mock Data Dir setting, and optionally reloads the window.

## Documentation and Contributing

- For development, build, and technical details, see the [repository README](https://github.com/zowe/zowe-mcp).
- To contribute or report issues, use the [Zowe MCP repository](https://github.com/zowe/zowe-mcp).
