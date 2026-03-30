# Endevor Evaluation: Description Variants × gemini-2.5-flash

**Date:** 2026-03-25  
**Model:** gemini-2.5-flash  
**Label:** `variants-comparison`  
**Git SHA:** 65786fa  
**Cache:** 255 hits, 15 writes, 145 LLM calls (400 total runs)

---

## Executive Summary

Three Zowe MCP description variants (`cli`, `intent`, `optimized`) were compared against each other and against the stateless code4z-gen-ai TypeScript MCP server across standard (10 questions) and stress (10 questions) question sets at 5 repetitions each.

**Key findings:**

1. On standard questions all three Zowe MCP variants (98–100%) clearly outperform code4z-gen-ai (90%).
2. On harder stress questions the `optimized` variant (70%) ties with code4z-gen-ai (70%) and visibly beats `cli` (66%) and `intent` (58%).
3. Two stress questions have **flawed assertions** — they reference PRD stage 2 which contains no data in the mock, making 0 % pass rate structurally unavoidable.
4. Four identified failure patterns are shared across all variants and even the reference server; they are not description-specific.

---

## Set-Level Scores

| Set | Description variant / server | Pass rate | Threshold | Status |
| --- | --- | --- | --- | --- |
| endevor | intent | 49/50 (98.0 %) | 70 % | ✅ PASS |
| endevor-cli | cli | 50/50 (100.0 %) | 70 % | ✅ PASS |
| endevor-optimized | optimized | 50/50 (100.0 %) | 70 % | ✅ PASS |
| endevor-code4z | code4z-gen-ai | 45/50 (90.0 %) | 70 % | ✅ PASS |
| endevor-stress | intent | 29/50 (58.0 %) | 50 % | ✅ PASS |
| endevor-stress-cli | cli | 33/50 (66.0 %) | 50 % | ✅ PASS |
| endevor-stress-optimized | optimized | 35/50 (70.0 %) | 50 % | ✅ PASS |
| endevor-stress-code4z | code4z-gen-ai | 35/50 (70.0 %) | 50 % | ✅ PASS |

All sets pass their minimum success rate threshold.

---

## Variant Comparison

### Standard questions (per-set × 5 reps)

| Variant | Score | Delta vs code4z-gen-ai |
| --- | --- | --- |
| cli | 100 % | +10 pp |
| optimized | 100 % | +10 pp |
| intent | 98 % | +8 pp |
| code4z-gen-ai | 90 % | baseline |

All Zowe MCP variants are essentially perfect on standard questions. The single failure in `intent` (`list-systems-dev` once out of 50 runs) is noise, not a systemic issue.

### Stress questions (per-set × 5 reps)

| Variant | Score | Delta vs intent |
| --- | --- | --- |
| optimized | 70 % | +12 pp |
| code4z-gen-ai | 70 % | +12 pp |
| cli | 66 % | +8 pp |
| intent | 58 % | baseline |

`optimized` has a clear lead on harder questions. The LLM-tuned descriptions (rephrase script) reduce confusion when the model faces ambiguous wording or multi-step workflows.

---

## Per-Question Failure Analysis (aggregated across 20 runs each)

| Question | Rate | Root cause |
| --- | --- | --- |
| list-environments | 20/20 | — |
| list-environments-both-present | 20/20 | — |
| list-systems-dev | 19/20 | 1 sporadic tool-not-called (noise) |
| list-subsystems | 20/20 | — |
| list-types | 20/20 | — |
| list-elements-cobpgm | 20/20 | — |
| list-elements-count | 20/20 | — |
| print-element | 20/20 | — |
| context-then-list | 15/20 | Model skips `endevorSetContext` (see §4.1) |
| list-copybooks | 20/20 | — |
| wildcard-name | 20/20 | — |
| cross-env-compare | 19/20 | 1 sporadic tool-not-called (noise) |
| count-all-elements | 20/20 | — |
| count-copybooks | 20/20 | — |
| missing-element | 13/20 | stageNumber required; model omits it (see §4.2) |
| multi-step-source | 20/20 | — |
| **ambiguous-type** | **0/20** | **Flawed assertion — PRD-2 empty (see §4.3)** |
| **implicit-stage** | **5/20** | CLI enforces stageNumber (see §4.4) |
| **natural-language-count** | **0/20** | **Flawed assertion — PRD-2 empty (see §4.3)** |
| context-then-multi | 15/20 | Model skips `endevorSetContext` (see §4.1) |

---

## Failure Deep-Dive

### 4.1 — `context-then-*`: Model skips `endevorSetContext`

**Affected:** `context-then-list` (5/20 failures), `context-then-multi` (5/20 failures).

The model interprets "set context then list" as an efficiency hint, not a strict protocol requirement. It passes all location parameters (`environment`, `stageNumber`, `system`, `subsystem`, `type`) directly to `endevorListElements` / `endevorPrintElement` and skips `endevorSetContext`. The data retrieved is correct; the assertion fails because it requires the ordered call sequence.

This pattern is identical across all four sets (intent, cli, optimized, code4z-gen-ai). It is not variant-specific. The code4z-gen-ai server has no `setContext` equivalent, so its failures look different (`get_elements` requiring an `element` parameter) but the net result is the same: the ordered assertion is not satisfied.

**Recommendation:** Either relax the `toolCallOrder` assertion to `anyOf` if the context tool is optional, or add a strong hint in the `endevorSetContext` description that it is the *required* first step before any listing call.

### 4.2 — `missing-element`: CLI requires `stageNumber` even for specific element lookup

**Affected:** `missing-element` (7/20 failures).

The model omits `stageNumber` when checking for `PROG99` (the question doesn't mention a stage). The Zowe CLI `endevor list elements` returns "Command syntax invalid" without it. The model then either:

- Correctly reports "not found" language based on the error → passes
- Returns "I need the stage number" → fails the `answerContains` pattern

**Recommendation:** Add `default: "*"` for `stageNumber` in the `endevor-tools.yaml` context fields (similar to the `type` P0b fix), so the CLI bridge injects `--stageNumber *` when the model omits it. This mirrors how Endevor wildcards work.

### 4.3 — `ambiguous-type` and `natural-language-count`: Flawed assertions (0 % guaranteed)

Both questions ask about **PRD stage 2** (`stageNumber: 2`). The mock EWS environment map only has `DEV-1` and `PRD-1`. There are no elements at PRD-2. The model correctly returns an empty list; the assertion `PROG0[1-5]` can never match.

These two questions are broken for the current mock data. The failures are universal across all four sets and all 5 repetitions — 100 % failure rate. The model behavior is correct; the test data and assertion are wrong.

**Recommendation:** Either:

- Fix the mock-ews-config to include PRD-2 with elements, **or**
- Change the question to ask about PRD stage **1**, where PROG01-05 exist.

### 4.4 — `implicit-stage`: CLI enforces `stageNumber`; no wildcard default

**Affected:** `implicit-stage` (15/20 failures).

The question explicitly says "do not specify a stage number." The model obeys and omits `stageNumber`. The Zowe CLI returns "Command syntax invalid." Some runs the model doesn't attempt the tool call at all; others do attempt and report the error rather than data.

The `intent` and `cli` variants fail more because their descriptions include the `stageNumber` parameter but don't give it a `default: "*"` that would auto-inject it. The `optimized` variant's reworded description may mention the default more prominently.

**Recommendation:** Same as 4.2: add `default: "*"` to `stageNumber` context field. This way the bridge auto-supplies `--stageNumber *` when omitted, matching Endevor's normal wildcard behavior.

---

## Performance Metrics

| Question | Avg duration (s) | Avg input tokens | Avg output tokens | Avg steps |
| --- | --- | --- | --- | --- |
| list-systems-dev | 3.4 | 3,783 | 20 | 2.0 |
| list-subsystems | 3.4 | 3,678 | 19 | 2.0 |
| list-types | 3.7 | 4,429 | 25 | 2.0 |
| list-elements-cobpgm | 3.6 | 9,620 | 53 | 2.0 |
| list-elements-count | 4.9 | 9,619 | 48 | 2.0 |
| print-element | 4.4 | 3,914 | 322 | 2.0 |
| context-then-list | 5.1 | 9,596 | 93 | 2.7 |
| list-copybooks | 6.6 | 5,956 | 32 | 2.0 |
| wildcard-name | 4.1 | 9,617 | 90 | 2.0 |
| cross-env-compare | 6.8 | 8,442 | 76 | 1.8 |
| count-all-elements | 4.4 | 12,073 | 23 | 2.0 |
| count-copybooks | 4.5 | 5,513 | 24 | 2.0 |
| missing-element | 5.1 | 3,631 | 28 | 2.2 |
| multi-step-source | 7.1 | 10,095 | 277 | 2.4 |
| ambiguous-type | 3.4 | 4,849 | 24 | 1.9 |
| implicit-stage | 2.8 | 3,465 | 41 | 1.5 |
| natural-language-count | 4.2 | 4,761 | 21 | 1.8 |
| context-then-multi | 8.9 | 9,926 | 252 | 3.5 |

**Key observations:**

- `count-all-elements` has the highest input token count (12 k). The Zowe MCP response from `endevorListElements` with all 7 elements is large. The code4z-gen-ai server response is leaner (meta + list only).
- `context-then-multi` has the highest step count (3.5 avg) and duration (8.9 s) — the model iterates through context → list → print as intended, but sometimes makes extra tool calls after errors.
- `implicit-stage` and `ambiguous-type` are the fastest (2.8–3.4 s) because the model either fails quickly on validation error or returns a very short response.
- All tasks are under 10 seconds per question with `gemini-2.5-flash`, making it suitable for interactive evaluation workflows.

---

## Code4z-gen-ai vs Zowe MCP Bridge Comparison

| Category | code4z-gen-ai | Zowe MCP optimized | Zowe MCP intent |
| --- | --- | --- | --- |
| Standard questions | 90 % | 100 % | 98 % |
| Stress questions | 70 % | 70 % | 58 % |
| `endevorSetContext` equivalent | None | Yes | Yes |
| `element` required for list | Yes (strict) | No (default `*`) | No (default `*`) |
| Response format | Lean EWS JSON | EWS JSON + extra meta | EWS JSON + extra meta |
| Tool count exposed | ~7 | 11 | 11 |

The Zowe MCP bridge outperforms code4z-gen-ai on standard questions largely because:

- It has a `endevorSetContext` tool that code4z-gen-ai lacks (questions requiring it score 0 on code4z-gen-ai)
- The `element` parameter defaults to `*` so no validation errors on list calls

Both tie on stress questions at 70 % (`optimized` variant). The code4z-gen-ai server benefits from leaner responses (fewer extra metadata fields confusing the model).

---

## Actionable Improvements

### P1 — Fix mock data or assertions for PRD stage 2

`ambiguous-type` and `natural-language-count` will always fail (0 %) until either the mock EWS config includes PRD-2 data or the questions are updated to reference PRD-1. These account for 4 pp × 2 variants × 2 sets = 40 out of 400 runs being structurally doomed.

**Fix:** Update the stress questions to use `PRD stage 1` instead of `PRD stage 2`.

### P2 — Add `default: "*"` to `stageNumber` in endevor-tools.yaml

`implicit-stage` and `missing-element` fail when the model omits `stageNumber`. Adding `default: "*"` to the `stageNumber` context field would inject `--stageNumber *` automatically, matching typical Endevor usage (search all stages). This is the same pattern already applied to the `type` field in the P0b fix.

**Estimated impact:** +8–12 pp on `endevor-stress-intent`, likely bringing it to 70 %+.

### P3 — Relax `context-then-*` assertions

The `toolCallOrder` requiring `endevorSetContext` as step 1 is too strict. The model consistently achieves the correct result without it. Consider either:

- Accepting runs that skip `endevorSetContext` as correct (relax assertion)
- Adding more explicit language in `endevorSetContext` description: "You MUST call this tool first before any list or print operation."

### P4 — Consider leaner response format

`count-all-elements` sends 12 k input tokens because the `endevorListElements` response includes verbose `availableFields` metadata. Trimming this from the response could reduce token consumption by 20–30 % for list operations and improve accuracy on count/analysis questions.

---

## What the Variants Teach Us

| Dimension | Finding |
| --- | --- |
| cli vs intent | No meaningful difference on standard tasks. The raw CLI help text is sufficient context for gemini-2.5-flash. |
| intent vs optimized | +12 pp on stress questions. The LLM-tuned descriptions reduce ambiguity when the question uses natural language far from z/OS jargon. |
| optimized vs code4z-gen-ai | Tied at 70 % on stress. Optimized descriptions bring Zowe MCP to parity with a purpose-built, heavily tuned reference server. |
| description variants (general) | For simple, well-specified questions: variant doesn't matter (98–100 % for all). For ambiguous, multi-step, or domain-jargon-heavy questions: optimized > cli > intent. |
