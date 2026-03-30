# Endevor Eval: qwen3-gemini-comparison

Multi-model, multi-server evaluation comparing **Qwen3-30B-A3B-Thinking** and **Gemini 2.5 Flash** on both
the Zowe CLI Bridge MCP server and the code4z-gen-ai TypeScript MCP server, using standard and stress
question sets.

## Run Setup

| Parameter | Value |
| --- | --- |
| Label | `qwen3-gemini-comparison` |
| Date | 2026-03-25 |
| Description variant | **`intent`** (intent-based, LLM-optimized rewrites) |
| Repetitions | 5 per question |
| Question sets | `endevor`, `endevor-code4z`, `endevor-stress`, `endevor-stress-code4z` |
| Total planned runs | 800 (160 questions × 5 reps × 4 models) |
| **Completed** | ~590 runs — qwen3 (all 4 sets), gemini-2.5-flash (3.8 of 4 sets) |
| Not reached | `gemini-3-flash`, `lmstudio-local` (Gemini API hung after ~350 gemini runs) |

### Models

| ID | Provider | Model |
| --- | --- | --- |
| `qwen3` | vLLM (`http://10.252.99.38:80/v1`) | Qwen3-30B-A3B-Thinking-2507-FP8 |
| `gemini-2.5-flash` | Gemini API | gemini-2.5-flash |
| `gemini-3-flash` | Gemini API | gemini-3-flash-preview *(not reached)* |
| `lmstudio-local` | LM Studio (`localhost:1234`) | broadcom/gemma-3-12b *(not reached)* |

### Description Variant: `intent`

The `intent` variant is a hand-written, intent-centric rewrite of each tool description. Examples:

- `endevorListElements`: *"Lists elements in the Endevor inventory matching the given location
  (environment, stageNumber, system, subsystem, type). All location parameters default to the active
  context set by endevorSetContext. Use wildcard \* to match all values for a location level."*
- `endevorListEnvironments`: *"Lists all available Endevor environments. Use this to discover the
  environments configured in the Endevor instance (e.g. DEV, PRD) before working with elements."*

Compare with `cli` (verbatim CLI help text) and `optimized` (Cursor-generated Gemini-focused variant).
This is the first multi-model eval with `intent` descriptions — previous runs used `intent` on gemini only.

### Mock Data

- EWS mock server (code4z-gen-ai `mock_ews_server`), port 8080
- Datasource `ENDEVOR`, two environments: **DEV** (stage 1) and **PRD** (stage 2)
- System: SYS1 → Subsystem: SUB1
- Types: `COBPGM` (5 elements: PROG01–PROG05), `COPYBOOK` (2 elements: CPYBK01, CPYBK02)

---

## Set-Level Results

| Model | endevor (standard) | endevor-code4z | endevor-stress | endevor-stress-code4z |
| --- | --- | --- | --- | --- |
| **qwen3** | 46/50 (92%) | 45/50 (90%) | 33/50 (66%) | 32/50 (64%) |
| **gemini-2.5-flash** | 50/50 (100%) ✓ | 45/50 (90%) | 26/50 (52%) | ~31/50 (incomplete)* |

\* gemini-2.5-flash stress-code4z: 8 of 10 questions completed (40 of 50 reps); last 2 questions
(`natural-language-count`, `context-then-multi`) were cut short by the API hang.

**Key observation**: standard questions show near-parity (90–100%) across models and servers. The stress
questions expose a 14–38 point gap and reveal specific failure modes.

---

## Per-Question Breakdown

### Standard Questions

| Question | Prompt summary | qwen3/zowe | qwen3/code4z | gemini/zowe | gemini/code4z |
| --- | --- | --- | --- | --- | --- |
| list-environments | List all Endevor environments | 3/5 (60%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| list-environments-both-present | Show all environments (confirm DEV + PRD) | 3/5 (60%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| list-systems-dev | Systems in DEV stage 1 | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| list-subsystems | Subsystems under DEV SYS1 | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| list-types | Element types in DEV SYS1 | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| list-elements-cobpgm | List COBPGM elements explicitly | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| list-elements-count | Count COBPGM elements, list all | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| print-element | Show source of PROG01 | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| **context-then-list** | SetContext, then list elements | **5/5 (100%)** | **0/5 (0%)** ❌ | **5/5 (100%)** | **0/5 (0%)** ❌ |
| list-copybooks | List COPYBOOK elements | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |

### Stress Questions

| Question | Prompt summary | qwen3/zowe | qwen3/code4z | gemini/zowe | gemini/code4z |
| --- | --- | --- | --- | --- | --- |
| **wildcard-name** | Elements whose name starts with PROG | **0/5 (0%)** ❌ | **5/5 (100%)** ✅ | **0/5 (0%)** ❌ | **5/5 (100%)** ✅ |
| cross-env-compare | Same elements in PRD as DEV? | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 4/5 (80%) |
| count-all-elements | Total element count, all types | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) |
| count-copybooks | Exact count of COPYBOOK elements | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 4/5 (80%) |
| **missing-element** | Is PROG99 in DEV? | **3/5 (60%)** | **2/5 (40%)** | **1/5 (20%)** | **5/5 (100%)** |
| multi-step-source | List COBPGMs, then print PROG03 | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 3/5 (60%) |
| **ambiguous-type** | "What COBOL programs are in PRD?" | **0/5 (0%)** ❌ | **0/5 (0%)** ❌ | **0/5 (0%)** ❌ | **0/5 (0%)** ❌ |
| **implicit-stage** | List all elements — do not specify stage | **5/5 (100%)** | **5/5 (100%)** | **0/5 (0%)** ❌ | **5/5 (100%)** ✅ |
| **natural-language-count** | All elements in PRD SYS1, with count | **0/5 (0%)** ❌ | **0/5 (0%)** ❌ | **0/5 (0%)** ❌ | incomplete |
| **context-then-multi** | SetContext, list COBPGMs, print PROG02 | **5/5 (100%)** ✅ | **0/5 (0%)** ❌ | **5/5 (100%)** ✅ | **0/5 (0%)** ❌ |

---

## Root Cause Analysis

### 1. `ambiguous-type` — 0% across ALL models and both servers (universal blocker)

**Failure**: model passes `type: "COBOL"` or `type: "*"` instead of `type: "COBPGM"`.

**Example error**:

```text
Expected tool "endevorListElements" with args matching {"type":"COBPGM"},
got {"type":"COBOL","system":"SYS1","element":"*","environment":"PRD","subsystem":"SUB1","stageNumber":"2"}
```

The prompt asks for "COBOL programs" (natural language). The `intent` variant describes the type
parameter as *"Endevor element type (e.g. COBPGM, COPYBOOK, JCL)"* — which does list COBPGM as an
example, but the model maps the phrase "COBOL programs" to the generic `COBOL` rather than recognising
`COBPGM` as the internal type code for COBOL programs. Both models, both servers, all 5 reps fail
without exception.

**Fix**: strengthen the description to explicitly map natural language to type codes:
> *"Endevor element type code. Use the exact code, not a language name: COBPGM for COBOL programs,
> COPYBOOK for copybooks, JCL for job control language. Example: to list COBOL programs, set
> type=COBPGM."*

---

### 2. `wildcard-name` / `natural-language-count` / `implicit-stage` (gemini) — missing `--type` in CLI

**Failure**: `zowe endevor list elements` is invoked without `--type`, producing "Command syntax invalid".

**Evidence**:

```text
[WARNING] CLI invocation failed {
  "command": ["endevor","list","elements"],
  "extraArgs": ["PROG*","--env","DEV","--sn","1","--sys","SYS1","--sub","SUB1"],
  "error": "Command syntax invalid"
}
```

The Zowe Endevor CLI requires `--type` even when you want all types. Without it the command is rejected.
The `type` field in `locationParams` has `default: "*"` in the schema, but when a model provides other
location params explicitly while omitting `type`, the default is not injected into the CLI invocation.

This is a **CLI bridge bug**: parameter defaults from `locationParams` context fields are not applied
when the model omits them alongside explicit values for sibling params.

**Why qwen3 avoids this for `implicit-stage`**: qwen3's extended thinking leads it to infer `type: *`
even without an explicit instruction, whereas gemini uses greedy decoding and skips it.

**Why code4z avoids this entirely**: code4z's REST API does not require a type filter. `element=PROG*`
works as a name-only wildcard against all element types, explaining why `wildcard-name` scores 5/5 on
code4z but 0/5 on Zowe MCP for both models.

**Fix**: ensure `type` always receives its default value `"*"` in the CLI argument list when not
explicitly provided by the model, regardless of whether other location params are present.

---

### 3. `context-then-list` / `context-then-multi` — architectural difference (both models)

**Failure on code4z**: `Expected a call to "endevorSetContext" (step 1) after index -1, with args matching {}`

The code4z-gen-ai server has no `endevorSetContext` tool. It is a stateless server — callers must pass
full location context with every tool invocation. The Zowe MCP CLI bridge server has stateful context
management via `endevorSetContext`, making it easier for agents to work with a fixed location without
repeating every parameter on every call.

Both `context-then-list` and `context-then-multi` pass 5/5 for both models on the Zowe MCP server,
confirming that `endevorSetContext` works correctly when present.

---

### 4. qwen3 `list-environments` inconsistency (60%) — spurious `getContext` call

In 2 of 5 reps, qwen3 called `getContext` first. The response stated "no z/OS backend configured —
only getContext is available." qwen3 then answered:

> *"To list Endevor environments, a z/OS backend must be configured first... all Endevor tools are
> unavailable."*

The Endevor CLI bridge tools operate independently of the z/OS backend (they invoke the Zowe CLI
directly), but the `getContext` response gives no indication of this. qwen3's reasoning led it to
incorrectly conclude the tools were unavailable.

Gemini does not probe `getContext` first and goes straight to `endevorListEnvironments`, scoring 100%.

**Fix**: update `getContext` to list registered CLI bridge plugins as a separate section, clearly
indicating they are available regardless of backend status.

---

### 5. `missing-element` — inconsistent "not found" phrasing

**Results**: qwen3/zowe 60%, qwen3/code4z 40%, gemini/zowe 20%, gemini/code4z 100%.

The assertion looks for: `[Nn]ot found | [Nn]o.*PROG99 | [Dd]oes not exist | [Nn]o element | [Cc]ould not find`

- **code4z returns an empty list** for an unknown element name. Gemini answers "no elements found"
  (matches pattern) 100% of the time.
- **Zowe MCP CLI call fails** when `type` is omitted (same CLI bug as #2 above). The model receives
  a tool error, not an empty list. Error messages vary: sometimes it explains the syntax error,
  sometimes it says the element wasn't found, sometimes it doesn't match the assertion pattern.
- qwen3 sometimes reasons its way to a "not found" response; gemini rarely does.

**Fix**: (a) apply the CLI `type` default fix from #2 so the tool actually runs; (b) broaden the
assertion pattern or add `[Ss]yntax error` / `[Nn]o results` to the match.

---

## Performance Metrics

| Model | Avg input tokens | Avg output tokens | Typical time per run |
| --- | --- | --- | --- |
| qwen3 (thinking) | ~7–11k | ~2–3k (incl. reasoning) | 10–35s (simple), up to 5 min (stress) |
| gemini-2.5-flash | ~9.6k avg, 15k max | ~1.5k avg, 4.3k max | 2–3s (simple), 10–15s (multi-step) |

Gemini is **10–100× faster per run**. For the 200 qwen3 runs (~73 min) vs ~190 gemini runs (~13 min),
the throughput difference is stark. The Qwen3 thinking overhead is significant even for simple queries
(35s for `list-environments` rep 1), and extreme for stress questions (4–5 min for `wildcard-name`).

Token usage is driven by the tool definitions being sent on every call (~6–7k input tokens for the tool
schemas alone), leaving ~1–8k for conversation history.

---

## Gemini API Hang

The run was killed after Gemini 2.5-flash's API call for step 2 of `natural-language-count`
(stress-code4z set) remained pending for **72 minutes** without a response. The process was at question
79 of 160 when killed.

**Likely cause**: quota exhaustion or a per-session token budget limit. By that point, gemini had
processed ~350 runs averaging ~18k total tokens each = ~6.3M tokens in the session. The API accepted
step 1 (tool call), returned a result, then timed out on step 2 (synthesis).

**Mitigations needed**:

1. Add an HTTP timeout (e.g. 120 s) to `generateText` calls
2. Add a configurable delay between runs (rate-limit headroom)
3. Handle quota errors gracefully (skip question, log error, continue)

---

## Comparison Summary: Zowe MCP vs code4z-gen-ai

| Dimension | Zowe MCP CLI Bridge | code4z-gen-ai |
| --- | --- | --- |
| Standard questions | 92–100% (both models) | 90–100% (both models) |
| Stress questions | 52–66% (both models) | 52–64% (both models)* |
| Wildcard filtering | ❌ CLI rejects partial wildcards | ✅ REST API accepts `PROG*` |
| Stateful context | ✅ `endevorSetContext` | ❌ Stateless only |
| Multi-step workflows | ✅ Passes for both models | ⚠️ Fails when `endevorSetContext` required |
| `ambiguous-type` | ❌ Universal fail | ❌ Universal fail |
| `missing-element` | ⚠️ Inconsistent | ✅ gemini 100%, qwen3 40% |
| `implicit-stage` | ✅ qwen3 100%, ❌ gemini 0% | ✅ Both 100% |

\* code4z stress incomplete for gemini; estimated from 8/10 completed questions.

The **primary differentiator** at this difficulty level is not description quality but **server
capabilities**: wildcard filtering (code4z REST wins) vs stateful context management (Zowe MCP wins).
Both fail equally on `ambiguous-type` — a description quality issue affecting both.

---

## Actionable Improvements

| Priority | Change | Expected impact |
| --- | --- | --- |
| P0 | Update `endevorListElements` `type` description to map natural language to type codes (COBPGM for COBOL programs) | Fixes `ambiguous-type` (+5 pts across all models/servers) |
| P0 | Fix CLI bridge to always inject `type: *` default into CLI args when model omits it | Fixes `wildcard-name`, `natural-language-count`, `implicit-stage` for gemini/zowe |
| P1 | Update `getContext` response to list CLI bridge tools as available regardless of backend | Fixes qwen3 `list-environments` 60%→100% |
| P1 | Add 120s timeout + graceful quota error handling to `generateText` in eval harness | Prevents future API hangs |
| P2 | Broaden `missing-element` assertion patterns; or add prompt instruction ("respond with 'not found' if…") | Fairer measurement of missing-element handling |
| P2 | Re-run with `gemini-3-flash` + `lmstudio-local` after cooling off the Gemini quota | Completes the 4-model comparison |
| P3 | Run `intent` vs `optimized` vs `cli` A/B comparison on stress questions with gemini-2.5-flash | Measures description variant impact under harder prompts |

---

## Technical Notes

- The Zowe MCP server was started with `--endevor-*` CLI flags pointing to the mock EWS server
- The code4z server was started with `--ews-url=http://localhost:8080 --ews-api=EndevorService/api/v2`
- Both servers used the same mock EWS (port 8080) throughout
- Cache was enabled; no cross-model or cross-server cache hits were expected (different system prompts
  and tool definitions produce different cache keys)
- The `endevor-code4z` and `endevor-stress-code4z` sets use `questionsFrom:` to share the exact same
  10 questions as `endevor` and `endevor-stress` respectively, ensuring equal question count for fair
  comparison
