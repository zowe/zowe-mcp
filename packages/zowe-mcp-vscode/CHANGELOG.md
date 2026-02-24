# Change Log

All notable changes to the Zowe MCP extension will be documented in this file.

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
