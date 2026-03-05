# Eval Model Comparison

Three-way comparison of LLM performance on the Zowe MCP tool-use eval suite.

## Metadata

| Field | Value |
| ----- | ----- |
| Date | 2026-03-05 |
| Zowe MCP Server | 0.6.0-dev |
| Git SHA | 9ddfe9e |
| Backend | Mock (filesystem) |
| Eval sets | 18 (19 total; `console` skipped — ZNP does not yet support `console.issueCmd`) |
| Total questions | 67 |
| Total runs per model | 379 (questions x repetitions) |
| Eval harness | `npm run eval-compare -- --set all --model <id>` |

### Models

| ID | Provider | Server Model | Type | Hosting |
| -- | -------- | ------------ | ---- | ------- |
| qwen3 | vLLM | Qwen3-30B-A3B-Thinking-2507-FP8 | Thinking (30B, MoE 3B active) | Self-hosted (vLLM on internal GPU) |
| gemini-2.5-flash | Gemini API | gemini-2.5-flash | Thinking | Google Cloud |
| gemini-3-flash | Gemini API | gemini-3-flash-preview | Thinking | Google Cloud |

### Eval Sets

| Set | Questions | Reps | Total Runs | Mock Preset | Category |
| --- | --------- | ---- | ---------- | ----------- | -------- |
| context | 2 | 2 | 4 | default | Context management |
| core | 1 | 2 | 2 | default | Server info |
| dataset-attributes | 1 | 2 | 2 | default | Dataset metadata |
| dataset-copy-rename | 2 | 2 | 4 | default | Dataset mutation |
| datasets | 5 | 2 | 10 | default | Dataset CRUD |
| description-quality | 11 | 10 | 110 | pagination | Tool description stress |
| jobs | 4 | 1 | 4 | native | Job operations |
| mutations | 2 | 5 | 10 | minimal | Write/delete flows |
| naming-stress | 18 | 10 | 180 | default | z/OS jargon & CLI phrasing |
| pagination | 2 | 2 | 4 | pagination | List pagination |
| read-pagination | 1 | 2 | 2 | pagination | Read line windowing |
| restore-dataset | 1 | 1 | 1 | native | HSM recall |
| search-pagination | 1 | 2 | 2 | pagination | Search result paging |
| search | 2 | 2 | 4 | default | Dataset search |
| sms-allocation | 4 | 5 | 20 | default | SMS parameter mapping |
| tso | 3 | 2 | 6 | default | TSO commands |
| uss-copy | 3 | 2 | 6 | default | USS file copy |
| uss | 4 | 2 | 8 | default | USS file operations |

Note: `jobs` and `restore-dataset` are native-only sets. When run in mock mode, the mock
backend returns canned output for `restore-dataset` (no-op) and throws "Not implemented"
for job operations. Results for these sets reflect mock behavior, not real z/OS.

## Results

### Overall

| Model | Pass Rate | Passed | Failed | Total |
| ----- | --------- | ------ | ------ | ----- |
| **Qwen3 30B** | **97.1%** | 368 | 11 | 379 |
| Gemini 3 Flash | 95.3% | 361 | 18 | 379 |
| Gemini 2.5 Flash | 85.0% | 322 | 57 | 379 |

### Per-Set Breakdown

| Set | Qwen3 30B | Gemini 3 Flash | Gemini 2.5 Flash | Best |
| --- | --------- | -------------- | ---------------- | ---- |
| context | **100.0%** (4/4) | **100.0%** (4/4) | 50.0% (2/4) | Qwen3 / G3 |
| core | **100.0%** (2/2) | **100.0%** (2/2) | 0.0% (0/2) | Qwen3 / G3 |
| dataset-attributes | **100.0%** (2/2) | **100.0%** (2/2) | 0.0% (0/2) | Qwen3 / G3 |
| dataset-copy-rename | **100.0%** (4/4) | 75.0% (3/4) | **100.0%** (4/4) | Qwen3 / G2.5 |
| datasets | **100.0%** (10/10) | **100.0%** (10/10) | 0.0% (0/10) | Qwen3 / G3 |
| description-quality | 92.7% (102/110) | **94.5%** (104/110) | 87.3% (96/110) | G3 |
| jobs | **100.0%** (4/4) | **100.0%** (4/4) | 75.0% (3/4) | Qwen3 / G3 |
| mutations | **100.0%** (10/10) | **100.0%** (10/10) | 70.0% (7/10) | Qwen3 / G3 |
| naming-stress | **100.0%** (180/180) | 97.8% (176/180) | 92.2% (166/180) | Qwen3 |
| pagination | **100.0%** (4/4) | 25.0% (1/4) | 50.0% (2/4) | Qwen3 |
| read-pagination | **100.0%** (2/2) | **100.0%** (2/2) | 50.0% (1/2) | Qwen3 / G3 |
| restore-dataset | **100.0%** (1/1) | **100.0%** (1/1) | **100.0%** (1/1) | All |
| search-pagination | **100.0%** (2/2) | **100.0%** (2/2) | 50.0% (1/2) | Qwen3 / G3 |
| search | **75.0%** (3/4) | 50.0% (2/4) | 50.0% (2/4) | Qwen3 |
| sms-allocation | **100.0%** (20/20) | **100.0%** (20/20) | **100.0%** (20/20) | All |
| tso | 83.3% (5/6) | 83.3% (5/6) | 66.7% (4/6) | Qwen3 / G3 |
| uss-copy | **100.0%** (6/6) | **100.0%** (6/6) | **100.0%** (6/6) | All |
| uss | 87.5% (7/8) | 87.5% (7/8) | 87.5% (7/8) | All |

### Category Summary

| Category | Qwen3 30B | Gemini 3 Flash | Gemini 2.5 Flash |
| -------- | --------- | -------------- | ---------------- |
| Core & context (core, context) | 100.0% | 100.0% | 33.3% |
| Dataset CRUD (datasets, dataset-attributes, dataset-copy-rename) | 100.0% | 93.8% | 25.0% |
| Dataset mutations (mutations) | 100.0% | 100.0% | 70.0% |
| Search (search, search-pagination) | 83.3% | 66.7% | 50.0% |
| Pagination (pagination, read-pagination) | 100.0% | 50.0% | 50.0% |
| Naming & jargon (naming-stress, sms-allocation) | 100.0% | 98.0% | 93.0% |
| Description quality | 92.7% | 94.5% | 87.3% |
| TSO & jobs (tso, jobs) | 90.0% | 90.0% | 70.0% |
| USS (uss, uss-copy) | 92.9% | 92.9% | 92.9% |

## Analysis

### Qwen3 30B — Best Overall (97.1%)

Qwen3 is the most reliable model for Zowe MCP tool use. It achieves perfect scores on
13 of 18 sets and is the only model to score 100% on **pagination** — a notoriously
difficult category that requires the agent to make multiple sequential tool calls with
correct offset/limit parameters across pages. Its thinking/reasoning capability helps
it follow multi-step workflows precisely.

**Strengths**: Pagination (100%), naming-stress (100%), search (75% — best of all three),
multi-step mutation workflows (100%).

**Weaknesses**: description-quality (92.7% — slightly behind Gemini 3 Flash), tso (83.3%),
uss write-temp-read-cleanup (1/2 fail).

### Gemini 3 Flash — Strong Runner-Up (95.3%)

A major upgrade over Gemini 2.5 Flash. Gemini 3 Flash matches Qwen3 on most sets and
leads on **description-quality** (94.5%), showing the best understanding of search options,
parameter combinations, and edge cases like `ignoreSequenceNumbers` vs `cobol` mode.

**Strengths**: description-quality (94.5% — best), naming-stress (97.8%), mutations (100%),
fast inference speed (~3x faster than Qwen3).

**Weaknesses**: pagination (25% — worst of all three), search (50%), dataset-copy-rename
(75%).

### Gemini 2.5 Flash — Baseline (85.0%)

The oldest model in the comparison. It struggles with basic tool discovery (core 0%,
datasets 0%, dataset-attributes 0%) and multi-step workflows (mutations 70%, pagination
50%). Still solid on SMS allocation (100%) and USS copy (100%).

**Strengths**: sms-allocation (100%), dataset-copy-rename (100%), uss-copy (100%).

**Weaknesses**: Core tool discovery (0% on core, datasets, dataset-attributes), pagination
(50%), mutations (70%).

### Shared Weaknesses

All three models share the same failure on **uss/uss-write-temp-read-cleanup** (87.5% —
1 of 2 reps fails for each). This multi-step workflow (get home → create temp dir → get
temp path → write file → read file → delete temp dir) requires precise tool sequencing
that occasionally trips up every model.

The **search** set remains the hardest (50–75%), likely because the agent must infer the
correct `dsn` and `string` parameters from natural language without explicit guidance.

### Speed vs Accuracy Trade-off

Qwen3 30B (self-hosted vLLM) is approximately 3x slower per question than Gemini Flash
models (Google Cloud API). The full eval suite took ~2.5 hours for Qwen3 vs ~33 minutes
for Gemini 2.5 Flash and ~58 minutes for Gemini 3 Flash. For CI/CD eval pipelines where
speed matters, Gemini 3 Flash offers 95.3% accuracy at 3x the throughput.
