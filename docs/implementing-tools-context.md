# Context for Implementing Not-Yet-Implemented Tools (Zowe MCP)

Use this in chats when implementing new data set operations or other z/OS tools.

---

## What Exists Today

### Dataset tools (all implemented at tool layer)

| Tool                   | Backend method    | Mock backend | Native (SSH) backend                                                                             |
| ---------------------- | ----------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `listDatasets`         | `listDatasets()`  | ✅           | ✅                                                                                               |
| `listMembers`          | `listMembers()`   | ✅           | ✅                                                                                               |
| `getDatasetAttributes` | `getAttributes()` | ✅           | ✅ (via `listDatasets` with `attributes: true`, exact DSN match)                                 |
| `readDataset`          | `readDataset()`   | ✅           | ✅                                                                                               |
| `writeDataset`         | `writeDataset()`  | ✅           | ✅                                                                                               |
| `createDataset`        | `createDataset()` | ✅           | ✅                                                                                               |
| `deleteDataset`        | `deleteDataset()` | ✅           | ✅                                                                                               |
| `copyDataset`          | `copyDataset()`   | ✅           | ✅ (read + write)                                                                                |
| `renameDataset`        | `renameDataset()` | ✅           | ✅                                                                                               |
| `getTempDatasetPrefix` | (uses `listDatasets`) | ✅       | ✅                                                                                               |
| `getTempDatasetName`   | (uses `getAttributes`) | ✅      | ✅                                                                                               |
| `createTempDataset`    | `createDataset()` | ✅           | ✅                                                                                               |
| `deleteDatasetsUnderPrefix` | `listDatasets()` + `deleteDataset()` | ✅ | ✅                                                                                 |

- **Mock backend**: `FilesystemMockBackend` in `src/zos/mock/` — implements full `ZosBackend`.
- **Native backend**: `NativeBackend` in `src/zos/native/native-backend.ts` — implements all data set methods. `getAttributes()` is implemented via `listDatasets` with `attributes: true` (pattern = DSN, then exact-name match). `writeDataset` supports optional `startLine` (block-of-records replace). `copyDataset` is implemented as read + write (target must exist).

### Other components

- **Core**: `info` tool (`src/tools/core/zowe-info.ts`).
- **Context**: `getContext`, `setSystem`, `listSystems` (`src/tools/context/context-tools.ts`).
- **USS**: Implemented (`src/tools/uss/uss-tools.ts`). Tools: `getUssHome`, `listUssFiles`, `readUssFile`, `writeUssFile`, `createUssFile`, `deleteUssFile`, `chmodUssFile`, `chownUssFile`, `chtagUssFile`, `runSafeUssCommand`, `getUssTempDir`, `getUssTempPath`, `createTempUssFile`, `createTempUssDir`, `deleteUssTempUnderDir`. See **USS tools** section below.
- **TSO**: Implemented (`src/tools/tso/tso-tools.ts`). Tool: `runSafeTsoCommand`. See **TSO tools** section below.
- **Jobs**: `submitJob`, `getJobStatus` (`src/tools/jobs/jobs-tools.ts`). Job cards from config file `jobCards` section or VS Code `zoweMCP.jobCards`. Mock backend throws "Not implemented"; native uses ZNP `client.jobs.submitJcl` and `getJobStatus`.

---

## Backend interface (`src/zos/backend.ts`)

`ZosBackend` defines these methods. Any new data set operation must:

1. Add a method to the interface (if not already there).
2. Implement it in `FilesystemMockBackend` and in `NativeBackend` (or throw with a clear message).

Signatures (see `backend.ts` for full JSDoc):

- `listDatasets(systemId, pattern, volser?, userId?)` → `Promise<DatasetEntry[]>`
- `listMembers(systemId, dsn, pattern?)` → `Promise<MemberEntry[]>`
- `readDataset(systemId, dsn, member?, encoding?)` → `Promise<ReadDatasetResult>`
- `writeDataset(systemId, dsn, content, member?, etag?, encoding?, startLine?, endLine?, progress?)` → `Promise<WriteDatasetResult>` — when both `startLine` and `endLine` are provided, the block of records from startLine to endLine (inclusive) is replaced by content; the number of lines need not match (data set can grow or shrink). When only `startLine` is provided, the same number of lines as in content are replaced. Mock and native both support it.
- `createDataset(systemId, dsn, options)` → `Promise<CreateDatasetResult>`
- `deleteDataset(systemId, dsn, member?)` → `Promise<void>`
- `getAttributes(systemId, dsn)` → `Promise<DatasetAttributes>`
- `copyDataset(systemId, sourceDsn, targetDsn, sourceMember?, targetMember?)` → `Promise<void>`
- `renameDataset(systemId, dsn, newDsn, member?, newMember?)` → `Promise<void>`

Types: `DatasetEntry`, `MemberEntry`, `ReadDatasetResult`, `WriteDatasetResult`, `CreateDatasetOptions`, `CreateDatasetResult`, `DatasetAttributes` are all in `backend.ts`.

---

## Implementing a new data set tool (or a new backend method)

### 1. Backend

- **Mock**: Implement (or extend) the method in `packages/zowe-mcp-server/src/zos/mock/filesystem-mock-backend.ts`.
- **Native**: Implement (or stub with a clear throw) in `packages/zowe-mcp-server/src/zos/native/native-backend.ts`. Native uses Zowe Native Proto SDK; see `listDatasets` there for pattern (get spec, credentials, client from cache, call SDK, map result to `DatasetEntry` etc.).

### 2. Tool layer

- **Data set tools**: Add or adjust in `packages/zowe-mcp-server/src/tools/datasets/dataset-tools.ts`.
  - Use `DatasetToolDeps`: `{ backend, systemRegistry, sessionState, credentialProvider }`.
  - Resolve system + DSN with `resolveInput(deps, dsn, member, system, log)` (which calls `ensureContext` and `resolveDsn`).
  - DSN convention: all names are fully qualified. Use `resolveDsn(dsn, member)` or `resolvePattern(dsnPattern)` from `src/zos/dsn.ts` for validation and resolution.
  - Return responses via the **response envelope** from `src/tools/response.ts`:
    - `buildContext(systemId, { resolvedDsn: formatResolved(dsn) })` (or `resolvedPattern` for list, `resolvedTargetDsn` for copy/rename).
    - List: `paginateList(items, offset, limit)` → `ListResultMeta`; use `getListMessages(meta)` for the envelope `messages` array when there are more pages; Read: sanitize text with `sanitizeTextForDisplay(result.text)`, then `windowContent(text, startLine, lineCount)` → `ReadResultMeta` (includes `hasMore`); use `getReadMessages(meta)` for the envelope `messages` array when there are more lines; Mutations: `MutationResultMeta` with `{ success: true }`.
    - `wrapResponse(ctx, meta, data, messages)` to build the final JSON envelope. For list tools, pass `getListMessages(meta)`; for read tools, pass `getReadMessages(meta)` so the agent is directed to fetch the next page when `hasMore` is true.
  - Tool names: **camelCase** (e.g. `listDatasets`). Annotations: `readOnlyHint: true` for read-only, `destructiveHint: true` for delete.
  - Describe data set/pattern parameters as fully qualified (e.g. USER.SRC.COBOL).

### 3. DSN utilities (`src/zos/dsn.ts`)

- `resolveDsn(input, member?)` → `ResolvedDsn` (validates 44-char limit, 8-char qualifiers; use for CRUD).
- `resolvePattern(input)` → normalized string (for list patterns, no full DSN validation).
- `validateDsn(dsn)`, `validateMember(member)`, `buildDsUri(system, dsn, member?)`, `inferMimeType(text)`.

### 4. Session and context

- **SessionState** (`src/zos/session.ts`): active system, per-system `SystemContext` (userId). `requireSystem(system?)`, `getContext(systemId)`.
- **ensureContext(deps, systemId)**: call before using backend so that if the LLM passes `system` without calling `setSystem`, context is lazily initialized from `credentialProvider`.

### 5. Tests and docs

- Add or extend tests in `packages/zowe-mcp-server/__tests__/` (e.g. `dataset-tools.test.ts`, or common tests in `common.test.ts`). Use transport providers so tests run on in-memory, stdio, and HTTP.
- Update `AGENTS.md` if you add a new component or change patterns.

---

## USS tools

USS (UNIX System Services) tools are in `src/tools/uss/`. The backend interface (`ZosBackend`) defines USS methods: `listUssFiles`, `readUssFile`, `writeUssFile`, `createUssFile`, `deleteUssFile`, `chmodUssFile`, `chownUssFile`, `chtagUssFile`, `runUnixCommand`, `getUssHome`, `getUssTempDir`, `getUssTempPath`, `deleteUssUnderPath`. Mock and native backends implement them (native via ZNP `client.uss.*` and `client.cmds.issueUnix`).

### Encoding and file tag

- **Resolution order**: operation param → per-system `mainframeUssEncoding` (from `setSystem`) → server default (`IBM-1047`). Same as datasets; see encoding in AGENTS.md.
- **ZNP**: When ZNP follows file tag for encoding, the backend may use the file’s tag; verify in ZNP and document.

### hardstop-patterns (command and path safety)

- **Commands** (`runSafeUssCommand`): Evaluation order is mandatory. (1) `checkBashDangerous(command)` → **BLOCK**. (2) `checkBashSafe(command)` → **ALLOW**. (3) Unknown → **elicit** (if client supports it) or **DENY**. Single tool only: `runSafeUssCommand`; no “run any command” tool.
- **Read path** (`readUssFile`): (1) `checkReadDangerous(path)` → **BLOCK**. (2) `checkReadSensitive(path)` → **WARN** / elicit. (3) `checkReadSafe(path)` → **ALLOW**. (4) Unknown → elicit or DENY. Implemented in `src/tools/uss/command-validation.ts`.

### Path resolution and context

- **Path**: `resolveUssPath()` in `src/zos/uss-path.ts` normalizes slashes and trims. `ResponseContext` can include `resolvedPath` when different from input.
- **Home**: `getUssHome` returns the user’s USS home (backend `getUssHome` or `echo $HOME`); result is cached in `SystemContext.ussHome` and included in `getContext` as `activeSystem.ussHome`.

### Temp tools safety

- **deleteUssTempUnderDir**: Path must contain the segment `tmp` (or `TMP`) and have at least 3 path segments (e.g. `/u/myuser/tmp/xyz`) to avoid accidental mass delete. Enforced in the tool layer.

---

## TSO tools

TSO tools are in `src/tools/tso/`. The backend interface (`ZosBackend`) defines `runTsoCommand(systemId, commandText, userId?, progress?)` → `Promise<string>`. Mock and native backends implement it (native via ZNP `client.cmds.issueTso`).

### TSO command safety (tso-command-patterns.json)

- **Patterns file**: `src/tools/tso/tso-command-patterns.json` — evaluation order: (1) **dangerous** → BLOCK (no question: system data set DELETE/RENAME, PASSWORD, CALL, ALTER, OSHELL non-pwd), (2) **elicit** → ELICIT (user approval required: DELETE/RENAME own data set, SUBMIT), (3) **safe** → ALLOW, (4) unknown → ELICIT. Each entry has `id`, optional `message`, and `pattern` (regex; use `\b` for word boundary in JSON). Block is reserved for truly dangerous; destructive-but-allowed-with-approval (e.g. delete own data set) is in elicit.
- **Validation**: `src/tools/tso/tso-command-validation.ts` exports `validateTsoCommand(commandText)`. Command is normalized (trim, collapse spaces, uppercase) before matching.
- **Cache and pagination**: Full output is cached (key: systemId + commandText). When **no** `startLine`/`lineCount` → run command, **set** cache, return first window. When **with** `startLine`/`lineCount` → **getOrFetch** from cache, then `windowContent` and return. So requesting the same command without startLine/lineCount **re-executes** the command.

---

## Implementing a new component (e.g. jobs)

1. Create `src/tools/<component>/` and export `register<Component>Tools(server, deps, logger)`.
2. In `server.ts`, call the registrar; for z/OS backends, only register when `options?.backend` is set.
3. Update the `components` array in the `info` tool response.
4. If the component needs a backend, define a small interface (e.g. `ZosJobsBackend`) and implement it for mock and, when relevant, native.

---

## Zowe Native SDK

The **Zowe Native Proto SDK** is used by the native (SSH) backend. We use only the SDK; it is **not published to npm**. The package is consumed as a file dependency (tgz in this repo).

### Paths

| What                           | Path                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SDK source (reference)**     | `zowe-native-proto` repo: `/Users/plape03/workspace/github.com/zowe/zowe-native-proto`. SDK code lives in `**packages/sdk`** (e.g. `src/ZSshClient.ts`, `src/doc/rpc/ds.ts` for data set RPCs). |
| **SDK source (Artifactory)**   | Zowe Artifactory: `https://zowe.jfrog.io/artifactory/npm-release/zowe-native-proto-sdk/` (version 0.2.4). Project uses registry in `.npmrc`. |
| **Server dependency**          | `packages/zowe-mcp-server/package.json`: `"zowe-native-proto-sdk": "0.2.4"`                                                                                                                     |
| **After `npm install`**        | `packages/zowe-mcp-server/node_modules/zowe-native-proto-sdk` (or `packages/zowe-mcp-vscode/server/node_modules/zowe-native-proto-sdk` in bundled extension)                                   |
| **Our code that uses the SDK** | `packages/zowe-mcp-server/src/zos/native/` — `ssh-client-cache.ts`, `native-backend.ts`                                                                                                        |

### Minimal example: list data sets

In the **zowe-native-proto** repo, see:

`**/Users/plape03/workspace/github.com/zowe/zowe-native-proto/example/index.ts`**

- Uses `SshSession` from `@zowe/zos-uss-for-zowe-sdk` and `ZSshClient` from `zowe-native-proto-sdk`.
- `using client = await ZSshClient.create(session);`
- `const response = await client.ds.listDatasets({ pattern });` → `response.items` (array of data set items).

Use this as the reference for calling data set APIs from the SDK.

### SSH client cache reference

The **zowe-native-proto** VS Code extension uses a cache that is a good reference for our native backend cache:

`**/Users/plape03/workspace/github.com/zowe/zowe-native-proto/packages/vsce/src/SshClientCache.ts`**

- Singleton cache keyed by client id (e.g. profile name + type).
- `connect(profile, restart?)` → get or create `ZSshClient`; uses mutex per client id; supports restart and server deploy/checksums.
- `end(hostOrProfile)` → dispose and remove client.
- `ZSshClient.create(session, { ...opts, onClose, onError })` for lifecycle.

Our cache in `packages/zowe-mcp-server/src/zos/native/ssh-client-cache.ts` follows a similar idea (key by `user@host:port`, getOrCreate, evict) but is adapted for MCP (no VS Code or profile, connection spec from config/env).

### Finding SDK sources on GitHub

The SDK is not on npm; the canonical source is the **zowe-native-proto** repo. Use these to find the right APIs without cloning:

- **Repo**: [https://github.com/zowe/zowe-native-proto](https://github.com/zowe/zowe-native-proto) (branch `main`).
- **Client API surface** (what methods exist on `client.ds`): `packages/sdk/src/RpcClientApi.ts`
Raw: [https://raw.githubusercontent.com/zowe/zowe-native-proto/main/packages/sdk/src/RpcClientApi.ts](https://raw.githubusercontent.com/zowe/zowe-native-proto/main/packages/sdk/src/RpcClientApi.ts)
- **Dataset RPC definitions** (request/response types): `packages/sdk/src/doc/rpc/ds.ts`
Raw: [https://raw.githubusercontent.com/zowe/zowe-native-proto/main/packages/sdk/src/doc/rpc/ds.ts](https://raw.githubusercontent.com/zowe/zowe-native-proto/main/packages/sdk/src/doc/rpc/ds.ts)
- **Common types** (e.g. `DsMember`, `Dataset`, `ListOptions`): `packages/sdk/src/doc/rpc/common.ts`
Raw: [https://raw.githubusercontent.com/zowe/zowe-native-proto/main/packages/sdk/src/doc/rpc/common.ts](https://raw.githubusercontent.com/zowe/zowe-native-proto/main/packages/sdk/src/doc/rpc/common.ts)
- **Example usage**: repo root `example/index.ts` (listDatasets only; no listMembers example in tree).

**How to discover "list members"**: In `RpcClientApi.ts`, the `ds` object lists all data set commands (`listDatasets`, `listDsMembers`, `readDataset`, etc.). The method name is `**listDsMembers`** (not `listMembers`). Then open `ds.ts` for `ListDsMembersRequest` / `ListDsMembersResponse` and `common.ts` for `DsMember`.

### Insights for native backend methods

- **SDK method name**: Backend method is `listMembers`; SDK method is `**listDsMembers`** (RPC command string `"listDsMembers"`).
- **No member pattern in SDK**: `ListDsMembersRequest` has `dsname`, `maxItems`, `start`, `attributes` — no `pattern`. Implement member-name filtering **client-side** (e.g. regex from `pattern.replace(/\*/g, '.*')`, case-insensitive), consistent with the mock backend.
- **Response shape**: `items: DsMember[]` with `DsMember = { name: string }`; maps 1:1 to our `MemberEntry` after normalizing `name` to uppercase.
- **Auth/connection errors**: Same handling as `listDatasets`: on errors whose message indicates auth or connection failure, call `credentialProvider.markInvalid(spec)`, `clientCache.evict(spec)`, `onPasswordInvalid?.(...)`, then rethrow.

### Implementing more native-backend methods

1. Follow the pattern in `native-backend.ts` `listDatasets`: get spec, credentials, client via cache, call SDK API, map to `DatasetEntry` / `MemberEntry` / etc.
2. Use the **example** above for the exact SDK calls (e.g. `client.ds.listDatasets({ pattern })`, `client.ds.listDsMembers({ dsname })`).
3. SDK types and APIs are in the installed package under `node_modules/zowe-native-proto-sdk`; for source and RPC definitions see `zowe-native-proto/packages/sdk/src/`.
4. **getDatasetAttributes**: The SDK has no dedicated `getAttributes` RPC. The native backend implements it by calling `listDatasets` with the DSN as pattern and `attributes: true`, then selecting the entry with an exact DSN match; if none, it throws "Dataset not found".

---

## Key file paths

| Area                               | Path                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| Backend interface                  | `packages/zowe-mcp-server/src/zos/backend.ts`                      |
| Mock backend                       | `packages/zowe-mcp-server/src/zos/mock/filesystem-mock-backend.ts` |
| Native backend                     | `packages/zowe-mcp-server/src/zos/native/native-backend.ts`        |
| Native SSH client cache (uses SDK) | `packages/zowe-mcp-server/src/zos/native/ssh-client-cache.ts`      |
| Data set tools                     | `packages/zowe-mcp-server/src/tools/datasets/dataset-tools.ts`     |
| USS tools                          | `packages/zowe-mcp-server/src/tools/uss/uss-tools.ts`             |
| USS path resolution                | `packages/zowe-mcp-server/src/zos/uss-path.ts`                    |
| USS command/path validation        | `packages/zowe-mcp-server/src/tools/uss/command-validation.ts`      |
| TSO tools                          | `packages/zowe-mcp-server/src/tools/tso/tso-tools.ts`               |
| TSO command validation and patterns | `packages/zowe-mcp-server/src/tools/tso/tso-command-validation.ts`, `tso-command-patterns.json` |
| Response envelope                  | `packages/zowe-mcp-server/src/tools/response.ts`                   |
| DSN resolution                     | `packages/zowe-mcp-server/src/zos/dsn.ts`                          |
| Session state                      | `packages/zowe-mcp-server/src/zos/session.ts`                      |
| Server wiring                      | `packages/zowe-mcp-server/src/server.ts`                           |
| Agent instructions                 | `AGENTS.md` (root)                                                 |

---

## Quick reference: response envelope

- **List**: `buildContext(..., { resolvedPattern: formatResolved(pattern) })`, `paginateList(list, offset, limit)`, `wrapResponse(ctx, meta, data, getListMessages(meta))`.
- **Read**: `buildContext(..., { resolvedDsn })`, `sanitizeTextForDisplay(result.text)`, `windowContent(text, startLine, lineCount)` (meta includes `hasMore`), `wrapResponse(ctx, meta, data, getReadMessages(meta))`.
- **Mutation**: `buildContext(..., { resolvedDsn } or { resolvedDsn, resolvedTargetDsn })`, `wrapResponse(ctx, { success: true }, data)`.
- Resolved values in `_context` (`resolvedPattern`, `resolvedDsn`, `resolvedTargetDsn`) are only present when resolution changed the input (e.g. normalized case, stripped quotes), and are fully qualified with no quotes.
