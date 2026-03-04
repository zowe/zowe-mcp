<!-- markdownlint-disable MD004 MD009 MD012 MD024 MD031 MD032 MD034 MD036 MD037 MD060 -->

# Zowe MCP Server Reference

> Auto-generated from the MCP server (v0.6.0-dev, commit 3f99476). Do not edit manually — run `npx zowe-mcp-server generate-docs` to regenerate.

This document describes all tools, prompts, resources, and resource templates provided by the Zowe MCP Server.

## Tools

The server provides **51** tools.

| # | Tool | Description |
| --- | --- | --- |
| 1 | [`info`](#info) | Provides information about the Zowe MCP server, its version, and backend connection status |
| 2 | [`listSystems`](#listsystems) | List all z/OS systems you have access to |
| 3 | [`setSystem`](#setsystem) | Set the active z/OS system |
| 4 | [`getContext`](#getcontext) | Return the current session context: active system, active connection (user@host), user ID, all known systems (with their connections when multiple exist), and recently used systems (those with saved context) |
| 5 | [`listDatasets`](#listdatasets) | List data sets matching a DSLEVEL pattern |
| 6 | [`listMembers`](#listmembers) | List members of a PDS/PDSE data set |
| 7 | [`searchInDataset`](#searchindataset) | When the response has _result |
| 8 | [`getDatasetAttributes`](#getdatasetattributes) | Get detailed attributes of a data set: organization, record format, record length, block size, volume, SMS classes, dates, and more |
| 9 | [`readDataset`](#readdataset) | Read the content of a sequential data set or PDS/PDSE member |
| 10 | [`writeDataset`](#writedataset) | Write UTF-8 content to a sequential data set or PDS/PDSE member |
| 11 | [`getTempDatasetPrefix`](#gettempdatasetprefix) | For automation and testing |
| 12 | [`getTempDatasetName`](#gettempdatasetname) | Returns a single unique full temporary data set name (for one data set) |
| 13 | [`createDataset`](#createdataset) | Create a new sequential or partitioned data set |
| 14 | [`createTempDataset`](#createtempdataset) | Creates a new data set with a unique temporary name in a single call |
| 15 | [`deleteDataset`](#deletedataset) | Delete a data set or a specific PDS/PDSE member |
| 16 | [`deleteDatasetsUnderPrefix`](#deletedatasetsunderprefix) | Destructive |
| 17 | [`copyDataset`](#copydataset) | Copy a data set or PDS/PDSE member within a single z/OS system |
| 18 | [`renameDataset`](#renamedataset) | Rename a data set or PDS/PDSE member |
| 19 | [`restoreDataset`](#restoredataset) | Restore (recall) a migrated data set from HSM |
| 20 | [`getUssHome`](#getusshome) | Return the current user's USS home directory for the active (or specified) system |
| 21 | [`changeUssDirectory`](#changeussdirectory) | Set the USS current working directory for the active (or specified) system |
| 22 | [`listUssFiles`](#listussfiles) | List files and directories in a USS path |
| 23 | [`readUssFile`](#readussfile) | Read the content of a USS file |
| 24 | [`runSafeUssCommand`](#runsafeusscommand) | Run a Unix command on z/OS USS |
| 25 | [`writeUssFile`](#writeussfile) | Write or overwrite a USS file |
| 26 | [`createUssFile`](#createussfile) | Create a USS file or directory |
| 27 | [`deleteUssFile`](#deleteussfile) | Delete a USS file or directory |
| 28 | [`chmodUssFile`](#chmodussfile) | Change permissions of a USS file or directory |
| 29 | [`chownUssFile`](#chownussfile) | Change owner of a USS file or directory |
| 30 | [`chtagUssFile`](#chtagussfile) | Set the z/OS file tag (encoding/type) for a USS file or directory |
| 31 | [`copyUssFile`](#copyussfile) | Copy a USS file or directory on z/OS |
| 32 | [`getUssTempDir`](#getusstempdir) | Return a unique USS directory path under the given base path (e |
| 33 | [`getUssTempPath`](#getusstemppath) | Return a unique USS file path under the given directory (e |
| 34 | [`createTempUssDir`](#createtempussdir) | Create a temporary USS directory |
| 35 | [`createTempUssFile`](#createtempussfile) | Create an empty USS file at the given path (e |
| 36 | [`deleteUssTempUnderDir`](#deleteusstempunderdir) | Delete all files and directories under the given USS path (the path itself is removed) |
| 37 | [`runSafeTsoCommand`](#runsafetsocommand) | Run a TSO command on z/OS |
| 38 | [`submitJob`](#submitjob) | Submit JCL to the current (or specified) z/OS system |
| 39 | [`getJobStatus`](#getjobstatus) | Get the current status of a z/OS job (e |
| 40 | [`listJobFiles`](#listjobfiles) | List output files (spools) for a z/OS job |
| 41 | [`readJobFile`](#readjobfile) | Read the content of one job output file (spool) |
| 42 | [`getJobOutput`](#getjoboutput) | Get aggregated output from job files for a completed job |
| 43 | [`searchJobOutput`](#searchjoboutput) | Search for a substring in a job's output files (all files or one by jobFileId) |
| 44 | [`listJobs`](#listjobs) | List jobs on the z/OS system with optional filters (owner, prefix, status) |
| 45 | [`getJcl`](#getjcl) | Get the JCL for a job |
| 46 | [`cancelJob`](#canceljob) | Cancel a job on the z/OS system |
| 47 | [`holdJob`](#holdjob) | Hold a job on the z/OS system |
| 48 | [`releaseJob`](#releasejob) | Release a held job on the z/OS system |
| 49 | [`deleteJob`](#deletejob) | Delete a job from the output queue |
| 50 | [`submitJobFromDataset`](#submitjobfromdataset) | Submit a job from a data set (e |
| 51 | [`submitJobFromUss`](#submitjobfromuss) | Submit a job from a USS file path |

### `info`

> Read-only

Provides information about the Zowe MCP server, its version, and backend connection status. 

#### Parameters

*No parameter.*

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Server display name |
| `version` | `string` | Yes | Semantic version |
| `description` | `string` | Yes | Short server description |
| `components` | `string`[] | Yes | Registered component names (e.g. core, datasets, uss) |
| `backend` | `string` \| `null` | Yes | Active backend: mock, native, or null |
| `notice` | `string` | No | Guidance when no backend is configured |

#### Example Output

```json
{
  "name": "Zowe MCP Server",
  "version": "0.6.0-dev",
  "description": "MCP server providing tools for z/OS systems including data sets, jobs, and UNIX System Services",
  "components": [
    "core",
    "context",
    "datasets",
    "uss",
    "tso",
    "jobs"
  ],
  "backend": "mock"
}
```

---

### `listSystems`

> Read-only

List all z/OS systems you have access to. Each system is a host; multiple configured connections (user@host) to the same host appear as one system with a connections list. Use setSystem to select which system (and optionally which connection) to use.

#### Parameters

*No parameter.*

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messages` | `string`[] | Yes | Informational messages (e.g. resolution notes). |
| `systems` | `object`[] | Yes | All configured z/OS systems you have access to. |

#### Example Output

```json
{
  "messages": [],
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

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `system` | `string` | Yes | Hostname of the z/OS system to activate (e.g. sys1.example.com or sys1 when unambiguous), or connection spec (user@host) when multiple connections exist for that host. |
| `mainframeMvsEncoding` | `string` \| `null` | No | Mainframe encoding (EBCDIC) for this system. Omit to leave unchanged; pass null to use MCP server default. |
| `mainframeUssEncoding` | unknown | No |  |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messages` | `string`[] | Yes | Resolution or connection messages (e.g. "System resolved from unqualified name 'sys1'."). |
| `activeSystem` | `string` | Yes | Resolved hostname of the active z/OS system. |
| `userId` | `string` | Yes | User ID on that system (e.g. from credentials). |
| `description` | `string` | No | Optional system description/label from configuration. |
| `mainframeMvsEncoding` | `string` \| `null` | No | Per-system MVS/data set encoding override (e.g. IBM-037). null = use MCP server default. |
| `mainframeUssEncoding` | `string` \| `null` | No | Per-system USS encoding override (e.g. IBM-1047). null = use MCP server default. |

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
  "messages": [],
  "activeSystem": "mainframe-dev.example.com",
  "userId": "USER",
  "description": "Development LPAR"
}
```

---

### `getContext`

> Read-only

Return the current session context: active system, active connection (user@host), user ID, all known systems (with their connections when multiple exist), and recently used systems (those with saved context).

#### Parameters

*No parameter.*

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messages` | `string`[] | Yes | Informational messages. |
| `activeSystem` | unknown | Yes | Currently selected system and user; null if no system has been set yet. |
| `allSystems` | `object`[] | Yes | All configured z/OS systems with host, optional description/connections, and active flag. |
| `recentlyUsedSystems` | `object`[] | Yes | Systems that have been used in this session (have saved context: userId, optional ussHome/encodings). |

#### Example Output

```json
// Error calling tool
{
  "error": "MCP error -32602: Structured content does not match the tool's output schema: data/recentlyUsedSystems/0 must NOT have additional properties"
}
```

---

### `listDatasets`

> Read-only

List data sets matching a DSLEVEL pattern. Results are paginated (default 500, max 1000 per page). When _result.hasMore is true, more items exist—you must call this tool again with offset and limit to get the next page (offset = current offset + _result.count, same limit). Do not answer using only the first page; fetch all pages until _result.hasMore is false. Parameters: offset (0-based), limit (items per page). Set attributes to false for names-only (default true includes dsorg, recfm, lrecl, etc.). DSLEVEL pattern (dataset list pattern for dsnPattern). It is not the same as grep regex or Windows filename masks.

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
- USER.**JCL — Invalid: ** needs to be used alone in a qualifier. Use USER.**.*JCL* instead.
- USER.**JCL* — Invalid: ** and * cannot be used together in the same qualifier. Use USER.**.*JCL* instead.

Notes:
- USER.*.OLD — Wrong when you want names like USER.JCL.VERY.OLD that match multiple qualifiers. * matches only one qualifier, so it matches USER.JCL.OLD but not USER.JCL.VERY.OLD. Use USER.**.OLD to match any number of middle qualifiers.
- *.DATASET or **.DATASET — Possible but will cause all catalogs on the system to be searched. It will take a considerable amount of time to complete this search. If you can be more specific, do so.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsnPattern` | `string` | Yes | Fully qualified data set list pattern (e.g. USER.* or USER.**). DSLEVEL pattern (dataset list pattern for dsnPattern). It is not the same as grep regex or Windows filename masks.  Rules: - Pattern must not begin with a wildcard (first qualifier must be literal, e.g. USER or MY.HIGH.LEVEL). - Maximum length 44 characters.  Wildcards: - % — any single character in that position (e.g. USER.TEST% matches USER.TEST1 and USER.TEST2). - * — any characters within that one qualifier only (e.g. USER.J*.OLD matches USER.JCL.OLD but not USER.JCL.VERY.OLD). - ** — any characters across any number of qualifiers (e.g. USER.**.OLD matches both USER.JCL.OLD and USER.JCL.VERY.OLD).  Patterns are fully qualified. MY.DATASET and 'MY.DATASET' are equivalent.  Examples: - Exact or prefix: USER, MY.DATASET, USER.** - Single qualifier wildcard: USER.J*.CNTL - Multi-qualifier: USER.**.CNTL (anything under USER ending in qualifier CNTL)  Correct use of * and ** in one pattern: - USER.T*.**.OLD — * matches any second qualifier that starts with T (e.g. TEST, TST); ** matches zero or more qualifiers before the final OLD. Matches USER.TEST.OLD, USER.TEST.BACKUP.OLD, USER.TST.X.Y.OLD. - USER.**.*JCL* — * matches any last qualifier that contains JCL (e.g. JCL, MYJCL, JCLOLD); ** matches zero or more qualifiers before the final segment. Matches USER.JCL, USER.BACKUP.JCLS, USER.TEST.SAMPJCL.  Invalid patterns: - USER.**JCL — Invalid: ** needs to be used alone in a qualifier. Use USER.**.*JCL* instead. - USER.**JCL* — Invalid: ** and * cannot be used together in the same qualifier. Use USER.**.*JCL* instead.  Notes: - USER.*.OLD — Wrong when you want names like USER.JCL.VERY.OLD that match multiple qualifiers. * matches only one qualifier, so it matches USER.JCL.OLD but not USER.JCL.VERY.OLD. Use USER.**.OLD to match any number of middle qualifiers. - *.DATASET or **.DATASET — Possible but will cause all catalogs on the system to be searched. It will take a considerable amount of time to complete this search. If you can be more specific, do so. |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |
| `volser` | `string` | No | Volume serial for uncataloged data sets. |
| `offset` | `integer` | No | 0-based offset into the result set. Default: 0. |
| `limit` | `integer` | No | Maximum number of items to return. Default: 500. Max: 1000. |
| `attributes` | `boolean` | No | When true (default), include data set attributes (dsorg, recfm, lrecl, blksz, volser, creationDate). When false, return only data set names. (default: `true`) |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object`[] | Yes |  |

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
  "messages": [],
  "data": [
    {
      "dsn": "USER.DATA.FILE01",
      "dsorg": "PS",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "volser": "VOL001",
      "resourceLink": "zos-ds://mainframe-dev.example.com/USER.DATA.FILE01?volser=VOL001"
    },
    {
      "dsn": "USER.DATA.INPUT",
      "dsorg": "PS",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "volser": "VOL001",
      "resourceLink": "zos-ds://mainframe-dev.example.com/USER.DATA.INPUT?volser=VOL001"
    },
    {
      "dsn": "USER.JCL.CNTL",
      "dsorg": "PO-E",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "volser": "VOL001",
      "creationDate": "2024-03-15",
      "resourceLink": "zos-ds://mainframe-dev.example.com/USER.JCL.CNTL?volser=VOL001"
    },
    {
      "dsn": "USER.LISTING",
      "dsorg": "PS",
      "recfm": "FBA",
      "lrecl": 133,
      "blksz": 27920,
      "volser": "VOL001",
      "creationDate": "2024-03-15",
      "resourceLink": "zos-ds://mainframe-dev.example.com/USER.LISTING?volser=VOL001"
    },
    {
      "dsn": "USER.LOADLIB",
      "dsorg": "PO-E",
      "recfm": "U",
      "lrecl": 0,
      "blksz": 32760,
      "volser": "VOL001",
      "creationDate": "2024-03-15",
      "resourceLink": "zos-ds://mainframe-dev.example.com/USER.LOADLIB?volser=VOL001"
    },
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
  "messages": [],
  "data": []
}
```

---

### `listMembers`

> Read-only

List members of a PDS/PDSE data set. Results are paginated (default 500, max 1000 per page). When _result.hasMore is true, more members exist—you must call this tool again with offset and limit to get the next page (offset = current offset + _result.count, same limit). Do not answer using only the first page; fetch all pages until _result.hasMore is false. Parameters: offset (0-based), limit (members per page).

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL). |
| `memberPattern` | `string` | No | Optional member name filter. Wildcards: * (zero or more characters), % (one character). E.g. "ABC*", "A%C". |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |
| `offset` | `integer` | No | 0-based offset into the result set. Default: 0. |
| `limit` | `integer` | No | Maximum number of items to return. Default: 500. Max: 1000. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object`[] | Yes |  |

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
  "messages": [],
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
  "pattern": "CUST*"
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
  "messages": [],
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

---

### `searchInDataset`

> Read-only

When the response has _result.hasMore true, you must call again with offset and limit (e.g. offset=500, limit=500) before giving a final count or answer—do not answer with only the first page. Search for a string in a sequential data set or in a PDS/PDSE (all members or one member). Returns matching lines with line numbers and a summary. Results are paginated by member (offset/limit); when _result.hasMore is true, call again with the next offset and limit. Options: caseSensitive (default false), cobol (ignore cols 1–6), ignoreSequenceNumbers, doNotProcessComments (asterisk, cobolComment, fortran, cpp, pli, pascal, pcAssembly, ada), includeContextLines (±6 lines around each match via LPSF). You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL or SYS1.SAMPLIB). |
| `string` | `string` | Yes | Search string (literal) to find in the data set or members. |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |
| `encoding` | `string` | No | Mainframe encoding (EBCDIC) for reading data set content. Overrides system and server default when set. |
| `member` | `string` | No | For PDS/PDSE only, limit search to this member (e.g. IEANTCOB). Omit to search all members or a sequential data set. |
| `offset` | `integer` | No | 0-based offset into the member list. Default: 0. |
| `limit` | `integer` | No | Number of members to return per page. Default: 500. Max: 1000. |
| `caseSensitive` | `boolean` | No | When true, match exact case. Default false (case-insensitive). |
| `cobol` | `boolean` | No | When true, ignore columns 1–6 (COBOL sequence numbers). Default: false. |
| `ignoreSequenceNumbers` | `boolean` | No | When true (default), ignore cols 73–80 as sequence numbers. When false, treat as data. |
| `doNotProcessComments` | `string`[] | No | Comment types to exclude from search: asterisk, cobolComment, fortran, cpp, pli, pascal, pcAssembly, ada (case-insensitive). |
| `includeContextLines` | `boolean` | No | When true, include ±6 lines of context (beforeContext/afterContext) around each match via SuperC LPSF. Only effective with the native ZNP backend; ignored by the fallback grep path. Default: false. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

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
  "messages": [],
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
  "messages": [],
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

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL). |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

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
  "messages": [],
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

Read the content of a sequential data set or PDS/PDSE member. Results are paginated by lines. When _result.hasMore is true, more lines exist—you must call this tool again with startLine and lineCount to get the next page. Do not answer using only the first page; fetch until _result.hasMore is false. Large files are automatically truncated to the first 2000 lines when no window is requested. Returns UTF-8 text, an ETag for optimistic locking, and the source encoding. Pass the ETag to writeDataset to prevent overwriting concurrent changes. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL). |
| `member` | `string` | No | Member name for PDS/PDSE data sets. |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |
| `encoding` | `string` | No | Mainframe encoding (EBCDIC) for this read. Overrides system and server default when set. Default: from system or MCP server default. |
| `startLine` | `integer` | No | 1-based starting line number. Default: 1 (beginning of file). |
| `lineCount` | `integer` | No | Number of lines to return. Default: all remaining lines up to the auto-truncation limit. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

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
  "messages": [],
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
    "etag": "20139c42e21eef3b9f7534041279ae8a",
    "encoding": "IBM-037"
  }
}
```

---

### `writeDataset`


Write UTF-8 content to a sequential data set or PDS/PDSE member. When startLine and endLine are provided, the block of records from startLine to endLine (inclusive) is replaced by the given lines; the number of lines need not match (data set can grow or shrink). When only startLine is provided, the same number of lines as in the lines array are replaced starting at startLine. When both are omitted, the entire data set or member is replaced. If an ETag is provided (from a previous readDataset call), the write fails if the data set was modified since the read — preventing overwrites. Returns a new ETag for the written content. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL). |
| `lines` | `string`[] | Yes | UTF-8 content to write as an array of lines (one string per record). |
| `member` | `string` | No | Member name for PDS/PDSE data sets. |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |
| `etag` | `string` | No | ETag from a previous readDataset call for optimistic locking. |
| `encoding` | `string` | No | Mainframe encoding (EBCDIC) for this write. Overrides system and server default when set. Default: from system or MCP server default. |
| `startLine` | `number` | No | 1-based first line of the block to replace; use with endLine to replace a range (content line count can differ). |
| `endLine` | `number` | No | 1-based last line of the block to replace (inclusive). When provided with startLine, the replaced block can grow or shrink to match the number of lines in the lines array. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `getTempDatasetPrefix`

> Read-only

For automation and testing. Returns a unique DSN prefix (HLQ) under which temporary data sets can be created. The prefix is verified not to exist on the system. Default is current user + .TMP (e.g. USER.TMP.XXXXXXXX.YYYYYYYY); configurable via parameters.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `prefix` | `string` | No | HLQ for temp names (e.g. USER.TMP). Default: current user on the target system + .TMP. |
| `suffix` | `string` | No | Optional suffix qualifier (last part of the generated prefix). |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

#### Example Output

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "success": true
  },
  "messages": [],
  "data": {
    "tempDsnPrefix": "USER.TMP.LOEIZW27.XGVV9U8L"
  }
}
```

---

### `getTempDatasetName`

> Read-only

Returns a single unique full temporary data set name (for one data set). The DSN is verified not to exist on the system. Same prefix/suffix defaults as getTempDatasetPrefix.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `prefix` | `string` | No | HLQ for temp names (e.g. USER.TMP). Default: current user on the target system + .TMP. |
| `suffix` | `string` | No | Optional suffix qualifier for the generated prefix. |
| `qualifier` | `string` | No | Last qualifier for the DSN (e.g. DATA, 1–8 chars). If omitted, a unique qualifier is generated. |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

#### Example Output

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "success": true
  },
  "messages": [],
  "data": {
    "tempDsn": "USER.TMP.GCS7ODOJ.F66ENX8F.HYBC0DGG"
  }
}
```

---

### `createDataset`


Create a new sequential or partitioned data set. Specify the type (PS/SEQUENTIAL, PO/PDS, PO-E/PDSE/LIBRARY) and optional attributes. Use primarySpace, secondarySpace, blockSize (Zowe CLI naming). Type and recfm are case-insensitive.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL). |
| `type` | `string` | Yes | Dataset type: PS or SEQUENTIAL (sequential), PO or PDS (PDS), PO-E or PDSE or LIBRARY (PDSE). Case-insensitive. |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |
| `recfm` | `string` | No | Record format. Supported: F, FB, V, VB, U, FBA, VBA. Default: FB. Case-insensitive. |
| `lrecl` | `number` | No | Logical record length. Default: 80. |
| `blockSize` | `number` | No | Block size. Default: 27920. |
| `primarySpace` | `number` | No | Primary space allocation. |
| `secondarySpace` | `number` | No | Secondary space allocation. |
| `dirblk` | `number` | No | Directory blocks (PDS only). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `createTempDataset`


Creates a new data set with a unique temporary name in a single call. Returns the created DSN for subsequent steps or cleanup. Same creation options as createDataset; optional prefix/suffix/qualifier for naming. Default prefix: current user + .TMP. Use primarySpace, secondarySpace, blockSize (Zowe CLI naming). Type and recfm are case-insensitive.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | `string` | Yes | Dataset type: PS or SEQUENTIAL (sequential), PO or PDS (PDS), PO-E or PDSE or LIBRARY (PDSE). Case-insensitive. |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |
| `prefix` | `string` | No | HLQ for temp name (e.g. USER.TMP). Default: current user + .TMP. |
| `suffix` | `string` | No | Optional suffix qualifier for the generated prefix. |
| `qualifier` | `string` | No | Last qualifier for the DSN (1–8 chars). If omitted, a unique qualifier is generated. |
| `recfm` | `string` | No | Record format. Supported: F, FB, V, VB, U, FBA, VBA. Default: FB. Case-insensitive. |
| `lrecl` | `number` | No | Logical record length. Default: 80. |
| `blockSize` | `number` | No | Block size. Default: 27920. |
| `primarySpace` | `number` | No | Primary space allocation. |
| `secondarySpace` | `number` | No | Secondary space allocation. |
| `dirblk` | `number` | No | Directory blocks (PDS only). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `deleteDataset`

> Destructive

Delete a data set or a specific PDS/PDSE member. This is a destructive operation that cannot be undone. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL). |
| `member` | `string` | No | Member name to delete (if omitting, the entire data set is deleted). |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `deleteDatasetsUnderPrefix`

> Destructive

Destructive. Deletes all data sets whose names start with the given prefix (e.g. tempDsnPrefix returned by getTempDatasetPrefix). For automation: create temp data sets under one prefix, then call this once to clean up. Prefix must have at least 3 qualifiers and contain TMP (e.g. USER.TMP.XXXXXXXX.YYYYYYYY).

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsnPrefix` | `string` | Yes | Fully qualified prefix (e.g. USER.TMP.A1B2C3D4.E5F6G7H8). All data sets matching this prefix will be deleted. Must have at least 3 qualifiers and contain TMP. |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `copyDataset`


Copy a data set or PDS/PDSE member within a single z/OS system. You may pass source or target dsn as USER.LIB(MEM) and omit the corresponding member.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sourceDsn` | `string` | Yes | Fully qualified source data set name (e.g. USER.SRC.COBOL). |
| `targetDsn` | `string` | Yes | Fully qualified target data set name (e.g. USER.SRC.BACKUP). |
| `sourceMember` | `string` | No | Source member name (for copying a single member). |
| `targetMember` | `string` | No | Target member name (defaults to source member name). |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `renameDataset`


Rename a data set or PDS/PDSE member. You may pass dsn as USER.LIB(MEM) and omit member.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.SRC.COBOL). |
| `newDsn` | `string` | Yes | Fully qualified new data set name (e.g. USER.SRC.NEW). |
| `member` | `string` | No | Current member name (for renaming a member within a PDS/PDSE). |
| `newMember` | `string` | No | New member name. |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `restoreDataset`


Restore (recall) a migrated data set from HSM. Use this when a data set shows as migrated in listDatasets or getDatasetAttributes.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully qualified data set name (e.g. USER.ARCHIVE.DATA). |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints (e.g. call again with offset/limit), resolution notes, or allocation messages. |
| `data` | `object` | Yes |  |

---

### `getUssHome`

> Read-only

Return the current user's USS home directory for the active (or specified) system. 

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

#### Example Output

```json
{
  "_context": {
    "system": "mainframe-dev.example.com"
  },
  "_result": {
    "success": true
  },
  "messages": [],
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

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | Directory path to set as current working directory (absolute or relative to current cwd). |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

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
  "messages": [],
  "data": {
    "path": "/u/USER"
  }
}
```

---

### `listUssFiles`

> Read-only

List files and directories in a USS path. Results are paginated (default 500, max 1000 per page). When _result.hasMore is true, call again with offset and limit to get the next page. Do not answer using only the first page; fetch all pages until _result.hasMore is false.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS directory path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd). |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |
| `includeHidden` | `boolean` | No | Include hidden files (names starting with .). (default: `false`) |
| `longFormat` | `boolean` | No | Return long format (mode, size, mtime, name). (default: `false`) |
| `offset` | `integer` | No | 0-based offset. Default: 0. |
| `limit` | `integer` | No | Max items per page. Default: 500. Max: 1000. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object`[] | Yes |  |

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
  "messages": [],
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
  "messages": [],
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

Read the content of a USS file. Results may be line-windowed; when _result.hasMore is true, call again with startLine and lineCount to get the next lines. Do not answer using only the first window; fetch until _result.hasMore is false.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd). |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |
| `encoding` | `string` | No | Mainframe (EBCDIC) encoding for the file. Omit to use system default or file tag. |
| `startLine` | `integer` | No | 1-based first line to return. Default: 1. |
| `lineCount` | `integer` | No | Number of lines to return. Omit for default window size. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

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
  "messages": [],
  "data": {
    "lines": [
      "Hello from USS mock. Use this file for readUssFile evals."
    ],
    "etag": "5ae4a6f88fbfe80e8240f72d58201302",
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

### `runSafeUssCommand`

> Read-only

Run a Unix command on z/OS USS. Only allowlisted (safe) commands run automatically. Unknown commands require user confirmation (elicitation); if the client does not support elicitation, execution is denied. Output is paginated by line; when _result.hasMore is true, call again with startLine and lineCount to get the next lines.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `commandText` | `string` | Yes | The Unix command line to execute (e.g. ls -la /tmp, whoami, pwd). |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |
| `startLine` | `integer` | No | 1-based first line of output to return. Default: 1. |
| `lineCount` | `integer` | No | Number of lines to return. Omit for default window size. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

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
  "messages": [],
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

### `writeUssFile`


Write or overwrite a USS file. Creates the file if it does not exist.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd). |
| `lines` | `string`[] | Yes | UTF-8 content to write as an array of lines (one string per line). |
| `system` | `string` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system. |
| `etag` | `string` | No | ETag for optimistic locking. |
| `encoding` | `string` | No | Mainframe encoding. Omit for default. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `createUssFile`


Create a USS file or directory.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS path to create: absolute or relative to current working directory (see getContext.ussCwd). |
| `isDirectory` | `boolean` | Yes | True to create a directory, false for a regular file. |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `permissions` | `string` | No | Octal permissions (e.g. 755). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `deleteUssFile`

> Destructive

Delete a USS file or directory. Use recursive for directories.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS path to delete: absolute or relative to current working directory (see getContext.ussCwd). |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `recursive` | `boolean` | No | If true, delete directory and contents. (default: `false`) |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `chmodUssFile`


Change permissions of a USS file or directory.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS path: absolute or relative to current working directory (see getContext.ussCwd). |
| `mode` | `string` | Yes | Octal mode (e.g. 755). |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `recursive` | `boolean` | No | Apply recursively. (default: `false`) |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `chownUssFile`


Change owner of a USS file or directory.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS path: absolute or relative to current working directory (see getContext.ussCwd). |
| `owner` | `string` | Yes | New owner. |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `recursive` | `boolean` | No | Apply recursively. (default: `false`) |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `chtagUssFile`


Set the z/OS file tag (encoding/type) for a USS file or directory.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS path: absolute or relative to current working directory (see getContext.ussCwd). |
| `tag` | `string` | Yes | Tag (e.g. ISO8859-1). |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `recursive` | `boolean` | No | Apply recursively. (default: `false`) |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `copyUssFile`


Copy a USS file or directory on z/OS. For directories, set recursive to true. Paths can be absolute (starting with /) or relative to the current working directory (see getContext.ussCwd).

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sourcePath` | `string` | Yes | Source USS path: absolute (starts with /) or relative to current working directory. |
| `targetPath` | `string` | Yes | Destination USS path: absolute (starts with /) or relative to current working directory. |
| `recursive` | `boolean` | No | Copy directories recursively. (default: `false`) |
| `followSymlinks` | `boolean` | No | Follow symlinks when copying recursively. (default: `false`) |
| `preserveAttributes` | `boolean` | No | Preserve permissions and ownership. (default: `false`) |
| `force` | `boolean` | No | Replace files that cannot be opened (like cp -f). (default: `false`) |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `getUssTempDir`

> Read-only

Return a unique USS directory path under the given base path (e.g. $HOME/tmp or /tmp) for temporary use. The path is verified not to exist. Use createUssFile with isDirectory true to create it.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `basePath` | `string` | Yes | Base directory: absolute or relative to current working directory (see getContext.ussCwd). |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `getUssTempPath`

> Read-only

Return a unique USS file path under the given directory (e.g. from getUssTempDir). The path is verified not to exist. Use writeUssFile or createUssFile to create the file.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dirPath` | `string` | Yes | Parent directory: absolute or relative to current working directory (see getContext.ussCwd). |
| `prefix` | `string` | No | Optional filename prefix. |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `createTempUssDir`


Create a temporary USS directory. Typically use a path from getUssTempDir. Creates the directory and any missing parents.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS directory path: absolute or relative to current working directory (see getContext.ussCwd). |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |
| `permissions` | `string` | No | Octal permissions (e.g. 755). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `createTempUssFile`


Create an empty USS file at the given path (e.g. from getUssTempPath). Creates parent directories if needed.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS file path: absolute or relative to current working directory (see getContext.ussCwd). |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `deleteUssTempUnderDir`

> Destructive

Delete all files and directories under the given USS path (the path itself is removed). Safety: path must contain the segment "tmp" (or "TMP") and have at least 3 path segments (e.g. /u/myuser/tmp/xyz).

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS path to delete recursively: absolute or relative to current working directory (see getContext.ussCwd); must contain "tmp" and min depth. |
| `system` | `string` | No | Target z/OS system: host or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination, line window, or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, resolution notes, or path warnings. |
| `data` | `object` | Yes |  |

---

### `runSafeTsoCommand`

> Read-only

Run a TSO command on z/OS. Only allowlisted (safe) commands run automatically. Unknown commands require user confirmation (elicitation); if the client does not support elicitation, execution is denied. Output is paginated by line; when _result.hasMore is true, call again with startLine and lineCount to get the next lines. Requesting the same command without startLine and lineCount re-executes the command.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `commandText` | `string` | Yes | The TSO command to execute (e.g. LISTDS 'USER.DATA', LISTALC, LISTCAT, STATUS). |
| `system` | `string` | No | Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system. |
| `startLine` | `integer` | No | 1-based first line of output to return. Default: 1. |
| `lineCount` | `integer` | No | Number of lines to return. Omit for default window size. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Line-window metadata for TSO output. |
| `messages` | `string`[] | Yes | Operational messages: line-window hints (e.g. call again with startLine/lineCount). |
| `data` | `object` | Yes |  |

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
    "contentLength": 74,
    "mimeType": "text/plain",
    "hasMore": false
  },
  "messages": [],
  "data": {
    "lines": [
      "TIME-05:13:58 AM. CPU-00:00:00 SERVICE-26895 SESSION-00:01:53 MARCH 4,2026"
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

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `lines` | `string`[] | Yes | JCL to submit as array of lines. Omit the job card to use the one configured for this connection; include it only when your JCL already has a full JOB statement. |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `jobName` | `string` | No | Job name for the JOB statement when using a template (max 8 chars). Default: user ID + "A". Ignored if JCL already contains a job card. |
| `programmer` | `string` | No | Programmer field in the JOB statement when using a template (max 19 chars). Typically describes what the job does. Default: empty. Ignored if JCL already contains a job card. |
| `wait` | `boolean` | No | When true, wait for the job to reach OUTPUT (or timeout) and return status, timedOut, and optionally failedStepJobFiles. |
| `timeoutSeconds` | `integer` | No | When wait is true, how long to wait for OUTPUT (seconds). Default 300. The job keeps running on z/OS after timeout. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `getJobStatus`

> Read-only

Get the current status of a z/OS job (e.g. INPUT, ACTIVE, OUTPUT) and its return code when complete.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `listJobFiles`

> Read-only

List output files (spools) for a z/OS job. The job must be in OUTPUT status. Use getJobStatus to check status first.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `offset` | `integer` | No | 0-based offset for pagination (default 0). |
| `limit` | `integer` | No | Number of job files to return (default 500, max 1000). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object`[] | Yes |  |

---

### `readJobFile`

> Read-only

Read the content of one job output file (spool). Use listJobFiles to get job file IDs. Optional startLine and lineCount for partial reads.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `jobFileId` | `integer` | Yes | Job file (spool) ID from listJobFiles. |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `startLine` | `integer` | No | 1-based first line to return (default 1). |
| `lineCount` | `integer` | No | Number of lines to return (default: all). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `getJobOutput`

> Read-only

Get aggregated output from job files for a completed job. By default returns output from failed steps only when the job has a non-zero return code. Optional jobFileIds to limit to specific files.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `failedStepsOnly` | `boolean` | No | When true (default), only include output from steps that failed (when job retcode is non-zero). When false, include all job files. |
| `jobFileIds` | `integer`[] | No | Optional list of job file (spool) IDs to include. When provided, only these files are read; failedStepsOnly is ignored. |
| `offset` | `integer` | No | 0-based offset for pagination over job files (default 0). |
| `limit` | `integer` | No | Number of job files to return (default 500, max 1000). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `searchJobOutput`

> Read-only

Search for a substring in a job's output files (all files or one by jobFileId). Returns matching lines with location and text. Use offset/limit to page results.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `searchString` | `string` | Yes | Substring to search for (literal, not regex). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `jobFileId` | `integer` | No | If provided, search only this job file (spool ID from listJobFiles). Otherwise search all job files. |
| `caseSensitive` | `boolean` | No | When true, match case exactly. Default false. |
| `offset` | `integer` | No | 0-based offset for pagination over matches (default 0). |
| `limit` | `integer` | No | Number of matches to return (default 100, max 500). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object`[] | Yes |  |

---

### `listJobs`

> Read-only

List jobs on the z/OS system with optional filters (owner, prefix, status). Use offset/limit to page results.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `owner` | `string` | No | Filter by job owner. |
| `prefix` | `string` | No | Filter by job name prefix. |
| `status` | `string` | No | Filter by status: INPUT, ACTIVE, or OUTPUT. |
| `offset` | `integer` | No | 0-based offset (default 0). |
| `limit` | `integer` | No | Number of jobs to return (default 100, max 1000). |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object`[] | Yes |  |

---

### `getJcl`

> Read-only

Get the JCL for a job.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `cancelJob`

> Destructive

Cancel a job on the z/OS system.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `holdJob`

> Destructive

Hold a job on the z/OS system.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `releaseJob`


Release a held job on the z/OS system.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `deleteJob`

> Destructive

Delete a job from the output queue.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID (e.g. JOB00123 or J0nnnnnn). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `submitJobFromDataset`

> Destructive

Submit a job from a data set (e.g. a PDS/PDSE member containing JCL). The data set must contain valid JCL including a job card. Set wait: true to wait for the job to reach OUTPUT and return status.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dsn` | `string` | Yes | Fully-qualified data set name, optionally with member in parentheses (e.g. USER.JCL.CNTL(MYJOB)). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `wait` | `boolean` | No | When true, wait for the job to reach OUTPUT (or timeout) and return status, timedOut, and optionally failedStepJobFiles. |
| `timeoutSeconds` | `integer` | No | When wait is true, how long to wait for OUTPUT (seconds). Default 300. The job keeps running on z/OS after timeout. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

---

### `submitJobFromUss`

> Destructive

Submit a job from a USS file path. The file must contain valid JCL including a job card. Set wait: true to wait for the job to reach OUTPUT and return status.

#### Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | USS path to the JCL file (e.g. /u/myuser/job.jcl). |
| `system` | `string` | No | Optional z/OS system (hostname). If omitted, the active system from setSystem is used. |
| `wait` | `boolean` | No | When true, wait for the job to reach OUTPUT (or timeout) and return status, timedOut, and optionally failedStepJobFiles. |
| `timeoutSeconds` | `integer` | No | When wait is true, how long to wait for OUTPUT (seconds). Default 300. The job keeps running on z/OS after timeout. |

#### Output Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `_context` | `object` | Yes | Resolution context: system and optional normalized names/paths. |
| `_result` | `object` | Yes | Result metadata (pagination or success). |
| `messages` | `string`[] | Yes | Operational messages: pagination hints, job card notice, or other notes. |
| `data` | `object` | Yes |  |

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

| Argument | Required | Description |
| --- | --- | --- |
| `dsn` | Yes | Fully qualified dataset name (e.g. USER.SRC.COBOL). |
| `member` | No | JCL member name (for PDS/PDSE datasets). |
| `system` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist. Defaults to active system. |

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

Get attributes and sample content of a dataset, then explain its purpose, structure, and how it fits into the system.

#### Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `dsn` | Yes | Fully qualified dataset name (e.g. USER.SRC.COBOL). |
| `system` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist. Defaults to active system. |

#### Prompt Text

**user:**

Please explain the z/OS dataset USER.SRC.COBOL on mainframe-dev.example.com.

Dataset attributes:
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
1. What is the purpose of this dataset based on its name and content?
2. What type of data does it contain (COBOL source, JCL, copybooks, data, etc.)?
3. How does it relate to other datasets in the same HLQ?
4. What are the key attributes (record format, record length) and why?
5. Any observations about the content structure or conventions used?

---

### `compareMembers`

Read two PDS/PDSE members and compare them, explaining the differences and their significance.

#### Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `dsn` | Yes | Fully qualified dataset name (e.g. USER.SRC.COBOL). |
| `member1` | Yes | First member name to compare. |
| `member2` | Yes | Second member name to compare. |
| `system` | No | Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist. Defaults to active system. |

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

### `Dataset Content`

**URI Template:** `zos-ds://{system}/{dsn}`

**MIME Type:** text/plain

Content of a sequential z/OS dataset. Provide the system hostname and fully-qualified dataset name.

---

### `Member Content`

**URI Template:** `zos-ds://{system}/{dsn}({member})`

**MIME Type:** text/plain

Content of a PDS/PDSE member on z/OS. Provide the system hostname, dataset name, and member name.

---
