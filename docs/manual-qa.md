# Manual QA

Use this checklist for behavior that requires a person to interact with VS Code,
GitHub Copilot Chat, or a live z/OS system. Server tool contracts, transports,
and extension-host behavior are covered by automated tests.

Use [`manual-test-workspace/`](../manual-test-workspace/) as a small trusted
workspace. See the [Copilot setup guide](copilot-setup-guide.md) for account,
model-provider, and organization-specific setup.

## Prerequisites

- A VS Code version supported by the
  [extension manifest](../packages/zowe-mcp-vscode/package.json)
- GitHub Copilot Chat with MCP support
- The Zowe MCP VSIX or a repository checkout for `npm run build-and-install`
- For the optional native test, SSH access to a permitted z/OS system

A clean VS Code profile is useful for first-install testing but is not required.
Create the profile in VS Code before targeting it from the command line; the
editor CLI cannot install into a profile that does not yet exist.

## Install and run the core smoke test

1. Install the extension as described in the
   [README](../README.md#install-the-extension). To build and install from the
   repository into an existing named profile, run:

   ```bash
   VSCODE_PROFILE=ZoweMcpManualClean npm run build-and-install
   ```

   Omit `VSCODE_PROFILE` to use the default profile.

2. Reload VS Code and open the trusted manual-test workspace.
3. Accept the Zowe MCP server trust or consent prompt if VS Code displays one.
4. Run **MCP: List Servers** and confirm that **Zowe** is present and running.
5. From the Zowe server entry, open **Show Output**. This is the MCP server
   process log.
6. Open **View: Toggle Output**, then select **Zowe MCP**. This is the extension
   log. Confirm that you can distinguish the two logs.
7. Open Copilot Chat and confirm that tools from the Zowe server are enabled.
8. Send this prompt:

   ```text
   Use the getContext tool and report the Zowe MCP server version from its response.
   ```

The test passes when Copilot invokes `getContext` (usually displayed as
`mcp_zowe_getContext`) and reports the installed server version.

## Mock backend smoke test

Use this test when no mainframe is available.

1. In Zowe MCP settings, set **Backend** to **mock**.
2. Run **Zowe MCP: Generate Mock Data**.
3. Choose an empty or new output folder, allow the command to configure the
   mock data directory, and reload when prompted.
4. Run **MCP: List Servers** and confirm that **Zowe** is running.
5. Ask Copilot:

   ```text
   List the available z/OS systems, then list data sets matching USER.** on the mock system.
   ```

The test passes when Copilot invokes tools such as `listSystems` and
`listDatasets` and returns plausible fixture data. If generation or startup
fails, see [Mock mode](mock-mode.md) and capture both logs.

## Native z/OS smoke test

Run this optional test only with an approved z/OS account and host.

1. In Zowe MCP settings, set **Backend** to **Zowe Remote SSH** (`zowex`).
2. Add `USER@host` or `USER@host:port` under **Zowe Remote SSH**
   (`zoweMCP.zowexConnections`).
3. Reload VS Code if prompted.
4. Ask Copilot to run a read-only operation against a data set pattern valid at
   your site, for example:

   ```text
   Set the active system to USER@host and list data sets matching SYS1.*.
   ```

The test passes when the SSH connection succeeds and Copilot returns data set
results without exposing credentials. The server tries configured SSH keys
before requesting a password.

## Settings and recovery checks

- Change `zoweMCP.logLevel` and confirm that log verbosity changes without a
  reload.
- If tools are stale, run **MCP: Reset Cached Tools**, then restart **Zowe**
  from **MCP: List Servers**.
- If native authentication uses an outdated password, run
  **Zowe MCP: Clear Stored Password** and retry the tool.
- Use **Zowe MCP: Reset All Settings and State** only when intentionally
  returning a local test profile to a clean state.
- If recovery commands do not help, run **Developer: Reload Window** and repeat
  the `getContext` smoke test.

## Failure evidence

Record the following when reporting a manual QA failure:

- VS Code and Zowe MCP extension versions
- Whether a named profile or Settings Sync is active
- The **Zowe MCP** extension log
- The **Zowe** MCP server output from **MCP: List Servers**
- The prompt, tool call, expected result, and actual result
- A screen recording for intermittent UI behavior when practical

For ad hoc inspection outside Copilot, launch the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) with
`npm run inspector`, `npm run inspector:mock`, or `npm run inspector:native`.
