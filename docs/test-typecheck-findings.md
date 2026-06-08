<!-- markdownlint-disable MD013 -->

# Test Type-Check Findings

Status: **resolved & enforced** · Scope: all package `__tests__` · Last updated: 2026-06-06

## Context

Phase 0 of the [CI hardening plan](ci-hardening-plan.md) added a `typecheck`
script scoped to **shipped source** (the `tsconfig.build.json` of each package).
Type-checking the server package's **dev** `tsconfig.json` — which also includes
`__tests__/**` and `scripts/**` — surfaces **59 pre-existing errors** across 11
test files. This document records what they are and how to address them so that
test type-checking can eventually be enforced (like `lint:md`).

Reproduce:

```bash
npm run build -w packages/zowe-mcp-common
npm run build -w @zowe/mcp-server
cd packages/zowe-mcp-server && npx tsc -p tsconfig.json --noEmit
```

## Key finding: none are production bugs

Every error is in **test code**, and all of those tests **pass at runtime** —
Vitest transpiles with esbuild and never type-checks. So these are type-level
issues only. However, several reveal real **test-maintenance debt** (stale
duplicate types, ignored helpers) that a type-check gate would have prevented —
which is the argument for enforcing it.

## Error totals

By TypeScript code:

| Code | Count | Meaning |
| --- | --- | --- |
| TS2740 | 19 | Type missing properties of an interface (partial mocks) |
| TS2339 | 12 | Property does not exist on type |
| TS2552 | 8 | Cannot find name (renamed/removed symbol) |
| TS18048 | 5 | Value possibly `undefined` |
| TS2322 | 4 | Type not assignable |
| TS18046 | 4 | Value is of type `unknown` |
| TS2345 | 3 | Argument type mismatch |
| TS2698 | 1 | Spread of non-object type |
| TS2551 | 1 | Property typo / near-miss |
| TS2420 | 1 | Class incorrectly implements interface |
| TS2352 | 1 | Non-overlapping cast |

By file:

| File | Count |
| --- | --- |
| `__tests__/dataset-tools.test.ts` | 16 |
| `__tests__/response-cache.test.ts` | 15 |
| `__tests__/native-backend.test.ts` | 14 |
| `__tests__/mock-zos-zosmf-restfiles.integration.test.ts` | 5 |
| `__tests__/transport-providers.ts` | 2 |
| `__tests__/extension-client.test.ts` | 2 |
| `__tests__/server.test.ts` | 1 |
| `__tests__/search-runner.test.ts` | 1 |
| `__tests__/search-benchmark.test.ts` | 1 |
| `__tests__/progress.test.ts` | 1 |
| `__tests__/native-stdio.e2e.test.ts` | 1 |

## Bucket 1 — Partial mocks of interfaces that have grown (~24 errors)

> **Resolved (this PR):** all Bucket 1 errors are fixed, taking the total to
> **0**. Type-level / test-double changes only; affected tests still pass.

Tests build hand-rolled fakes implementing only the methods they exercise; the
real interfaces gained members and the mocks did not keep up. Harmless at
runtime (unused methods are never called), but `tsc` flags the structural gap.
Fixes applied:

- `response-cache.test.ts`: `class CountingBackend implements ZosBackend`
  defined ~17 methods but `ZosBackend` has ~45 (`copyUssFile`, `runTsoCommand`,
  `runConsoleCommand`, `restoreDataset`, …) → `TS2420` + `TS2740` (×9).
  **Fix:** replaced the 228-line hand-delegating class with a ~25-line
  Proxy-based `createCountingBackend(inner)` factory that delegates every method
  to the real `inner` backend and counts the three of interest — complete by
  construction, so it never drifts again.
- `native-backend.test.ts`: `clientCache: { getOrCreate, evict, hasKey }` passed
  where `SshClientCache` needs `clients, staticOptions, getOptions, options, …`
  → `TS2740` (×10) and `TS2322` (×2). **Fix:** widened `createOptions`' override
  params to `Partial<…>` and cast the assembled doubles once at the return.
- `search-runner.test.ts`: a fake backend missing ~35 `ZosBackend` methods →
  `TS2740`. **Fix:** a shared `createStubBackend(overrides)` helper
  (`__tests__/helpers/stub-backend.ts`) — a Proxy whose methods reject by
  default; tests override only what they call. Reusable and drift-proof.

## Bucket 2 — Stale duplicate types / ignored helpers (~18 errors)

> **Resolved (this PR):** all 22 Bucket 2 errors are fixed, dropping the total
> from 59 to 37. The fixes are type-level only — runtime behavior is unchanged
> and the touched test files still pass (92 tests).

The genuinely valuable findings: tests pointing at types/shapes that have moved.

- `mock-zos-zosmf-restfiles.integration.test.ts` **redefined its own local**
  `interface ZosmfDataSetItem` / `ZosmfDataSetListResponse` that were **stale** —
  missing `migr`, `mvol`, `ovf`, `edate`, `moreRows` (and typing `lrecl`/`blksz`
  as `number` though the wire form is `string`). The production type in
  `src/mock-host/zosmf/response.ts` already declares all of them. The test
  asserted on fields its local type did not know about → `TS2339` / `TS2551`.
  Runtime passed because the real response has the fields.
  **Fix:** delete the local duplicates, import the production types.
- `dataset-tools.test.ts` uses `SearchResultMeta` but **omitted it from the
  import** (only `ListResultMeta` / `ReadResultMeta` were imported);
  `SearchResultMeta` does exist in `src/tools/response.ts` → `TS2552` (×8). The
  `tsc` "did you mean `ReadResultMeta`?" hint was misleading — it was a missing
  import, not a rename. **Fix:** add `SearchResultMeta` to the import.
- `CreateServerResult` is a union (`McpServer | { server, registerZoweExplorerTools }`)
  with a `getServer()` helper to narrow it, but `response-cache.test.ts`,
  `transport-providers.ts`, and `server.test.ts` used the union **directly as
  `McpServer`** (`.connect()` / `.close()`) → `TS2339` / `TS2322`.
  **Fix:** wrap `createServer(...)` in `getServer(...)` (or annotate the helper's
  return type as `ReturnType<typeof getServer>`).

## Bucket 3 — Missing narrowing under `strict` (~15 errors)

> **Resolved (this PR):** all Bucket 3 errors are fixed, dropping the total from
> 37 to 22 (only Bucket 1 mocks remain). Fixes are type-level except a harmless
> `event.type === 'log-level'` guard in `extension-client.test.ts`; affected
> tests still pass.

Loose test code that should narrow or assert. Fixes applied:

- `dataset-tools.test.ts`: `envelope.messages` is optional (`TS18048`),
  `envelope.data` is `unknown` (`TS18046`). **Fix:** type the `parseEnvelope<T>()`
  call and assert `envelope.messages![i]` after the length check (also removed a
  now-unused `eslint-disable no-unsafe-assignment`).
- `native-backend.test.ts`: `await importOriginal()` was `unknown` → spread /
  property access errors (`TS2698` / `TS18046`). **Fix:**
  `importOriginal<Record<string, unknown>>()`.
- `extension-client.test.ts`: handler receives the `ExtensionToServerEvent`
  union, pushed into a `LogLevelEvent[]` (`TS2345`). **Fix:** narrow with
  `if (event.type === 'log-level')` before pushing.
- `search-benchmark.test.ts`: `{ ...process.env }` is
  `Record<string, string | undefined>` vs `Record<string, string>` (`TS2322`).
  **Fix:** `as Record<string, string>`.
- `progress.test.ts`: `number | undefined` vs `number | bigint` (`TS2345`).
  **Fix:** non-null assertion on the compared value.
- `native-stdio.e2e.test.ts`: non-overlapping cast (`TS2352`). **Fix:**
  `as unknown as <target>` per the compiler's own suggestion.

## How to address

### Per-bucket fixes

Bucket 1 (mocks) — pick one style:

- **Shared `fakeBackend(overrides)` helper** returning a fully-stubbed
  `ZosBackend` (all methods `vi.fn()`); tests override the few they need. One
  helper clears most of the 32 and prevents recurrence. *(Recommended.)*
- **`vitest-mock-extended`** (`mock<ZosBackend>()` / `mock<SshClientCache>()`)
  auto-implements every member; adds a dev dependency.
- **Explicit `as unknown as ZosBackend` casts** — cheapest, but only documents
  "partial mock" by convention and silences future real mismatches.
- For `CountingBackend`: forward to `inner` via `Object.assign` / `Proxy`
  instead of `implements`, so it is structurally complete.

Bucket 2 (stale types) — straightforward, low-risk cleanups:

- Delete the local `ZosmfDataSetItem` / `ZosmfDataSetListResponse` duplicates and
  **import the production types** from `src/mock-host/zosmf/response.ts`.
- Replace `SearchResultMeta` with `ReadResultMeta`.
- Use the existing `getServer(result)` helper to narrow `CreateServerResult`
  before `.connect()` / `.close()` (3 sites).

Bucket 3 (narrowing) — small, local:

- A typed `parseEnvelope<T>()` test helper removes most `unknown` / optional
  friction in `dataset-tools.test.ts`; non-null assertions, type guards, or
  `as Record<string, string>` for the rest.

### Overall strategy

1. **Fix all three buckets, then enforce test type-checking** — extend the
   `typecheck` script to each package's dev `tsconfig.json` and add it to CI.
   Best long-term; the work is mostly mechanical and clusters (one backend
   helper plus a few type-import swaps cover ~50 of 59).
2. **Separate `typecheck:tests` lane** — keep today's source-only `typecheck`
   (Phase 2) green, add a tests-only check flipped on once fixed. Lets Phase 2
   proceed while tests are tackled independently.
3. **Incremental ratchet** — a `tsconfig` that includes only already-clean test
   files, expanding per fix so nothing regresses.
4. **Status quo** — leave tests out of type-checking (Vitest runs them untyped).
   Lowest effort, but it is what let Bucket 2 drift in.

### Outcome — done and enforced

All three buckets are fixed and **every package's tests now type-check with 0
errors** (`zowe-mcp-vscode`, `zowe-mcp-evals`, and `zowe-mcp-common` were
confirmed clean too — only `@zowe/mcp-server` had a backlog).

Enforcement is wired (strategy 2, the separate lane):

- Each package has a **`typecheck:tests`** script (`tsc -p tsconfig.json
  --noEmit`) that type-checks `src/**` plus `__tests__/**` via its dev tsconfig.
- A root **`npm run typecheck:tests`** builds the library packages, then runs
  each package's script.
- CI runs **`npm run typecheck:tests --workspaces --if-present`** as a step in
  the `build` job (after the build, so common + server are already compiled),
  covered by the required `build` status check.

The earlier source-only `typecheck` (build tsconfigs) is retained as a faster
local check; `typecheck:tests` is its superset and is the enforced gate. Any
future test type error now fails CI, so this class of drift cannot recur.
