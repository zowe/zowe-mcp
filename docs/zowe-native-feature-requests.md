# Zowe Native Proto — Feature Requests

List of new functions or behaviors requested from Zowe Native Proto for use by Zowe MCP server.

---

## Dataset: get attributes for one dataset

- **Request**: New RPC (e.g. `getDatasetAttributes` or `getAttributes`).
- **Input**: `{ command: "getDatasetAttributes", dsname: string }`.
- **Output**: Success + single object with dataset attributes (e.g. same shape as `common.Dataset`: dsn, dsorg, recfm, lrecl, blksz, volser, creationDate, referenceDate, optional SMS/usage fields).
- **Why**: Callers need attributes for a single DSN without listing; today there is no dedicated API.

---

## Dataset: listDatasets return attributes

- **Request**: When `listDatasets` is called with `attributes: true`, include attribute fields in each returned item (e.g. dsorg, recfm, lrecl, blksz, volser, cdate, rdate).
- **Why**: AI agents and tools need type/format/size to reason about datasets; currently attributes are not returned.
- ✅ **Status**: Supported and used by the Zowe MCP server. The Zowe MCP server calls the SDK with `attributes: true` by default; the tool accepts an optional `attributes` parameter (default true) so callers can set `attributes: false` for names-only responses.

---

## Dataset: listDsMembers member-name pattern

- **Request**: Add optional member-name pattern (or filter) parameter to `listDsMembers` so the server can filter by member name (e.g. `A*`, `%`).
- **Why**: Enables server-side filtering instead of client-side only; consistent with pattern semantics for datasets.
