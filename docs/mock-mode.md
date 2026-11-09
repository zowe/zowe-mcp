# Mock mode

Mock mode lets you try Zowe MCP without a mainframe. The server reads sample
data sets and USS files from a directory on your workstation instead of
connecting to z/OS.

Mock mode does not include jobs. The job tools return an error.

## In VS Code

Run **Zowe MCP: Generate Mock Data** from the Command Palette. See
[Try it without a mainframe](../packages/zowe-mcp-vscode/README.md#try-it-without-a-mainframe)
in the extension README.

## With any other MCP client

These steps use the `zowe-mcp-server` program from the
[standalone server guide](standalone-mcp.md#install-the-server).

1. Create the mock data:

   ```bash
   zowe-mcp-server init-mock --output ./zowe-mcp-mock-data
   ```

2. In your MCP client configuration, replace `--native --system ...` with
   `--mock` and the absolute path of the directory:

   ```json
   {
     "mcpServers": {
       "zowe": {
         "command": "zowe-mcp-server",
         "args": ["--stdio", "--mock", "/absolute/path/to/zowe-mcp-mock-data"]
       }
     }
   }
   ```

   You can set the `ZOWE_MCP_MOCK_DIR` environment variable instead of
   `--mock`.

3. Restart the client and ask the assistant:

   ```text
   Set the active system to mainframe-dev.example.com and list the data sets that match USER.**
   ```

The server does not start when both a mock directory and `--native` are set.

## Choose the amount of mock data

| Command | Result |
| --- | --- |
| `init-mock --output <dir>` | 2 systems, 2 users on each, 8 data sets for each user |
| `init-mock --output <dir> --preset minimal` | 1 system, 1 user, 5 data sets |
| `init-mock --output <dir> --preset large` | 5 systems, 3 users on each, 20 data sets for each user |

Each preset also adds a few `SYS1` data sets. To set the numbers yourself, use
`--systems`, `--users-per-system`, `--datasets-per-user`, and
`--members-per-pds`.

## Directory layout

```text
zowe-mcp-mock-data/
  systems.json                          # Systems, user IDs, and mock passwords
  mainframe-dev.example.com/            # One directory for each system
    USER/                               # High-level qualifier
      SRC.COBOL/                        # PDS or PDS/E: a directory of members
        CUSTFILE.cbl                    # Member
        _meta.json                      # Data set attributes
      DATA.INPUT                        # Sequential data set: a file
  uss/
    mainframe-dev.example.com/u/USER/   # USS home directory
```

You can edit the files, or add your own, to test with other content.

## For contributors

To test the SSH connection path without a mainframe, use the
[mock z/OS host](mock-zos-host.md). It is a local SSH server that the native
backend connects to.
