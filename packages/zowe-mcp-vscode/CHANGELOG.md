# Change Log

All notable changes to the Zowe MCP extension will be documented in this file.

## `0.2.0`

### New features and enhancements

- **VS Code settings renamed to `zoweMCP.*`**: All extension settings now use the `zoweMCP` prefix (e.g. `zoweMCP.nativeSystems`, `zoweMCP.mockDataDirectory`, `zoweMCP.logLevel`). Existing configurations using the old names must be updated.
- **Zowe Native server options**: New settings to control the remote Zowe Native server — install path (`zoweMCP.zoweNativeServerPath`) and optional auto-install when the server is not found (`zoweMCP.installZoweNativeServerAutomatically`). Changes are sent to the MCP server and apply to future connections.
- **Default HTTP port**: When using the HTTP transport, the default port is now **7542** (Zowe 75xx range).
- **Documentation**: Copilot setup guide added to the repo.

## `0.1.0`

### New features and enhancements

- Initial release. Registers the Zowe MCP server so AI assistants (e.g. GitHub Copilot Chat) can use z/OS tools for data sets.
- Native (SSH) connection to z/OS: add systems in **Native Systems** (e.g. `USERID@host`) and enter your password when prompted; passwords are stored in VS Code Secret Storage.
- Mock mode: try the tools without a mainframe. Use the **Zowe MCP: Generate Mock Data** command to create mock data, or set the Mock Data Directory in settings.
