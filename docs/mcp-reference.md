<!-- markdownlint-disable MD004 MD009 MD012 MD024 MD031 MD032 MD034 MD036 MD037 MD060 -->

# Zowe MCP Server Reference

> Auto-generated from the MCP server (v0.8.0-dev, commit e37440f). Do not edit manually — run `npx @zowe/mcp-server generate-docs` to regenerate.

This document describes all [Context](#context), [Data Sets](#data-sets), [USS](#uss), [TSO](#tso), [Jobs](#jobs), [Local Files](#local-files), [Endevor CLI Plugin Tools](#endevor-cli-plugin-tools), [Tool Reference](#tool-reference), [Prompts](#prompts), [Resource Templates](#resource-templates) provided by the Zowe MCP Server.

## Context

The server provides **3** tools.

Server information and session management — set the active z/OS system and query the current session state (systems, active connection, active user).

| # | Tool                          | Description                                                                                                                                                                                                                                                                 |
|---|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | [`getContext`](#getcontext)   | Return the Zowe MCP server info (version, backend, components) and the current session context: active system, active connection (user@host), user ID, all known systems (with their connections when multiple exist), and recently used systems (those with saved context) |
| 2 | [`listSystems`](#listsystems) | List all z/OS systems you have access to                                                                                                                                                                                                                                    |
| 3 | [`setSystem`](#setsystem)     | Set the active z/OS system                                                                                                                                                                                                                                                  |

## Data Sets

The server provides **15** tools.

z/OS data set operations — list, search, read, write, create, copy, rename, delete, and manage PDS/E members and temporary data sets.

| #  | Tool                                                      | Description                                                                                                                                                   |
|----|-----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | [`listDatasets`](#listdatasets)                           | List data sets matching a DSLEVEL pattern                                                                                                                     |
| 2  | [`listMembers`](#listmembers)                             | List members of a PDS or PDS/E data set Results are paginated (default 500, max 1000 per page); follow the pagination instructions in the server instructions |
| 3  | [`searchInDataset`](#searchindataset)                     | Search for a string in a sequential data set, PDS, or PDS/E (all members or one member)                                                                       |
| 4  | [`getDatasetAttributes`](#getdatasetattributes)           | Get detailed attributes of a data set: organization, record format, record length, block size, volume, SMS classes, dates, and more                           |
| 5  | [`readDataset`](#readdataset)                             | Read the content of a sequential data set or PDS/E member                                                                                                     |
| 6  | [`writeDataset`](#writedataset)                           | Write UTF-8 content to a sequential data set or PDS/E member                                                                                                  |
| 7  | [`createDataset`](#createdataset)                         | Create a new sequential or partitioned data set                                                                                                               |
| 8  | [`createTempDataset`](#createtempdataset)                 | Creates a new data set with a unique temporary name in a single call                                                                                          |
| 9  | [`getTempDatasetPrefix`](#gettempdatasetprefix)           | Return a unique DSN prefix (HLQ) under which temporary data sets can be created                                                                               |
| 10 | [`getTempDatasetName`](#gettempdatasetname)               | Returns a single unique full temporary data set name (for one data set)                                                                                       |
| 11 | [`copyDataset`](#copydataset)                             | Copy a data set or PDS or PDS/E member within a single z/OS system                                                                                            |
| 12 | [`renameDataset`](#renamedataset)                         | Rename a data set or PDS or PDS/E member                                                                                                                      |
| 13 | [`deleteDataset`](#deletedataset)                         | Delete a data set or a specific PDS or PDS/E member                                                                                                           |
| 14 | [`deleteDatasetsUnderPrefix`](#deletedatasetsunderprefix) | Delete all data sets whose names start with the given prefix (e.g. tempDsnPrefix from getTempDatasetPrefix)                                                   |
| 15 | [`restoreDataset`](#restoredataset)                       | Restore (recall) a migrated data set from the hierarchical storage manager (HSM/DFHSM)                                                                        |

## USS

The server provides **17** tools.

UNIX System Services — navigate directories, read/write files, manage permissions and tags, run shell commands, and work with temporary files.

| #  | Tool                                              | Description                                                                                                                                                    |
|----|---------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | [`getUssHome`](#getusshome)                       | Return the current user's USS home directory for the active (or specified) system                                                                              |
| 2  | [`changeUssDirectory`](#changeussdirectory)       | Set the USS current working directory for the active (or specified) system                                                                                     |
| 3  | [`listUssFiles`](#listussfiles)                   | List files and directories in a USS path Results are paginated (default 500, max 1000 per page); follow the pagination instructions in the server instructions |
| 4  | [`readUssFile`](#readussfile)                     | Read the content of a USS file Results may be line-windowed; follow the pagination instructions in the server instructions                                     |
| 5  | [`writeUssFile`](#writeussfile)                   | Write or overwrite a USS file                                                                                                                                  |
| 6  | [`createUssFile`](#createussfile)                 | Create a USS file or directory                                                                                                                                 |
| 7  | [`deleteUssFile`](#deleteussfile)                 | Delete a USS file or directory                                                                                                                                 |
| 8  | [`chmodUssFile`](#chmodussfile)                   | Change permissions of a USS file or directory                                                                                                                  |
| 9  | [`chownUssFile`](#chownussfile)                   | Change owner of a USS file or directory                                                                                                                        |
| 10 | [`chtagUssFile`](#chtagussfile)                   | Set the z/OS file tag (encoding/type) for a USS file or directory                                                                                              |
| 11 | [`copyUssFile`](#copyussfile)                     | Copy a USS file or directory within the same z/OS system                                                                                                       |
| 12 | [`runSafeUssCommand`](#runsafeusscommand)         | Run a Unix command on z/OS USS                                                                                                                                 |
| 13 | [`getUssTempDir`](#getusstempdir)                 | Generate a unique USS temporary directory path as a subdirectory of the given base path (e.g. /tmp or the user home)                                           |
| 14 | [`getUssTempPath`](#getusstemppath)               | Return a unique USS temporary file path under the given directory                                                                                              |
| 15 | [`createTempUssDir`](#createtempussdir)           | Create a temporary USS directory                                                                                                                               |
| 16 | [`createTempUssFile`](#createtempussfile)         | Create an empty temporary USS file at the given path, creating parent directories if needed                                                                    |
| 17 | [`deleteUssTempUnderDir`](#deleteusstempunderdir) | Delete all files and directories under the given USS path (the path itself is removed)                                                                         |

## TSO

The server provides **1** tool.

Time Sharing Option — run TSO commands interactively on z/OS.

| # | Tool                                      | Description               |
|---|-------------------------------------------|---------------------------|
| 1 | [`runSafeTsoCommand`](#runsafetsocommand) | Run a TSO command on z/OS |

## Jobs

The server provides **14** tools.

z/OS batch job management — submit JCL, monitor job status, read spool output, search output, and manage job lifecycle (cancel, hold, release, delete).

| #  | Tool                                            | Description                                                                                                                                                                       |
|----|-------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | [`submitJob`](#submitjob)                       | Submit JCL to the current (or specified) z/OS system                                                                                                                              |
| 2  | [`submitJobFromDataset`](#submitjobfromdataset) | Submit a job from a data set or PDS or PDS/E member containing JCL                                                                                                                |
| 3  | [`submitJobFromUss`](#submitjobfromuss)         | Submit a job from a USS file path                                                                                                                                                 |
| 4  | [`getJobStatus`](#getjobstatus)                 | Get the current status of a z/OS job (INPUT, ACTIVE, or OUTPUT) and its return code when complete                                                                                 |
| 5  | [`listJobFiles`](#listjobfiles)                 | List output files (spools) for a z/OS job                                                                                                                                         |
| 6  | [`readJobFile`](#readjobfile)                   | Read the content of one job output file (spool); use listJobFiles to get job file IDs Results may be line-windowed; follow the pagination instructions in the server instructions |
| 7  | [`getJobOutput`](#getjoboutput)                 | Get aggregated output from job files for a completed job                                                                                                                          |
| 8  | [`searchJobOutput`](#searchjoboutput)           | Search for a substring in a job's output files (all files or one by jobFileId)                                                                                                    |
| 9  | [`listJobs`](#listjobs)                         | List jobs on the z/OS system with optional filters (owner, prefix, status)                                                                                                        |
| 10 | [`getJcl`](#getjcl)                             | Get the JCL for a job                                                                                                                                                             |
| 11 | [`cancelJob`](#canceljob)                       | Cancel a job on the z/OS system                                                                                                                                                   |
| 12 | [`holdJob`](#holdjob)                           | Hold a job on the z/OS system                                                                                                                                                     |
| 13 | [`releaseJob`](#releasejob)                     | Release a held job on the z/OS system                                                                                                                                             |
| 14 | [`deleteJob`](#deletejob)                       | Delete a job from the output queue                                                                                                                                                |

## Local Files

The server provides **5** tools.

Transfer files between z/OS (data sets and USS paths) and the local workspace.

| # | Tool                                              | Description                                                                                  |
|---|---------------------------------------------------|----------------------------------------------------------------------------------------------|
| 1 | [`downloadDatasetToFile`](#downloaddatasettofile) | Download a sequential data set or PDS/E member from z/OS to a file under the workspace       |
| 2 | [`uploadFileToDataset`](#uploadfiletodataset)     | Upload a UTF-8 text file from the workspace to a sequential data set or PDS/E member on z/OS |
| 3 | [`downloadUssFileToFile`](#downloadussfiletofile) | Download a z/OS USS file to a local workspace file as UTF-8 text                             |
| 4 | [`uploadFileToUssFile`](#uploadfiletoussfile)     | Upload a UTF-8 workspace file to a z/OS USS path                                             |
| 5 | [`downloadJobFileToFile`](#downloadjobfiletofile) | Download one job spool file from z/OS to a local workspace file as UTF-8 text                |

## Endevor CLI Plugin Tools

The server provides **11** tools.

Registered from `plugins/endevor-tools.yaml`. These tools require the [Zowe CLI Endevor plug-in](https://www.npmjs.com/package/@broadcom/endevor-for-zowe-cli) to be installed. Configure a connection via `zoweMCP.cliPluginConnections` (VS Code) or `--cli-plugin-connection endevor=<connfile>` (standalone).

| #  | Tool                                                        | Description                                                                                                                         |
|----|-------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| 1  | [`endevorSetContext`](#endevorsetcontext)                   | Sets the default Endevor location context (environment, stageNumber, system, subsystem, type) for all subsequent Endevor tool calls |
| 2  | [`endevorListEnvironments`](#endevorlistenvironments)       | Lists all available Endevor environments                                                                                            |
| 3  | [`endevorListStages`](#endevorliststages)                   | Lists the stages (1, 2) configured for the given environment                                                                        |
| 4  | [`endevorListSystems`](#endevorlistsystems)                 | Lists all systems within the given environment and stage                                                                            |
| 5  | [`endevorListSubsystems`](#endevorlistsubsystems)           | Lists all subsystems within the given environment, stage, and system                                                                |
| 6  | [`endevorListTypes`](#endevorlisttypes)                     | Lists element types (e.g. COBPGM, COPYBOOK, JCL) within the given location                                                          |
| 7  | [`endevorListElements`](#endevorlistelements)               | Lists elements in the Endevor inventory matching the given location (environment, stageNumber, system, subsystem, type)             |
| 8  | [`endevorPrintElement`](#endevorprintelement)               | Retrieves and returns the source code content of an Endevor element                                                                 |
| 9  | [`endevorListProcessorGroups`](#endevorlistprocessorgroups) | Lists processor groups defined for the given element type in Endevor                                                                |
| 10 | [`endevorQueryComponents`](#endevorquerycomponents)         | Queries the components (dependencies) used by a specific element in Endevor                                                         |
| 11 | [`endevorListPackages`](#endevorlistpackages)               | Lists Endevor packages (change bundles used to promote elements through environments)                                               |

## Tool Reference

Full parameter and output schema details for every tool. Links in the summary tables above point to the corresponding section here.

### `getContext`

> Read-only

Return the Zowe MCP server info (version, backend, components) and the current session context: active system, active connection (user@host), user ID, all known systems (with their connections when multiple exist), and recently used systems (those with saved context). 

#### Parameters

*No parameter.*

<a id="getcontext-output-schema"></a>

#### Output Schema

| Field                           | Type               | Required | Description                                                                                                          |
|---------------------------------|--------------------|----------|----------------------------------------------------------------------------------------------------------------------|
| `messages`                      | `string`[]         | No       | Informational messages. Omitted when empty.                                                                          |
| `server`                        | `object`           | Yes      | Zowe MCP server metadata: name, version, registered components, and backend status.                                  |
| &ensp;├─ `name`                 | `string`           | Yes      | Server display name.                                                                                                 |
| &ensp;├─ `version`              | `string`           | Yes      | Semantic version.                                                                                                    |
| &ensp;├─ `description`          | `string`           | Yes      | Short server description.                                                                                            |
| &ensp;├─ `components`           | `string`[]         | Yes      | Registered component names (e.g. context, datasets, uss).                                                            |
| &ensp;└─ `backend`              | `string` \| `null` | Yes      | Active backend: mock, native, or null.                                                                               |
| `activeSystem`                  | `object` \| `null` | Yes      | Currently selected system and user; null if no system has been set yet.                                              |
| &ensp;├─ `system`               | `string`           | Yes      | Hostname of the active z/OS system.                                                                                  |
| &ensp;├─ `userId`               | `string`           | Yes      | User ID on that system.                                                                                              |
| &ensp;├─ `activeConnection`     | `string`           | No       | Connection spec (user@host) for the active system.                                                                   |
| &ensp;├─ `ussHome`              | `string`           | No       | USS home directory path for this system/user (when known).                                                           |
| &ensp;├─ `ussCwd`               | `string`           | No       | Current USS working directory (when set via changeUssDirectory).                                                     |
| &ensp;├─ `mainframeMvsEncoding` | `string`           | No       | Effective MVS/data set encoding for this system (e.g. IBM-037). Resolved from per-system override or server default. |
| &ensp;├─ `mainframeUssEncoding` | `string`           | No       | Effective USS encoding for this system (e.g. IBM-1047). Resolved from per-system override or server default.         |
| &ensp;└─ `jobCard`              | `string`           | No       | Job card for this connection when configured. Used by submitJob when JCL has no job card.                            |
| `allSystems`                    | `object`[]         | Yes      | All configured z/OS systems with host, optional description/connections, and active flag.                            |
| &ensp;├─ `host`                 | `string`           | Yes      | System hostname.                                                                                                     |
| &ensp;├─ `description`          | `string`           | No       | Optional label.                                                                                                      |
| &ensp;├─ `connections`          | `string`[]         | No       | Connection specs when multiple connections exist for this host.                                                      |
| &ensp;└─ `active`               | `boolean`          | Yes      | True if this system is the active one.                                                                               |
| `recentlyUsedSystems`           | `object`[]         | Yes      | Systems that have been used in this session (have saved context: userId, optional ussHome/encodings).                |
| &ensp;├─ `system`               | `string`           | Yes      | System hostname.                                                                                                     |
| &ensp;├─ `userId`               | `string`           | Yes      | User ID used on that system.                                                                                         |
| &ensp;├─ `ussHome`              | `string`           | No       | USS home when known.                                                                                                 |
| &ensp;├─ `ussCwd`               | `string`           | No       | USS current working directory when set.                                                                              |
| &ensp;├─ `mainframeMvsEncoding` | `string` \| `null` | No       | Per-system MVS encoding when set.                                                                                    |
| &ensp;└─ `mainframeUssEncoding` | `string` \| `null` | No       | Per-system USS encoding when set.                                                                                    |

#### Example Output

```json
{
  "server": {
    "name": "Zowe MCP Server",
    "version": "0.8.0-dev",
    "description": "MCP server providing tools for z/OS systems including data sets, jobs, and UNIX System Services",
    "components": [
      "context",
      "datasets",
      "uss",
      "tso",
      "jobs",
      "local-files"
    ],
    "backend": "mock"
  },
  "activeSystem": {
    "system": "mainframe-dev.example.com",
    "userId": "USER",
    "activeConnection": "USER@mainframe-dev.example.com",
    "mainframeMvsEncoding": "IBM-037",
    "mainframeUssEncoding": "IBM-1047"
  },
  "allSystems": [
    {
      "host": "mainframe-dev.example.com",
      "description": "Development LPAR",
      "active": true
    },
    {
      "host": "mainframe-test.example.com",
      "description": "Test/QA LPAR",
      "active": false
    }
  ],
  "recentlyUsedSystems": [
    {
      "system": "mainframe-dev.example.com",
      "userId": "USER"
    }
  ]
}
```

---

### `listSystems`

> Read-only

List all z/OS systems you have access to. Each system is a host; multiple configured connections (user@host) to the same host appear as one system with a connections list. Use setSystem to select which system (and optionally which connection) to use.

#### Parameters

*No parameter.*

<a id="listsystems-output-schema"></a>

#### Output Schema

| Field                  | Type       | Required | Description                                                                                                                                        |
|------------------------|------------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| `messages`             | `string`[] | No       | Informational messages (e.g. resolution notes). Omitted when empty.                                                                                |
| `systems`              | `object`[] | Yes      | All configured z/OS systems you have access to.                                                                                                    |
| &ensp;├─ `host`        | `string`   | Yes      | z/OS system hostname (e.g. sys1.example.com).                                                                                                      |
| &ensp;├─ `description` | `string`   | No       | Optional human-readable label for the system.                                                                                                      |
| &ensp;├─ `connections` | `string`[] | No       | Connection specs (user@host or user@host:port) when multiple connections exist for this host. Use setSystem with one of these when disambiguating. |
| &ensp;└─ `active`      | `boolean`  | Yes      | True if this system is the currently active one.                                                                                                   |

#### Example Output

```json
{
  "systems": [
    {
      "host": "mainframe-dev.example.com",
      "description": "Development LPAR",
      "active": false
    },
    {
      "host": "mainframe-test.example.com",
      "description": "Test/QA LPAR",
      "active": false
    }
  ]
}
```

---

### `setSystem`


Set the active z/OS system. The system parameter can be a host (e.g. zos.example.com) when only one connection exists for that host, or a connection spec (e.g. USER@zos.example.com) when multiple connections exist for the same host. If you pass only a host and multiple connections exist, the tool fails and lists valid connection values. Optionally set mainframe encodings for this system (data set and USS); omit to leave existing overrides unchanged, or pass null to use MCP server default.

#### Parameters

| Parameter              | Type               | Required | Description                                                                                                                                                             |
|------------------------|--------------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `system`               | `string`           | Yes      | Hostname of the z/OS system to activate (e.g. sys1.example.com or sys1 when unambiguous), or connection spec (user@host) when multiple connections exist for that host. |
| `mainframeMvsEncoding` | `string` \| `null` | No       | MVS/data set encoding (EBCDIC) for this system. Omit to leave unchanged; pass null to use MCP server default.                                                           |
| `mainframeUssEncoding` | `string` \| `null` | No       | Mainframe USS encoding (EBCDIC) for this system. Omit to leave unchanged; pass null to use MCP server default.                                                          |

<a id="setsystem-output-schema"></a>

#### Output Schema

| Field                  | Type               | Required | Description                                                                                                   |
|------------------------|--------------------|----------|---------------------------------------------------------------------------------------------------------------|
| `messages`             | `string`[]         | No       | Resolution or connection messages (e.g. "System resolved from unqualified name 'sys1'."). Omitted when empty. |
| `activeSystem`         | `string`           | Yes      | Resolved hostname of the active z/OS system.                                                                  |
| `userId`               | `string`           | Yes      | User ID on that system (e.g. from credentials).                                                               |
| `description`          | `string`           | No       | Optional system description/label from configuration.                                                         |
| `mainframeMvsEncoding` | `string` \| `null` | No       | Per-system MVS/data set encoding override (e.g. IBM-037). null = use MCP server default.                      |
| `mainframeUssEncoding` | `string` \| `null` | No       | Per-system USS encoding override (e.g. IBM-1047). null = use MCP server default.                              |

#### Example Output

Input:

```json
{
  "system": "mainframe-dev.example.com"
}
```

Output:

```json
{
  "activeSystem": "mainframe-dev.example.com",
  "userId": "USER",
  "description": "Development LPAR"
}
```

---

### `listDatasets`

> Read-only

List data sets matching a DSLEVEL pattern. Results are paginated (default 500, max 1000 per page); follow the pagination instructions in the server instructions. Use the detail parameter to control response verbosity (minimal, basic, full). DSLEVEL pattern (dataset list pattern for dsnPattern). It is not the same as grep regex or Windows filename masks.

Rules:
- Pattern must not begin with a wildcard (first qualifier must be literal, e.g. USER or MY.HIGH.LEVEL).
- Maximum length 44 characters.

Wildcards:
- % — any single character in that position (e.g. USER.TEST% matches USER.TEST1 and USER.TEST2).
- * — any characters within that one qualifier only (e.g. USER.J*.OLD matches USER.JCL.OLD but not USER.JCL.VERY.OLD).
- ** — any characters across any number of qualifiers (e.g. USER.**.OLD matches both USER.JCL.OLD and USER.JCL.VERY.OLD).

Patterns are fully qualified. MY.DATASET and 'MY.DATASET' are equivalent.

Examples:
- Exact or prefix: USER, MY.DATASET, USER.**
- Single qualifier wildcard: USER.J*.CNTL
- Multi-qualifier: USER.**.CNTL (anything under USER ending in qualifier CNTL)

Correct use of * and ** in one pattern:
- USER.T*.**.OLD — * matches any second qualifier that starts with T (e.g. TEST, TST); ** matches zero or more qualifiers before the final OLD. Matches USER.TEST.OLD, USER.TEST.BACKUP.OLD, USER.TST.X.Y.OLD.
- USER.**.*JCL* — * matches any last qualifier that contains JCL (e.g. JCL, MYJCL, JCLOLD); ** matches zero or more qualifiers before the final segment. Matches USER.JCL, USER.BACKUP.JCLS, USER.TEST.SAMPJCL.

Invalid patterns:
- USER.**JCL — Invalid: ** must be the entire qualifier (no other characters). Use USER.**.*JCL* instead.
- USER.**JCL* — Invalid: ** and * cannot be combined in the same qualifier. Use USER.**.*JCL* instead.
- USER.**.**.OLD — Avoid using ** more than once; a single ** already matches any number of qualifiers.

Notes:
- USER.*.OLD — Wrong when you want names like USER.JCL.VERY.OLD that match multiple qualifiers. * matches only one qualifier, so it matches USER.JCL.OLD but not USER.JCL.VERY.OLD. Use USER.**.OLD to match any number of middle qualifiers.
- *.DATASET or **.DATASET — Possible but will cause all catalogs on the system to be searched. It will take a considerable amount of time to complete this search. If you can be more specific, do so.

#### Parameters

| Parameter    | Type                           | Required | Description                                                                                                                                                                                                                                                                                                                       |
|--------------|--------------------------------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsnPattern` | `string`                       | Yes      | Fully qualified data set list pattern (e.g. USER.* or USER.**). Wildcards: * matches one qualifier, ** matches across qualifiers, % matches one character.                                                                                                                                                                        |
| `system`     | `string`                       | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                                                                                                                                                                                               |
| `volser`     | `string`                       | No       | Volume serial (VOLSER) to restrict the search to a specific DASD volume. Primarily used for uncataloged data sets that are not in the system catalog.                                                                                                                                                                             |
| `offset`     | `integer`                      | No       | 0-based offset into the result set. Default: 0.                                                                                                                                                                                                                                                                                   |
| `limit`      | `integer`                      | No       | Maximum number of items to return. Default: 500. Max: 1000.                                                                                                                                                                                                                                                                       |
| `detail`     | `minimal` \| `basic` \| `full` | No       | Level of detail for each data set entry. minimal: dsn, dsorg, dsntype; migrated/encrypted only when true; volser only for non-SMS. basic (default): adds recfm, lrecl, blksz, space; volser only for non-SMS (no volsers). full: all attributes including resourceLink, SMS classes, device type, all dates. (default: `"basic"`) |

<a id="listdatasets-output-schema"></a>

#### Output Schema

| Field                        | Type       | Required | Description                                                                                                                                                                                                                                                                          |
|------------------------------|------------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`                   | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns.                                                                                                                                                                                                          |
| &ensp;├─ `system`            | `string`   | Yes      | Resolved z/OS system hostname (target of the operation).                                                                                                                                                                                                                             |
| &ensp;├─ `resolvedPattern`   | `string`   | No       | Normalized list pattern (uppercase, no quotes). Present only when input was quoted or lowercase.                                                                                                                                                                                     |
| &ensp;├─ `resolvedDsn`       | `string`   | No       | Normalized data set name (uppercase, no quotes). Present only when input was quoted or lowercase.                                                                                                                                                                                    |
| &ensp;└─ `resolvedTargetDsn` | `string`   | No       | Normalized target data set name for copy/rename. Present only when input differed from resolved value.                                                                                                                                                                               |
| `_result`                    | `object`   | Yes      | Result metadata (pagination, line window, or success).                                                                                                                                                                                                                               |
| &ensp;├─ `count`             | `number`   | Yes      | Number of items returned in this page.                                                                                                                                                                                                                                               |
| &ensp;├─ `totalAvailable`    | `number`   | Yes      | Total matching items before pagination.                                                                                                                                                                                                                                              |
| &ensp;├─ `offset`            | `number`   | Yes      | 0-based offset of the first item in this page.                                                                                                                                                                                                                                       |
| &ensp;└─ `hasMore`           | `boolean`  | Yes      | True if more items exist. Call the tool again with offset = offset + count and the same limit to fetch the next page.                                                                                                                                                                |
| `messages`                   | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty.                                                                                                                                            |
| `data`                       | `object`[] | Yes      | Array of data set entries. Fields depend on detail: minimal (dsn, dsorg, dsntype; migrated/encrypted only when true; volser for non-SMS), basic (adds recfm, lrecl, blksz, space; volser for non-SMS, no volsers), full (all attributes including resourceLink, dates, SMS classes). |
| &ensp;├─ `dsn`               | `string`   | Yes      | Fully qualified data set name (uppercase, no quotes).                                                                                                                                                                                                                                |
| &ensp;├─ `resourceLink`      | `string`   | No       | Resource URI (zos-ds://system/dsn) for this data set. Only present at detail level full.                                                                                                                                                                                             |
| &ensp;├─ `dsorg`             | `string`   | No       | Data set organization: PS (sequential), PO (PDS), PO-E (PDS/E), VS, DA. Present at all detail levels.                                                                                                                                                                                |
| &ensp;├─ `recfm`             | `string`   | No       | Record format: F, FB, V, VB, U, FBA, VBA.                                                                                                                                                                                                                                            |
| &ensp;├─ `lrecl`             | `number`   | No       | Logical record length in bytes.                                                                                                                                                                                                                                                      |
| &ensp;├─ `blksz`             | `number`   | No       | Block size in bytes.                                                                                                                                                                                                                                                                 |
| &ensp;├─ `volser`            | `string`   | No       | Volume serial where the data set resides. Omitted for VSAM data sets (use dsorg VS to identify VSAM).                                                                                                                                                                                |
| &ensp;├─ `creationDate`      | `string`   | No       | Creation date (YYYY-MM-DD).                                                                                                                                                                                                                                                          |
| &ensp;├─ `referenceDate`     | `string`   | No       | Last referenced date (YYYY-MM-DD).                                                                                                                                                                                                                                                   |
| &ensp;├─ `expirationDate`    | `string`   | No       | Expiration date (YYYY-MM-DD).                                                                                                                                                                                                                                                        |
| &ensp;├─ `multivolume`       | `boolean`  | No       | True if data set spans multiple volumes.                                                                                                                                                                                                                                             |
| &ensp;├─ `migrated`          | `boolean`  | No       | True if data set is migrated (HSM).                                                                                                                                                                                                                                                  |
| &ensp;├─ `encrypted`         | `boolean`  | No       | True if data set is encrypted.                                                                                                                                                                                                                                                       |
| &ensp;├─ `dsntype`           | `string`   | No       | Data set name type (e.g. PDS, LIBRARY).                                                                                                                                                                                                                                              |
| &ensp;├─ `dataclass`         | `string`   | No       | SMS data class.                                                                                                                                                                                                                                                                      |
| &ensp;├─ `mgmtclass`         | `string`   | No       | SMS management class.                                                                                                                                                                                                                                                                |
| &ensp;├─ `storclass`         | `string`   | No       | SMS storage class.                                                                                                                                                                                                                                                                   |
| &ensp;├─ `spaceUnits`        | `string`   | No       | Space unit type (TRACKS, CYLINDERS, etc.).                                                                                                                                                                                                                                           |
| &ensp;├─ `usedPercent`       | `number`   | No       | Used space percentage.                                                                                                                                                                                                                                                               |
| &ensp;├─ `usedExtents`       | `number`   | No       | Used extents count.                                                                                                                                                                                                                                                                  |
| &ensp;├─ `primary`           | `number`   | No       | Primary allocation units.                                                                                                                                                                                                                                                            |
| &ensp;├─ `secondary`         | `number`   | No       | Secondary allocation units.                                                                                                                                                                                                                                                          |
| &ensp;├─ `devtype`           | `string`   | No       | Device type.                                                                                                                                                                                                                                                                         |
| &ensp;└─ `volsers`           | `string`[] | No       | Multi-volume serial list.                                                                                                                                                                                                                                                            |

#### Example Outputs

##### default

Input:

```json
{
  "dsnPattern": "USER.*"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "count": 8,
    "totalAvailable": 8,
    "offset": 0,
    "hasMore": false
  },
  "data": [
    {
      "dsn": "USER.DATA.FILE01",
      "dsorg": "PS",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "volser": "VOL001"
    },
    {
      "dsn": "USER.DATA.INPUT",
      "dsorg": "PS",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "volser": "VOL001"
    },
    {
      "dsn": "USER.JCL.CNTL",
      "dsorg": "PO-E",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "volser": "VOL001"
    },
    {
      "dsn": "USER.LISTING",
      "dsorg": "PS",
      "recfm": "FBA",
      "lrecl": 133,
      "blksz": 27920,
      "volser": "VOL001"
    },
    {
      "dsn": "USER.LOADLIB",
      "dsorg": "PO-E",
      "recfm": "U",
      "lrecl": 0,
      "blksz": 32760,
      "volser": "VOL001"
    },
    {
      "dsn": "USER.SRC.COBOL",
      "dsorg": "PO-E",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "volser": "VOL001"
    },
    {
  // ... truncated ...
```

##### no results

Input:

```json
{
  "dsnPattern": "NONEXIST.*"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "count": 0,
    "totalAvailable": 0,
    "offset": 0,
    "hasMore": false
  },
  "data": []
}
```

---

### `listMembers`

> Read-only

List members of a PDS or PDS/E data set Results are paginated (default 500, max 1000 per page); follow the pagination instructions in the server instructions.

#### Parameters

| Parameter       | Type      | Required | Description                                                                                                         |
|-----------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `dsn`           | `string`  | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                |
| `memberPattern` | `string`  | No       | Optional member name filter. Wildcards: * (zero or more characters), % (one character). E.g. "ABC*", "A%C".         |
| `system`        | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `offset`        | `integer` | No       | 0-based offset into the result set. Default: 0.                                                                     |
| `limit`         | `integer` | No       | Maximum number of items to return. Default: 500. Max: 1000.                                                         |

<a id="listmembers-output-schema"></a>

#### Output Schema

| Field             | Type       | Required | Description                                                                                                                               |
|-------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`        | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`         | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`listDatasets`](#listdatasets-output-schema))*                          |
| `messages`        | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`            | `object`[] | Yes      | Array of PDS or PDS/E member entries. Each entry has the member name (up to 8 characters, uppercase).                                     |
| &ensp;└─ `member` | `string`   | Yes      | PDS or PDS/E member name (up to 8 characters, uppercase).                                                                                 |

#### Example Outputs

##### default

Input:

```json
{
  "dsn": "USER.SRC.COBOL"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "count": 5,
    "totalAvailable": 5,
    "offset": 0,
    "hasMore": false
  },
  "data": [
    {
      "member": "ACCTPROC"
    },
    {
      "member": "BATCHUPD"
    },
    {
      "member": "CUSTFILE"
    },
    {
      "member": "RPTGEN"
    },
    {
      "member": "VALCHECK"
    }
  ]
}
```

##### with pattern

Input:

```json
{
  "dsn": "USER.SRC.COBOL",
  "memberPattern": "CUST*"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "count": 1,
    "totalAvailable": 1,
    "offset": 0,
    "hasMore": false
  },
  "data": [
    {
      "member": "CUSTFILE"
    }
  ]
}
```

---

### `searchInDataset`

> Read-only

Search for a string in a sequential data set, PDS, or PDS/E (all members or one member). Results are paginated (default 500, max 1000 per page); follow the pagination instructions in the server instructions. Returns matching lines with line numbers and a summary. You may pass dsn as USER.LIB(MEM) and omit member. Options: caseSensitive (default false), cobol (search cols 7–72 only), ignoreSequenceNumbers (exclude cols 73–80, default true), doNotProcessComments, includeContextLines (±6 lines via LPSF)

#### Parameters

| Parameter               | Type       | Required | Description                                                                                                                                                                                           |
|-------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`                   | `string`   | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL or SYS1.SAMPLIB).                                                                                                                                  |
| `string`                | `string`   | Yes      | Search string (literal) to find in the data set or members.                                                                                                                                           |
| `system`                | `string`   | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                                                                   |
| `encoding`              | `string`   | No       | Mainframe encoding (EBCDIC) for reading data set content. Overrides system and server default when set.                                                                                               |
| `member`                | `string`   | No       | For PDS or PDS/E only, limit search to this member (e.g. IEANTCOB). Omit to search all members or a sequential data set.                                                                              |
| `offset`                | `integer`  | No       | 0-based offset into the member list. Default: 0.                                                                                                                                                      |
| `limit`                 | `integer`  | No       | Number of members to return per page. Default: 500. Max: 1000.                                                                                                                                        |
| `caseSensitive`         | `boolean`  | No       | When true, match exact case. Default false (case-insensitive).                                                                                                                                        |
| `cobol`                 | `boolean`  | No       | When true, restrict search to columns 7–72 only (the COBOL program text area, skipping the line-number area in columns 1–6). Also called COBOL mode. Default: false.                                  |
| `ignoreSequenceNumbers` | `boolean`  | No       | When true (default), exclude columns 73–80 from search. Columns 73–80 are the traditional card sequence-number field in fixed-length records. When false, search includes those columns as data.      |
| `doNotProcessComments`  | `string`[] | No       | Comment types to exclude from search: asterisk, cobolComment, fortran, cpp, pli, pascal, pcAssembly, ada (case-insensitive).                                                                          |
| `includeContextLines`   | `boolean`  | No       | When true, include ±6 lines of context (beforeContext/afterContext) around each match via SuperC LPSF. Only effective with the native ZNP backend; ignored by the fallback grep path. Default: false. |

<a id="searchindataset-output-schema"></a>

#### Output Schema

| Field                          | Type       | Required | Description                                                                                                                               |
|--------------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`                     | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`                      | `object`   | Yes      | Result metadata (pagination, line window, or success).                                                                                    |
| &ensp;├─ `count`               | `number`   | Yes      | Number of members returned in this page.                                                                                                  |
| &ensp;├─ `totalAvailable`      | `number`   | Yes      | Total members with matches (before pagination).                                                                                           |
| &ensp;├─ `offset`              | `number`   | Yes      | 0-based offset of the first member in this page.                                                                                          |
| &ensp;├─ `hasMore`             | `boolean`  | Yes      | True if more members exist. Call again with offset and limit to fetch the next page.                                                      |
| &ensp;├─ `linesFound`          | `number`   | Yes      | Total lines that matched the search string across all members.                                                                            |
| &ensp;├─ `linesProcessed`      | `number`   | Yes      | Total lines read across all members during the search.                                                                                    |
| &ensp;├─ `membersWithLines`    | `number`   | Yes      | Number of members that had at least one matching line.                                                                                    |
| &ensp;├─ `membersWithoutLines` | `number`   | Yes      | Number of members with no matches (PDS or PDS/E only).                                                                                    |
| &ensp;├─ `searchPattern`       | `string`   | Yes      | The literal search string that was used.                                                                                                  |
| &ensp;└─ `processOptions`      | `string`   | Yes      | SuperC process options applied (e.g. ANYC for case-insensitive, COBOL for column 7–72).                                                   |
| `messages`                     | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`                         | `object`   | Yes      |                                                                                                                                           |
| &ensp;├─ `dataset`             | `string`   | Yes      | Fully qualified data set name that was searched.                                                                                          |
| &ensp;├─ `members`             | `object`[] | Yes      | Members in this page with their matching lines.                                                                                           |
| &ensp;└─ `summary`             | `object`   | Yes      | Aggregate counts and options for the search.                                                                                              |

#### Example Outputs

##### default

Input:

```json
{
  "dsn": "USER.SRC.COBOL",
  "string": "DIVISION"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "count": 5,
    "totalAvailable": 5,
    "offset": 0,
    "hasMore": false,
    "linesFound": 20,
    "linesProcessed": 405,
    "membersWithLines": 5,
    "membersWithoutLines": 0,
    "searchPattern": "DIVISION",
    "processOptions": "ANYC SEQ"
  },
  "data": {
    "dataset": "USER.SRC.COBOL",
    "members": [
      {
        "name": "ACCTPROC",
        "matches": [
          {
            "lineNumber": 1,
            "content": "       IDENTIFICATION DIVISION."
          },
          {
            "lineNumber": 9,
            "content": "       ENVIRONMENT DIVISION."
          },
          {
            "lineNumber": 25,
            "content": "       DATA DIVISION."
          },
          {
            "lineNumber": 47,
            "content": "       PROCEDURE DIVISION."
          }
        ]
      },
      {
        "name": "BATCHUPD",
        "matches": [
          {
            "lineNumber": 1,
            "content": "       IDENTIFICATION DIVISION."
          },
          {
            "lineNumber": 9,
            "content": "       ENVIRONMENT DIVISION."
          },
          {
            "lineNumber": 25,
            "content": "       DATA DIVISION."
          },
          {
            "lineNumber": 47,
            "content": "       PROCEDURE DIVISION."
          }
        ]
  // ... truncated ...
```

##### single member

Input:

```json
{
  "dsn": "USER.SRC.COBOL",
  "member": "CUSTFILE",
  "string": "WORKING-STORAGE"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "count": 1,
    "totalAvailable": 1,
    "offset": 0,
    "hasMore": false,
    "linesFound": 1,
    "linesProcessed": 81,
    "membersWithLines": 1,
    "membersWithoutLines": 0,
    "searchPattern": "WORKING-STORAGE",
    "processOptions": "ANYC SEQ"
  },
  "data": {
    "dataset": "USER.SRC.COBOL",
    "members": [
      {
        "name": "CUSTFILE",
        "matches": [
          {
            "lineNumber": 37,
            "content": "       WORKING-STORAGE SECTION."
          }
        ]
      }
    ],
    "summary": {
      "linesFound": 1,
      "linesProcessed": 81,
      "membersWithLines": 1,
      "membersWithoutLines": 0,
      "searchPattern": "WORKING-STORAGE",
      "processOptions": "ANYC SEQ"
    }
  }
}
```

---

### `getDatasetAttributes`

> Read-only

Get detailed attributes of a data set: organization, record format, record length, block size, volume, SMS classes, dates, and more. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `dsn`     | `string` | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="getdatasetattributes-output-schema"></a>

#### Output Schema

| Field                     | Type       | Required | Description                                                                                                                               |
|---------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`                | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `messages`                | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`                    | `object`   | Yes      |                                                                                                                                           |
| &ensp;├─ `dsn`            | `string`   | Yes      | Fully qualified data set name.                                                                                                            |
| &ensp;├─ `type`           | `string`   | Yes      | Data set organization (DSORG): PS, PO, PO-E, VS, DA.                                                                                      |
| &ensp;├─ `recfm`          | `string`   | No       | Record format (F, FB, V, VB, U, etc.).                                                                                                    |
| &ensp;├─ `lrecl`          | `number`   | No       | Logical record length.                                                                                                                    |
| &ensp;├─ `blksz`          | `number`   | No       | Block size.                                                                                                                               |
| &ensp;├─ `volser`         | `string`   | No       | Volume serial.                                                                                                                            |
| &ensp;├─ `creationDate`   | `string`   | No       | Creation date (YYYY-MM-DD).                                                                                                               |
| &ensp;├─ `referenceDate`  | `string`   | No       | Last reference date (YYYY-MM-DD).                                                                                                         |
| &ensp;├─ `expirationDate` | `string`   | No       | Expiration date (YYYY-MM-DD).                                                                                                             |
| &ensp;├─ `smsClass`       | `string`   | No       | SMS storage/management class (when SMS managed).                                                                                          |
| &ensp;├─ `usedTracks`     | `number`   | No       | Number of tracks used.                                                                                                                    |
| &ensp;├─ `usedExtents`    | `number`   | No       | Number of extents used.                                                                                                                   |
| &ensp;├─ `multivolume`    | `boolean`  | No       | True if data set spans multiple volumes.                                                                                                  |
| &ensp;├─ `migrated`       | `boolean`  | No       | True if data set is migrated (HSM).                                                                                                       |
| &ensp;├─ `encrypted`      | `boolean`  | No       | True if data set is encrypted.                                                                                                            |
| &ensp;├─ `dsntype`        | `string`   | No       | Data set name type (e.g. PDS, LIBRARY).                                                                                                   |
| &ensp;├─ `dataclass`      | `string`   | No       | SMS data class.                                                                                                                           |
| &ensp;├─ `mgmtclass`      | `string`   | No       | SMS management class.                                                                                                                     |
| &ensp;├─ `storclass`      | `string`   | No       | SMS storage class.                                                                                                                        |
| &ensp;├─ `spaceUnits`     | `string`   | No       | Space unit type (TRACKS, CYLINDERS, etc.).                                                                                                |
| &ensp;├─ `usedPercent`    | `number`   | No       | Used space percentage.                                                                                                                    |
| &ensp;├─ `primary`        | `number`   | No       | Primary allocation units.                                                                                                                 |
| &ensp;├─ `secondary`      | `number`   | No       | Secondary allocation units.                                                                                                               |
| &ensp;├─ `devtype`        | `string`   | No       | Device type.                                                                                                                              |
| &ensp;└─ `volsers`        | `string`[] | No       | Multi-volume serial list.                                                                                                                 |

#### Example Output

Input:

```json
{
  "dsn": "USER.SRC.COBOL"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "data": {
    "dsn": "USER.SRC.COBOL",
    "type": "PO-E",
    "recfm": "FB",
    "lrecl": 80,
    "blksz": 27920,
    "volser": "VOL001",
    "creationDate": "2024-03-15"
  }
}
```

---

### `readDataset`

> Read-only

Read the content of a sequential data set or PDS/E member. Results may be line-windowed; follow the pagination instructions in the server instructions. Returns UTF-8 text, an ETag for optimistic locking, and the source encoding. Pass the ETag to writeDataset to prevent overwriting concurrent changes. You may pass dsn as USER.LIB(MEM) and omit member

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                                                                                                            |
|-------------|-----------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`       | `string`  | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                                                                                                   |
| `member`    | `string`  | No       | Member name for PDS or PDS/E data sets.                                                                                                                                                                |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                                                                    |
| `encoding`  | `string`  | No       | Mainframe encoding (EBCDIC) for this read. Overrides system and server default when set. Default: from system or MCP server default.                                                                   |
| `startLine` | `integer` | No       | 1-based starting line number for random access — use this to jump directly to any line without reading from the beginning. Default: 1.                                                                 |
| `lineCount` | `integer` | No       | Number of lines to return from startLine. Use with startLine to read an exact range (e.g. startLine: 20, lineCount: 10 for lines 20–29). Default: all remaining lines up to the auto-truncation limit. |

<a id="readdataset-output-schema"></a>

#### Output Schema

| Field                    | Type       | Required | Description                                                                                                                               |
|--------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`               | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`                | `object`   | Yes      | Result metadata (pagination, line window, or success).                                                                                    |
| &ensp;├─ `totalLines`    | `number`   | Yes      | Total number of lines in the full content.                                                                                                |
| &ensp;├─ `startLine`     | `number`   | Yes      | 1-based line number of the first line returned in this window.                                                                            |
| &ensp;├─ `returnedLines` | `number`   | Yes      | Number of lines in the returned window.                                                                                                   |
| &ensp;├─ `contentLength` | `number`   | Yes      | Character count of the returned text.                                                                                                     |
| &ensp;├─ `mimeType`      | `string`   | Yes      | Inferred content type (e.g. text/plain, text/x-cobol, text/x-jcl). Used for display or syntax highlighting.                               |
| &ensp;└─ `hasMore`       | `boolean`  | Yes      | True if more lines exist. Call the tool again with startLine and lineCount to fetch the next window.                                      |
| `messages`               | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`                   | `object`   | Yes      |                                                                                                                                           |
| &ensp;├─ `lines`         | `string`[] | Yes      | Content as array of lines (UTF-8). When _result.hasMore is true, call again with startLine/lineCount to get more.                         |
| &ensp;├─ `etag`          | `string`   | Yes      | Opaque version token. Pass to writeDataset for optimistic locking so the write fails if the data set changed since the read.              |
| &ensp;└─ `encoding`      | `string`   | Yes      | Mainframe (EBCDIC) encoding used to convert to UTF-8 (e.g. IBM-037, IBM-1047).                                                            |

#### Example Outputs

##### default

Input:

```json
{
  "dsn": "USER.SRC.COBOL(CUSTFILE)"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "totalLines": 80,
    "startLine": 1,
    "returnedLines": 80,
    "contentLength": 2582,
    "mimeType": "text/x-cobol",
    "hasMore": false
  },
  "data": {
    "lines": [
      "       IDENTIFICATION DIVISION.",
      "       PROGRAM-ID. CUSTFILE.",
      "       AUTHOR. GENERATED-MOCK.",
      "       DATE-WRITTEN. 2024-03-15.",
      "      *",
      "      * CUSTFILE - Generated mock COBOL program",
      "      * Part of USER application suite",
      "      *",
      "       ENVIRONMENT DIVISION.",
      "       CONFIGURATION SECTION.",
      "       SOURCE-COMPUTER. IBM-ZOS.",
      "       OBJECT-COMPUTER. IBM-ZOS.",
      "      *",
      "       INPUT-OUTPUT SECTION.",
      "       FILE-CONTROL.",
      "           SELECT INFILE  ASSIGN TO INDD",
      "                  ORGANIZATION IS SEQUENTIAL",
      "                  ACCESS MODE IS SEQUENTIAL",
      "                  FILE STATUS IS WS-FILE-STATUS.",
      "           SELECT OUTFILE ASSIGN TO OUTDD",
      "                  ORGANIZATION IS SEQUENTIAL",
      "                  ACCESS MODE IS SEQUENTIAL",
      "                  FILE STATUS IS WS-OUT-STATUS.",
      "      *",
      "       DATA DIVISION.",
      "       FILE SECTION.",
      "       FD  INFILE",
      "           RECORDING MODE IS F",
      "           BLOCK CONTAINS 0 RECORDS.",
      "       01  IN-RECORD                    PIC X(80).",
      "      *",
      "       FD  OUTFILE",
      "           RECORDING MODE IS F",
      "           BLOCK CONTAINS 0 RECORDS.",
      "       01  OUT-RECORD                   PIC X(133).",
      "      *",
      "       WORKING-STORAGE SECTION.",
      "       01  WS-FILE-STATUS               PIC XX VALUE SPACES.",
      "       01  WS-OUT-STATUS                PIC XX VALUE SPACES.",
      "       01  WS-EOF-FLAG                  PIC X  VALUE 'N'.",
      "           88 END-OF-FILE               VALUE 'Y'.",
      "       01  WS-RECORD-COUNT              PIC 9(7) VALUE ZERO.",
      "       01  WS-ERROR-COUNT               PIC 9(5) VALUE ZERO.",
      "      *",
      "           COPY ACCTFMT.",
      "      *",
  // ... truncated ...
```

##### with line window

Input:

```json
{
  "dsn": "USER.SRC.COBOL(CUSTFILE)",
  "startLine": 1,
  "lineCount": 10
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "totalLines": 80,
    "startLine": 1,
    "returnedLines": 10,
    "contentLength": 286,
    "mimeType": "text/x-cobol",
    "hasMore": true
  },
  "messages": [
    "More lines are available (showing lines 1–10 of 80). You must call this tool again with startLine=11 and the same lineCount to fetch the next page. Do not answer with only partial data—keep calling until _result.hasMore is false."
  ],
  "data": {
    "lines": [
      "       IDENTIFICATION DIVISION.",
      "       PROGRAM-ID. CUSTFILE.",
      "       AUTHOR. GENERATED-MOCK.",
      "       DATE-WRITTEN. 2024-03-15.",
      "      *",
      "      * CUSTFILE - Generated mock COBOL program",
      "      * Part of USER application suite",
      "      *",
      "       ENVIRONMENT DIVISION.",
      "       CONFIGURATION SECTION."
    ],
    "etag": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    "encoding": "IBM-037"
  }
}
```

---

### `writeDataset`


Write UTF-8 content to a sequential data set or PDS/E member. When startLine and endLine are provided, the block of records from startLine to endLine (inclusive) is replaced by the given lines; the number of lines need not match (data set can grow or shrink). When only startLine is provided, the same number of lines as in the lines array are replaced starting at startLine. When both are omitted, the entire data set or member is replaced. If an ETag is provided (from a previous readDataset call), the write fails if the data set was modified since the read — preventing overwrites. Returns a new ETag for the written content. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter   | Type       | Required | Description                                                                                                                                                                 |
|-------------|------------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`       | `string`   | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                                                                        |
| `lines`     | `string`[] | Yes      | UTF-8 content to write as an array of lines (one string per record).                                                                                                        |
| `member`    | `string`   | No       | Member name for PDS or PDS/E data sets.                                                                                                                                     |
| `system`    | `string`   | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                                         |
| `etag`      | `string`   | No       | ETag from a previous readDataset call for optimistic locking.                                                                                                               |
| `encoding`  | `string`   | No       | Mainframe encoding (EBCDIC) for this write. Overrides system and server default when set. Default: from system or MCP server default.                                       |
| `startLine` | `number`   | No       | 1-based first line of the block to replace; use with endLine to replace a range (content line count can differ).                                                            |
| `endLine`   | `number`   | No       | 1-based last line of the block to replace (inclusive). When provided with startLine, the replaced block can grow or shrink to match the number of lines in the lines array. |

<a id="writedataset-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                                               |
|--------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`          | `object`   | Yes      | Result metadata (pagination, line window, or success).                                                                                    |
| &ensp;└─ `success` | `boolean`  | Yes      | True when the operation completed successfully.                                                                                           |
| `messages`         | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`             | `object`   | Yes      |                                                                                                                                           |
| &ensp;└─ `etag`    | `string`   | Yes      | New ETag after the write. Use this for a subsequent read or write to detect concurrent changes.                                           |

---

### `createDataset`


Create a new sequential or partitioned data set. Specify the type (PS/SEQUENTIAL, PO/PDS, PO-E/PDSE/LIBRARY) and optional attributes (primarySpace, secondarySpace, blockSize, recfm, lrecl). Type and recfm values are case-insensitive.

#### Parameters

| Parameter         | Type     | Required | Description                                                                                                                                                                                                                                          |
|-------------------|----------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`             | `string` | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                                                                                                                                                 |
| `type`            | `string` | Yes      | Data set organization type (DSORG): PS or SEQUENTIAL (Physical Sequential — a flat file), PO or PDS (Partitioned Data Set — a directory of members), PO-E or PDSE or LIBRARY (PDS/E — Partitioned Data Set Extended, recommended). Case-insensitive. |
| `system`          | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                                                                                                                  |
| `recfm`           | `string` | No       | Record Format (RECFM). Supported: F (Fixed), FB (Fixed Blocked), V (Variable), VB (Variable Blocked), U (Undefined), FBA, VBA. Default: FB. Case-insensitive.                                                                                        |
| `lrecl`           | `number` | No       | Logical Record Length (LRECL) in bytes. Default: 80.                                                                                                                                                                                                 |
| `blockSize`       | `number` | No       | Block Size (BLKSIZE) in bytes. Default: 27920.                                                                                                                                                                                                       |
| `primarySpace`    | `number` | No       | Primary space allocation in tracks (the initial amount of disk space).                                                                                                                                                                               |
| `secondarySpace`  | `number` | No       | Secondary space allocation in tracks (additional space allocated when primary is full).                                                                                                                                                              |
| `dirblk`          | `number` | No       | Directory Blocks (DIRBLK) — number of 256-byte directory blocks (PDS only).                                                                                                                                                                          |
| `volser`          | `string` | No       | Volume serial (VOLSER) to allocate the data set on (e.g. VOL001).                                                                                                                                                                                    |
| `dataClass`       | `string` | No       | SMS Data Class for allocation (e.g. DCLAS01).                                                                                                                                                                                                        |
| `storageClass`    | `string` | No       | SMS Storage Class for allocation (e.g. SCLAS01).                                                                                                                                                                                                     |
| `managementClass` | `string` | No       | SMS Management Class for allocation (e.g. MCLAS01).                                                                                                                                                                                                  |

<a id="createdataset-output-schema"></a>

#### Output Schema

| Field                 | Type       | Required | Description                                                                                                                               |
|-----------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`            | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`             | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`            | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`                | `object`   | Yes      |                                                                                                                                           |
| &ensp;├─ `dsn`        | `string`   | Yes      | Fully qualified name of the created data set.                                                                                             |
| &ensp;├─ `type`       | `string`   | Yes      | Data set type created: PS (sequential), PO (PDS), PO-E (PDS/E).                                                                           |
| &ensp;└─ `allocation` | `object`   | No       | Allocation result when the backend returns it.                                                                                            |

---

### `createTempDataset`


Creates a new data set with a unique temporary name in a single call. Returns the created DSN for subsequent steps or cleanup. Same creation options as createDataset; optional prefix/suffix/qualifier for naming. Default prefix: current user + .TMP. Use primarySpace, secondarySpace, blockSize (Zowe CLI naming). Type and recfm are case-insensitive.

#### Parameters

| Parameter        | Type     | Required | Description                                                                                                                                                                                                                                          |
|------------------|----------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `type`           | `string` | Yes      | Data set organization type (DSORG): PS or SEQUENTIAL (Physical Sequential — a flat file), PO or PDS (Partitioned Data Set — a directory of members), PO-E or PDSE or LIBRARY (PDS/E — Partitioned Data Set Extended, recommended). Case-insensitive. |
| `system`         | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                                                                                                                  |
| `prefix`         | `string` | No       | HLQ for temp name (e.g. USER.TMP). Default: current user + .TMP.                                                                                                                                                                                     |
| `suffix`         | `string` | No       | Optional suffix qualifier for the generated prefix.                                                                                                                                                                                                  |
| `qualifier`      | `string` | No       | Last qualifier for the DSN (1–8 chars). If omitted, a unique qualifier is generated.                                                                                                                                                                 |
| `recfm`          | `string` | No       | Record Format (RECFM). Supported: F (Fixed), FB (Fixed Blocked), V (Variable), VB (Variable Blocked), U (Undefined), FBA, VBA. Default: FB. Case-insensitive.                                                                                        |
| `lrecl`          | `number` | No       | Logical Record Length (LRECL) in bytes. Default: 80.                                                                                                                                                                                                 |
| `blockSize`      | `number` | No       | Block Size (BLKSIZE) in bytes. Default: 27920.                                                                                                                                                                                                       |
| `primarySpace`   | `number` | No       | Primary space allocation in tracks (the initial amount of disk space).                                                                                                                                                                               |
| `secondarySpace` | `number` | No       | Secondary space allocation in tracks (additional space allocated when primary is full).                                                                                                                                                              |
| `dirblk`         | `number` | No       | Directory Blocks (DIRBLK) — number of 256-byte directory blocks (PDS only).                                                                                                                                                                          |

<a id="createtempdataset-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                                               |
|------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages` | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`     | `object`   | Yes      | *(same as [`createDataset`](#createdataset-output-schema))*                                                                               |

---

### `getTempDatasetPrefix`

> Read-only

Return a unique DSN prefix (HLQ) under which temporary data sets can be created. The prefix is verified not to exist on the system. Default: current user + .TMP.

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `prefix`  | `string` | No       | HLQ for temp names (e.g. USER.TMP). Default: current user on the target system + .TMP.                              |
| `suffix`  | `string` | No       | Optional suffix qualifier (last part of the generated prefix).                                                      |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="gettempdatasetprefix-output-schema"></a>

#### Output Schema

| Field                    | Type       | Required | Description                                                                                                                               |
|--------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`               | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`                | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`               | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`                   | `object`   | Yes      |                                                                                                                                           |
| &ensp;└─ `tempDsnPrefix` | `string`   | Yes      | Unique HLQ prefix under which to create temporary data sets (e.g. USER.TMP.XXXXXXXX.YYYYYYYY). Verified not to exist on the system.       |

#### Example Output

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "success": true
  },
  "data": {
    "tempDsnPrefix": "USER.TMP.A1B2C3D4.E5F6G7H8"
  }
}
```

---

### `getTempDatasetName`

> Read-only

Returns a single unique full temporary data set name (for one data set). The DSN is verified not to exist on the system. Same prefix/suffix defaults as getTempDatasetPrefix.

#### Parameters

| Parameter   | Type     | Required | Description                                                                                                         |
|-------------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `prefix`    | `string` | No       | HLQ for temp names (e.g. USER.TMP). Default: current user on the target system + .TMP.                              |
| `suffix`    | `string` | No       | Optional suffix qualifier for the generated prefix.                                                                 |
| `qualifier` | `string` | No       | Last qualifier for the DSN (e.g. DATA, 1–8 chars). If omitted, a unique qualifier is generated.                     |
| `system`    | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="gettempdatasetname-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                                               |
|--------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`          | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`         | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`             | `object`   | Yes      |                                                                                                                                           |
| &ensp;└─ `tempDsn` | `string`   | Yes      | Unique full temporary data set name. Verified not to exist on the system; use for a single createDataset call.                            |

#### Example Output

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "success": true
  },
  "data": {
    "tempDsn": "USER.TMP.A1B2C3D4.E5F6G7H8.J9K0L1M2"
  }
}
```

---

### `copyDataset`


Copy a data set or PDS or PDS/E member within a single z/OS system. You may pass source or target dsn as USER.LIB(MEM) and omit the corresponding member.

#### Parameters

| Parameter      | Type     | Required | Description                                                                                                         |
|----------------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `sourceDsn`    | `string` | Yes      | Fully qualified source data set name (e.g. USER.SRC.COBOL).                                                         |
| `targetDsn`    | `string` | Yes      | Fully qualified target data set name (e.g. USER.SRC.BACKUP).                                                        |
| `sourceMember` | `string` | No       | Source member name (for copying a single member).                                                                   |
| `targetMember` | `string` | No       | Target member name (defaults to source member name).                                                                |
| `system`       | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="copydataset-output-schema"></a>

#### Output Schema

| Field                | Type       | Required | Description                                                                                                                               |
|----------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`           | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`            | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`           | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`               | `object`   | Yes      |                                                                                                                                           |
| &ensp;├─ `sourceDsn` | `string`   | Yes      | Fully qualified source data set (or member) that was copied.                                                                              |
| &ensp;└─ `targetDsn` | `string`   | Yes      | Fully qualified target data set (or member) after the copy.                                                                               |

---

### `renameDataset`


Rename a data set or PDS or PDS/E member. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter   | Type     | Required | Description                                                                                                         |
|-------------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `dsn`       | `string` | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                |
| `newDsn`    | `string` | Yes      | Fully qualified new data set name (e.g. USER.SRC.NEW).                                                              |
| `member`    | `string` | No       | Current member name (for renaming a member within a PDS or PDS/E).                                                  |
| `newMember` | `string` | No       | New member name.                                                                                                    |
| `system`    | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="renamedataset-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                                               |
|--------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`          | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`         | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`             | `object`   | Yes      |                                                                                                                                           |
| &ensp;├─ `oldName` | `string`   | Yes      | Fully qualified name before the rename (data set or member).                                                                              |
| &ensp;└─ `newName` | `string`   | Yes      | Fully qualified name after the rename.                                                                                                    |

---

### `deleteDataset`

> Destructive

Delete a data set or a specific PDS or PDS/E member. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `dsn`     | `string` | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                |
| `member`  | `string` | No       | Member name to delete (if omitting, the entire data set is deleted).                                                |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="deletedataset-output-schema"></a>

#### Output Schema

| Field                 | Type       | Required | Description                                                                                                                               |
|-----------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`            | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`             | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`            | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`                | `object`   | Yes      |                                                                                                                                           |
| &ensp;└─ `deletedDsn` | `string`   | Yes      | Fully qualified name of the deleted data set or member (e.g. USER.PDS(MEM) for a member).                                                 |

---

### `deleteDatasetsUnderPrefix`

> Destructive

Delete all data sets whose names start with the given prefix (e.g. tempDsnPrefix from getTempDatasetPrefix). Prefix must have at least 3 qualifiers and contain TMP.

#### Parameters

| Parameter   | Type     | Required | Description                                                                                                                                                    |
|-------------|----------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsnPrefix` | `string` | Yes      | Fully qualified prefix (e.g. USER.TMP.A1B2C3D4.E5F6G7H8). All data sets matching this prefix will be deleted. Must have at least 3 qualifiers and contain TMP. |
| `system`    | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                            |

<a id="deletedatasetsunderprefix-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                                               |
|--------------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`          | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`         | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`             | `object`   | Yes      |                                                                                                                                           |
| &ensp;├─ `deleted` | `string`[] | Yes      | List of fully qualified data set names that were deleted.                                                                                 |
| &ensp;└─ `count`   | `number`   | Yes      | Number of data sets deleted.                                                                                                              |

---

### `restoreDataset`


Restore (recall) a migrated data set from the hierarchical storage manager (HSM/DFHSM). Use this when a data set shows as migrated in listDatasets or getDatasetAttributes.

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `dsn`     | `string` | Yes      | Fully qualified data set name (e.g. USER.ARCHIVE.DATA).                                                             |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="restoredataset-output-schema"></a>

#### Output Schema

| Field          | Type       | Required | Description                                                                                                                               |
|----------------|------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`     | `object`   | Yes      | Resolution context: system and optional normalized data set names/patterns. *(same as [`listDatasets`](#listdatasets-output-schema))*     |
| `_result`      | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*                          |
| `messages`     | `string`[] | No       | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. Omitted when empty. |
| `data`         | `object`   | Yes      |                                                                                                                                           |
| &ensp;└─ `dsn` | `string`   | Yes      | Fully qualified data set name that was restored (recalled).                                                                               |

---

### `getUssHome`

> Read-only

Return the current user's USS home directory for the active (or specified) system. 

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="getusshome-output-schema"></a>

#### Output Schema

| Field                       | Type       | Required | Description                                                                                                      |
|-----------------------------|------------|----------|------------------------------------------------------------------------------------------------------------------|
| `_context`                  | `object`   | Yes      | Resolution context: system and optional normalized USS paths.                                                    |
| &ensp;├─ `system`           | `string`   | Yes      | Resolved z/OS system hostname (target of the operation).                                                         |
| &ensp;├─ `resolvedPath`     | `string`   | No       | Resolved USS path when normalization changed the input.                                                          |
| &ensp;├─ `currentDirectory` | `string`   | No       | USS current working directory in display form.                                                                   |
| &ensp;└─ `listedDirectory`  | `string`   | No       | USS directory that was listed (listUssFiles).                                                                    |
| `_result`                   | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))* |
| `messages`                  | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                  |
| `data`                      | `object`   | Yes      |                                                                                                                  |
| &ensp;└─ `path`             | `string`   | Yes      | USS path (absolute or relative to cwd in display form).                                                          |

#### Example Output

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "success": true
  },
  "data": {
    "path": "/u/USER"
  }
}
```

---

### `changeUssDirectory`

> Read-only

Set the USS current working directory for the active (or specified) system. Path can be absolute (starts with /) or relative to the current working directory. The new cwd is used to resolve relative paths in other USS tools and is shown in getContext as ussCwd.

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`    | `string` | Yes      | Directory path to set as current working directory (absolute or relative to current cwd).                           |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="changeussdirectory-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

#### Example Output

Input:

```json
{
  "path": "/u/USER"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com",
    "currentDirectory": "."
  },
  "_result": {
    "success": true
  },
  "data": {
    "path": "/u/USER"
  }
}
```

---

### `listUssFiles`

> Read-only

List files and directories in a USS path Results are paginated (default 500, max 1000 per page); follow the pagination instructions in the server instructions.

#### Parameters

| Parameter       | Type      | Required | Description                                                                                                         |
|-----------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`          | `string`  | Yes      | USS directory path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).      |
| `system`        | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `includeHidden` | `boolean` | No       | Include hidden files (names starting with .). (default: `false`)                                                    |
| `longFormat`    | `boolean` | No       | Return long format (mode, size, mtime, name). (default: `false`)                                                    |
| `offset`        | `integer` | No       | 0-based offset. Default: 0.                                                                                         |
| `limit`         | `integer` | No       | Max items per page. Default: 500. Max: 1000.                                                                        |

<a id="listussfiles-output-schema"></a>

#### Output Schema

| Field                  | Type       | Required | Description                                                                                                                                               |
|------------------------|------------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `_context`             | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))*                                       |
| `_result`              | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`listDatasets`](#listdatasets-output-schema))*                                          |
| `messages`             | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                                                           |
| `data`                 | `object`[] | Yes      | Array of USS directory entries. Each entry has name, path, and optional long-format fields (links, user, group, size, filetag, mtime, mode, isDirectory). |
| &ensp;├─ `name`        | `string`   | Yes      | File or directory name.                                                                                                                                   |
| &ensp;├─ `path`        | `string`   | Yes      | Path in display form: relative if under current working directory, otherwise absolute.                                                                    |
| &ensp;├─ `links`       | `number`   | No       | Number of links (long format).                                                                                                                            |
| &ensp;├─ `user`        | `string`   | No       | Owner user (long format).                                                                                                                                 |
| &ensp;├─ `group`       | `string`   | No       | Owner group (long format).                                                                                                                                |
| &ensp;├─ `size`        | `number`   | No       | Size in bytes, files only (long format).                                                                                                                  |
| &ensp;├─ `filetag`     | `string`   | No       | z/OS file tag / encoding (long format).                                                                                                                   |
| &ensp;├─ `mtime`       | `string`   | No       | Modification time, ISO 8601 or platform string (long format).                                                                                             |
| &ensp;├─ `mode`        | `string`   | No       | Permission string, e.g. drwxr-xr-x (long format).                                                                                                         |
| &ensp;└─ `isDirectory` | `boolean`  | No       | True if this entry is a directory (long format).                                                                                                          |

#### Example Outputs

##### default

Input:

```json
{
  "path": "/"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com",
    "currentDirectory": ".",
    "listedDirectory": "/"
  },
  "_result": {
    "count": 1,
    "totalAvailable": 1,
    "offset": 0,
    "hasMore": false
  },
  "data": [
    {
      "name": "u",
      "path": "/u"
    }
  ]
}
```

##### user home

Input:

```json
{
  "path": "/u/USER"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com",
    "currentDirectory": ".",
    "listedDirectory": "."
  },
  "_result": {
    "count": 2,
    "totalAvailable": 2,
    "offset": 0,
    "hasMore": false
  },
  "data": [
    {
      "name": "file.txt",
      "path": "file.txt"
    },
    {
      "name": "subdir",
      "path": "subdir"
    }
  ]
}
```

---

### `readUssFile`

> Read-only

Read the content of a USS file Results may be line-windowed; follow the pagination instructions in the server instructions.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                         |
|-------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`      | `string`  | Yes      | USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).           |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `encoding`  | `string`  | No       | Mainframe (EBCDIC) encoding for the file. Omit to use system default or file tag.                                   |
| `startLine` | `integer` | No       | 1-based first line to return. Default: 1.                                                                           |
| `lineCount` | `integer` | No       | Number of lines to return. Omit for default window size.                                                            |

<a id="readussfile-output-schema"></a>

#### Output Schema

| Field               | Type       | Required | Description                                                                                                         |
|---------------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context`          | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`           | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`readDataset`](#readdataset-output-schema))*      |
| `messages`          | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`              | `object`   | Yes      |                                                                                                                     |
| &ensp;├─ `lines`    | `string`[] | Yes      | File content as UTF-8 array of lines; may be a line window.                                                         |
| &ensp;├─ `etag`     | `string`   | Yes      | Opaque version token for optimistic locking on write.                                                               |
| &ensp;└─ `mimeType` | `string`   | Yes      | Inferred content type (e.g. text/plain, text/x-cobol).                                                              |

#### Example Outputs

##### default

Input:

```json
{
  "path": "/u/USER/file.txt"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com",
    "currentDirectory": "."
  },
  "_result": {
    "totalLines": 1,
    "startLine": 1,
    "returnedLines": 1,
    "contentLength": 57,
    "mimeType": "text/plain",
    "hasMore": false
  },
  "data": {
    "lines": [
      "Hello from USS mock. Use this file for readUssFile evals."
    ],
    "etag": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    "mimeType": "text/plain"
  }
}
```

##### sensitive path

Input:

```json
{
  "path": "/etc/profile"
}
```

Output:

```json
// isError: true
{
  "error": "Path requires user confirmation (sensitive or unknown path). Elicitation is not available; access denied."
}
```

---

### `writeUssFile`


Write or overwrite a USS file. Creates the file if it does not exist.

#### Parameters

| Parameter  | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`     | `string`   | Yes      | USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).           |
| `lines`    | `string`[] | Yes      | UTF-8 content to write as an array of lines (one string per line).                                                  |
| `system`   | `string`   | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `etag`     | `string`   | No       | ETag for optimistic locking.                                                                                        |
| `encoding` | `string`   | No       | Mainframe encoding. Omit for default.                                                                               |

<a id="writeussfile-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                         |
|--------------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`          | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages`         | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`             | `object`   | Yes      |                                                                                                                     |
| &ensp;├─ `etag`    | `string`   | Yes      | New ETag after the write.                                                                                           |
| &ensp;└─ `created` | `boolean`  | No       | True if the file was created (did not exist before).                                                                |

---

### `createUssFile`


Create a USS file or directory.

#### Parameters

| Parameter     | Type      | Required | Description                                                                                                         |
|---------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`        | `string`  | Yes      | USS path to create: absolute or relative to current working directory (see getContext.ussCwd).                      |
| `isDirectory` | `boolean` | Yes      | True to create a directory, false for a regular file.                                                               |
| `system`      | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `permissions` | `string`  | No       | Octal permissions (e.g. 755).                                                                                       |

<a id="createussfile-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `deleteUssFile`

> Destructive

Delete a USS file or directory. Use recursive for directories.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                         |
|-------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`      | `string`  | Yes      | USS path to delete: absolute or relative to current working directory (see getContext.ussCwd).                      |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `recursive` | `boolean` | No       | If true, delete directory and contents. (default: `false`)                                                          |

<a id="deleteussfile-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                         |
|--------------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`          | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages`         | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`             | `object`   | Yes      |                                                                                                                     |
| &ensp;└─ `deleted` | `string`   | Yes      | Path of the deleted file or directory (display form).                                                               |

---

### `chmodUssFile`


Change permissions of a USS file or directory.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                         |
|-------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`      | `string`  | Yes      | USS path: absolute or relative to current working directory (see getContext.ussCwd).                                |
| `mode`      | `string`  | Yes      | Octal mode (e.g. 755).                                                                                              |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `recursive` | `boolean` | No       | Apply recursively. (default: `false`)                                                                               |

<a id="chmodussfile-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `chownUssFile`


Change owner of a USS file or directory.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                         |
|-------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`      | `string`  | Yes      | USS path: absolute or relative to current working directory (see getContext.ussCwd).                                |
| `owner`     | `string`  | Yes      | New owner.                                                                                                          |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `recursive` | `boolean` | No       | Apply recursively. (default: `false`)                                                                               |

<a id="chownussfile-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `chtagUssFile`


Set the z/OS file tag (encoding/type) for a USS file or directory.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                                                                           |
|-------------|-----------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `path`      | `string`  | Yes      | USS path: absolute or relative to current working directory (see getContext.ussCwd).                                                                                  |
| `tag`       | `string`  | Yes      | File tag value: a coded character set identifier (CCSID) name or number. Common values: ISO8859-1, IBM-1047 (EBCDIC), UTF-8, binary. Use "binary" for non-text files. |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                                   |
| `recursive` | `boolean` | No       | Apply recursively. (default: `false`)                                                                                                                                 |

<a id="chtagussfile-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `copyUssFile`


Copy a USS file or directory within the same z/OS system. For directories, set recursive to true. Paths can be absolute (starting with /) or relative to the current working directory (see getContext.ussCwd).

#### Parameters

| Parameter            | Type      | Required | Description                                                                                                         |
|----------------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `sourcePath`         | `string`  | Yes      | Source USS path: absolute (starts with /) or relative to current working directory.                                 |
| `targetPath`         | `string`  | Yes      | Destination USS path: absolute (starts with /) or relative to current working directory.                            |
| `recursive`          | `boolean` | No       | Copy directories recursively. (default: `false`)                                                                    |
| `followSymlinks`     | `boolean` | No       | Follow symlinks when copying recursively. (default: `false`)                                                        |
| `preserveAttributes` | `boolean` | No       | Preserve permissions and ownership. (default: `false`)                                                              |
| `force`              | `boolean` | No       | Replace files that cannot be opened (like cp -f). (default: `false`)                                                |
| `system`             | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="copyussfile-output-schema"></a>

#### Output Schema

| Field                 | Type       | Required | Description                                                                                                         |
|-----------------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context`            | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`             | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages`            | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`                | `object`   | Yes      |                                                                                                                     |
| &ensp;├─ `sourcePath` | `string`   | Yes      | Source USS path (display form).                                                                                     |
| &ensp;└─ `targetPath` | `string`   | Yes      | Destination USS path (display form).                                                                                |

---

### `runSafeUssCommand`

> Read-only

Run a Unix command on z/OS USS. Results may be line-windowed; follow the pagination instructions in the server instructions. Only allowlisted (safe) commands run automatically; unknown commands require user confirmation via elicitation

#### Parameters

| Parameter     | Type      | Required | Description                                                                                                         |
|---------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `commandText` | `string`  | Yes      | The Unix command line to execute (e.g. ls -la /tmp, whoami, pwd).                                                   |
| `system`      | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `startLine`   | `integer` | No       | 1-based first line of output to return. Default: 1.                                                                 |
| `lineCount`   | `integer` | No       | Number of lines to return. Omit for default window size.                                                            |

<a id="runsafeusscommand-output-schema"></a>

#### Output Schema

| Field               | Type       | Required | Description                                                                                                         |
|---------------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context`          | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`           | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`readDataset`](#readdataset-output-schema))*      |
| `messages`          | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`              | `object`   | Yes      |                                                                                                                     |
| &ensp;├─ `lines`    | `string`[] | Yes      | Command stdout (UTF-8) as array of lines.                                                                           |
| &ensp;└─ `mimeType` | `string`   | Yes      | Content type (e.g. text/plain).                                                                                     |

#### Example Outputs

##### default

Input:

```json
{
  "commandText": "pwd"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "totalLines": 1,
    "startLine": 1,
    "returnedLines": 1,
    "contentLength": 7,
    "mimeType": "text/plain",
    "hasMore": false
  },
  "data": {
    "lines": [
      "/u/USER"
    ],
    "mimeType": "text/plain"
  }
}
```

##### blocked command

Input:

```json
{
  "commandText": "rm -rf /"
}
```

Output:

```json
// isError: true
{
  "error": "Deletes root filesystem"
}
```

---

### `getUssTempDir`

> Read-only

Generate a unique USS temporary directory path as a subdirectory of the given base path (e.g. /tmp or the user home). The path is verified not to exist on the system. Use createTempUssDir to create it, or createUssFile with isDirectory true.

#### Parameters

| Parameter  | Type     | Required | Description                                                                                                         |
|------------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `basePath` | `string` | Yes      | Base directory: absolute or relative to current working directory (see getContext.ussCwd).                          |
| `system`   | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="getusstempdir-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `getUssTempPath`

> Read-only

Return a unique USS temporary file path under the given directory. The path is verified not to exist; use writeUssFile or createUssFile to create the file.

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `dirPath` | `string` | Yes      | Parent directory: absolute or relative to current working directory (see getContext.ussCwd).                        |
| `prefix`  | `string` | No       | Optional filename prefix.                                                                                           |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="getusstemppath-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `createTempUssDir`


Create a temporary USS directory. Typically use a path from getUssTempDir. Creates the directory and any missing parents.

#### Parameters

| Parameter     | Type     | Required | Description                                                                                                         |
|---------------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`        | `string` | Yes      | USS directory path: absolute or relative to current working directory (see getContext.ussCwd).                      |
| `system`      | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `permissions` | `string` | No       | Octal permissions (e.g. 755).                                                                                       |

<a id="createtempussdir-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `createTempUssFile`


Create an empty temporary USS file at the given path, creating parent directories if needed.

#### Parameters

| Parameter | Type     | Required | Description                                                                                                         |
|-----------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `path`    | `string` | Yes      | USS file path: absolute or relative to current working directory (see getContext.ussCwd).                           |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

<a id="createtempussfile-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                         |
|------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages` | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`     | `object`   | Yes      | *(same as [`getUssHome`](#getusshome-output-schema))*                                                               |

---

### `deleteUssTempUnderDir`

> Destructive

Delete all files and directories under the given USS path (the path itself is removed). Safety: path must contain the segment "tmp" (or "TMP") and have at least 3 path segments (e.g. /u/myuser/tmp/xyz).

#### Parameters

| Parameter | Type     | Required | Description                                                                                                                                  |
|-----------|----------|----------|----------------------------------------------------------------------------------------------------------------------------------------------|
| `path`    | `string` | Yes      | USS path to delete recursively: absolute or relative to current working directory (see getContext.ussCwd); must contain "tmp" and min depth. |
| `system`  | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                          |

<a id="deleteusstempunderdir-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                         |
|--------------------|------------|----------|---------------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: system and optional normalized USS paths. *(same as [`getUssHome`](#getusshome-output-schema))* |
| `_result`          | `object`   | Yes      | Result metadata (pagination, line window, or success). *(same as [`writeDataset`](#writedataset-output-schema))*    |
| `messages`         | `string`[] | No       | Operational messages: pagination hints, resolution notes, or path warnings. Omitted when empty.                     |
| `data`             | `object`   | Yes      |                                                                                                                     |
| &ensp;└─ `deleted` | `string`[] | Yes      | List of deleted paths (display form).                                                                               |

---

### `runSafeTsoCommand`

> Read-only

Run a TSO command on z/OS. Results may be line-windowed; follow the pagination instructions in the server instructions. Only allowlisted (safe) commands run automatically; unknown commands require user confirmation via elicitation. Requesting the same command without startLine and lineCount re-executes the command

#### Parameters

| Parameter     | Type      | Required | Description                                                                                                         |
|---------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `commandText` | `string`  | Yes      | The TSO command to execute (e.g. LISTDS 'USER.DATA', LISTALC, LISTCAT, STATUS).                                     |
| `system`      | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `startLine`   | `integer` | No       | 1-based first line of output to return. Default: 1.                                                                 |
| `lineCount`   | `integer` | No       | Number of lines to return. Omit for default window size.                                                            |

<a id="runsafetsocommand-output-schema"></a>

#### Output Schema

| Field             | Type       | Required | Description                                                                                             |
|-------------------|------------|----------|---------------------------------------------------------------------------------------------------------|
| `_context`        | `object`   | Yes      | Resolution context: target z/OS system.                                                                 |
| &ensp;└─ `system` | `string`   | Yes      | Resolved z/OS system hostname (target of the operation).                                                |
| `_result`         | `object`   | Yes      | Line-window metadata for TSO output. *(same as [`readDataset`](#readdataset-output-schema))*            |
| `messages`        | `string`[] | No       | Operational messages: line-window hints (e.g. call again with startLine/lineCount). Omitted when empty. |
| `data`            | `object`   | Yes      | *(same as [`runSafeUssCommand`](#runsafeusscommand-output-schema))*                                     |

#### Example Outputs

##### default

Input:

```json
{
  "commandText": "TIME"
}
```

Output:

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "totalLines": 1,
    "startLine": 1,
    "returnedLines": 1,
    "contentLength": 75,
    "mimeType": "text/plain",
    "hasMore": false
  },
  "data": {
    "lines": [
      "TIME-09:59:11 PM. CPU-00:00:00 SERVICE-26895 SESSION-00:01:53 MARCH 25,2026"
    ],
    "mimeType": "text/plain"
  }
}
```

##### blocked command

Input:

```json
{
  "commandText": "OSHELL rm -rf /"
}
```

Output:

```json
// isError: true
{
  "error": "OSHELL runs arbitrary USS commands (fails with rc 255 in ZNP)."
}
```

---

### `submitJob`

> Destructive

Submit JCL to the current (or specified) z/OS system. A job card is added from config when JCL has none; include a job card only when your JCL already has a full JOB statement. To wait for the job to complete, set wait: true (and optionally timeoutSeconds); the tool will then return status and optional output info. Submitting runs work on z/OS—use with care.

#### Parameters

| Parameter        | Type       | Required | Description                                                                                                                                                                    |
|------------------|------------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `lines`          | `string`[] | Yes      | JCL to submit as array of lines. Omit the job card to use the one configured for this connection; include it only when your JCL already has a full JOB statement.              |
| `system`         | `string`   | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used.                                                                                         |
| `jobName`        | `string`   | No       | Job name for the JOB statement when using a template (max 8 chars). Default: user ID + "A". Ignored if JCL already contains a job card.                                        |
| `programmer`     | `string`   | No       | Programmer field in the JOB statement when using a template (max 19 chars). Typically describes what the job does. Default: empty. Ignored if JCL already contains a job card. |
| `wait`           | `boolean`  | No       | When true, wait for the job to reach OUTPUT (or timeout) and return status, timedOut, and optionally failedStepJobFiles.                                                       |
| `timeoutSeconds` | `integer`  | No       | When wait is true, how long to wait for OUTPUT (seconds). Default 300. The job keeps running on z/OS after timeout.                                                            |

<a id="submitjob-output-schema"></a>

#### Output Schema

| Field                         | Type       | Required | Description                                                                                                 |
|-------------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`                    | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`                     | `object`   | Yes      | Result metadata (pagination or success). *(same as [`writeDataset`](#writedataset-output-schema))*          |
| `messages`                    | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`                        | `object`   | Yes      |                                                                                                             |
| &ensp;├─ `jobId`              | `string`   | Yes      | Job ID assigned by JES (e.g. JOB00123).                                                                     |
| &ensp;├─ `jobName`            | `string`   | Yes      | Job name from the JOB statement.                                                                            |
| &ensp;├─ `jobCardAddedLines`  | `string`[] | No       | Job card lines that were prepended when JCL had no job card.                                                |
| &ensp;├─ `id`                 | `string`   | No       | Job ID.                                                                                                     |
| &ensp;├─ `name`               | `string`   | No       | Job name.                                                                                                   |
| &ensp;├─ `owner`              | `string`   | No       | Job owner.                                                                                                  |
| &ensp;├─ `status`             | `string`   | No       | Status: INPUT, ACTIVE, or OUTPUT.                                                                           |
| &ensp;├─ `type`               | `string`   | No       | Job type: JOB, STC, TSU.                                                                                    |
| &ensp;├─ `class`              | `string`   | No       | Execution class.                                                                                            |
| &ensp;├─ `retcode`            | `string`   | No       | Return code when complete (e.g. 0000).                                                                      |
| &ensp;├─ `subsystem`          | `string`   | No       | Subsystem.                                                                                                  |
| &ensp;├─ `phase`              | `number`   | No       | Phase number.                                                                                               |
| &ensp;├─ `phaseName`          | `string`   | No       | Phase name.                                                                                                 |
| &ensp;├─ `correlator`         | `string`   | No       | Correlator (JES3).                                                                                          |
| &ensp;├─ `timedOut`           | `boolean`  | No       | True if wait for OUTPUT timed out; job continues on z/OS.                                                   |
| &ensp;└─ `failedStepJobFiles` | `object`[] | No       | Job file entries for failed steps when retcode is non-zero.                                                 |

---

### `submitJobFromDataset`

> Destructive

Submit a job from a data set or PDS or PDS/E member containing JCL. The data set must contain valid JCL including a job card. Set wait: true to wait for the job to reach OUTPUT.

#### Parameters

| Parameter        | Type      | Required | Description                                                                                                              |
|------------------|-----------|----------|--------------------------------------------------------------------------------------------------------------------------|
| `dsn`            | `string`  | Yes      | Fully-qualified data set name, optionally with member in parentheses (e.g. USER.JCL.CNTL(MYJOB)).                        |
| `system`         | `string`  | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used.                                   |
| `wait`           | `boolean` | No       | When true, wait for the job to reach OUTPUT (or timeout) and return status, timedOut, and optionally failedStepJobFiles. |
| `timeoutSeconds` | `integer` | No       | When wait is true, how long to wait for OUTPUT (seconds). Default 300. The job keeps running on z/OS after timeout.      |

<a id="submitjobfromdataset-output-schema"></a>

#### Output Schema

| Field                         | Type       | Required | Description                                                                                                 |
|-------------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`                    | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`                     | `object`   | Yes      | Result metadata (pagination or success). *(same as [`writeDataset`](#writedataset-output-schema))*          |
| `messages`                    | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`                        | `object`   | Yes      |                                                                                                             |
| &ensp;├─ `jobId`              | `string`   | Yes      | Job ID assigned by JES.                                                                                     |
| &ensp;├─ `jobName`            | `string`   | Yes      | Job name from the JOB statement.                                                                            |
| &ensp;├─ `id`                 | `string`   | No       | Job ID.                                                                                                     |
| &ensp;├─ `name`               | `string`   | No       | Job name.                                                                                                   |
| &ensp;├─ `owner`              | `string`   | No       | Job owner.                                                                                                  |
| &ensp;├─ `status`             | `string`   | No       | Status: INPUT, ACTIVE, or OUTPUT.                                                                           |
| &ensp;├─ `type`               | `string`   | No       | Job type: JOB, STC, TSU.                                                                                    |
| &ensp;├─ `class`              | `string`   | No       | Execution class.                                                                                            |
| &ensp;├─ `retcode`            | `string`   | No       | Return code when complete (e.g. 0000).                                                                      |
| &ensp;├─ `subsystem`          | `string`   | No       | Subsystem.                                                                                                  |
| &ensp;├─ `phase`              | `number`   | No       | Phase number.                                                                                               |
| &ensp;├─ `phaseName`          | `string`   | No       | Phase name.                                                                                                 |
| &ensp;├─ `correlator`         | `string`   | No       | Correlator (JES3).                                                                                          |
| &ensp;├─ `timedOut`           | `boolean`  | No       | True if wait for OUTPUT timed out; job continues on z/OS.                                                   |
| &ensp;└─ `failedStepJobFiles` | `object`[] | No       | Job file entries for failed steps when retcode is non-zero.                                                 |

---

### `submitJobFromUss`

> Destructive

Submit a job from a USS file path. The file must contain valid JCL including a job card. Set wait: true to wait for the job to reach OUTPUT and return status.

#### Parameters

| Parameter        | Type      | Required | Description                                                                                                              |
|------------------|-----------|----------|--------------------------------------------------------------------------------------------------------------------------|
| `path`           | `string`  | Yes      | USS path to the JCL file (e.g. /u/myuser/job.jcl).                                                                       |
| `system`         | `string`  | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used.                                   |
| `wait`           | `boolean` | No       | When true, wait for the job to reach OUTPUT (or timeout) and return status, timedOut, and optionally failedStepJobFiles. |
| `timeoutSeconds` | `integer` | No       | When wait is true, how long to wait for OUTPUT (seconds). Default 300. The job keeps running on z/OS after timeout.      |

<a id="submitjobfromuss-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                 |
|------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination or success). *(same as [`writeDataset`](#writedataset-output-schema))*          |
| `messages` | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`     | `object`   | Yes      | *(same as [`submitJobFromDataset`](#submitjobfromdataset-output-schema))*                                   |

---

### `getJobStatus`

> Read-only

Get the current status of a z/OS job (INPUT, ACTIVE, or OUTPUT) and its return code when complete.

#### Parameters

| Parameter | Type     | Required | Description                                                                            |
|-----------|----------|----------|----------------------------------------------------------------------------------------|
| `jobId`   | `string` | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `system`  | `string` | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

<a id="getjobstatus-output-schema"></a>

#### Output Schema

| Field                 | Type       | Required | Description                                                                                                 |
|-----------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`            | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `messages`            | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`                | `object`   | Yes      |                                                                                                             |
| &ensp;├─ `id`         | `string`   | Yes      | Job ID.                                                                                                     |
| &ensp;├─ `name`       | `string`   | Yes      | Job name.                                                                                                   |
| &ensp;├─ `owner`      | `string`   | Yes      | Job owner.                                                                                                  |
| &ensp;├─ `status`     | `string`   | Yes      | Status: INPUT, ACTIVE, or OUTPUT.                                                                           |
| &ensp;├─ `type`       | `string`   | Yes      | Job type: JOB, STC, TSU.                                                                                    |
| &ensp;├─ `class`      | `string`   | Yes      | Execution class.                                                                                            |
| &ensp;├─ `retcode`    | `string`   | No       | Return code when complete (e.g. 0000).                                                                      |
| &ensp;├─ `subsystem`  | `string`   | No       | Subsystem.                                                                                                  |
| &ensp;├─ `phase`      | `number`   | Yes      | Phase number.                                                                                               |
| &ensp;├─ `phaseName`  | `string`   | Yes      | Phase name.                                                                                                 |
| &ensp;└─ `correlator` | `string`   | No       | Correlator (JES3).                                                                                          |

---

### `listJobFiles`

> Read-only

List output files (spools) for a z/OS job. The job must be in OUTPUT status. Use getJobStatus to check status first.

#### Parameters

| Parameter | Type      | Required | Description                                                                            |
|-----------|-----------|----------|----------------------------------------------------------------------------------------|
| `jobId`   | `string`  | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `system`  | `string`  | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `offset`  | `integer` | No       | 0-based offset for pagination (default 0).                                             |
| `limit`   | `integer` | No       | Number of job files to return (default 500, max 1000).                                 |

<a id="listjobfiles-output-schema"></a>

#### Output Schema

| Field               | Type       | Required | Description                                                                                                 |
|---------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`          | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`           | `object`   | Yes      | Result metadata (pagination or success). *(same as [`listDatasets`](#listdatasets-output-schema))*          |
| `messages`          | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`              | `object`[] | Yes      | Array of job file (spool) entries. Each entry has id, optional ddname, stepname, dsname, procstep.          |
| &ensp;├─ `id`       | `number`   | Yes      | Job file (spool) ID.                                                                                        |
| &ensp;├─ `ddname`   | `string`   | No       | DD name (e.g. SYSOUT, JESJCL).                                                                              |
| &ensp;├─ `stepname` | `string`   | No       | Step name.                                                                                                  |
| &ensp;├─ `dsname`   | `string`   | No       | Data set name when applicable.                                                                              |
| &ensp;└─ `procstep` | `string`   | No       | Procedure step name.                                                                                        |

---

### `readJobFile`

> Read-only

Read the content of one job output file (spool); use listJobFiles to get job file IDs Results may be line-windowed; follow the pagination instructions in the server instructions.

#### Parameters

| Parameter   | Type      | Required | Description                                                                            |
|-------------|-----------|----------|----------------------------------------------------------------------------------------|
| `jobId`     | `string`  | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `jobFileId` | `integer` | Yes      | Job file (spool) ID from listJobFiles.                                                 |
| `system`    | `string`  | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `startLine` | `integer` | No       | 1-based first line to return (default 1).                                              |
| `lineCount` | `integer` | No       | Number of lines to return (default: all).                                              |

<a id="readjobfile-output-schema"></a>

#### Output Schema

| Field                    | Type       | Required | Description                                                                                                 |
|--------------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`               | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`                | `object`   | Yes      | Result metadata (pagination or success). *(same as [`readDataset`](#readdataset-output-schema))*            |
| `messages`               | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`                   | `object`   | Yes      |                                                                                                             |
| &ensp;├─ `lines`         | `string`[] | Yes      | File content as array of lines; may be a line window when _result.hasMore is true.                          |
| &ensp;├─ `totalLines`    | `number`   | Yes      | Total lines in the full file.                                                                               |
| &ensp;├─ `startLine`     | `number`   | Yes      | 1-based first line in this window.                                                                          |
| &ensp;├─ `returnedLines` | `number`   | Yes      | Number of lines returned.                                                                                   |
| &ensp;├─ `hasMore`       | `boolean`  | Yes      | True if more lines exist.                                                                                   |
| &ensp;└─ `mimeType`      | `string`   | Yes      | Content type (e.g. text/plain, text/x-jcl).                                                                 |

---

### `getJobOutput`

> Read-only

Get aggregated output from job files for a completed job. By default returns output from failed steps only when the job has a non-zero return code. Optional jobFileIds to limit to specific files.

#### Parameters

| Parameter         | Type        | Required | Description                                                                                                                        |
|-------------------|-------------|----------|------------------------------------------------------------------------------------------------------------------------------------|
| `jobId`           | `string`    | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                                                                |
| `system`          | `string`    | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used.                                             |
| `failedStepsOnly` | `boolean`   | No       | When true (default), only include output from steps that failed (when job retcode is non-zero). When false, include all job files. |
| `jobFileIds`      | `integer`[] | No       | Optional list of job file (spool) IDs to include. When provided, only these files are read; failedStepsOnly is ignored.            |
| `offset`          | `integer`   | No       | 0-based offset for pagination over job files (default 0).                                                                          |
| `limit`           | `integer`   | No       | Number of job files to return (default 500, max 1000).                                                                             |

<a id="getjoboutput-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                 |
|--------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`          | `object`   | Yes      | Result metadata (pagination or success). *(same as [`listDatasets`](#listdatasets-output-schema))*          |
| `messages`         | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`             | `object`   | Yes      |                                                                                                             |
| &ensp;├─ `jobId`   | `string`   | Yes      | Job ID.                                                                                                     |
| &ensp;├─ `status`  | `string`   | Yes      | Job status (e.g. OUTPUT).                                                                                   |
| &ensp;├─ `retcode` | `string`   | No       | Job return code when complete.                                                                              |
| &ensp;└─ `files`   | `object`[] | Yes      | Output from job files in this page.                                                                         |

---

### `searchJobOutput`

> Read-only

Search for a substring in a job's output files (all files or one by jobFileId). Returns matching lines with location and text. Use offset/limit to page results.

#### Parameters

| Parameter       | Type      | Required | Description                                                                                          |
|-----------------|-----------|----------|------------------------------------------------------------------------------------------------------|
| `jobId`         | `string`  | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                                  |
| `searchString`  | `string`  | Yes      | Substring to search for (literal, not regex).                                                        |
| `system`        | `string`  | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used.               |
| `jobFileId`     | `integer` | No       | If provided, search only this job file (spool ID from listJobFiles). Otherwise search all job files. |
| `caseSensitive` | `boolean` | No       | When true, match case exactly. Default false.                                                        |
| `offset`        | `integer` | No       | 0-based offset for pagination over matches (default 0).                                              |
| `limit`         | `integer` | No       | Number of matches to return (default 100, max 500).                                                  |

<a id="searchjoboutput-output-schema"></a>

#### Output Schema

| Field                 | Type       | Required | Description                                                                                                 |
|-----------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`            | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`             | `object`   | Yes      | Result metadata (pagination or success). *(same as [`listDatasets`](#listdatasets-output-schema))*          |
| `messages`            | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`                | `object`[] | Yes      | Array of search matches in job output. Each entry has jobFileId, ddname, stepname, lineNumber, lineText.    |
| &ensp;├─ `jobFileId`  | `number`   | Yes      | Job file (spool) ID where the match was found.                                                              |
| &ensp;├─ `ddname`     | `string`   | No       | DD name.                                                                                                    |
| &ensp;├─ `stepname`   | `string`   | No       | Step name.                                                                                                  |
| &ensp;├─ `lineNumber` | `number`   | Yes      | 1-based line number.                                                                                        |
| &ensp;└─ `lineText`   | `string`   | Yes      | The line content.                                                                                           |

---

### `listJobs`

> Read-only

List jobs on the z/OS system with optional filters (owner, prefix, status). Use offset/limit to page results.

#### Parameters

| Parameter | Type      | Required | Description                                                                            |
|-----------|-----------|----------|----------------------------------------------------------------------------------------|
| `system`  | `string`  | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `owner`   | `string`  | No       | Filter by job owner.                                                                   |
| `prefix`  | `string`  | No       | Filter by job name prefix.                                                             |
| `status`  | `string`  | No       | Filter by status: INPUT, ACTIVE, or OUTPUT.                                            |
| `offset`  | `integer` | No       | 0-based offset (default 0).                                                            |
| `limit`   | `integer` | No       | Number of jobs to return (default 100, max 1000).                                      |

<a id="listjobs-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                                                                            |
|------------|------------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))*                                                            |
| `_result`  | `object`   | Yes      | Result metadata (pagination or success). *(same as [`listDatasets`](#listdatasets-output-schema))*                                                                     |
| `messages` | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                                                                           |
| `data`     | `object`[] | Yes      | Array of job status entries. Each entry has id, name, owner, status, type, class, retcode, phase, phaseName. *(same as [`getJobStatus`](#getjobstatus-output-schema))* |

---

### `getJcl`

> Read-only

Get the JCL for a job.

#### Parameters

| Parameter | Type     | Required | Description                                                                            |
|-----------|----------|----------|----------------------------------------------------------------------------------------|
| `jobId`   | `string` | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `system`  | `string` | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

<a id="getjcl-output-schema"></a>

#### Output Schema

| Field            | Type       | Required | Description                                                                                                 |
|------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`       | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `messages`       | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`           | `object`   | Yes      |                                                                                                             |
| &ensp;└─ `lines` | `string`[] | Yes      | JCL for the job as array of lines.                                                                          |

---

### `cancelJob`

> Destructive

Cancel a job on the z/OS system.

#### Parameters

| Parameter | Type     | Required | Description                                                                            |
|-----------|----------|----------|----------------------------------------------------------------------------------------|
| `jobId`   | `string` | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `system`  | `string` | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

<a id="canceljob-output-schema"></a>

#### Output Schema

| Field              | Type       | Required | Description                                                                                                 |
|--------------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context`         | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`          | `object`   | Yes      | Result metadata (pagination or success). *(same as [`writeDataset`](#writedataset-output-schema))*          |
| `messages`         | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`             | `object`   | Yes      |                                                                                                             |
| &ensp;└─ `success` | `boolean`  | Yes      | Operation completed successfully.                                                                           |

---

### `holdJob`

> Destructive

Hold a job on the z/OS system.

#### Parameters

| Parameter | Type     | Required | Description                                                                            |
|-----------|----------|----------|----------------------------------------------------------------------------------------|
| `jobId`   | `string` | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `system`  | `string` | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

<a id="holdjob-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                 |
|------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination or success). *(same as [`writeDataset`](#writedataset-output-schema))*          |
| `messages` | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`     | `object`   | Yes      | *(same as [`cancelJob`](#canceljob-output-schema))*                                                         |

---

### `releaseJob`


Release a held job on the z/OS system.

#### Parameters

| Parameter | Type     | Required | Description                                                                            |
|-----------|----------|----------|----------------------------------------------------------------------------------------|
| `jobId`   | `string` | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `system`  | `string` | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

<a id="releasejob-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                 |
|------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination or success). *(same as [`writeDataset`](#writedataset-output-schema))*          |
| `messages` | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`     | `object`   | Yes      | *(same as [`cancelJob`](#canceljob-output-schema))*                                                         |

---

### `deleteJob`

> Destructive

Delete a job from the output queue.

#### Parameters

| Parameter | Type     | Required | Description                                                                            |
|-----------|----------|----------|----------------------------------------------------------------------------------------|
| `jobId`   | `string` | Yes      | Job ID (e.g. JOB00123 or J0nnnnnn).                                                    |
| `system`  | `string` | No       | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

<a id="deletejob-output-schema"></a>

#### Output Schema

| Field      | Type       | Required | Description                                                                                                 |
|------------|------------|----------|-------------------------------------------------------------------------------------------------------------|
| `_context` | `object`   | Yes      | Resolution context: target z/OS system. *(same as [`runSafeTsoCommand`](#runsafetsocommand-output-schema))* |
| `_result`  | `object`   | Yes      | Result metadata (pagination or success). *(same as [`writeDataset`](#writedataset-output-schema))*          |
| `messages` | `string`[] | No       | Operational messages: pagination hints, job card notice, or other notes. Omitted when empty.                |
| `data`     | `object`   | Yes      | *(same as [`cancelJob`](#canceljob-output-schema))*                                                         |

---

### `downloadDatasetToFile`

> Read-only

Download a sequential data set or PDS/E member from z/OS to a file under the workspace. Writes UTF-8 text. Requires a local path under an MCP root or configured workspace directory. Missing parent directories for the destination file are created automatically.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                                                                  |
|-------------|-----------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`       | `string`  | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                                                         |
| `member`    | `string`  | No       | Member name for PDS or PDS/E data sets.                                                                                                                      |
| `localPath` | `string`  | Yes      | Destination file path: absolute, or relative to the first workspace root when using roots/fallback. Parent directories are created automatically if missing. |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.                                          |
| `encoding`  | `string`  | No       | Mainframe (EBCDIC) encoding for the read.                                                                                                                    |
| `overwrite` | `boolean` | No       | Allow overwriting an existing local file (default false).                                                                                                    |

<a id="downloaddatasettofile-output-schema"></a>

#### Output Schema

| Field                        | Type                | Required | Description                                                 |
|------------------------------|---------------------|----------|-------------------------------------------------------------|
| `_context`                   | `object`            | Yes      | Context for local file transfer tools.                      |
| &ensp;├─ `system`            | `string`            | Yes      | Resolved z/OS system hostname (target of the operation).    |
| &ensp;├─ `resolvedLocalPath` | `string`            | Yes      | Absolute local filesystem path written or read.             |
| &ensp;├─ `rootUri`           | `string`            | Yes      | file:// URI of the workspace root that contained the path.  |
| &ensp;└─ `rootsSource`       | `mcp` \| `fallback` | Yes      | Whether paths came from MCP roots/list or env/CLI fallback. |
| `data`                       | `object`            | Yes      |                                                             |
| &ensp;├─ `bytesWritten`      | `number`            | No       | Bytes written to local disk (UTF-8 encoding).               |
| &ensp;├─ `bytesRead`         | `number`            | No       | Bytes read from local disk (UTF-8 encoding).                |
| &ensp;├─ `etag`              | `string`            | No       | z/OS ETag after read or write when applicable.              |
| &ensp;├─ `dsn`               | `string`            | Yes      | Fully qualified data set name.                              |
| &ensp;└─ `member`            | `string`            | No       | Member name when applicable.                                |

---

### `uploadFileToDataset`

> Destructive

Upload a UTF-8 text file from the workspace to a sequential data set or PDS/E member on z/OS. Replaces the entire member or data set unless using etag for optimistic locking.

#### Parameters

| Parameter   | Type     | Required | Description                                                                                                         |
|-------------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `localPath` | `string` | Yes      | Source file path under an MCP root or configured workspace directory.                                               |
| `dsn`       | `string` | Yes      | Fully qualified data set name.                                                                                      |
| `member`    | `string` | No       | Member name for PDS or PDS/E data sets.                                                                             |
| `system`    | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `etag`      | `string` | No       | ETag from a previous read for optimistic locking.                                                                   |
| `encoding`  | `string` | No       | Mainframe (EBCDIC) encoding for the write.                                                                          |

<a id="uploadfiletodataset-output-schema"></a>

#### Output Schema

| Field      | Type     | Required | Description                                                                                                        |
|------------|----------|----------|--------------------------------------------------------------------------------------------------------------------|
| `_context` | `object` | Yes      | Context for local file transfer tools. *(same as [`downloadDatasetToFile`](#downloaddatasettofile-output-schema))* |
| `data`     | `object` | Yes      | *(same as [`downloadDatasetToFile`](#downloaddatasettofile-output-schema))*                                        |

---

### `downloadUssFileToFile`

> Read-only

Download a z/OS USS file to a local workspace file as UTF-8 text. Path must be under an MCP root or configured workspace directory. Missing parent directories for the destination file are created automatically.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                            |
|-------------|-----------|----------|------------------------------------------------------------------------------------------------------------------------|
| `path`      | `string`  | Yes      | USS file path on z/OS (absolute or relative to USS cwd; see getContext).                                               |
| `localPath` | `string`  | Yes      | Destination path under workspace roots or fallback directory. Parent directories are created automatically if missing. |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.    |
| `encoding`  | `string`  | No       | Mainframe encoding for the file read.                                                                                  |
| `overwrite` | `boolean` | No       | Allow overwriting an existing local file (default false).                                                              |

<a id="downloadussfiletofile-output-schema"></a>

#### Output Schema

| Field                   | Type     | Required | Description                                                                                                        |
|-------------------------|----------|----------|--------------------------------------------------------------------------------------------------------------------|
| `_context`              | `object` | Yes      | Context for local file transfer tools. *(same as [`downloadDatasetToFile`](#downloaddatasettofile-output-schema))* |
| `data`                  | `object` | Yes      |                                                                                                                    |
| &ensp;├─ `bytesWritten` | `number` | No       | Bytes written to local disk (UTF-8 encoding).                                                                      |
| &ensp;├─ `bytesRead`    | `number` | No       | Bytes read from local disk (UTF-8 encoding).                                                                       |
| &ensp;├─ `etag`         | `string` | No       | z/OS ETag after read or write when applicable.                                                                     |
| &ensp;└─ `ussPath`      | `string` | Yes      | Resolved USS path on z/OS.                                                                                         |

---

### `uploadFileToUssFile`

> Destructive

Upload a UTF-8 workspace file to a z/OS USS path. Creates or overwrites the remote file.

#### Parameters

| Parameter   | Type     | Required | Description                                                                                                         |
|-------------|----------|----------|---------------------------------------------------------------------------------------------------------------------|
| `localPath` | `string` | Yes      | Source file under workspace roots or fallback directory.                                                            |
| `path`      | `string` | Yes      | Target USS path on z/OS.                                                                                            |
| `system`    | `string` | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `etag`      | `string` | No       | ETag for optimistic locking.                                                                                        |
| `encoding`  | `string` | No       | Mainframe encoding for the write.                                                                                   |

<a id="uploadfiletoussfile-output-schema"></a>

#### Output Schema

| Field      | Type     | Required | Description                                                                                                        |
|------------|----------|----------|--------------------------------------------------------------------------------------------------------------------|
| `_context` | `object` | Yes      | Context for local file transfer tools. *(same as [`downloadDatasetToFile`](#downloaddatasettofile-output-schema))* |
| `data`     | `object` | Yes      | *(same as [`downloadUssFileToFile`](#downloadussfiletofile-output-schema))*                                        |

---

### `downloadJobFileToFile`

> Read-only

Download one job spool file from z/OS to a local workspace file as UTF-8 text. Use listJobFiles to obtain jobFileId. Missing parent directories for the destination file are created automatically.

#### Parameters

| Parameter   | Type      | Required | Description                                                                                                            |
|-------------|-----------|----------|------------------------------------------------------------------------------------------------------------------------|
| `jobId`     | `string`  | Yes      | Job ID (e.g. JOB00123).                                                                                                |
| `jobFileId` | `integer` | Yes      | Spool file ID from listJobFiles.                                                                                       |
| `localPath` | `string`  | Yes      | Destination path under workspace roots or fallback directory. Parent directories are created automatically if missing. |
| `system`    | `string`  | No       | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system.    |
| `overwrite` | `boolean` | No       | Allow overwriting an existing local file (default false).                                                              |

<a id="downloadjobfiletofile-output-schema"></a>

#### Output Schema

| Field                   | Type      | Required | Description                                                                                                        |
|-------------------------|-----------|----------|--------------------------------------------------------------------------------------------------------------------|
| `_context`              | `object`  | Yes      | Context for local file transfer tools. *(same as [`downloadDatasetToFile`](#downloaddatasettofile-output-schema))* |
| `data`                  | `object`  | Yes      |                                                                                                                    |
| &ensp;├─ `bytesWritten` | `number`  | No       | Bytes written to local disk (UTF-8 encoding).                                                                      |
| &ensp;├─ `bytesRead`    | `number`  | No       | Bytes read from local disk (UTF-8 encoding).                                                                       |
| &ensp;├─ `etag`         | `string`  | No       | z/OS ETag after read or write when applicable.                                                                     |
| &ensp;├─ `jobId`        | `string`  | Yes      |                                                                                                                    |
| &ensp;└─ `jobFileId`    | `integer` | Yes      |                                                                                                                    |

---

### `endevorSetContext`


Sets the default Endevor location context (environment, stageNumber, system, subsystem, type) for all subsequent Endevor tool calls. Call this once before working with elements to avoid repeating location parameters on every invocation.

#### Parameters

| Parameter     | Type     | Required | Description                                                                                   |
|---------------|----------|----------|-----------------------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported.               |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                                            |
| `system`      | `string` | No       | Name of the Endevor system (e.g. SYS1). Wildcards (*,%) are supported.                        |
| `subsystem`   | `string` | No       | Name of the Endevor subsystem (e.g. SUB1). Wildcards (*,%) are supported.                     |
| `type`        | `string` | No       | Name of the Endevor element type (e.g. COBPGM, COPYBOOK, JCL). Wildcards (*,%) are supported. |

---

### `endevorListEnvironments`

> Read-only

Lists all available Endevor environments. Use this to discover the environments configured in the Endevor instance (e.g. DEV, PRD) before working with elements.

#### Parameters

| Parameter     | Type     | Required | Description                                                     |
|---------------|----------|----------|-----------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment. Wildcards (*,%) are supported. |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                      |

---

### `endevorListStages`

> Read-only

Lists the stages (1, 2) configured for the given environment. Use this to discover which stage numbers are valid before listing elements.

#### Parameters

| Parameter     | Type     | Required | Description                                                                     |
|---------------|----------|----------|---------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported. |
| `stage`       | `string` | No       | Stage number filter (1 or 2). Use * for all stages.                             |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                      |

---

### `endevorListSystems`

> Read-only

Lists all systems within the given environment and stage. Use this to discover system names (e.g. SYS1, ACME) before listing elements.

#### Parameters

| Parameter     | Type     | Required | Description                                                                     |
|---------------|----------|----------|---------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported. |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                              |
| `system`      | `string` | No       | Name of the Endevor system. Wildcards (*,%) are supported.                      |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                      |

---

### `endevorListSubsystems`

> Read-only

Lists all subsystems within the given environment, stage, and system. Use this to discover subsystem names (e.g. SUB1, CORE) before listing elements.

#### Parameters

| Parameter     | Type     | Required | Description                                                                     |
|---------------|----------|----------|---------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported. |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                              |
| `system`      | `string` | No       | Name of the Endevor system (e.g. SYS1). Wildcards (*,%) are supported.          |
| `subsystem`   | `string` | No       | Name of the Endevor subsystem. Wildcards (*,%) are supported.                   |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                      |

---

### `endevorListTypes`

> Read-only

Lists element types (e.g. COBPGM, COPYBOOK, JCL) within the given location. Use this to discover what types exist before listing or retrieving elements.

#### Parameters

| Parameter     | Type     | Required | Description                                                                                   |
|---------------|----------|----------|-----------------------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported.               |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                                            |
| `system`      | `string` | No       | Name of the Endevor system (e.g. SYS1). Wildcards (*,%) are supported.                        |
| `type`        | `string` | No       | Name of the Endevor element type. Wildcards (*,%) are supported (e.g. COBPGM, COPYBOOK, JCL). |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                                    |

---

### `endevorListElements`

> Read-only

Lists elements in the Endevor inventory matching the given location (environment, stageNumber, system, subsystem, type). All location parameters default to the active context set by endevorSetContext. Use wildcard * to match all values for a location level (e.g. system=* lists across all systems).

#### Parameters

| Parameter     | Type     | Required | Description                                                                                                                                                                           |
|---------------|----------|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported.                                                                                                       |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                                                                                                                                    |
| `system`      | `string` | No       | Name of the Endevor system (e.g. SYS1). Wildcards (*,%) are supported.                                                                                                                |
| `subsystem`   | `string` | No       | Name of the Endevor subsystem (e.g. SUB1). Wildcards (*,%) are supported.                                                                                                             |
| `type`        | `string` | No       | Name of the Endevor element type (e.g. COBPGM, COPYBOOK, JCL). Wildcards (*,%) are supported.                                                                                         |
| `element`     | `string` | No       | Element name filter. Supports wildcards: * matches any characters. Omit or use * to list all elements in the location.                                                                |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                                                                                                                            |
| `search`      | `string` | No       | When true, searches through the Endevor map to include elements from preceding stages (map traversal / search up the map).                                                            |
| `data`        | `string` | No       | Controls the level of metadata returned per element. BAS (default) = basic fields only; ELE = adds last-action info; ALL = all fields including package, processor, and signout data. |

---

### `endevorPrintElement`

> Read-only

Retrieves and returns the source code content of an Endevor element. Use this to read the content of a COBOL program, copybook, JCL, or any other element type stored in Endevor.

#### Parameters

| Parameter     | Type     | Required | Description                                                                                   |
|---------------|----------|----------|-----------------------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported.               |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                                            |
| `system`      | `string` | No       | Name of the Endevor system (e.g. SYS1). Wildcards (*,%) are supported.                        |
| `subsystem`   | `string` | No       | Name of the Endevor subsystem (e.g. SUB1). Wildcards (*,%) are supported.                     |
| `type`        | `string` | No       | Name of the Endevor element type (e.g. COBPGM, COPYBOOK, JCL). Wildcards (*,%) are supported. |
| `element`     | `string` | Yes      | Name of the element whose source code to retrieve (e.g. PROG01, CPYBK01).                     |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                                    |
| `search`      | `string` | No       | When true, searches up the Endevor map to find the element in preceding stages.               |

---

### `endevorListProcessorGroups`

> Read-only

Lists processor groups defined for the given element type in Endevor. Processor groups define how elements are generated, compiled, and deployed.

#### Parameters

| Parameter     | Type     | Required | Description                                                                                   |
|---------------|----------|----------|-----------------------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported.               |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                                            |
| `system`      | `string` | No       | Name of the Endevor system (e.g. SYS1). Wildcards (*,%) are supported.                        |
| `subsystem`   | `string` | No       | Name of the Endevor subsystem (e.g. SUB1). Wildcards (*,%) are supported.                     |
| `type`        | `string` | No       | Name of the Endevor element type (e.g. COBPGM, COPYBOOK, JCL). Wildcards (*,%) are supported. |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                                    |

---

### `endevorQueryComponents`

> Read-only

Queries the components (dependencies) used by a specific element in Endevor. Use this to find what COBOL copybooks, subprograms, or JCL procedures an element depends on, enabling impact analysis and change management.

#### Parameters

| Parameter     | Type     | Required | Description                                                                                   |
|---------------|----------|----------|-----------------------------------------------------------------------------------------------|
| `environment` | `string` | No       | Name of the Endevor environment (e.g. DEV, PRD). Wildcards (*,%) are supported.               |
| `stageNumber` | `string` | No       | The Endevor stage number (1 or 2).                                                            |
| `system`      | `string` | No       | Name of the Endevor system (e.g. SYS1). Wildcards (*,%) are supported.                        |
| `subsystem`   | `string` | No       | Name of the Endevor subsystem (e.g. SUB1). Wildcards (*,%) are supported.                     |
| `type`        | `string` | No       | Name of the Endevor element type (e.g. COBPGM, COPYBOOK, JCL). Wildcards (*,%) are supported. |
| `element`     | `string` | Yes      | Name of the element to query for component dependencies (e.g. PROG01).                        |
| `instance`    | `string` | No       | Name of the Endevor Web Services instance.                                                    |

---

### `endevorListPackages`

> Read-only

Lists Endevor packages (change bundles used to promote elements through environments). Use this to discover packages, their status, and associated elements for release management and promotion tracking.

#### Parameters

| Parameter  | Type     | Required | Description                                                                    |
|------------|----------|----------|--------------------------------------------------------------------------------|
| `instance` | `string` | No       | Name of the Endevor Web Services instance.                                     |
| `status`   | `string` | No       | Status of the Endevor package (e.g. INENDEVOR, APPROVED, EXECUTED, COMMITTED). |

---

## Prompts

The server provides **4** prompts.

### `reflectZoweMcp`

Reflect on z/OS and Zowe MCP usage in this repo: list learnings, struggles, and suggestions. Then create or update AGENTS.md and ZOWE_MCP_SUGGESTIONS.md in the current repository to help future agents and capture improvement ideas.

*No arguments.*

#### Prompt Text

**user:**

Reflect on your experience using the Zowe MCP server and z/OS in this repository, then produce the requested artifacts.

**Context (use this when writing ZOWE_MCP_SUGGESTIONS.md):** MCP client: generate-docs 1.0.0.

1. **Learnings**: List all your learnings about z/OS and the Zowe MCP server (tools, data sets, systems, pagination, context, etc.).

2. **Struggles**: What did you struggle with? What was confusing, error-prone, or missing?

3. **Suggestions**: What are your suggestions to make the MCP server easier to understand and use?

4. **Artifacts**: Create or update the following in the **current repository** (this workspace):
- **AGENTS.md** — Update or create this file so it helps future agents use the Zowe MCP server better and understand the environment (e.g. system/connection context, data set naming, pagination, which tools to use when).
- **ZOWE_MCP_SUGGESTIONS.md** — Create or update this markdown file at the repository root with your concrete improvement suggestions. Use this filename exactly.

**Attribution:** In every section you write in ZOWE_MCP_SUGGESTIONS.md, include at the start: **Client:** (use the Context above if provided, otherwise write N/A) and **Model:** (your model name if you know it, e.g. Claude 3.5, GPT-4; otherwise write N/A). Do not ask the user—fill this in yourself.

**When ZOWE_MCP_SUGGESTIONS.md already exists:** Read it first. Append a **new section** with a clear heading that includes the date (e.g. "## 2025-02-26"). In that section, add Client and Model as above, then your learnings, struggles, and suggestions. At the end of the section, optionally add a short "Agreement/conflict with prior feedback" line if your suggestions align or conflict with earlier sections. This keeps a history of feedback from different runs and models while allowing consolidation later.

---

### `reviewJcl`

Read a JCL member and analyze it for common issues, suggest improvements, and explain what the job does.

#### Arguments

| Argument | Required | Description                                                                                                                                 |
|----------|----------|---------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`    | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                                        |
| `member` | No       | JCL member name (for PDS or PDS/E data sets).                                                                                               |
| `system` | No       | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Prompt Text

**user:**

Please review the following JCL from USER.JCL.CNTL(COMPILE) on mainframe-dev.example.com.

Analyze it for:
1. Common JCL errors (missing DD statements, incorrect PGM names, bad COND parameters)
2. Performance issues (unnecessary steps, inefficient SPACE allocations)
3. Best practices (job card conventions, NOTIFY, MSGCLASS settings)
4. Security concerns (hardcoded passwords, excessive permissions)
5. Explain what each step does and the overall purpose of the job

```jcl
//COMPILE JOB (ACCT),'USER',
//  CLASS=A,MSGCLASS=X,MSGLEVEL=(1,1),
//  NOTIFY=&SYSUID
//*
//* COMPILE - Compile and run CUSTFILE
//* Generated mock JCL
//*
//COMPILE EXEC PGM=IGYCRCTL,
//  PARM='RENT,APOST,MAP,XREF,OFFSET'
//STEPLIB  DD DSN=IGY.V6R4M0.SIGYCOMP,DISP=SHR
//SYSIN    DD DSN=USER.SRC.COBOL(CUSTFILE),DISP=SHR
//SYSLIB   DD DSN=USER.SRC.COPYBOOK,DISP=SHR
//         DD DSN=SYS1.MACLIB,DISP=SHR
//SYSPRINT DD SYSOUT=*
//SYSLIN   DD DSN=&&LOADSET,DISP=(MOD,PASS),
//            UNIT=SYSDA,SPACE=(TRK,(3,3))
//SYSUT1   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT2   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT3   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT4   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT5   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT6   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT7   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//*
//LKED    EXEC PGM=IEWL,COND=(4,LT),
//  PARM='LIST,XREF,LET,RENT'
//SYSLIB   DD DSN=CEE.SCEELKED,DISP=SHR
//SYSLIN   DD DSN=&&LOADSET,DISP=(OLD,DELETE)
//SYSLMOD  DD DSN=USER.LOADLIB,DISP=SHR
//SYSPRINT DD SYSOUT=*
//SYSUT1   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//*
//RUN     EXEC PGM=CUSTFILE,COND=(4,LT)
//STEPLIB  DD DSN=USER.LOADLIB,DISP=SHR
//INDD     DD DSN=USER.DATA.INPUT,DISP=SHR
//OUTDD    DD DSN=USER.LISTING,DISP=SHR
//SYSOUT   DD SYSOUT=*
//SYSPRINT DD SYSOUT=*

```

---

### `explainDataset`

Get attributes and sample content of a data set, then explain its purpose, structure, and how it fits into the system.

#### Arguments

| Argument | Required | Description                                                                                                                                 |
|----------|----------|---------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`    | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                                        |
| `system` | No       | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Prompt Text

**user:**

Please explain the z/OS data set USER.SRC.COBOL on mainframe-dev.example.com.

Data set attributes:
```json
{
  "dsn": "USER.SRC.COBOL",
  "dsorg": "PO-E",
  "recfm": "FB",
  "lrecl": 80,
  "blksz": 27920,
  "volser": "VOL001",
  "creationDate": "2024-03-15"
}
```
Sample content (first member: ACCTPROC):
```cobol
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ACCTPROC.
       AUTHOR. GENERATED-MOCK.
       DATE-WRITTEN. 2024-03-15.
      *
      * ACCTPROC - Generated mock COBOL program
      * Part of USER application suite
      *
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-ZOS.
       OBJECT-COMPUTER. IBM-ZOS.
      *
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT INFILE  ASSIGN TO INDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-FILE-STATUS.
           SELECT OUTFILE ASSIGN TO OUTDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.
      *
       DATA DIVISION.
       FILE SECTION.
       FD  INFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  IN-RECORD                    PIC X(80).
      *
       FD  OUTFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  OUT-RECORD                   PIC X(133).
      *
       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUS               PIC XX VALUE SPACES.
       01  WS-OUT-STATUS                PIC XX VALUE SPACES.
       01  WS-EOF-FLAG                  PIC X  VALUE 'N'.
           88 END-OF-FILE               VALUE 'Y'.
       01  WS-RECORD-COUNT              PIC 9(7) VALUE ZERO.
       01  WS-ERROR-COUNT               PIC 9(5) VALUE ZERO.
      *
           COPY ERRCODES.
      *
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-INITIALIZE
           PERFORM 2000-PROCESS UNTIL END-OF-FILE
           PERFORM 3000-TERMINATE
           STOP RUN.
      *
       1000-INITIALIZE.
           OPEN INPUT  INFILE
           OPEN OUTPUT OUTFILE
           IF WS-FILE-STATUS NOT = '00'
              DISPLAY 'ACCTPROC: ERROR OPENING INPUT FILE'
              DISPLAY 'FILE STATUS: ' WS-FILE-STATUS
              MOVE 16 TO RETURN
... (truncated)
```

Please explain:
1. What is the purpose of this data set based on its name and content?
2. What type of data does it contain (COBOL source, JCL, copybooks, data, etc.)?
3. How does it relate to other data sets in the same HLQ?
4. What are the key attributes (record format, record length) and why?
5. Any observations about the content structure or conventions used?

---

### `compareMembers`

Read two PDS or PDS/E members and compare them, explaining the differences and their significance.

#### Arguments

| Argument  | Required | Description                                                                                                                                 |
|-----------|----------|---------------------------------------------------------------------------------------------------------------------------------------------|
| `dsn`     | Yes      | Fully qualified data set name (e.g. USER.SRC.COBOL).                                                                                        |
| `member1` | Yes      | First member name to compare.                                                                                                               |
| `member2` | Yes      | Second member name to compare.                                                                                                              |
| `system`  | No       | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Prompt Text

**user:**

Please compare these two members from USER.SRC.COBOL on mainframe-dev.example.com.

**Member 1: CUSTFILE**
```jcl
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CUSTFILE.
       AUTHOR. GENERATED-MOCK.
       DATE-WRITTEN. 2024-03-15.
      *
      * CUSTFILE - Generated mock COBOL program
      * Part of USER application suite
      *
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-ZOS.
       OBJECT-COMPUTER. IBM-ZOS.
      *
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT INFILE  ASSIGN TO INDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-FILE-STATUS.
           SELECT OUTFILE ASSIGN TO OUTDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.
      *
       DATA DIVISION.
       FILE SECTION.
       FD  INFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  IN-RECORD                    PIC X(80).
      *
       FD  OUTFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  OUT-RECORD                   PIC X(133).
      *
       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUS               PIC XX VALUE SPACES.
       01  WS-OUT-STATUS                PIC XX VALUE SPACES.
       01  WS-EOF-FLAG                  PIC X  VALUE 'N'.
           88 END-OF-FILE               VALUE 'Y'.
       01  WS-RECORD-COUNT              PIC 9(7) VALUE ZERO.
       01  WS-ERROR-COUNT               PIC 9(5) VALUE ZERO.
      *
           COPY ACCTFMT.
      *
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-INITIALIZE
           PERFORM 2000-PROCESS UNTIL END-OF-FILE
           PERFORM 3000-TERMINATE
           STOP RUN.
      *
       1000-INITIALIZE.
           OPEN INPUT  INFILE
           OPEN OUTPUT OUTFILE
           IF WS-FILE-STATUS NOT = '00'
              DISPLAY 'CUSTFILE: ERROR OPENING INPUT FILE'
              DISPLAY 'FILE STATUS: ' WS-FILE-STATUS
              MOVE 16 TO RETURN-CODE
              STOP RUN
           END-IF
           READ INFILE
              AT END SET END-OF-FILE TO TRUE
           END-READ.
      *
       2000-PROCESS.
           ADD 1 TO WS-RECORD-COUNT
           MOVE IN-RECORD TO OUT-RECORD
           WRITE OUT-RECORD
           READ INFILE
              AT END SET END-OF-FILE TO TRUE
           END-READ.
      *
       3000-TERMINATE.
           CLOSE INFILE
           CLOSE OUTFILE
           DISPLAY 'CUSTFILE: PROCESSED ' WS-RECORD-COUNT
                   ' RECORDS'
           DISPLAY 'CUSTFILE: ERRORS    ' WS-ERROR-COUNT.

```

**Member 2: ACCTPROC**
```jcl
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ACCTPROC.
       AUTHOR. GENERATED-MOCK.
       DATE-WRITTEN. 2024-03-15.
      *
      * ACCTPROC - Generated mock COBOL program
      * Part of USER application suite
      *
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-ZOS.
       OBJECT-COMPUTER. IBM-ZOS.
      *
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT INFILE  ASSIGN TO INDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-FILE-STATUS.
           SELECT OUTFILE ASSIGN TO OUTDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.
      *
       DATA DIVISION.
       FILE SECTION.
       FD  INFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  IN-RECORD                    PIC X(80).
      *
       FD  OUTFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  OUT-RECORD                   PIC X(133).
      *
       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUS               PIC XX VALUE SPACES.
       01  WS-OUT-STATUS                PIC XX VALUE SPACES.
       01  WS-EOF-FLAG                  PIC X  VALUE 'N'.
           88 END-OF-FILE               VALUE 'Y'.
       01  WS-RECORD-COUNT              PIC 9(7) VALUE ZERO.
       01  WS-ERROR-COUNT               PIC 9(5) VALUE ZERO.
      *
           COPY ERRCODES.
      *
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-INITIALIZE
           PERFORM 2000-PROCESS UNTIL END-OF-FILE
           PERFORM 3000-TERMINATE
           STOP RUN.
      *
       1000-INITIALIZE.
           OPEN INPUT  INFILE
           OPEN OUTPUT OUTFILE
           IF WS-FILE-STATUS NOT = '00'
              DISPLAY 'ACCTPROC: ERROR OPENING INPUT FILE'
              DISPLAY 'FILE STATUS: ' WS-FILE-STATUS
              MOVE 16 TO RETURN-CODE
              STOP RUN
           END-IF
           READ INFILE
              AT END SET END-OF-FILE TO TRUE
           END-READ.
      *
       2000-PROCESS.
           ADD 1 TO WS-RECORD-COUNT
           MOVE IN-RECORD TO OUT-RECORD
           WRITE OUT-RECORD
           READ INFILE
              AT END SET END-OF-FILE TO TRUE
           END-READ.
      *
       3000-TERMINATE.
           CLOSE INFILE
           CLOSE OUTFILE
           DISPLAY 'ACCTPROC: PROCESSED ' WS-RECORD-COUNT
                   ' RECORDS'
           DISPLAY 'ACCTPROC: ERRORS    ' WS-ERROR-COUNT.

```

Please:
1. Identify and explain the key differences between the two members
2. Highlight any additions, deletions, or modifications
3. Explain the significance of each difference
4. Note any potential issues introduced by the changes
5. Suggest which version is preferred and why (if applicable)

---


## Resource Templates

The server provides **2** resource templates.

### `Data Set Content`

**URI Template:** `zos-ds://{system}/{dsn}`

**MIME Type:** text/plain

Content of a sequential z/OS data set. Provide the system hostname and fully-qualified data set name.

---

### `Member Content`

**URI Template:** `zos-ds://{system}/{dsn}({member})`

**MIME Type:** text/plain

Content of a PDS or PDS/E member on z/OS. Provide the system hostname, data set name, and member name.

---
