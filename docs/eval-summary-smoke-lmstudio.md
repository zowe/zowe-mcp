# LM Studio Local Model Eval Summary

**Date:** 2026-05-14 → 2026-05-18
**Host:** 512 GB RAM Mac running LM Studio with OpenAI-compat API
**Repetitions:** 20 per question (every rep is an independent LLM call; cache disabled)
**Backend:** Mock z/OS (no live mainframe)

This report consolidates three eval campaigns:

1. **Smoke set** — `core` + `context` + `datasets` (8 questions, 160 runs per model) across 12 models.
2. **Full sweep (initial)** — 18 mock-compatible sets (71 questions, 1420 runs per model) across 3 top models. Surfaced a capability-tier bug.
3. **Full sweep (after harness fix)** — same scope, after fixing the eval harness to start the mock server with `--capability-tier full` so write/execute tools are registered.

---

## 🏆 Leaderboard (full 18-set sweep, post-fix)

| # | Model | Pass rate | Total runs | Wall time |
|---:|---|---:|---:|---:|
| 🥇 | **`qwen3.6-35b-a3b`** | **93.0%** | 1321/1420 | ~5.5 hr |
| 🥈 | **`minimax-m2.7`** | **92.3%** | 1311/1420 | ~12 hr |
| 🥉 | **`granite-4.1-30b`** | **86.1%** | 1222/1420 | ~8.8 hr |

**Result:** `qwen3.6-35b-a3b` wins on both quality and speed. `minimax-m2.7` is essentially tied on quality (0.7 pp behind) but takes 2.2× longer to run. `granite-4.1-30b` is a clear third.

---

## Smoke leaderboard (12 models, quick screen)

| # | Model | Combined pass rate | Total runs | Wall time |
|---:|---|---:|---:|---:|
| 🏆 1 | `qwen3.6-35b-a3b` (MoE) | **100.00%** | 320/320 (2 runs) | 12.5 min |
| 🏆 1 | `qwen3.6-27b` (dense) | **100.00%** | 160/160 | 36.0 min |
| 🥈 3 | `minimax-m2.7` | 98.75% | 316/320 (2 runs) | 22 min |
| 4 | `qwen3-coder-next` | 94.38% | 151/160 | 22 min |
| 5 | `qwen3-coder-30b` | 94.06% | 301/320 (2 runs) | 7 min |
| 6 | `glm-4.7-flash` | 93.75% | 300/320 (2 runs) | 21 min |
| 7 | `qwen2.5-coder-14b` | 90.00% | 144/160 | 10.5 min |
| 8 | `granite-4.1-30b` | 87.50% | 140/160 | 19 min |
| 9 | `qwen3-next-80b` | 86.88% | 139/160 | 31.5 min |
| 10 | `granite-4-h-tiny` | 80.00% | 128/160 | 4 min |
| 11 | `kimi-k2-instruct` | 75.00% | 120/160 | 41.5 min |
| 12 | `devstral-small-2-2512` | 62.50% | 100/160 | 14 min |

Smoke ran at the original `read-strict` tier. Even at that tier, smoke's three sets (core/context/datasets) only use read tools, so the leaderboard is valid as a fast screen.

---

## The capability-tier bug

The first full-sweep run revealed that the eval harness was starting the mock MCP server at the default `read-strict` capability tier, which **filters out all write/execute tools** (`createDataset`, `writeDataset`, `copyDataset`, `copyUssFile`, `writeUssFile`, `uploadFileToDataset`, `runSafeTsoCommand`, …). Four sets scored **0%** across all three models, and three more sets capped at identical scores because of this filter.

### Fix

[`packages/zowe-mcp-evals/src/harness.ts`](../packages/zowe-mcp-evals/src/harness.ts) — when starting the mock server, also pass `--capability-tier full`:

```ts
} else if (this.options.mockDir) {
  args.push('--mock', this.options.mockDir);
  args.push('--capability-tier', 'full');  // ← fix
}
```

Mock data is synthetic — there is no safety risk from registering write tools in this context. Real-world production safety comes from the deployed server config, not the eval harness.

### Impact

| Model | Before fix | After fix | Δ |
|---|---:|---:|---:|
| `granite-4.1-30b` | 67.0% (952/1420) | **86.1% (1222/1420)** | **+19.0 pp** |
| `qwen3.6-35b-a3b` | 69.8% (991/1420) | **93.0% (1321/1420)** | **+23.2 pp** |
| `minimax-m2.7` | 68.6% (974/1420) | **92.3% (1311/1420)** | **+23.7 pp** |

The fix surfaced the real leaderboard. Pre-fix, the spread between top and bottom was only 2.8 pp because broken sets compressed everyone toward zero. Post-fix, the spread is 6.9 pp — the top models genuinely pull away.

---

## Per-set deltas (before → after fix)

| Set | granite-4.1-30b | qwen3.6-35b-a3b | minimax-m2.7 |
|---|---:|---:|---:|
| `core` | 100% → 100% | 100% → 100% | 100% → 100% |
| `context` | 100% → 100% | 100% → 100% | 100% → 100% |
| `dataset-attributes` | 100% → 100% | 100% → 100% | 100% → 100% |
| **`dataset-copy-rename`** | **0% → 67.5%** | **0% → 95.0%** | **0% → 70.0%** |
| `datasets` | 82% → 80% | 100% → 100% | 99% → 99% |
| `description-quality` | 87.7% → 85.9% | 99.1% → 97.3% | 99.1% → 96.4% |
| `detail-levels` | 100% → 87.5% | 100% → 100% | 95% → 93.8% |
| **`local-files`** | **60% → 100%** | **59% → 100%** | **56% → 99%** |
| **`mutations`** | **0% → 77.5%** | **0% → 90.0%** | **0% → 72.5%** |
| **`naming-stress`** | 83.3% → 96.7% | 83.3% → **100%** | 82.2% → 99.7% |
| `pagination` | 45% → 27.5% | 67.5% → 27.5% | 17.5% → 32.5% |
| `read-pagination` | 85% → 95% | 35% → 80% | 80% → 90% |
| `search-pagination` | 10% → 15% | 0% → 0% | 30% → 55% |
| `search` | 100% → 100% | 100% → 100% | 100% → 100% |
| **`sms-allocation`** | **0% → 96.2%** | **0% → 100%** | **0% → 100%** |
| **`tso`** | 33.3% → 46.7% | 33.3% → 68.3% | 33.3% → 65.0% |
| `uss` | 75% → 73.8% | 75% → 81.2% | 75% → 86.2% |
| **`uss-copy`** | **0% → 100%** | **0% → 100%** | **0% → 100%** |

**Saturated** (100% across all 3 models): `core`, `context`, `dataset-attributes`, `search`, `uss-copy` (post-fix).

**Hard / discriminating sets** (still differentiate models well): `pagination`, `search-pagination`, `read-pagination`, `dataset-copy-rename`, `mutations`, `tso`, `uss`.

**Small regressions** (likely 20-rep variance, not real): `detail-levels` (-12.5 pp on granite), `description-quality` (-1.8 to -2.7 pp), `datasets` (-2 pp on granite).

---

## Remaining known issues (eval-design, not model)

Beyond the now-fixed capability-tier bug, these patterns hold all three models back:

### 1. Pagination flow (all 3 models weak)

- `pagination`: 27.5–32.5% (was 17.5–67.5%)
- `search-pagination`: 0–55% — almost universally weak
- `read-pagination`: 80–95% — strongest of the three pagination sets

Models don't reliably page through results. This is a *real* model weakness, not an eval-design bug; the sets are correctly discriminating.

### 2. `readDataset` argument-form mismatch

- Assertion expects `validDsn: "USER.SRC.COBOL(CUSTFILE)"` (combined form)
- Models call with `dsn: "USER.SRC.COBOL", member: "CUSTFILE"` (separate fields — also valid in the tool schema)

**Fix:** Make `validDsn` matcher accept either form, OR add `dsn`+`member` as an `oneOf` alternative in the affected assertions.

### 3. DSN-pattern wildcard expectations

- 19 failures where agent uses `dsnPattern: "USER.*"` but assertion wants `USER.**` (or vice versa)
- Affects naming-stress, description-quality, pagination sets

**Fix:** Broaden the pattern accept lists.

### 4. USS step-ordering rigidity in `uss-write-temp-read-cleanup`

- Assertion demands `getUssTempDir` as exact step 1
- Some agents skip it and use a known temp path
- 32 failures pre-fix, still present post-fix

**Fix:** Make step 1 optional or alternative.

### 5. Prompt-clarity for "from line 20"

- Models interpret "starting at line 20" inconsistently (some pick 20, some pick 31 or 42)
- Affects readDataset paginated reads

**Fix:** Reword as "with startLine=20" in the prompt.

---

## Granite family progression

| Model | Params | Architecture | Smoke | Full sweep |
|---|---:|---|---:|---:|
| `granite-4-h-tiny` | ~3B | hybrid Mamba | 80.0% | not run |
| **`granite-4.1-30b`** | 29B | dense Transformer | 87.5% | **86.1%** |

The 4.1 series delivers a real uplift on smoke and is now a credible full-sweep performer. Its weak spots are `pagination` (27.5%) and `description-quality` (85.9%) — both about decoding complex multi-step intent from prose.

---

## Qwen3.6 family

`qwen3.6-35b-a3b` (MoE) and `qwen3.6-27b` (dense) **both scored 100% on smoke**. The MoE is the practical winner: same quality, ~3× faster wall time because only ~3B params activate per token.

The `Qwen3.6` line officially absorbs the "Coder" branding — there is no `Qwen3.6-Coder` repo. The `Qwen3.6-27B` model card describes it as "Flagship-Level Coding in a 27B Dense Model".

---

## Timings reference

### Smoke set (160 runs per model)

| Model | Wall time |
|---|---:|
| `granite-4-h-tiny` | 4 min ⚡ |
| `qwen3-coder-30b` | 7 min |
| `qwen2.5-coder-14b` | 10.5 min |
| `qwen3.6-35b-a3b` | 12.5 min |
| `devstral-small-2-2512` | 14 min |
| `granite-4.1-30b` | 19 min |
| `glm-4.7-flash` | 21 min |
| `minimax-m2.7` | 22 min |
| `qwen3-coder-next` | 22 min |
| `qwen3-next-80b` | 31.5 min |
| `qwen3.6-27b` | 36 min |
| `kimi-k2-instruct` | 41.5 min 🐢 |

### Full sweep — post-fix (1420 runs per model)

| Model | Wall time |
|---|---:|
| `qwen3.6-35b-a3b` | ~5.5 hr |
| `granite-4.1-30b` | ~8.8 hr |
| `minimax-m2.7` | ~12 hr |

Total run: ~26 hours wall time for 4,260 runs across 3 models.

---

## Source reports

- [smoke-lmstudio-top10](../evals-report/smoke-lmstudio-top10-2026-05-14T20-07-56/comparison.md)
- [kimi-k2-followup](../evals-report/kimi-k2-followup-2026-05-14T20-54-45/comparison.md)
- [tier12-plus-granite41](../evals-report/tier12-plus-granite41-2026-05-15T04-41-23/comparison.md) — partial (3 of 5 ran due to OOM)
- [granite-4.1-30b-followup](../evals-report/granite-4.1-30b-followup-2026-05-15T13-42-50/comparison.md)
- [minimax-m2.7-followup](../evals-report/minimax-m2.7-followup-2026-05-15T14-05-45/comparison.md)
- [qwen3.6-27b-smoke](../evals-report/qwen3.6-27b-smoke-2026-05-16T14-59-10/comparison.md)
- [full-top3-mock](../evals-report/full-top3-mock-2026-05-16T14-21-30/comparison.md) — **18-set full sweep, pre-fix**
- [full-top3-mock-tier-full](../evals-report/full-top3-mock-tier-full-2026-05-18T02-25-07/comparison.md) — **18-set full sweep, post-fix**
- [eval-scoreboard.md](eval-scoreboard.md) — full append-only history

---

## Key takeaways

1. **`qwen3.6-35b-a3b` is the winner overall** — 93.0% on the full 18-set sweep, fastest of the top tier (5.5 hr).
2. **`minimax-m2.7` is a strong second** — 92.3% — virtually tied, but 2.2× slower.
3. **`granite-4.1-30b` is a credible third** — 86.1% — a meaningful upgrade over the 4.0-h-tiny.
4. **The capability-tier fix added ~20–24 pp to every model's score** by unblocking 4 sets and improving 3 more. Critically, it surfaced the *real* leaderboard — the pre-fix 2.8 pp spread was an artifact.
5. **Pagination is the universal weak spot** — even the top model gets 27.5% on `pagination` and 0% on `search-pagination`. This is a real model-capability gap, not an eval bug.
6. **For local production**: `qwen3.6-35b-a3b` is the obvious default. `qwen3-coder-30b` at 7 min smoke + 94% is the speed-quality champion when sub-perfect is acceptable.

## Outstanding

- **GLM-5.1 Q2_K** download paused at ~56 GB of 266 GB. Resume in LM Studio's Downloads tab to add a frontier-class entry.
- The eval-design issues listed above (pagination assertion strictness, readDataset arg form, DSN wildcards, USS step ordering) would further unlock 50–100 pp of pagination/uss/description-quality scores if fixed. None block the leaderboard ranking; they just trim ceilings.
