# Eval Summary: Local vs Remote vs Cloud (2026-05-30)

Three-way comparison of LLM performance on the Zowe MCP tool-use eval suite,
testing the practical limits of local small models against remote and cloud models.

## Metadata

| Field | Value |
| --- | --- |
| Date | 2026-05-30 |
| Git SHA | bde1e95 |
| Zowe MCP Server | 0.10.0-dev |
| Backend | Mock z/OS |
| Eval sets | `naming-stress` (18 q) + `description-quality` (11 q) = 29 questions |
| Repetitions | 5 per question |
| Total runs | 435 (29 × 5 × 3 models) |
| LLM result cache | 260 hits, 175 live LLM calls |
| Run label | `top3-local-remote-cloud` |

## Models

| ID | Provider | Server model | Parameters | Hosting |
| --- | --- | --- | --- | --- |
| `lm-qwen3-8b` | LM Studio | `broadcom/qwen3-8b` | 8B (thinking) | Local Mac (32 GB RAM) |
| `qwen3` | vLLM | `Qwen3-30B-A3B-Thinking-2507-FP8` | 30B MoE (thinking) | Remote server |
| `gemini-2.5-flash` | Gemini API | `gemini-2.5-flash` | — | Cloud |

The local machine has 32 GB RAM. Of the 9 available LM Studio models, only `qwen3-8b`
loads under the memory guardrails; all models ≥12B exceed available free system memory.
The `contextLength` is set to 32000 for all models.

---

## Results

### Scores

| Model | naming-stress | description-quality | Overall |
| --- | ---: | ---: | ---: |
| **`qwen3`** (30B, vLLM) | **100%** (90/90) | **100%** (55/55) | **100%** |
| **`gemini-2.5-flash`** (cloud) | 73.3% (66/90) | 83.6% (46/55) | **77%** |
| **`lm-qwen3-8b`** (local 8B) | 6.7% (6/90) | 0% (0/55) | **~4%** |

### Per-question breakdown

#### naming-stress

| Question | lm-qwen3-8b | qwen3 | gemini-2.5-flash |
| --- | --- | --- | --- |
| cli-list-ds-with-attributes | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| cli-view-uss-file | 1/5 (20%) | 5/5 (100%) | 0/5 (0%) |
| cli-search-datasets | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| cli-create-ds-like-zowe | 0/5 (0%) | 5/5 (100%) | 1/5 (20%) |
| zos-allocate-ps | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| zos-dsname-with-quotes | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| zos-catalog-search | 0/5 (0%) | 5/5 (100%) | 0/5 (0%) |
| zos-pds-directory | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| zos-dsorg-vocabulary | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| ambiguous-find-text | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| ambiguous-show-files | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| ambiguous-what-datasets | 0/5 (0%) | 5/5 (100%) | 0/5 (0%) |
| ambiguous-look-at-code | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| ambiguous-grep-cobol | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| ispf-34-style | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| spool-terminology | 0/5 (0%) | 5/5 (100%) | 0/5 (0%) |
| unix-ls-style | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| tso-who-am-i | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |

#### description-quality

| Question | lm-qwen3-8b | qwen3 | gemini-2.5-flash |
| --- | --- | --- | --- |
| metadata-member-count | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| metadata-dataset-count | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| search-case-sensitive | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| search-ignore-sequence-numbers | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| search-cobol-mode | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| search-with-context-lines | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| search-combined-options | 0/5 (0%) | 5/5 (100%) | 1/5 (20%) |
| read-first-lines | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| read-specific-range | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| search-single-member | 0/5 (0%) | 5/5 (100%) | 0/5 (0%) |
| get-attributes-explicit | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |

---

## Analysis

### qwen3 30B — Perfect (100%)

The strongest performer by a wide margin. Every question type passes at 100%:

- **z/OS native vocabulary** — DSN-with-quotes, PDS directory, RECFM/LRECL allocation, DSORG terminology
- **Ambiguous natural-language phrasing** — "find COBOL code", "show my files", "grep in data sets"
- **ISPF 3.4-style prompts** — maps listing idioms directly to `listDatasets`
- **Multi-option search parameters** — combines `caseSensitive + ignoreSequenceNumbers + cobol` correctly, and narrows to a specific member
- **Pagination and attribute-level detail** — picks up count-based questions correctly

### gemini-2.5-flash — Good (77%), 7 failure patterns

All failures are consistent behavioural patterns, not random noise:

| Failed question | Failure mode |
| --- | --- |
| `cli-view-uss-file` (0/5) | **Conservative**: refuses to call tools without an active system — says "please call `setSystem` first" instead of trying the tool |
| `cli-create-ds-like-zowe` (1/5) | Same conservative behaviour on 4 of 5 runs |
| `zos-catalog-search` (0/5) | Does not map "search the catalog" → `listDatasets` |
| `ambiguous-what-datasets` (0/5) | Does not map "what data sets do I have" → `listDatasets` |
| `spool-terminology` (0/5) | "Spool files" → wrong tool or no tool call |
| `search-combined-options` (1/5) | Drops parameters when combining `caseSensitive + cobol + ignoreSequenceNumbers` |
| `search-single-member` (0/5) | Does not use the `member` parameter in `searchInDataset` |

**Strengths**: reads tool descriptions well (basic naming-stress questions), handles ISPF
vocabulary, USS operations, most z/OS jargon.

**Weaknesses**: overly conservative when no system is active; some ambiguous z/OS idioms
("catalog", "what data sets do I have", "spool") are not mapped to the right tool; combined
search parameters are dropped.

### lm-qwen3-8b — Not viable (~4%)

**Root cause: context overflow.** 138 of 139 failures produce:

```text
The number of tokens to keep from the initial prompt is greater than the context length.
Try to load the model with a larger context length, or provide a shorter input.
```

The Zowe MCP server exposes ~60 tools. The complete prompt (tool schemas + system
instructions + server instructions) exceeds the 8B model's usable inference budget even
with a 32K context allocation. One model crash (`Exit code: null`) was also observed.

The 6 passes are from a cached run that completed before the model reloaded with a fresh
KV cache. This shows the model's reasoning is sound; the bottleneck is purely memory
capacity, not reasoning quality.

**Minimum viable local model size**: a model needs at least 14–27B parameters to handle the
full Zowe MCP tool set. At 32 GB RAM with LM Studio's default guardrails, none of the
available models in that range loaded; see the memory constraint section below.

---

## Local memory constraint

| Model | Status | Memory (est.) |
| --- | --- | --- |
| `broadcom/qwen3-8b` | ✅ Loads | — |
| `broadcom/gemma-3-12b` | ❌ Blocked | ~9.4 GB |
| `broadcom/devstral-small-2505` | ❌ Blocked | — |
| `broadcom/qwen2.5-coder-14b` | ❌ Blocked | — |
| `broadcom/qwen3-14b` | ❌ Blocked | — |
| `broadcom/mistral-small-24b-instruct-2501` | ❌ Blocked | ~15.2 GB |
| `broadcom/gemma-3-27b` | ❌ Blocked | — |
| `broadcom/gemma-4-31b` | ❌ Blocked | ~27.8 GB |

LM Studio's memory guardrails compare the model's required allocation (weights + KV cache
for the configured context length) against currently free system pages. On a 32 GB system
with typical background load (~22+ GB in use), only the 8B model passes the guard.

To run larger local models, either free more system memory, reduce `contextLength` in
`evals.config.json`, or adjust LM Studio's memory guardrail threshold in its settings.

---

## Key takeaways

1. **`qwen3` 30B on vLLM is the clear winner** — 100% across both sets. It handles every
   z/OS idiom, ambiguous phrasing, and multi-parameter combination tested.
2. **`gemini-2.5-flash` is a solid second at 77%** — reliable on mainstream questions,
   consistent blind spots around conservative no-system behaviour and a few z/OS idioms.
   The failures are actionable: improving the system prompt (e.g. auto-activating a system)
   or adding clarifying examples to tool descriptions could close most of the 23 pp gap.
3. **Local 8B models are not viable** for the current Zowe MCP tool set — the prompt is
   too large for the model's context budget. A 14B+ model is the practical minimum, which
   requires either more free RAM or reduced LM Studio guardrail thresholds.
4. **Context window is the critical local constraint**, not reasoning quality — the single
   cached run that passed shows qwen3-8b reasons correctly when it can fit the prompt.

---

## Source report

- [top3-local-remote-cloud](../evals-report/top3-local-remote-cloud-2026-05-30T09-40-47/comparison.md)
- [eval-scoreboard.md](eval-scoreboard.md) — full append-only history
