# Mock mode

The server includes a filesystem-backed mock z/OS backend for testing without a
mainframe. The server reads fixture files directly and does not use SSH.

To test the native SSH and `zowex-sdk` path, use the
[mock z/OS host](mock-zos-host.md).

## Generate mock data

```bash
# Default preset (2 systems, 2 users each, ~8 data sets per user)
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data

# Minimal (1 system, 1 user, 5 data sets)
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data --preset minimal

# Large (5 systems, 3 users each, 20 data sets per user)
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data --preset large

# Custom scale
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data \
  --systems 3 --users-per-system 2 --datasets-per-user 10 --members-per-pds 8
```

If the server is installed globally or in a project, use its binary:

```bash
zowe-mcp-server init-mock --output ./zowe-mcp-mock-data

# Or generate directly from a local tarball
npx --package=file:/absolute/path/to/zowe-mcp-server-<version>.tgz \
  zowe-mcp-server init-mock --output ./zowe-mcp-mock-data
```

The generated directory looks like:

```text
zowe-mcp-mock-data/
  systems.json                          # System definitions + credentials
  mainframe-dev.example.com/            # One directory per system
    USER/                               # HLQ directory
      SRC.COBOL/                        # PDS — directory with members
        CUSTFILE.cbl                    # Member file
        _meta.json                      # Data set attributes
      DATA.INPUT                        # Sequential data set — plain file
  uss/
    mainframe-dev.example.com/u/USER/   # USS home tree per system
```

## Run the server with mock data

Inside this repository after `npm install`:

```bash
# Via CLI flag
npx @zowe/mcp-server --stdio --mock ./zowe-mcp-mock-data

# Via environment variable
ZOWE_MCP_MOCK_DIR=./zowe-mcp-mock-data npx @zowe/mcp-server --stdio
```

In an MCP client configuration, replace the `--native --system …` arguments
with `--mock` and the absolute mock-data path:

```jsonc
"args": [
  "/absolute/path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
  "--stdio",
  "--mock",
  "/absolute/path/to/zowe-mcp/zowe-mcp-mock-data"
]
```

Outside this repository, install the server from a tarball first. See
[Standalone MCP clients](standalone-mcp.md#obtaining-the-tgz). Then run the
installed binary directly:

```bash
zowe-mcp-server --stdio --mock ./zowe-mcp-mock-data

# Or run directly from a local tarball
npx --package=file:/abs/path/to/zowe-mcp-server-<version>.tgz \
  zowe-mcp-server --stdio --mock ./zowe-mcp-mock-data
```

Native and mock backends cannot be configured together: if both `--mock` (or
`ZOWE_MCP_MOCK_DIR`) and `--native` are set, the server logs an error and exits.

For the VS Code extension workflow, see the
[mock backend smoke test](manual-qa.md#mock-backend-smoke-test).
