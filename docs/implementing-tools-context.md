# Context for Implementing Not-Yet-Implemented Tools (Zowe MCP)

Use this in chats when implementing new dataset operations or other z/OS tools.

---

## What Exists Today

### Dataset tools (all implemented at tool layer)

| Tool | Backend method | Mock backend | Native (SSH) backend |
| ---- | -------------- | ------------ | -------------------- |
| `listDatasets` | `listDatasets()` | ✅ | ✅ |
| `listMembers` | `listMembers()` | ✅ | ❌ throws |
| `getDatasetAttributes` | `getAttributes()` | ✅ | ❌ throws |
| `readDataset` | `readDataset()` | ✅ | ❌ throws |
| `writeDataset` | `writeDataset()` | ✅ | ❌ throws |
| `createDataset` | `createDataset()` | ✅ | ❌ throws |
| `deleteDataset` | `deleteDataset()` | ✅ | ❌ throws |
| `copyDataset` | `copyDataset()` | ✅ | ❌ throws |
| `renameDataset` | `renameDataset()` | ✅ | ❌ throws |

- **Mock backend**: `FilesystemMockBackend` in `src/zos/mock/` — implements full `ZosBackend`.
- **Native backend**: `NativeBackend` in `src/zos/native/native-backend.ts` — only `listDatasets()` is implemented; all other methods throw `"Not implemented for Zowe Native backend"`.

### Other components

- **Core**: `info` tool (`src/tools/core/zowe-info.ts`).
- **Context**: `getContext`, `setSystem`, `setDsnPrefix`, `listSystems` (`src/tools/context/context-tools.ts`).
- **Future**: `jobs`, `uss` (mentioned in AGENTS.md; not implemented).

---

## Backend interface (`src/zos/backend.ts`)

`ZosBackend` defines these methods. Any new dataset operation must:

1. Add a method to the interface (if not already there).
2. Implement it in `FilesystemMockBackend` and in `NativeBackend` (or throw with a clear message).

Signatures (see `backend.ts` for full JSDoc):

- `listDatasets(systemId, pattern, volser?, userId?)` → `Promise<DatasetEntry[]>`
- `listMembers(systemId, dsn, pattern?)` → `Promise<MemberEntry[]>`
- `readDataset(systemId, dsn, member?, codepage?)` → `Promise<ReadDatasetResult>`
- `writeDataset(systemId, dsn, content, member?, etag?, codepage?)` → `Promise<WriteDatasetResult>`
- `createDataset(systemId, dsn, options)` → `Promise<CreateDatasetResult>`
- `deleteDataset(systemId, dsn, member?)` → `Promise<void>`
- `getAttributes(systemId, dsn)` → `Promise<DatasetAttributes>`
- `copyDataset(systemId, sourceDsn, targetDsn, sourceMember?, targetMember?)` → `Promise<void>`
- `renameDataset(systemId, dsn, newDsn, member?, newMember?)` → `Promise<void>`

Types: `DatasetEntry`, `MemberEntry`, `ReadDatasetResult`, `WriteDatasetResult`, `CreateDatasetOptions`, `CreateDatasetResult`, `DatasetAttributes` are all in `backend.ts`.

---

## Implementing a new dataset tool (or a new backend method)

### 1. Backend

- **Mock**: Implement (or extend) the method in `packages/zowe-mcp-server/src/zos/mock/filesystem-mock-backend.ts`.
- **Native**: Implement (or stub with a clear throw) in `packages/zowe-mcp-server/src/zos/native/native-backend.ts`. Native uses Zowe Native Proto SDK; see `listDatasets` there for pattern (get spec, credentials, client from cache, call SDK, map result to `DatasetEntry` etc.).

### 2. Tool layer

- **Dataset tools**: Add or adjust in `packages/zowe-mcp-server/src/tools/datasets/dataset-tools.ts`.
  - Use `DatasetToolDeps`: `{ backend, systemRegistry, sessionState, credentialProvider }`.
  - Resolve system + DSN with `resolveInput(deps, dsn, member, system, log)` (which calls `ensureContext` and `resolveDsn`).
  - DSN convention: unquoted = relative to DSN prefix; single-quoted = absolute. Use `resolveDsn(dsn, prefix, member)` from `src/zos/dsn.ts` for validation and resolution.
  - Return responses via the **response envelope** from `src/tools/response.ts`:
    - `buildContext(systemId, prefix, { resolvedDsn: formatResolved(dsn) })` (or `resolvedPattern` for list, `resolvedTargetDsn` for copy/rename).
    - List: `paginateList(items, offset, limit)` → `ListResultMeta`; Read: `windowContent(text, startLine, lineCount)` → `ReadResultMeta`; Mutations: `MutationResultMeta` with `{ success: true }`.
    - `wrapResponse(ctx, meta, data)` to build the final JSON envelope.
  - Tool names: **camelCase** (e.g. `listDatasets`). Annotations: `readOnlyHint: true` for read-only, `destructiveHint: true` for delete.
  - Describe single-quote convention in tool description and param descriptions.

### 3. DSN utilities (`src/zos/dsn.ts`)

- `resolveDsn(dsn, prefix, member?)` → `ResolvedDsn` (validates 44-char limit, 8-char qualifiers; use for CRUD).
- `resolveWithPrefix(dsn, prefix)` → `ResolvedWithPrefix` (for patterns, no full validation).
- `validateDsn(dsn)`, `validateMember(member)`, `buildDsUri(system, dsn, member?)`, `inferMimeType(text)`.

### 4. Session and context

- **SessionState** (`src/zos/session.ts`): active system, per-system `SystemContext` (userId, dsnPrefix). `requireSystem(system?)`, `getDsnPrefix(systemId)`, `getContext(systemId)`.
- **ensureContext(deps, systemId)**: call before using backend so that if the LLM passes `system` without calling `setSystem`, context is lazily initialized from `credentialProvider`.

### 5. Tests and docs

- Add or extend tests in `packages/zowe-mcp-server/__tests__/` (e.g. `dataset-tools.test.ts`, or common tests in `common.test.ts`). Use transport providers so tests run on in-memory, stdio, and HTTP.
- Update `AGENTS.md` if you add a new component or change patterns.

---

## Implementing a new component (e.g. jobs, USS)

1. Create `src/tools/<component>/` and export `register<Component>Tools(server, deps, logger)`.
2. In `server.ts`, call the registrar; for z/OS backends, only register when `options?.backend` is set.
3. Update the `components` array in the `info` tool response.
4. If the component needs a backend, define a small interface (e.g. `ZosJobsBackend`) and implement it for mock and, when relevant, native.

---

## Zowe Native SDK

The **Zowe Native Proto SDK** is used by the native (SSH) backend. We use only the SDK; it is **not published to npm**. The package is consumed as a file dependency (tgz in this repo).

### Paths

| What | Path |
| ---- | ---- |
| **SDK source (reference)** | `zowe-native-proto` repo: `/Users/plape03/workspace/github.com/zowe/zowe-native-proto`. SDK code lives in **`packages/sdk`** (e.g. `src/ZSshClient.ts`, `src/doc/rpc/ds.ts` for dataset RPCs). |
| **Tgz (this repo)** | `bin/zowe-native-proto-sdk-0.2.3.tgz` — built from the SDK source; copied into this repo for install. |
| **Server dependency** | `packages/zowe-mcp-server/package.json`: `"zowe-native-proto-sdk": "file:../../bin/zowe-native-proto-sdk-0.2.3.tgz"` |
| **After `npm install`** | `packages/zowe-mcp-server/node_modules/zowe-native-proto-sdk` (or `packages/zowe-mcp-vscode/server/node_modules/zowe-native-proto-sdk` in bundled extension) |
| **Our code that uses the SDK** | `packages/zowe-mcp-server/src/zos/native/` — `ssh-client-cache.ts`, `native-backend.ts` |

### Minimal example: list datasets

In the **zowe-native-proto** repo, see:

**`/Users/plape03/workspace/github.com/zowe/zowe-native-proto/example/index.ts`**

- Uses `SshSession` from `@zowe/zos-uss-for-zowe-sdk` and `ZSshClient` from `zowe-native-proto-sdk`.
- `using client = await ZSshClient.create(session);`
- `const response = await client.ds.listDatasets({ pattern });` → `response.items` (array of dataset items).

Use this as the reference for calling dataset APIs from the SDK.

### SSH client cache reference

The **zowe-native-proto** VS Code extension uses a cache that is a good reference for our native backend cache:

**`/Users/plape03/workspace/github.com/zowe/zowe-native-proto/packages/vsce/src/SshClientCache.ts`**

- Singleton cache keyed by client id (e.g. profile name + type).
- `connect(profile, restart?)` → get or create `ZSshClient`; uses mutex per client id; supports restart and server deploy/checksums.
- `end(hostOrProfile)` → dispose and remove client.
- `ZSshClient.create(session, { ...opts, onClose, onError })` for lifecycle.

Our cache in `packages/zowe-mcp-server/src/zos/native/ssh-client-cache.ts` follows a similar idea (key by `user@host:port`, getOrCreate, evict) but is adapted for MCP (no VS Code or profile, connection spec from config/env).

### Implementing more native-backend methods

1. Follow the pattern in `native-backend.ts` `listDatasets`: get spec, credentials, client via cache, call SDK API, map to `DatasetEntry` / `MemberEntry` / etc.
2. Use the **example** above for the exact SDK calls (e.g. `client.ds.listDatasets({ pattern })`).
3. SDK types and APIs are in the installed package under `node_modules/zowe-native-proto-sdk`; for source and RPC definitions see `zowe-native-proto/packages/sdk/src/`.

---

## Key file paths

| Area | Path |
| ---- | ---- |
| Backend interface | `packages/zowe-mcp-server/src/zos/backend.ts` |
| Mock backend | `packages/zowe-mcp-server/src/zos/mock/filesystem-mock-backend.ts` |
| Native backend | `packages/zowe-mcp-server/src/zos/native/native-backend.ts` |
| Native SSH client cache (uses SDK) | `packages/zowe-mcp-server/src/zos/native/ssh-client-cache.ts` |
| Dataset tools | `packages/zowe-mcp-server/src/tools/datasets/dataset-tools.ts` |
| Response envelope | `packages/zowe-mcp-server/src/tools/response.ts` |
| DSN resolution | `packages/zowe-mcp-server/src/zos/dsn.ts` |
| Session state | `packages/zowe-mcp-server/src/zos/session.ts` |
| Server wiring | `packages/zowe-mcp-server/src/server.ts` |
| Agent instructions | `AGENTS.md` (root) |

---

## Quick reference: response envelope

- **List**: `buildContext(..., { resolvedPattern: formatResolved(pattern) })`, `paginateList(list, offset, limit)`, `wrapResponse(ctx, meta, data)`.
- **Read**: `buildContext(..., { resolvedDsn })`, `windowContent(text, startLine, lineCount)`, `wrapResponse(ctx, meta, { text, etag, ... })`.
- **Mutation**: `buildContext(..., { resolvedDsn } or { resolvedDsn, resolvedTargetDsn })`, `wrapResponse(ctx, { success: true }, data)`.
- Resolved values in `_context` are always fully-qualified, absolute, single-quoted (e.g. `'USER.SRC.COBOL'`). Include `dsnPrefix` in context only when the input was relative.
