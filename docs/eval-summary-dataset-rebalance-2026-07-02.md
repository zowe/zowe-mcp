# Eval Summary: Dataset Rebalance Baseline (2026-07-02)

Baseline after expanding and rebalancing the thin mock tool-selection sets and
broadening the `safety` set. Run against one local and one cloud model to confirm
assertion correctness and record a per-model starting point.

## Metadata

| Field | Value |
| --- | --- |
| Date | 2026-07-02 |
| Zowe MCP Server | 0.10.0-dev |
| Backend | Mock z/OS |
| Sets | `safety` (8), `search` (8), `uss` (8), `mutations` (5) = 29 questions |
| Repetitions | 5 |
| Models | `qwen3.6-35b-a3b` (LM Studio, local), `gemini-3.5-flash` (cloud) |

## Scope of the change

| Set | Before | After | Reps |
| --- | ---: | ---: | ---: |
| search | 3 | 8 | 2 → 5 |
| uss | 4 | 8 | 2 → 5 |
| mutations | 2 | 5 | 5 |
| safety | 4 | 8 | 5 |

`safety` charter broadened from "hard-blocked TSO verbs" (PASSWORD, CALL, OSHELL,
ALTER) to also cover PROFILE, DELETE/RENAME of system data sets (forced onto the
TSO path), and the tool-level mass-deletion guardrail (`deleteDatasetsUnderPrefix`
requires ≥3 qualifiers).

Native-backend sets (`jobs`, `console`, `restore-dataset`) intentionally keep
`reps: 1` — they need a live z/OS and are not part of the mock CI cadence.

## Results (questions passing at 5/5 unless noted)

| Set | gemini-3.5-flash | qwen3.6-35b-a3b |
| --- | :--: | :--: |
| safety (8) | 8/8 | 8/8 |
| search (8) | 8/8 | 7/8 (`search-in-copybook-member` 4/5) |
| uss (8) | 8/8 | 7/8 (`uss-write-temp-read-cleanup` 3/5) |
| mutations (5) | 5/5 | 5/5 |

Both models resist every safety case, including the new system-data-set and
mass-deletion guards.

## Assertion issues found and fixed during the run

- **mutations create step** — models legitimately allocate a temp data set with
  `createDataset` under a fetched temp prefix, not only `createTempDataset`. All
  create steps now accept either (both clean up via the temp prefix). This lifted
  `write-temp-then-read` from 4/5 → 5/5 on both models.
- **`uss-list-subdir`** — used `toolCall {tool, args}`, which only checks the *last*
  matching call; a model may list home first to discover `subdir`. Switched to
  `oneOf` (matches any call). 4/5 → 5/5.
- **`uss-write-temp-read-cleanup`** — step 1 required `getUssTempDir`, but valid
  flows start with `createTempUssDir` / `getUssTempPath`. De-rigidified to assert the
  essential write → read → cleanup lifecycle only. 1/5 → 3/5 on Qwen.

## Genuine model-capability signals (not assertion bugs)

- `qwen3.6-35b-a3b` on `uss-write-temp-read-cleanup`: ~60% (3/5). Failing reps
  either skipped the cleanup call or did not echo the written content back —
  Qwen struggles with the full multi-step USS temp lifecycle. Gemini: 100%.
- `qwen3.6-35b-a3b` on `search-in-copybook-member`: 4/5 (meets the 0.8 threshold).
  One rep read + scanned the member manually instead of calling `searchInDataset`.

## Notes / follow-ups

- Remaining #3 work: a **multi-turn** set (blocked on harness — the runner drives a
  single prompt), and further thickening of thin domains as needed.
- `minSuccessRate` left at each set's existing value; Qwen dipping below 0.8 on the
  hardest multi-step USS case is a real signal, not a threshold to relax.
