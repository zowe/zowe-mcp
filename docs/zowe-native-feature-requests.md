# Zowe Native Proto — Feature Requests and Defects

List of new functions or behaviors requested from Zowe Native Proto for use by Zowe MCP server, and defects observed that we request be fixed. Each item has a short ID (e.g. `ZNP-001-UNIX-CMD`) for reference.

**Priority**: **P0** = Critical (defects that block or severely harm usage) · **P1** = High (missing features that break or limit important flows) · **P2** = Medium (improvements, efficiency) · **P3** = Lower (enhancements)

---

## `ZNP-009-LIST-ABEND` — Defect: ZNP server abend (CEE3204S / 0C4) during listDatasets

- **Priority**: P0
- **Summary**: The ZNP server on z/OS abends with a protection exception (System Completion Code 0C4) while handling requests (observed during `listDatasets`). The client then receives abend/dump output instead of JSON, logs "Invalid JSON response", and the request can hang until timeout.
- **Request**: Fix the server-side crash so `listDatasets` (and any other operations that hit the same code path) complete successfully or return a proper error instead of abending.
- **ZNP version**: No version reported in the ZNP log messages. Client SDK in use: zowe-native-proto-sdk 0.2.4 (from Zowe Artifactory npm-release).
- **z/OS system**: Host: zos.example.com (example; use your system hostname when reporting).
- **Observed context**: Occurred when listing data sets (e.g. patterns like `USER.**`, `SAMPLE.**`) over SSH to a z/OS system; the server had successfully connected and was running the first list operation when the abend occurred.
- **Log details** (from MCP server stderr when the client receives the invalid response):

```text
Error: Invalid JSON response: CEE3204S The system detected a protection exception (System Completion Code=0C4).
Error: Invalid JSON response:          From compile unit TOROLABA:../ship/include/__string/ at entry point std::__1::_EBCDIC::basic_string<char, std::__1::_EBCDIC::char_traits<char>, std::__1::_EBCDIC::alloc... at statement 210 at compile unit offset +000000003CEF90A2 at entry offset
Error: Invalid JSON response:          +000000000000016A at address 000000003CEF90A2.
```

- **Note**: The stack points to EBCDIC string handling (`std::__1::_EBCDIC::basic_string`, compile unit TOROLABA). This suggests a defect in the server's handling of string/data in that path (e.g. encoding, buffer, or lifecycle). Related client-side ask: see `ZNP-010-CLIENT-FAIL-FAST` so that when the server does abend, the client fails the request immediately instead of hanging.

---

## `ZNP-010-CLIENT-FAIL-FAST` — Client: fail request immediately on invalid JSON response

- **Priority**: P0
- **Request**: When the SDK receives a response from the z/OS ZNP server that is not valid JSON (e.g. abend dump, protection exception 0C4, or other garbage), reject the in-flight request Promise immediately instead of only logging to stderr (e.g. "Invalid JSON response: ...") and leaving the Promise pending until the response timeout.
- **Why**: If the ZNP server on z/OS abends, the client currently may log the error but not reject the request. The MCP server then holds the connection lock until the full timeout (e.g. 300s), blocking other requests and delaying feedback to the user. Callers expect the operation to fail as soon as the backend failure is detected so they can evict the client and surface an error without waiting for the timeout.

---

## `ZNP-004-RENAME-MEMBER` — Data set: rename PDS/PDSE member (renameMember)

- **Priority**: P1
- **Request**: Implement the `renameMember` command on the ZNP z/OS server so that PDS/PDSE members can be renamed in place.
- **Input**: `{ dsname: string, memberBefore: string, memberAfter: string }` (data set name, current member name, new member name).
- **Output**: Success or error (e.g. member not found, new name already exists).
- **Why**: The Zowe MCP server exposes a `renameDataset` tool that supports renaming a member within the same data set (dsn and newDsn equal, member and newMember specified). When the client calls this, the native backend invokes `ds.renameMember(...)`. The ZNP server on z/OS responds with **"Unrecognized command renameMember"**, so the operation is not available. Zowe zos-files (z/OSMF) provides `rename data-set-member`; the Native Proto server should offer equivalent capability for SSH-based workflows. The MCP server's native-stdio E2E test 7.2 (renameDataset member) is skipped until ZNP supports this.
- **Observed**: SDK in use (zowe-native-proto-sdk 0.2.4); server returns "Unrecognized command renameMember" when the client sends the renameMember request.

---

## `ZNP-001-UNIX-CMD` — USS: Unix command execution (unixCommand)

- **Priority**: P1
- **Request**: Implement the `unixCommand` (or equivalent) RPC on the ZNP z/OS server so that the client can run arbitrary Unix commands (e.g. `echo $HOME`, `whoami`, `pwd`, `ls`) and receive the command output.
- **Where**: ZNP server command handling, e.g. [zowe-native-proto/native/zowed/commands.cpp](https://github.com/zowe/zowe-native-proto/blob/main/native/zowed/commands.cpp) (or equivalent); the SDK exposes `client.cmds.issueUnix({ commandText })` but the server must handle the request.
- **Input**: `{ commandText: string }` (the command line to execute).
- **Output**: Success + command stdout (e.g. `{ data: string }`).
- **Why**: Without this, the Zowe MCP server cannot determine the user's USS home directory (getUssHome uses `echo $HOME`) or run safe allowlisted commands (runSafeUssCommand). The server currently responds with **"Unrecognized command unixCommand"**, getUssHome is **not** disabled: when `echo $HOME` is unavailable, the server probes typical home bases (`/u`, `/a`, `/z`, `/u/users`, `/u/users/group/product`) via `listUssFiles` for a directory matching the user ID (case-insensitive) and defaults to `/u/<lowercase-userId>` with a warning if none is found. runSafeUssCommand remains enabled but will fail until ZNP adds support. All other USS tools (listUssFiles, readUssFile, writeUssFile, createUssFile, deleteUssFile, chmod, chown, chtag, and temp tools) remain enabled and use `client.uss.*` only.

---

## `ZNP-002-GET-DS-ATTR` — Data set: get attributes for one data set

- **Priority**: P2
- **Request**: New RPC (e.g. `getDatasetAttributes` or `getAttributes`).
- **Input**: `{ command: "getDatasetAttributes", dsname: string }`.
- **Output**: Success + single object with data set attributes (e.g. same shape as `common.Dataset`: dsn, dsorg, recfm, lrecl, blksz, volser, creationDate, referenceDate, optional SMS/usage fields).
- **Why**: Callers need attributes for a single DSN without listing; today there is no dedicated API.

---

## `ZNP-011-CREATE-DS-LIKE` — Dataset: create dataset “allocate like” (copy attributes from existing)

- **Priority**: P2
- **Request**: New RPC (e.g. `createDatasetLike` or `createDataset` with an optional `likeDsn` parameter) that allocates a new data set with the same attributes as an existing one (mainframe “allocate like” idiom).
- **Input**: `{ dsname: string, likeDsn: string }` — the new data set name and the existing data set whose attributes (dsorg, recfm, lrecl, blksz, space, dirblk for PDS, etc.) are to be copied. Optional overrides (e.g. primary/secondary space) could be supported later.
- **Output**: Success (and optionally the attributes applied, e.g. same shape as createDataset response).
- **Why**: The MCP server can then call a single ZNP API instead of getAttributes(likeDsn) + createDataset(dsn, options). Matches common mainframe workflows. Today the server would need two round-trips and attribute mapping in the tool layer; a native “allocate like” is one round-trip and keeps allocation semantics on the server (e.g. SMS, space rounding) where z/OS handles them correctly.

---

## `ZNP-003-EXTENDED-ATTR` — Dataset and member: extended attributes (SMS, ISPF, load modules)

- **Priority**: P3
- **Request**: Expose additional attributes so tools and AI agents can reason about storage, editing, and executable metadata:
  - **Datasets**: SMS-related fields (e.g. storage class, management class, data class, volume serials, space/usage if available from catalog or DFHSM).
  - **Members**: ISPF statistics (e.g. size, modified date, created date, version, line count, TTR) and, for load libraries, load module attributes (e.g. AMODE, RMODE, size, entry point, aliases).
- **Where**: In `getDatasetAttributes` (and list with `attributes: true`) for data set-level SMS attributes; in `listDsMembers` (and any future get-member-attributes) for member-level ISPF and load-module attributes.
- **Why**: AI agents need to distinguish load modules from source, understand member history, or advise on SMS/space; today only basic data set attributes (dsorg, recfm, lrecl, etc.) are exposed.

---

## `ZNP-005-LIST-MEMBERS-PATTERN` — Dataset: listDsMembers member-name pattern

- **Priority**: P2
- **Request**: Add optional member-name pattern (or filter) parameter to `listDsMembers` so the server can filter by member name (e.g. `A*`, `%`).
- **Why**: Enables server-side filtering instead of client-side only; consistent with pattern semantics for data sets.

---

## `ZNP-006-PARTIAL-RW` — Dataset: partial read/write with change detection

- **Priority**: P2
- **Request**: Support reading or writing a range of records/lines (e.g. by record number or line offset) so the client does not need to transfer the entire data set. In addition, provide a way to detect that the data set (or member) has changed between reads.
- **Why**: The MCP server currently caches the full data set for pagination and applies line windowing in the tool layer. For large data sets this is inefficient and can serve stale data. We need either:
  - **Server-side range read**: Native API that accepts something like `startRecord`, `recordCount` (or line-based) and returns only that slice, so we avoid caching the whole data set; and/or
  - **Stable change token**: A version/ETag or last-modified indicator returned with list/read that we can send on a subsequent read so the backend can tell us “content changed” and we can invalidate cache or warn the user.
- **Open question**: How does the Native Proto backend today (or in future) represent “same content” vs “changed” (e.g. generation, timestamp, ETag) so we can safely paginate without re-reading the full data set each time?

---

## `ZNP-007-LIST-HLQ` — Dataset: list high-level qualifiers (HLQs)

- **Priority**: P2
- **Request**: New RPC (e.g. `listHighLevelQualifiers` or `listHLQs`) that returns the set of high-level qualifiers (first qualifier of data set names) visible to the user, without listing all data sets.
- **Input**: Optional scope (e.g. system, volume, or catalog).
- **Output**: List of HLQ strings (e.g. `["SYS1", "USER", "ISP"]`).
- **Why**: AI agents and UIs often need to discover “what prefixes exist” before building patterns or drilling down. Listing all data sets under `*` is expensive and unnecessary when only HLQs are needed.

---

## `ZNP-008-SEARCH` — Search: data set names, member names, and content

- **Priority**: P3
- **Request**: Search capabilities in the Native Proto layer:
  - **By name**: Search data set names and/or member names by pattern (e.g. wildcard, SUPERCE-style, or regex if supported on the platform).
  - **By content**: Search inside data set or member content (e.g. SUPERC/SUPERCE or grep-like) with pattern (string or regex), optionally scoped to a DSN pattern, member pattern, or list of members.
- **Input**: Pattern type (name vs content), pattern (string/regex), scope (HLQ, DSN pattern, member pattern), optional content search options (case-sensitive, whole record, etc.).
- **Output**: List of matches with location (data set, member if applicable, record/line number, matched text or snippet).
- **Why**: Enables “find where this symbol is used” or “which members reference this copybook” without the client reading every data set and member; essential for large systems and better UX in MCP tools.
