<!-- markdownlint-disable MD013 -->

# Test Type-Check Findings

Status: **analysis** · Scope: `packages/zowe-mcp-server/__tests__` · Last updated: 2026-06-06

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

## Bucket 1 — Partial mocks of interfaces that have grown (~32 errors)

Tests build hand-rolled fakes implementing only the methods they exercise; the
real interfaces gained members and the mocks did not keep up. Harmless at
runtime (unused methods are never called), but `tsc` flags the structural gap.

- `response-cache.test.ts`: `class CountingBackend implements ZosBackend`
  defines 3 methods; `ZosBackend` now has ~16 (`copyUssFile`, `runTsoCommand`,
  `runConsoleCommand`, `restoreDataset`, …) → `TS2420` + `TS2740` (×9).
- `native-backend.test.ts`: `clientCache: { getOrCreate, evict, hasKey }` passed
  where `SshClientCache` needs `clients, staticOptions, getOptions, options, …`
  → `TS2740` (×10) and `TS2322` (×2).
- `search-runner.test.ts`: a fake backend object missing 25+ `ZosBackend`
  methods → `TS2740`.

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

## Bucket 3 — Missing narrowing under `strict` (~9 errors)

Loose test code that should narrow or assert.

- `dataset-tools.test.ts`: `envelope.messages` is optional (`TS18048`),
  `envelope.data` is `unknown` (`TS18046`) — accessed without narrowing.
- `native-backend.test.ts`: spread of an `unknown` value (`TS2698` / `TS18046`).
- `extension-client.test.ts`: a broad `ExtensionToServerEvent` passed where
  `LogLevelEvent` is expected (`TS2345`).
- `search-benchmark.test.ts`: `Record<string, string | undefined>` (env spread)
  vs `Record<string, string>` (`TS2322`).
- `progress.test.ts`: `number | undefined` vs `number | bigint` (`TS2345`).
- `native-stdio.e2e.test.ts`: a non-overlapping cast (`TS2352`).

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

### Recommendation

**Bucket 2 is done** (this PR) — 59 → 37. Next: clear **Bucket 1** with a shared
`fakeBackend` helper (covers the ~24 mock errors in `native-backend.test.ts`,
`response-cache.test.ts`, `search-runner.test.ts`), mop up **Bucket 3**'s
remaining ~13 narrowing errors, then enable test type-checking (strategy 1),
optionally staged via a separate `typecheck:tests` lane (strategy 2) so it lands
as its own PR without blocking Phase 2.
