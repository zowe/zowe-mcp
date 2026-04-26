# Research: Efficient Pagination and Caching with zowex (Zowe Remote SSH SDK)

This document analyzes how the Zowe MCP server reads, caches, and paginates z/OS resources, what the zowex SDK currently supports, and what SDK enhancements would enable more efficient operations.

## Current state: operations that use cache

The MCP server uses `ResponseCache` (in-memory LRU, default 10 min TTL, 1 GB max) to avoid redundant backend calls when the AI agent paginates through results.

| Operation | Reads full content? | Caches full content? | Then windows/paginates? |
| --- | --- | --- | --- |
| `readDataset` | Yes — full data set/member | Yes | Line windowing (`startLine`/`lineCount`) on cached text |
| `readUssFile` | Yes — full file | Yes | Line windowing on cached text |
| `readJobFile` | Yes — full spool file | **No** | Line windowing but re-reads from backend every call |
| `runSafeTsoCommand` | Yes — full output | Yes (conditional) | Re-executes on initial call, caches for pagination |
| `runSafeUssCommand` | Yes — full output | **No** | Line windowing but re-executes every call |
| `searchInDataset` | Yes — full search result | Yes | Member-level pagination (`offset`/`limit`) on cached result |
| `listDatasets` | Yes — full list | Yes | Offset/limit slicing on cached list |
| `listMembers` | Yes — full list | Yes | Offset/limit slicing on cached list |
| `getJobOutput` | Yes — full spool per file | **No** | Paginates by file, reads full spool per file on every call |
| `searchJobOutput` | Yes — all spool files | **No** | Reads every spool file, greps in-memory, paginates matches — re-reads every call |

**Pattern**: Most read operations fetch the **entire** content from the backend, cache it in memory, then apply windowing/pagination in the tool layer. However, job operations (`readJobFile`, `getJobOutput`, `searchJobOutput`) and `runSafeUssCommand` do **not** use the cache at all — every paginated call re-reads from the backend.

### How it works in code

For `readDataset` ([dataset-tools.ts](../packages/zowe-mcp-server/src/tools/datasets/dataset-tools.ts) lines 864-888):

```typescript
const result = await withCache(responseCache, cacheKey,
  () => backend.readDataset(systemId, dsn, member, encoding, progressCb),
  scopes
);
const sanitized = sanitizeTextForDisplay(result.text);
const windowed = windowContent(sanitized, startLine, lineCount);
```

`withCache()` calls the backend lambda on cache miss, stores the full result, and returns it. `windowContent()` then slices the text to the requested line range. On subsequent page requests with different `startLine`, the cache returns the same full text without hitting z/OS.

### Write operations

The MCP server's `writeDataset` "block of records" feature (`startLine`/`endLine` parameters) is implemented as **read-modify-write** at the MCP tool layer: it reads the full data set content, splices in the new lines at the requested range, and writes the full modified content back via the SDK. The same applies to any future partial-write patterns for USS files — the SDK has no mechanism for updating a portion of a file.

---

## What the zowex SDK supports today

Examined at `packages/sdk/src/doc/rpc/` in the [zowex repository](https://github.com/zowe/zowe-native-proto).

### Data set read (`readDataset`)

- **No partial-read parameters.** `ReadDatasetRequest` accepts `dsname`, `encoding`, `localEncoding`, optional `volume`, and optional `stream` — but no `startLine`, `lineCount`, byte offset, or range parameters.
- Returns `data: B64String` (full content) + `etag`.
- Streaming support (`stream?: () => Writable`) allows progressive delivery but still transfers the full content.

### USS file read (`readFile`)

- **No partial-read parameters.** Same pattern: `fspath`, `encoding`, `localEncoding`, optional `stream`.
- Returns full `data: B64String` + `etag`.

### Job spool read (`readSpool`)

- **No partial-read parameters.** Accepts `jobId`, `spoolId`, `encoding`, `localEncoding`.
- Returns full `data: B64String`.

### Data set write (`writeDataset`)

- **No partial-write parameters.** Accepts full `data` (or `stream`) + optional `etag` for optimistic locking.
- There is no way to update a range of records without replacing the entire content.

### USS file write (`writeFile`)

- **No partial-write parameters.** Same as data set write: full `data` (or `stream`) + optional `etag`.
- There is no way to update a portion of a file without replacing the entire content.

### List operations

- `ListDatasetsRequest` has `maxItems?: number` and `start?: string` (skip data sets before this name) — **cursor-based pagination** exists.
- `ListDsMembersRequest` has `maxItems?: number` and `start?: string` — same cursor-based pagination.
- `ListJobsRequest` has `maxItems?: number` — item count limit only.
- `ListFilesRequest` (USS) has `maxItems?: number`.

### Search (`toolSearch`)

- Returns full search results as a single `data: string`. No pagination.

### TSO/USS command execution

- Returns full output as a single `data: string`. No pagination.

---

## Summary: SDK gaps

| Resource type | SDK supports partial read? | SDK supports partial write? |
| --- | --- | --- |
| Data sets/members | **No** — full content only | **No** — full content only |
| USS files | **No** — full content only | **No** — full content only |
| Job spool files | **No** — full content only | N/A |
| TSO/USS commands | **No** — full output only | N/A |
| Data set lists | **Partial** — `maxItems` + `start` cursor | N/A |
| Member lists | **Partial** — `maxItems` + `start` cursor | N/A |

---

## Relevant capabilities in the broader Zowe ecosystem

### Zowe CLI `--range` (z/OSMF path)

The Zowe CLI (via z/OSMF REST API) **already supports record-range reads**:

- **`zowe zos-files view data-set "DSN" --range SSS-EEE`** or **`--range SSS,NNN`** — reads a range of records from a data set. This uses the z/OSMF `X-IBM-Record-Range` HTTP header under the hood.
- **`zowe jobs download output "JOBID" --recordRange "0-100"`** — reads a range of records from job spool ([PR #2411](https://github.com/zowe/zowe-cli/pull/2411), merged Jan 2025).

This demonstrates that **record-range reads are a well-understood z/OS pattern** supported by IBM's z/OSMF REST API. The zowex z/OS server component could implement equivalent functionality using native z/OS I/O APIs (QSAM record skipping, JES2 SAPI) — potentially more efficiently than z/OSMF since it operates natively on z/OS.

### zowex GitHub issues

Review of [zowe/zowex](https://github.com/zowe/zowex) issues reveals the following related plans:

| Issue | Title | Status | Relevance |
| --- | --- | --- | --- |
| [#320](https://github.com/zowe/zowex/issues/320) | **Epic: Streaming support for large files** | Open | The foundational epic — addresses the ~100KB RPC limit with chunked streaming. Streaming enables large file transfer but does **not** by itself enable partial/windowed reads (it still transfers the full content in chunks). |
| [#321](https://github.com/zowe/zowex/issues/321) | Support streaming for read/write ds requests | Closed | Streaming for data set read/write was implemented. |
| [#322](https://github.com/zowe/zowex/issues/322) | Adopt streaming in clients for read/write requests | Closed | Client-side streaming adoption completed. |
| [#324](https://github.com/zowe/zowex/issues/324) | **Support streaming for reading job spool** | Open | Job spool streaming is **not yet implemented** — reading large spool files remains a gap. |
| [#433](https://github.com/zowe/zowex/issues/433) | **Support server-sided pagination for listing data sets** | Open | Explicitly requests range-based listing for data sets and PDS members (Zowe Explorer use case). |
| [#443](https://github.com/zowe/zowex/issues/443) | Switch from streaming to buffered mode below threshold | Open | Optimization: skip streaming overhead for small files (<32KB). |

**Key insight**: Streaming (#320, #321, #322) addresses **large file transfer** (chunked delivery of full content) but is **not the same as windowed/partial reads**. Streaming allows transferring a 10MB file without hitting the RPC buffer limit; windowed reads would allow requesting only lines 500-600 of that file. The zowex project has implemented data set/USS streaming but has **no open issues for record-range or line-range read support**.

### Native C++ server analysis

Examination of the z/OS server component source code (`native/c/`) confirms:

- **`ReadDatasetRequest`** accepts only `dsname`, `encoding`, `localEncoding`, `volume`, `stream` — no range/offset parameters.
- **`ReadFileRequest`** (USS) accepts only `fspath`, `encoding`, `localEncoding`, `stream` — no range parameters.
- **`ReadSpoolRequest`** accepts only `jobId`, `spoolId`, `encoding`, `localEncoding` — no range parameters.
- The `handle_data_set_view` function in `commands/ds.cpp` calls `zds_read(read_opts, response)` which reads the full content into a string, or `zds_read_streamed()` which streams full content to a pipe.
- The zowex CLI `view data-set` command does **not** have a `--range` option (unlike the Zowe CLI z/OSMF path).

**Conclusion: zowex currently cannot read a part of a file or data set.** No existing parameter, issue, or PR addresses record-range reads. Streaming only addresses chunked transfer of full content. This is a **new feature request** that would need to be filed.

---

## What the zowex SDK needs for efficient pagination and partial updates

### Windowed reads

To avoid reading and caching entire contents upfront, the SDK (and its z/OS server component) would need new request parameters:

**For data set / USS file / spool reads:**

- `startLine?: number` — 1-based starting line (or `startRecord` for data sets)
- `lineCount?: number` — max lines to return (or `maxRecords`)
- Response should include: `totalLines` (or `totalRecords`), `returnedLines`, `hasMore`, and `etag` for the full content

**Implementation on z/OS:**

- **Data sets**: Read records from QSAM/BPAM starting at a record offset, reading only N records. For PDS members, the directory entry provides the TTR starting address.
- **USS files**: `lseek()` to a byte offset (line-counting requires a first pass, or tracking line offsets on the server side).
- **Spool files**: JES2 SAPI or `SFDATA` macro with record-level navigation.

### Partial writes (block of records)

To update a portion of a data set or USS file without replacing the entire content:

**For data set writes:**

- `startLine?: number` — 1-based starting line of the block to replace
- `endLine?: number` — 1-based ending line of the block to replace (inclusive)
- `data: B64String` — replacement content (may be more or fewer lines than the replaced range)
- `etag?: string` — optimistic locking on the full content
- Response should include: the new `etag` after the partial write

**For USS file writes:**

- Same parameters: `startLine`, `endLine`, `data`, `etag`
- Alternatively, byte-offset-based: `startByte`, `endByte`, `data` — more natural for USS but requires clients to track byte positions

**Implementation on z/OS:**

- **Data sets (fixed-length records)**: Read up to `startLine`, write the replacement, then write the remainder. For RECFM=FB, record boundaries are predictable. For RECFM=VB, records must be parsed sequentially.
- **Data sets (PDS/E members)**: The STOW macro with replace can update a member. The operation is: read the existing member, splice the new block, write the full member back. PDS/E members cannot be partially updated at the BPAM level — the entire member is replaced. However, the z/OS server can do this read-splice-write internally so the client only sends the changed block.
- **USS files**: Use `lseek()` + `write()` for byte-level updates. For line-based updates, the server would need to translate line offsets to byte offsets, perform the splice, and handle file size changes (growing or shrinking).

### Search pagination

- Add `offset?: number`, `limit?: number` to `toolSearch` — paginate matches server-side so the full SuperC output is not returned in one response.

### Metadata without full read

- Add `totalLines` (or `totalRecords`) to read responses. Even without partial reads, if the SDK could return a line count cheaply (e.g., from a pre-scan, record count, or data set attributes for RECFM=FB where `totalLines = fileSize / LRECL`), the MCP server could show accurate "page X of Y" metadata without reading the full content.

## Streaming vs windowed reads vs incremental client cache

**Streaming (what zowex already moves toward)** is primarily about **transport**: avoid putting an entire large object in one JSON-RPC body, reduce peak memory, and improve **time-to-first-byte**. It does **not** by itself mean “read only page 2” or “resume after page 1 on the next MCP tool call.”

### First page only (stop consuming early)

In principle the MCP server could attach a writable stream, read decoded chunks until it has enough lines for the first window, then **stop reading** from the stream.

- On z/OS, streamed data set reads walk the file from the beginning (`fread` in a loop in `zds_read_streamed`); writing to the FIFO can **block** when the pipe buffer is full. That can **pause further reads** from the data set, so not all bytes need leave z/OS immediately.
- Caveats: RPC timeouts, client/server cleanup on half-closed streams, and the need for explicit **abort** semantics if the consumer drops the stream (otherwise a worker may stay blocked or the z/OS side may need to finish or tear down cleanly). Today’s MCP model is **one `tools/call` per page** with no built-in “same logical read, resume later” handle.

So “first page only” can reduce **bytes transferred to the MCP process** in one session, but it is **not** a substitute for **windowed RPC parameters** unless productized (cursor token, second call `continueRead`, etc.).

### “Wait with streaming until the next page is requested”

Across **separate** MCP tool invocations (`readDataset` with `startLine=1`, then later `startLine=1001`), there is **no standard persisted stream** unless the stack invents one:

- **Option A — stateless (today):** each call starts a **new** read from the beginning of the member/file (unless zowex adds `startRecord` / byte offset). Page 2 without a cache implies **re-reading from the start** and skipping/discarding in the client — wasteful on z/OS and the network.
- **Option B — stateful session:** zowex (or MCP) holds an open read context (file offset, spool cursor) keyed by a token; the next call passes the token. That is **new protocol and lifecycle** (TTL, eviction on write, multi-tenant HTTP isolation), not “just use streaming.”

### Incremental cache while streaming (sequential pagination)

For the common case **page 1, then page 2, then page 3** (strictly forward), streaming **does** combine well with caching:

- The server reads the stream once, parses line boundaries as chunks arrive, **appends to an in-memory (or spill-to-disk) cache** until it has served the requested window.
- The next tool call for the following window may be satisfied **entirely from cache** with no second z/OS read, same as today’s full-read-then-cache — but **peak memory** can grow more gradually and **first page latency** can improve versus waiting for a full non-streamed buffer.

For **random access** (jump to page 50 only), streaming without server-side offset still forces either **full materialization in cache first** or **re-stream from the beginning** and skip — same fundamental limit as buffer-and-slice, unless zowex adds true windowed reads.

### Summary

| Approach | Random page (e.g. page 50 only) | Sequential pages | Cross-call “resume stream” |
| --- | --- | --- | --- |
| Full read + MCP cache (today) | Poor first hit; good repeats | Good after first full read | N/A (each call self-contained) |
| Streaming only | No inherent win without offset | Good with incremental cache | Not supported without new API |
| Server window / record range | **Best** | **Best** | Natural fit for stateless RPC |

**Recommendation:** Treat streaming as **complementary** to (not a replacement for) **windowed read RPCs** and optional **metadata** (`totalLines`). Use streaming + incremental cache as an interim optimization for large sequential reads; pursue **startRecord/startLine** in zowex for correct random access and minimal z/OS I/O.

---

## Current tradeoffs

**Why full-read-then-cache works reasonably well today:**

- Most data set members and USS files the LLM reads are small (< 1000 lines)
- The LRU cache prevents re-reading on subsequent page requests
- The cache is invalidated on writes (via `applyCacheAfterMutation`)
- For the common MCP use case (AI browsing code), the AI typically reads most/all of a member anyway

**Where it hurts:**

- Large sequential data sets (thousands of records)
- Large spool files (e.g., SYSOUT from batch jobs with millions of lines)
- Large USS files (logs, dumps)
- Memory pressure when many large files are cached simultaneously
- Initial latency — the first `readDataset` call must transfer everything before returning even the first page
- Partial writes require a full round-trip: read everything, splice locally, write everything back

**List operations — already better:**

The zowex SDK **does** support `maxItems` + `start` (cursor) for `listDatasets` and `listDsMembers`. However, the MCP server currently does **not** leverage this — it fetches the full list and caches it. This is a near-term optimization opportunity.

---

## Recommendations

### Immediate (MCP server only, no SDK changes)

1. **Add caching to job operations.** `readJobFile`, `getJobOutput`, and `searchJobOutput` currently re-read from the backend on every call. Adding `withCache()` (same pattern as `readDataset`) would eliminate redundant z/OS reads when the AI paginates through spool output. Same for `runSafeUssCommand`.

2. **Leverage `maxItems`/`start` cursor for list operations.** The zowex SDK already supports `maxItems` and `start` (name-based cursor) for `listDatasets` and `listDsMembers`. The MCP server currently ignores these and fetches the full list. For large catalogs, passing `maxItems` to the SDK would reduce initial transfer. The tradeoff: the cache-then-slice model is simpler and gives accurate `totalAvailable` counts; cursor-based requires fetching all pages to know the total.

### Medium-term (requires zowex SDK + z/OS server changes)

1. **Add `startRecord`/`maxRecords` to `readDataset`, `readFile`, `readSpool`.** This is the key enabler for efficient pagination. See the "Windowed reads" section above for implementation details per resource type.

2. **Add partial-write support to `writeDataset` and `writeFile`.** Accept `startLine`/`endLine` + replacement content so the client only sends the changed block. The z/OS server component performs the read-splice-write internally and returns the new etag. See the "Partial writes" section above.

3. **Add pagination to `toolSearch` (SuperC).** The current `tool.search` returns the entire SuperC output as one string. For large PDS libraries, this can be megabytes. Server-side pagination by member or by match count would help.

4. **Add `totalLines` metadata to read responses.** See the "Metadata without full read" section above.

### Architecture considerations

1. **Keep the cache even with server-side windowing.** AI chat patterns involve re-reading the same pages (the AI reads lines 1-100, reasons about them, then re-reads to verify). The cache should remain for repeated identical requests. With server-side windowing, the cache key would include the line range, and the cache would store individual pages rather than full content.

2. **Hybrid approach for the transition period.** While the SDK is being enhanced, the MCP server can continue with full-read-then-cache for small files and add a size threshold: if the backend reports a file is larger than X bytes (knowable from data set attributes for MVS, or `stat` for USS), switch to a streaming or partial-read strategy when available.
