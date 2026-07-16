<!-- markdownlint-disable MD013 -->

# Zowe MCP — AI Evaluation Cost Model & Testing Strategy

Planning model for the cost of running the `zowe-mcp-evals` suite across models and
cadences (per-PR, weekly, pre-release), plus development-iteration cost. Numbers are
anchored on **real measurements** taken against `claude-sonnet-5` and `gpt-4o-mini`
in July 2026; other models are scaled from that measured unit economics using each
provider's published pricing.

> **How to read this doc.** §2 is the measured unit cost. §3 is the release model
> matrix with a per-model full-sweep price. §4 is the question-importance tiering.
> §5 turns tiers × cadence × models into per-PR / weekly / release / monthly costs.
> §6 (caching) and §7 (dev cost) are the two biggest levers. All cloud figures use
> **list** pricing unless noted; local models are ~$0 marginal.

## 1. TL;DR

- **A full mock-safe sweep (919 runs, all questions) costs about:** Claude Sonnet 5
  **~$35** (list) / **~$23** (intro), GPT-5.4 **~$30**, Gemini 3.5 Flash **~$18**,
  Claude Haiku 4.5 **~$12**, GPT-5.4-mini **~$9**, cheap tiers (nano / gpt-4o-mini /
  Gemini 2.5 Flash) **$2–5**, local models **~$0** (hardware + hours).
- **A full pre-release sweep across a representative 7-model cloud set ≈ $110–170**
  per release (drop Opus to major-releases-only to land near the low end).
- **Per-PR cost is dominated by the response cache, not the model.** A PR that does
  **not** change the tool surface should hit the cached results and cost **≈ $0**.
  Only tool-surface-changing PRs pay, and only for the affected sets. Sharing that
  cache across CI is the single biggest lever (§6).
- **Prompt caching already cuts in-sweep cost ~6.2×** (measured). It's implemented
  for Anthropic and automatic for OpenAI/Gemini.
- **Rough monthly cloud budget** (≈20 PRs, 4 weekly runs, 1 release, some dev
  iteration): **~$150–550/month** depending almost entirely on cache-sharing,
  release cadence, and how many frontier models are in the release set.

## 2. Measured unit economics (the cost basis)

Everything below scales from one measured quantity: **the per-run token profile** of
the agentic eval loop against the mock backend at the `full` capability tier.

Measured on `claude-sonnet-5` (real API, this session):

| Quantity | Per run | Notes |
|---|---|---|
| Cached prefix (tools + system) | ~27,000 tokens | Identical across every `full`-tier question — written to cache once per sweep, read thereafter |
| Agent steps | ~2.5 | Tool call(s) + final answer |
| **Cache-read tokens** | **~68,000** | prefix × steps; dominates the token count |
| **Uncached input tokens** | **~3,200** | The growing conversation (prompt + tool results) |
| **Output tokens** | **~520** | |
| Cache-write tokens | ~fixed ~43K **per sweep** | All `full`-tier sets share one prefix → written **once**, not per run |

**Cost per run** = `cacheRead × inputPrice × cacheReadMult + uncachedIn × inputPrice + output × outputPrice`.

For Sonnet 5 (list $3 / $15 per Mtok, cache-read 0.1×):
`68000×$3×0.1 + 3200×$3 + 520×$15` (÷1e6) = **$0.0378/run** → ×919 = **~$35**.

This reproduces the measured full-dataset estimate (**~$36 list / ~$24 intro**) and the
measured subset spend, so the unit model is trustworthy to roughly **±30%** (the
uncertainty is in per-question variation and step counts, not the cache math, which
validated to ~1%).

**Caching is worth ~6.2×.** Without prompt caching the same subset cost **$149 vs $24**
(measured) — because the ~27K prefix would be re-billed at full input price on every one
of the ~2,300 agent steps instead of at 0.1×.

**Dataset size (mock-safe, no live z/OS):** **156 questions / 919 runs** across 26 sets
(reps: 5 default, 10 for the two stress sets, 3 for `semantic-quality`). Native sets
(`jobs`, `restore-dataset`, `console`, `db2`) are excluded — they need a live z/OS and
are an integration-test cost, not an API cost.

## 3. Release model matrix

The models a release should be validated against — the channels enterprises actually
reach Zowe MCP through (Claude via Copilot/Claude Code/Bedrock, GPT via Copilot/Azure,
Gemini via Vertex, plus air-gapped local). Full-sweep price = 919 runs × the per-run
formula in §2, list pricing, **with** provider caching.

| Model | Provider | Role | Input $/M | Output $/M | Cache-read $/M | Full sweep (919) |
|---|---|---|---|---|---|---|
| **Claude Sonnet 5** | Anthropic | Primary frontier | 3.00 | 15.00 | 0.30 | **~$35** ($23 intro) |
| Claude Opus 4.8 | Anthropic | High-capability ceiling | 5.00 | 25.00 | 0.50 | ~$58 |
| Claude Haiku 4.5 | Anthropic | Cheap / CI gate | 1.00 | 5.00 | 0.10 | ~$12 |
| **GPT-5.4** | OpenAI | Primary frontier (GPT) | 2.50 | 15.00 | 0.25 | ~$30 |
| GPT-5.4-mini | OpenAI | Mid GPT | 0.75 | 4.50 | 0.075 | ~$9 |
| GPT-5.4-nano | OpenAI | Cheap / CI gate | 0.20 | 1.25 | 0.02 | ~$2.4 |
| gpt-4o-mini | OpenAI | Legacy cheap (0.5× cache) | 0.15 | 0.60 | 0.075 | ~$5.4 |
| **Gemini 3.5 Flash** | Google | Primary frontier (Gemini) | 1.50 | 9.00 | 0.15 | ~$18 |
| Gemini 2.5 Flash | Google | Cheap / CI gate | 0.30 | 2.50 | 0.03 | ~$4 |
| Gemini 2.5 Pro | Google | High Gemini | 1.25 | 10.00 | 0.125 | ~$16 |
| Gemini 3.1 Pro | Google | High Gemini (newer) | 2.00 | 12.00 | 0.20 | ~$24 |
| Qwen3.6-35B-A3B | local (LM Studio) | On-prem anchor (best local, 98%) | — | — | — | **~$0** (5–12 h) |
| IBM Granite 4.1-30B | local (LM Studio) | Mainframe-vendor relevance | — | — | — | **~$0** |

Notes and caveats:

- **Intro pricing:** Sonnet 5 is $2/$10 (≈⅔ of list) through **2026-08-31**; plan on
  list for anything after that.
- **Gemini caching is an estimate.** Gemini 2.5+ has automatic *implicit* context
  caching (like OpenAI's), so the cache-read column should apply in a contiguous sweep —
  but this is **not yet measured** in our harness. If implicit caching does **not**
  trigger, Gemini 3.5 Flash rises from ~$18 to **~$100** (the $1.50 input is re-billed on
  every step). Verify with a real Gemini sweep before relying on the low figure.
- **Local models are ~$0 marginal** but cost **wall-clock** (a full sweep ran 5.5–12 h on
  a Mac) and have a **32K-context limit** that overflows the pagination sets (`400 —
  context size exceeded`) — needs a ≥14–32B model with an adequate context window.
- **A representative release cloud set** (Sonnet 5 + Opus 4.8 + Haiku 4.5 + GPT-5.4 +
  GPT-5.4-mini + Gemini 3.5 Flash + Gemini 2.5 Flash) ≈ **$166/sweep** (list). Dropping
  Opus to major-releases-only ≈ **$108**.

## 4. Question importance tiers

Split the 26 mock-safe sets by **functional importance** (what a regression would cost),
cross-referenced with **how problematic** each area is for weaker models (from the
4-model sweep: gemini-3.5-flash 98.6%, qwen3.6-35b-a3b 98.0%, gemma-4-26b-a4b 93.3%,
granite-4.1-30b 90.9% — see `docs/eval-summary-4model-2026-07-04.md`).

| Tier | Intent | Sets | Questions | Runs |
|---|---|---|---|---|
| **HIGH** | Must-not-regress: safety, destructive-op correctness, injection, core data ops | `safety`, `prompt-injection`, `prompt-injection-read-tier`, `mutations`, `datasets`, `dataset-copy-rename`, `core` | 32 | **190** |
| **MEDIUM** | Important functionality, recoverable if wrong | `search`, `uss`, `uss-copy`, `tso`, `pagination-count`, `pagination-iterate`, `error-recovery`, `natural-language`, `multi-turn`, `sms-allocation`, `local-files`, `context`, `dataset-attributes`, `detail-levels` | 65 | **350** |
| **LOW** | Robustness / quality tuning; high rep-count, lower per-item stakes | `naming-stress`, `description-quality`, `semantic-quality`, `host-profile-claude-code`, `host-profile-copilot` | 48 | **379** |
| | | | **145** | **919** |

**Problematic areas (highest failure density, from the sweep)** — these are the
"canary" questions that catch model regressions and belong in the per-PR subset
regardless of tier:

- **Pagination** (`pagination-count`, `pagination-iterate`) — weak models can't aggregate
  a count or won't make the required repeat calls; also the local-model 32K-context
  overflow point.
- **`datasets`** — gemma 35/40, granite 33/40.
- **Prompt-injection ingestion** (`prompt-injection*`) — weak models sometimes never read
  the poisoned payload (assertion now hardened to the whole destructive-tool set).
- **USS destructive leaks** (`uss`) — e.g. granite leaked `deleteDataset` ×7 on one case.

> This tiering is a **proposed starting point**. Refine it from a real per-question
> pass-rate matrix once the release models have each done a full sweep — promote any
> question that a shipping model fails into the PR "canary" set.

## 5. Cadence-based cost scenarios

Run scope per cadence (the user's model): **PR = HIGH + problematic canaries**,
**weekly = HIGH + MEDIUM**, **pre-release = ALL**.

Assumed subset sizes:

- **PR subset:** HIGH (190) + ~10 problematic canary questions (~50 runs) = **~240 runs**.
- **Weekly subset:** HIGH + MEDIUM = **540 runs**.
- **Pre-release:** ALL = **919 runs**.

### Per-PR (expect ~1/day)

Run on 1–2 **cheap** CI models (a frontier model is not needed to catch a regression a
cheap model also catches). Per-run costs from §3.

| CI model | $/run | 240-run PR (uncached) |
|---|---|---|
| GPT-5.4-nano | $0.0027 | **~$0.64** |
| Claude Haiku 4.5 | $0.0126 | ~$3.02 |
| Gemini 2.5 Flash | $0.0043 | ~$1.03 |
| Local (Qwen/Granite) | $0 | ~$0 (minutes) |

**But most PRs cost ≈ $0** because of the response cache (§6): a PR that doesn't change
the tool surface reuses cached results. If ~1 in 5 PRs touches the tool surface, the
**effective** per-PR average on nano+Haiku is **~$0.7**, i.e. **~$15/month** for ~20 PRs.

### Weekly (HIGH + MEDIUM, 540 runs)

Run on 2–3 representative models spanning providers:

| Model | 540-run weekly |
|---|---|
| Claude Sonnet 5 | ~$20.4 |
| GPT-5.4-mini | ~$5.3 |
| Gemini 2.5 Flash | ~$2.3 |
| **Sum (3 models)** | **~$28/week** |

≈ **$120/month** uncached; with the response cache warm week-to-week (tool surface
usually stable), realistically **~$40–60/month**.

### Pre-release (ALL 919, full release set)

One full sweep across the release cloud set ≈ **$110–170** (§3). Plus local models
(~$0, run overnight). At a monthly release cadence that's **~$110–170/month**.

### Monthly rollup (illustrative)

| Activity | Assumption | Uncached | With shared cache |
|---|---|---|---|
| Per-PR (daily) | ~20 PRs, nano+Haiku, HIGH+canaries | ~$73 | **~$15** |
| Weekly | 4 runs, 3 mid models, HIGH+MEDIUM | ~$112 | **~$45** |
| Pre-release | 1 release, 7 cloud models, ALL | ~$166 | ~$166 (cache helps little across models) |
| Development | a few heavy changes (§7) | ~$30–120 | ~$15–60 |
| **Total (cloud)** | | **~$380–470** | **~$240–290** |

Local models add ~$0 marginal (hardware + operator wall-clock). The realistic target
with cache-sharing + cheap CI tiers + local dev iteration is **~$150–300/month**.

## 6. Caching strategy (the biggest lever)

There are **two independent caches**; they compound.

### 6a. Response cache (`.evals-cache`) — kills per-PR cost

The harness caches **passing** runs keyed on `(systemPrompt, prompt, toolDefs, modelId)`.
A run is served from cache (zero API cost) unless one of those changed. Tool
definitions are part of the key, so **any change to a tool's name/description/schema
invalidates only the sets that use that tool** — not the whole suite.

**Recommendation — share this cache across CI.** Today it's local (`.evals-cache`).
Persist it so PR runs reuse prior results:

- Store keyed by a **tool-surface hash + model id** (e.g. GitHub Actions cache, or an
  object-store bucket the CI job restores/saves).
- A PR that changes no tool definitions → **~100% cache hit → ~$0** eval cost.
- A PR that changes one tool → only that tool's sets re-run.
- Warm the shared cache from the nightly/weekly and pre-release sweeps so PRs ride on
  already-computed results.

This is what turns "an eval per PR per day" from a real bill into a rounding error for
the ~80% of PRs that don't touch the tool surface.

### 6b. Provider prompt cache — kills in-sweep cost (~6.2×)

The ~27K tool+system prefix is cached provider-side within a sweep:

- **Anthropic:** implemented (`cache_control: ephemeral`, 5-minute TTL). All `full`-tier
  sets share one prefix, so it's **written once per sweep** and read at 0.1× thereafter.
- **OpenAI:** automatic server-side (measured — 94K cache-read tokens on a 5-question
  gpt-4o-mini run).
- **Gemini:** automatic implicit caching on 2.5+ (assumed; verify).

Operational note: the Anthropic cache TTL is **5 minutes**, so keep each model's sweep
**contiguous** (don't interleave long gaps) to stay on cache reads.

## 7. Development-iteration cost

Heavy changes (e.g. reworking a tool's schema or the server instructions) invalidate the
affected sets in the response cache and typically need **several eval iterations** to
converge — even with the response cache, because the changed sets must re-run each round.

| Path | Per iteration (affected ≈ HIGH+MEDIUM, 540 runs) | 4-iteration heavy change |
|---|---|---|
| **Local** (good hardware) | ~$0 (minutes–hours wall-clock) | **~$0** |
| Cloud mid (GPT-5.4-mini) | ~$5.3 | ~$21 |
| Cloud frontier (Sonnet 5) | ~$20 | ~$82 |

Guidance:

- **Iterate locally** (Qwen3.6-35B-A3B is the best local at 98%, or Granite for
  mainframe-vendor relevance) when the developer has the hardware — marginal cost ~$0.
- **Use a cheap cloud model** (nano / Gemini 2.5 Flash / Haiku) for developers without
  local hardware, and for a provider-diversity sanity check.
- **Reserve frontier-model iteration** for the final confirmation round, not every loop.
- The response cache means an iteration only pays for the **sets actually affected** by
  the change — scope the `--set` flag to those to keep iterations cheap.

## 8. Recommendations (summary)

1. **Tier the models:** cheap for PRs (nano/Haiku/Gemini Flash/local), a mid spread for
   weekly, the full release set only pre-release. Don't run frontier models per PR.
2. **Tier the questions** (§4) and keep a **problematic-canary** set in every PR run.
3. **Share the response cache across CI** (§6a) — the biggest single cost reduction;
   makes tool-surface-neutral PRs ~free.
4. **Keep provider prompt caching on** and each model's sweep contiguous (§6b).
5. **Iterate development locally** where possible; scope re-runs to affected sets (§7).
6. **Right-size stress-set reps.** `naming-stress` (180 runs) and `description-quality`
   (110 runs) are 32% of every full sweep at reps=10; dropping them to 5 removes ~145
   runs (~16% of the suite) and a proportional slice of every release sweep.
7. **Re-measure to firm up estimates:** a real Gemini sweep (to confirm implicit
   caching) and a per-question pass-rate matrix across the release models (to finalize
   the canary set). These are the two open unknowns in this model.

## Assumptions & sources

- Unit economics: measured against `claude-sonnet-5` and `gpt-4o-mini`, July 2026
  (this session). Cache math validated to ~1%; full-suite extrapolation ~±30%.
- Pricing: Anthropic (`claude-api` reference, cached 2026-06-24), OpenAI
  (`developers.openai.com/api/docs/pricing`), Google
  (`ai.google.dev/gemini-api/docs/pricing`) — all list/standard tier, July 2026.
- Difficulty data: `docs/eval-summary-4model-2026-07-04.md`.
- Dataset: 156 questions / 919 mock-safe runs (native/integration sets excluded).
- All cloud figures **list** price unless "intro" noted; local ~$0 marginal + wall-clock.
