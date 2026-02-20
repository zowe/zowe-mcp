# Change Log

All notable changes to the Zowe MCP extension will be documented in this file.

## `0.1.0`

### New features and enhancements

- Initial release. Registers the Zowe MCP server so AI assistants (e.g. GitHub Copilot Chat) can use z/OS tools for data sets.
- Native (SSH) connection to z/OS: add systems in **Native Systems** (e.g. `USERID@host`) and enter your password when prompted; passwords are stored in VS Code Secret Storage.
- Mock mode: try the tools without a mainframe. Use the **Zowe MCP: Generate Mock Data** command to create mock data, or set the Mock Data Directory in settings.
