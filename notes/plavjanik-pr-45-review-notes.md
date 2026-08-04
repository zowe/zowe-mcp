# PR #45 review notes (add-system-tools)

Draft list of review comments to leave on the PR.

Items 1-5 were posted as a PR comment and confirmed fixed in Dan's `5d076ff` ("pr comment
reviews") commit — checked the diff directly. Items 6 and 8 were fixed and item 7 deferred
to TODO.md in Dan's `e21d5c2` ("review feedback") commit — also checked directly; the full
mock test suite passes on that commit (883 passed / 113 env-gated skips). The stray
`.gitignore` `$HOME` entry is removed in the same commit as this notes update.

**Overall status: all review items resolved or deferred. Approval is waiting on the
post-`e21d5c2` evaluation runs (gemini-2.5-flash on system+certificates, qwen3.6-27b on
certificates) completing without regressions.**

## 1. Use `dsn`/`volser`, not `dsname`/`volume`

**Status: fixed in `5d076ff`.** `system-output-schemas.ts`, `backend.ts`, `native-backend.ts`,
and `filesystem-mock-backend.ts` all renamed `dsname`→`dsn`, `volume`→`volser`; the tool renamed
`listApf`→`listApfLibraries` and the field renamed `apf`→`apfAuthorized`, matching exactly what
was suggested below.

The new system tools introduce a second naming convention for the same two concepts
that the rest of the MCP server already names consistently:

| Concept | dataset tools (existing) | system tools (this PR) |
|---|---|---|
| data set name | `dsn` | `dsname` |
| volume serial | `volser` / `volsers` | `volume` |

`dsn`/`volser` is the established convention (see `dataset-output-schemas.ts`, e.g. lines
186, 202, 279, 284, 336). The new tools should match it instead of introducing `dsname`/
`volume`, so agents (and humans) don't have to learn two names for the same field.

Note: `jobs-output-schemas.ts` already uses `dsname` (line 113) for job spool files — that's
a pre-existing inconsistency too, but out of scope for this PR; not asking to touch it here.

**Counterpoint, considered and rejected:** `dsname`/`volume`/`apf` aren't arbitrary — they're
verbatim the column headers IBM's own operator commands use for exactly what these two tools
wrap:

- `DISPLAY PROG,APF` → columns `ENTRY VOLUME DSNAME`
- `DISPLAY PROG,LNKLST` → columns `ENTRY APF VOLUME DSNAME`

So there's a real tradeoff: match the underlying z/OS command's own terminology, or match this
MCP server's internal `dsn`/`volser` convention used by every other tool. Recommending the
latter anyway — an agent calling `listApf`/`listLinklist` right after `listDatasets` benefits
more from one consistent field name across the whole tool surface than from `listApf`'s output
mirroring `D PROG,APF`'s column names 1:1. (The `apf` boolean itself is fine as-is — it's not
overloaded with the `listApf` tool name; it corresponds to the distinct `APF` column in
`D PROG,LNKLST`. Worth knowing as an FYI, not a fix: IBM's `APF` column is actually three-valued
—`A`/`SMS`/blank— and the zowex-sdk already collapses that to a plain boolean before it reaches
this PR's code, so there's no SMS-vs-authorized distinction to recover here even if we wanted it.)

**Also rename: `listApf` → `listApfLibraries`, `apf` → `apfAuthorized`.** The tool's own
description text already spells out the proper name, it's only the identifiers that abbreviate
it:

- `listApf`'s description: *"List the **APF-authorized** ... data sets ... audit which load
  libraries are **authorized** to run privileged code."* (`system-tools.ts:112-113`)
- `listLinklist`'s description: *"each with its volume serial and **APF-authorization status** ...
  which are **APF-authorized**."* (`system-tools.ts:214-215`)
- IBM's own doc title for the underlying command: *"Displaying entries in the list of
  **APF-authorized libraries** (PROG,APF)"*.

So `listApfLibraries` (tool name) and `apfAuthorized` (boolean field) match what the tool
already calls itself in prose — bare `apf` as a boolean field reads as a noun, not a predicate,
and the tool name `listApf` on its own doesn't say what it's a list *of* (libraries) the way
`listLinklist`/`listDatasets`/`listMembers` do.

Affected:

- Tool name `listApf` → `listApfLibraries`: `system-tools.ts` (registerTool call, cache key,
  log messages), `system-output-schemas.ts`, `backend.ts`, `native-backend.ts`,
  `filesystem-mock-backend.ts`, `scripts/generate-docs.ts`, `__tests__/mock-stdio.e2e.test.ts`,
  `__tests__/system-tools.test.ts`, `zowe-mcp-evals/questions/system.yaml`. (Optional/nice-to-have:
  the exported type names `ListApfResult`/`ApfDatasetEntry` in `backend.ts` could follow too, but
  that's internal and lower priority than the tool-visible name.)
- Field `apf` → `apfAuthorized`: `system-output-schemas.ts:94,107`, `backend.ts:471`
  (`LinklistDatasetEntry.apf`), `native-backend.ts:1833` (adapter mapping — **not** line 224,
  which is the `NativeSystemApi`/SDK wire-contract type, same caveat as `dsname`/`volume`),
  `filesystem-mock-backend.ts:1118-1122`, `__tests__/system-tools.test.ts:167-176`.

Affected (this PR's own code, not the zowex-sdk's wire contract — see caveat below):

- `src/tools/system/system-output-schemas.ts:55-56` — `listApfEntrySchema` (`dsname`, `volume`)
- `src/tools/system/system-output-schemas.ts:67` — description text mentioning `dsname`/`volume`
- `src/tools/system/system-output-schemas.ts:92-93` — `listLinklistEntrySchema` (`dsname`, `volume`)
- `src/tools/system/system-output-schemas.ts:107` — description text mentioning `dsname`/`volume`
- `src/zos/backend.ts:445-449` — `ApfDatasetEntry` (`dsname`, `volume`)
- `src/zos/backend.ts:465-469` — `LinklistDatasetEntry` (`dsname`, `volume`)
- `src/zos/native/native-backend.ts:1790-1791, 1831-1832` — adapter mapping into the above
  two types (rename the *output* field names here; the *input* side reads from the
  zowex-sdk response, see caveat)
- `src/zos/mock/filesystem-mock-backend.ts:1087-1122` — mock data for `listApf`/`listLinklist`
- `__tests__/system-tools.test.ts:126-177` — assertions on `dsname`/`volume`

**Caveat — do not rename:** `native-backend.ts:213-226` (`NativeSystemApi` interface) describes
the zowex-sdk's own RPC response shape (`{ dsname, volume }` over the wire, SDK 0.6.0+/0.6.1+).
That's an external contract, not ours to rename. The fix is only in the adapter step that maps
the SDK's `dsname`/`volume` into our own `dsn`/`volser` before it reaches the output schema.

## 2. `data` should be the array directly, not `data.items`

**Status: fixed in `5d076ff`.** All three tools now call `wrapResponse(ctx, meta, page, ...)`
directly instead of `wrapResponse(ctx, meta, { items: page }, ...)` — `data` is the bare array,
matching `listDatasets`/`listMembers`/etc.

Checked the actual convention across every existing "simple list" tool in the codebase —
`listDatasets`, `listMembers` (datasets), `listJobFiles`, `listJobs`, `searchJobOutput` (jobs),
`listUssFiles` (uss). Every one of them makes `data` **the array itself**:

```ts
// e.g. src/tools/datasets/dataset-output-schemas.ts:402-410
export const listDatasetsOutputSchema = envelopeSchema(
  z.array(datasetListEntrySchema).describe(...),
  listResultMetaSchema,
  'Paginated list of data sets matching a pattern. data[] has one entry per data set; ...'
);
```

documented consistently as "`data[]` has one entry per X". None of them nest the array under
a wrapper key. The three new system tools are the only ones in the codebase that do this —
they wrap it as `data: { items: [...] }`:

```ts
// src/tools/system/system-output-schemas.ts:59-61
const listApfDataSchema = z.object({
  items: z.array(apfDatasetSchema).describe('APF-authorized data sets for this page.'),
});
```

Should drop the `items` wrapper and pass the array itself as `data`, matching every other
list tool. This affects `listApf`, `listLinklist`, and `listProclib` (see #3 for that one's
entry-shape issue too).

Affected:

- `src/tools/system/system-output-schemas.ts` — `listApfDataSchema` (55-61), `listProclibDataSchema`
  (74-78), `listLinklistDataSchema` (90-101, incl. entry schema at 92-93) — drop `items` wrapper,
  make `data` the array; update the three envelope descriptions (67, 82-ish, 107) to say
  `data[]` like the other tools
- `src/tools/system/system-tools.ts` — every place that builds `{ items: page }` for these
  three tools (`wrapResponse(ctx, meta, { items: page }, ...)`) — pass `page` directly instead
- `__tests__/system-tools.test.ts:126-177` — assertions read `env.data.items`, need to read
  `env.data` directly

## 3. `listProclib` should return objects, not bare strings

**Status: fixed in `5d076ff`.** `listProclib` entries are now `{ dsn }` objects, matching the
convention used by `listApfLibraries`/`listLinklist`.

Related to #2 but a separate defect: even after unwrapping `items`, `listProclib`'s entries
are plain strings, unlike every other data-set list (`listApf`, `listLinklist`, and the existing
`listDatasets`), which return objects keyed by `dsn` (plus other optional attributes) even when
most fields are absent:

```ts
// src/tools/system/system-output-schemas.ts:74-78
const listProclibDataSchema = z.object({
  items: z.array(z.string()).describe('PROCLIB data set names ...'),
});
```

Should be `z.array(z.object({ dsn: z.string() }))` (or reuse a shared minimal data-set-entry
schema) — a list of data sets is a list of objects with a `dsn` attribute, not a list of plain
strings.

Note this is a real constraint, not just a mapping gap: the underlying zowex-sdk's own
`ListProclibResponse.items` is `string[]` too (`@zowe/zowex-for-zowe-sdk/lib/doc/rpc/system.d.ts`)
— PROCLIB entries genuinely have no volser available from the RPC, unlike APF/LNKLST which get
`{ dsname, volume }` from the SDK. So the fix is to wrap the name as `{ dsn }`, not to try to
add a `volser` that isn't there.

Affected:

- `src/tools/system/system-output-schemas.ts:74-78` — `listProclibDataSchema`
- `src/zos/backend.ts:459-462` — `ListProclibResult.items: string[]`
- `src/zos/native/native-backend.ts` — wherever `ListProclibResult` is built from the SDK response
- `src/zos/mock/filesystem-mock-backend.ts` — mock `listProclib` data
- `__tests__/system-tools.test.ts` — assertions on `listProclib` items

## 4. `listProclib` items have trailing padding whitespace

**Status: fixed in `5d076ff`.** `native-backend.ts` now calls `.trim()` on all three list
methods' entries, with a comment noting `listProclib` is the one that actually needs it.

Tested live against System B (real z/OS, native SSH/zowex backend). `listProclib`
items come back padded with trailing spaces, e.g.:

```text
"SYS1.PROCLIB                                "
```

`listApf` and `listLinklist` (same system, same call) return clean, unpadded data set names.
Likely the raw PROCLIB concatenation string from the zowex-sdk isn't being trimmed before
being split into `items`. Should be trimmed the same way the other two list tools already are.

## 5. `viewSyslog` start/end are in two different time zones, and start ends up after end

**Status: mitigated in `5d076ff`.** Added `syslogWindowClockSkewWarning()` in `system-tools.ts`,
which detects `start > end` and appends a warning message telling callers the window boundaries
are unreliable and to trust the SYSLOG line timestamps instead. This is the defensive-check
option below, not a root-cause fix — the underlying clock mismatch is still there (expected,
since the root cause is upstream in `@zowe/zowex-for-zowe-sdk`, not fixable in this PR's code).

Tested live against System B with `secondsAgo=600, maxLines=20`:

```json
{
  "startDate": "2026-08-04", "startTime": "08:00:17",
  "endDate":   "2026-08-04", "endTime":   "04:10:17"
}
```

`startTime` (08:00:17) is chronologically *after* `endTime` (04:10:17) — backwards for a window
that's supposed to run from start to end. Checked against the system's actual clocks over SSH
at the time of the call:

```text
$ ssh TESTUSER@System B 'date; tsocmd "TIME"'
Tue Aug  4 08:10:37 2026                                    # USS/UTC
TIME-04:10:37 AM. ... AUGUST 4,2026                         # TSO local
```

System B's TSO/operator local time is 4 hours behind its USS/UTC time. `startTime: 08:00:17` lines
up with `now (UTC) - 600s`; `endTime: 04:10:17` lines up with TSO local time and matches the
actual SYSLOG record's own timestamp (`26216 04:10:17.86` in the returned line). So the two
fields describing one window are computed in two different time zones — UTC for the requested
start, system-local for the actual end — which is why start sorts after end instead of before it.

Traced where this comes from: `native-backend.ts:1842-1872` (`viewSyslog`) does a straight
pass-through — `secondsAgo` goes to the SDK unchanged, and `startDate`/`startTime`/`endDate`/
`endTime` are taken as-is from the SDK's `response.*` fields with no client-side date math.
So this isn't a bug in this PR's mapping code; the inconsistency is coming from inside the
`@zowe/zowex-for-zowe-sdk` native agent itself (or however it computes "now - secondsAgo" vs.
the timestamp of the last record it read).

Still worth raising on the PR: right now this ships to the caller with no sanity check, so an
agent (or a human) reading `startTime > endTime` has no signal that the window is unreliable.
Two options, not mutually exclusive:

- File it upstream against `zowe-zowex-for-zowe-sdk` (root cause is there, not in zowe-mcp).
- Add a defensive check in `native-backend.ts`/`system-tools.ts`: if `start > end`, either
  normalize (e.g. treat SDK's start/end as unreliable and derive from `secondsAgo`/`maxLines`
  echoed back) or surface a message so callers know not to trust the window boundaries.

**Cross-system confirmation.** Ran more calls on System B and, for comparison, on System C
(a different LPAR, reachable over SSH as `testuser`; couldn't reach System D — no SSH access
configured there, only a z/OSMF profile, and this backend needs SSH). The pattern holds exactly
along the fault line I expected: **it only shows up on systems where the OS-level clock and the
TSO/operator-local clock disagree.**

| System | USS `date` vs TSO `TIME` | Call | startTime | endTime | Consistent? |
|---|---|---|---|---|---|
| System B | UTC vs local (4h split: `08:10:37` vs `04:10:37`) | `secondsAgo=600, maxLines=20` | 08:00:17 | 04:10:17 | ✗ start > end |
| System B | (same split) | no params (default) | 09:37:03 | 05:37:32 | ✗ start > end |
| System B | (same split) | `secondsAgo=60` | 09:36:36 | 05:37:35 | ✗ start > end |
| System B | (same split) | `secondsAgo=3600, maxLines=5` | 08:37:39 | 05:37:38 | ✗ (closer, but still off — see note) |
| System C | both local EDT, agree (`05:32:03` both) | `secondsAgo=600, maxLines=20` | 05:24:56 | 05:24:59 | ✓ |
| System C | (agree) | `secondsAgo=3600, maxLines=5` | 04:35:19 | 04:35:29 | ✓ |
| System C | (agree) | no params (default) | 05:34:53 | 05:35:23 | ✓ |

On System B, `startTime` tracks "now (host OS/UTC clock) − secondsAgo" while `endTime` tracks the
actual last SYSLOG record's local timestamp — two different clocks 4 hours apart, so start
consistently lands after end. On System C, the host OS clock and TSO local time are the same zone,
so the same computation produces a self-consistent, correctly-ordered window every time. This
isn't randomness or a System B-specific data quirk — it's the same code path on two systems, and it
only misbehaves when the target LPAR's OS-level clock isn't set to local time. Reinforces that
the fix belongs in whichever layer computes "now" for the `secondsAgo` window (zowex-sdk/native
agent) — it needs to use the same clock basis as the SYSLOG timestamps it's windowing over, not
the host's raw OS clock.

The System B rows actually fit an exact formula, which pins the mechanism down further:
`(startTime − endTime) = 4h − secondsAgo`, i.e. `startTime = hostUTCNow − secondsAgo` and
`endTime ≈ localNow`, with `hostUTCNow − localNow` a constant 4h on this system:

| secondsAgo | predicted gap (4h − secondsAgo) | observed gap |
|---|---|---|
| 600 | 3:50:00 | 3:50:00 |
| 0 (default) | 4:00:00 | 3:59:31 |
| 60 | 3:59:00 | 3:59:01 |
| 3600 | 3:00:00 | 3:00:01 |

Matches to the second across four different `secondsAgo` values — not a coincidence.

## 6. `deleteCertificate` can report a fatal error after the delete already succeeded

**Status: fixed in `e21d5c2`.** New `refreshFailureWarning()` in `certificate-tools.ts`
detects refresh-only failures (message matching "REFRESH failed") and converts them to
`_result.success: true` plus a warning pointing at `refreshCertificateClass` — applied to
both `deleteCertificate` and `importCertificate`, exactly the two flagged below. Unit
tests cover the positive case and the crucial negative one (a `DataRemove failed` error,
where the mutation did NOT commit, still throws). Caveat: it keys on the SDK's error
message text, so the durable fix (SDK reporting refresh failure as a soft warning in the
response) is still worth filing upstream.

Also in this PR: nine certificate/key-ring tools (`showCertificate`, `connectCertificate`,
`deleteCertificate`, `exportCertificate`, `importCertificate`, `setDefaultCertificate`,
`trustCertificate`, `renameCertificate`, `refreshCertificateClass`). Tested live on System B with a
throwaway certificate/ring created under my own ID (`TESTUSER`) for this purpose — cleaned up
afterward, nothing else touched.

Sequence: created cert `TEST-CERT-1` (RACDCERT GENCERT) and ring `TEST.KEYRING`
(RACDCERT ADDRING) directly, since no MCP tool creates either (see #7). Used the actual PR tools
from there:

1. `connectCertificate` (`fromDatabase: true`) — succeeded, `_result.success: true`.
2. `showCertificate` — read back the cert correctly (label, owner, usage, trust, validity dates
   all matched RACDCERT LIST; the ISO-8601 `notBefore`/`notAfter` conversion from the local RACF
   dates was correctly timezone-aware, for what it's worth — no issue there).
3. `deleteCertificate` (`database: true`) — **returned a fatal error**:

   ```json
   {"error":"Error: IRRSDL64 REFRESH failed: SAF rc: 8, RACF rc: 8, RACF rsn: 92"}
   ```

   Checked via `RACDCERT ID(TESTUSER) LIST(LABEL('TEST-CERT-1'))` immediately after: *"No
   certificate information was found for user TESTUSER."* **The certificate was already deleted.**
   Only the automatic post-delete `SETROPTS REFRESH(DIGTCERT)` step failed — the primary
   mutation had already committed — and that sub-step's failure got surfaced as if the whole
   operation had failed.

This is worse than a cosmetic issue: a caller (agent or human) seeing this error has every reason
to believe the delete didn't happen and could retry it, build automation around a false failure
signal, or distrust the tool's success reporting generally — when the destructive action already
went through.

The codebase already has the right mechanism for this, just not applied here: `connectCertificate`
hit its own soft-failure in step 1 above (reconnecting an existing cert ignored the supplied
label) and correctly reported it as `_result.success: true` plus a `warning` string and
`safReturnCodes` — no thrown error. `deleteCertificate`'s auto-refresh failure should follow the
same pattern instead of throwing.

Affected: `deleteCertificate` (confirmed live) and `importCertificate` (same `skipRefresh`/
auto-refresh description and code shape — `certificate-tools.ts:390,399,410` — not tested live,
but worth checking for the same issue). `src/zos/native/native-backend.ts:1910-1936`
(`deleteCertificate`) passes `skipRefresh` straight through to the SDK's single
`certificates.deleteCertificate(...)` RPC call, so the delete-succeeded/refresh-failed distinction
would need to come from how that RPC's response/error is shaped — may need a fix in
`@zowe/zowex-for-zowe-sdk` itself to report refresh failure as a soft warning in the response
rather than rejecting, similar to #5's `viewSyslog` situation.

## 7. No way to discover certificates or key rings — every cert tool needs an exact label upfront

**Status: deferred in `e21d5c2`.** Recorded in TODO.md as a follow-up (wrap the SDK's
existing `listCertificates`/`listRings` RPCs as read-only tools), with the SDK RPC details
from this note carried over. Acceptable as a follow-up PR; not a merge blocker.

All nine certificate tools require the caller to already know `owner`+`keyring`+`label` (or
`owner`+`keyring` for key-ring-level ops). There's no `listCertificates`/`listKeyRings` tool, so
an agent has no path to discover what's actually on a system before acting — it can `showCertificate`
or mutate a cert, but only if it already knows the exact label out-of-band. Hit this directly
while testing #6: had to create a test cert via raw RACDCERT over SSH just to have a label to
call `showCertificate` with, because there's no MCP tool that could have told me what certificates
already existed.

This isn't a missing SDK capability — `@zowe/zowex-for-zowe-sdk`'s own
`lib/doc/rpc/certificates.d.ts` already defines request/response types the PR doesn't wrap:

- `listCertificates` (`ListCertificatesRequest`/`Response`) — certs on a given ring, with
  `label`/`usage` filters, `labelOnly`/`ownerOnly` projections, and `maxEntries`/`moreAvailable`
  pagination already built in.
- `listRings` (`ListRingsRequest`/`Response`) — a user's key rings and the certs connected to
  each, without needing to already know a ring name.
- `createKeyring`/`deleteKeyring`/`countRing` — also unused; not as critical as the two list
  RPCs, but the same gap (had to create/delete the test ring via raw SSH for #6, not through
  any MCP tool).

Recommend adding `listCertificates` and `listKeyRings`/`listRings` tools (read-only, same
`ResourceEffect.READ` tier as `showCertificate`) so the certificate tools are usable without an
out-of-band way to learn labels/ring names first — mirrors exactly why `listApf`/`listLinklist`/
`listProclib` exist for the system tools.

## 8. Three near-identical hand-rolled `envelopeSchema` helpers

**Status: fixed in `e21d5c2`.** Extracted a shared `sharedEnvelopeSchema` (exported from
`dataset-output-schemas.ts` rather than `response.ts` as suggested below — works, though
it makes the system/certificate schema files import from the datasets module) with a doc
comment requiring all tool families to build envelopes through it and naming the
`data.items` wrapper as the divergence it prevents. The system and certificate schema
files' local helpers now delegate to it.

`dataset-output-schemas.ts`, `system-output-schemas.ts`, and `certificate-output-schemas.ts`
each define their own local `envelopeSchema(dataSchema, resultSchema, ...)` function, doing the
same job (wrap `_context`/`messages`/`data`/optional `_result`) with slightly different
signatures:

- `dataset-output-schemas.ts:371` — `(dataSchema, resultSchema?, envelopeDescription?)`
- `system-output-schemas.ts:30` — `(dataSchema, resultSchema, resultDescription, envelopeDescription)`
  (resultSchema required, extra `resultDescription` param)
- `certificate-output-schemas.ts:30` — `(dataSchema, resultSchema | undefined, envelopeDescription)`
  (inlines the result description as a fixed string)

Three copies drifting independently is likely *why* #2 happened — `system-output-schemas.ts`'s
own hand-rolled copy made it easy to nest `items` inside `data` without the existing
`dataset-output-schemas.ts` convention (`data` as the bare array) being visible or enforced
anywhere. Suggest extracting one shared helper (e.g. into `response.ts`, which `system-tools.ts`
and `certificate-tools.ts` already import from for `buildContext`/`wrapResponse`) so future tool
families can't silently diverge the same way again.
