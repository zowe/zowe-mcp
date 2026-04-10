<!-- markdownlint-disable MD004 MD009 MD012 MD024 MD031 MD032 MD034 MD036 MD037 MD060 -->

# Zowe CLI Plugin Tools Reference

> Auto-generated from the Zowe MCP server (v0.8.0-dev, commit 7dafbbe). Do not edit manually — run `npx @zowe/mcp-server generate-docs` to regenerate.

> For core Zowe MCP tools, see [docs/mcp-reference.md](../../../docs/mcp-reference.md).

## db2 CLI Plugin Tools

The server provides **5** tools.

Registered from `vendor/zowe/cli-bridge-plugins/db2-tools.yaml`. Configure a connection via `zoweMCP.cliPluginConfiguration` (VS Code) or `--cli-plugin-configuration db2=<connfile>` (standalone).

| # | Tool                                        | Description                                                                                                                                                                              |
|---|---------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | [`db2ListConnections`](#db2listconnections) | Lists all configured Db2 connection profiles                                                                                                                                             |
| 2 | [`db2SetConnection`](#db2setconnection)     | Sets the active Db2 connection                                                                                                                                                           |
| 3 | [`db2ExecuteSql`](#db2executesql)           | Executes one or more SQL statements against a Db2 for z/OS subsystem to query, modify, or define database objects, including built-in catalog queries, and returns paginated result rows |
| 4 | [`db2CallProcedure`](#db2callprocedure)     | Calls a Db2 stored procedure, returning its output parameters and result sets                                                                                                            |
| 5 | [`db2ExportTable`](#db2exporttable)         | Exports a Db2 table as SQL INSERT statements, returning its full content in SQL format for backup, migration, or inspection                                                              |

## Tool Reference

Full parameter and output schema details for every tool. Links in the summary tables above point to the corresponding section here.

### `db2ListConnections`

> Read-only

Lists all configured Db2 connection profiles.

#### Parameters

*No parameter.*

---

### `db2SetConnection`


Sets the active Db2 connection. Call once before using tools; auto-selected when only one profile is configured.

#### Parameters

| Parameter      | Type     | Required | Description                                       |
|----------------|----------|----------|---------------------------------------------------|
| `connectionId` | `string` | Yes      | The ID of the Db2 connection profile to activate. |

---

### `db2ExecuteSql`

> Destructive

Executes one or more SQL statements against a Db2 for z/OS subsystem to query, modify, or define database objects, including built-in catalog queries, and returns paginated result rows. Results are paginated (default 500, max 1000 per page); follow the pagination instructions in the server instructions.

#### Parameters

| Parameter      | Type      | Required | Description                                                                                                                                                                                                      |
|----------------|-----------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `connectionId` | `string`  | No       | Override the active Db2 connection for this single call without changing the global default.                                                                                                                     |
| `query`        | `string`  | Yes      | The SQL statement to execute. Enclose in double quotes. Separate multiple statements with semicolons. To list all tables for a schema use: "SELECT NAME, TYPE FROM SYSIBM.SYSTABLES WHERE CREATOR = 'MYSCHEMA'". |
| `offset`       | `integer` | No       | Zero-based index of the first item to return. Use 0 for the first page. (default: `0`)                                                                                                                           |
| `limit`        | `integer` | No       | Maximum items to return per page (max 1000). (default: `200`)                                                                                                                                                    |

---

### `db2CallProcedure`

> Destructive

Calls a Db2 stored procedure, returning its output parameters and result sets. Specify the fully qualified procedure name and provide input or output parameters using (?, ?) markers with values supplied via the parameters option.

#### Parameters

| Parameter      | Type     | Required | Description                                                                                                                                                                                                        |
|----------------|----------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `connectionId` | `string` | No       | Override the active Db2 connection for this single call without changing the global default.                                                                                                                       |
| `routine`      | `string` | Yes      | The fully qualified stored procedure name with optional parameter markers, e.g. "SCHEMA.PROC_NAME" or "SCHEMA.PROC_NAME(?, ?)".                                                                                    |
| `parameters`   | `string` | No       | Space-separated values to bind to the stored procedure parameter markers (?). For output parameters, pass a placeholder string whose length equals the expected output length, e.g. "00" for a 2-character output. |

---

### `db2ExportTable`

> Read-only

Exports a Db2 table as SQL INSERT statements, returning its full content in SQL format for backup, migration, or inspection. Results may be line-windowed; follow the pagination instructions in the server instructions.

#### Parameters

| Parameter      | Type      | Required | Description                                                                                  |
|----------------|-----------|----------|----------------------------------------------------------------------------------------------|
| `connectionId` | `string`  | No       | Override the active Db2 connection for this single call without changing the global default. |
| `table`        | `string`  | Yes      | The fully qualified table name to export, e.g. "SCHEMA.TABLE_NAME".                          |
| `separator`    | `string`  | No       | Specify whether to add a separator between statements when exporting a table                 |
| `startLine`    | `integer` | No       | First line to return (1-based). Omit to start from line 1.                                   |
| `lineCount`    | `integer` | No       | Number of lines per window (default 1000). Used with startLine for windowed reads.           |

---
