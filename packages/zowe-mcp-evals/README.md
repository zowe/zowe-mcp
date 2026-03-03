# Zowe MCP Evals

AI evaluations for the Zowe MCP server: run an LLM agent against the server (mock or native backend), check tool choice and arguments, and optionally answer content.

## Setup

1. **Build the server**: From repo root, run `npm run build` (or `npm run build -w packages/zowe-mcp-server`).

2. **Evals config** (at repo root): Copy an example and set your LLM provider (vLLM, Gemini, or LM Studio):

   ```bash
   # From repo root
   cp evals.config.example.json evals.config.json
   ```

   Edit `evals.config.json` at the repo root. All keys use **camelCase** (`serverModel`, `baseUrl`, `apiKey`):

   - **Single-model (legacy)**: Top-level `provider`, `serverModel`, and optionally `baseUrl` (vLLM), `apiKey` (or `GEMINI_API_KEY` env for Gemini).
   - **Multi-model**: A `models` array. Each entry has `id`, `provider`, `serverModel`, and provider-specific fields (`baseUrl`/`apiKey` for vLLM, `apiKey` or env for Gemini, `baseUrl` for LM Studio). The **first** model is the default; use `npm run evals -- --model <id>` to run with another.

   ### Providers

   | Provider | `provider` value | Required fields | Notes |
   | --- | --- | --- | --- |
   | vLLM | `"vllm"` | `serverModel`; optional `baseUrl` (default `http://localhost:8000/v1`), `apiKey` | OpenAI-compatible |
   | Gemini | `"gemini"` | `serverModel`, `apiKey` (or `GEMINI_API_KEY` env) | Google AI |
   | LM Studio | `"lmstudio"` | `serverModel`; optional `baseUrl` (default `http://localhost:1234/v1`), `contextLength` (default 32768) | OpenAI-compatible; auto-loads the model in LM Studio with the configured context length via `POST /api/v1/models/load`; if `serverModel` is missing, lists available models |

   The file `evals.config.json` is gitignored; do not commit secrets.

3. **Install and build** (from repo root):

   ```bash
   npm install
   npm run build
   ```

## Running evals

From **repo root** only:

```bash
npm run evals
```

Pass CLI options after `--`:

```bash
npm run evals -- --set datasets
npm run evals -- --set datasets --model gemini-flash
npm run evals -- --set datasets --number 1
npm run evals -- --set datasets --number 1-2
npm run evals -- --set members --filter listMembers
npm run evals -- --set datasets --id list-systems
npm run evals -- --no-cache
```

### CLI options

- **`--set <name>`** — Run one set (e.g. `datasets`) or multiple: `--set datasets,members`. Default: `all` (all YAML files in `questions/`).
- **`--model <id>`** — Use the model with this id from `evals.config.json`. Only applies when config uses the `models` array; the first model is the default when omitted.
- **`--number <n>`** — Run only question index `n` (1-based). **`--number <start>-<end>`** — Run questions in range (e.g. `1-5`).
- **`--id <id>`** — Run only questions whose id equals the given value. **`--id id1,id2`** — Multiple ids.
- **`--filter <substring>`** — Run only questions whose id or prompt contains the substring (case-insensitive).
- **`--no-cache`** — Disable the development cache (see below). Use for CI or when you want every run to call the LLM.

### Cache (development)

When cache is enabled (default), successful eval results are stored under `.evals-cache/` at the repo root. The cache key includes the system prompt, question text, tool descriptions for the tools under test, and the model id (when using multi-model config), so changing a tool description, the question, or the model invalidates the cache for that question. Only **passing** runs are cached; failed runs are never stored. Repeated evals with the same questions, tooling, and model reuse cached results and skip LLM calls. At the end of a run you see a line like: `Cache: N hits, M writes, K LLM calls (T runs)`. To run without cache (e.g. in CI or for a clean run), pass **`--no-cache`**.

## Question sets

Question sets are YAML files in `questions/`. Each file has:

- **config** (optional): `repetitions`, `minSuccessRate`, `mock` or `native`, `systemPrompt` or `systemPromptAddition`.
- **questions**: List of `id`, `prompt`, optional `preset`, and `assertions`.

### Set config

- **repetitions** — Runs per question (default: 5).
- **minSuccessRate** — Threshold in [0, 1]; a question passes if its pass rate ≥ this (default: 0.8).
- **mock** — Use mock backend. One string `initArgs` passed to init-mock (after `--output <dir>`). Example: `initArgs: --preset default` or one line per option in YAML.
- **native** — Use native z/OS backend. One string `serverArgs` (e.g. `--native --config native-config.json`). Passwords from env (`ZOWE_MCP_PASSWORD_*`, `ZOS_PASSWORD`).
- **systemPrompt** — Full system prompt for the agent (replaces default).
- **systemPromptAddition** — Appended to the default system prompt.

### Assertions

Assertions use Ansible-style key-based format. Each assertion is an object with the assertion type as a key and an optional `name` for failure messages. Three assertion types:

- **toolCall** — Unified tool-call assertion. Body fields:
  - `tool` (string) — single tool name; checks the last matching call + optional `args`.
  - `tools` (string[]) — any of these tools matches (no per-tool args).
  - `oneOf` (array of `{tool, args?}`) — any of these specs matches (per-tool args).
  - `args` (object) — partial argument match (used with `tool` or `tools`).
  - `count` (integer) — exact number of total tool calls expected (e.g. `count: 1` for single-tool-call assertions).
  - `minCount` (integer) — minimum call count (e.g. for pagination).
- **toolCallOrder** — Ordered tool-call sequence. Value is directly an array of steps (no intermediate `sequence:` key). Each step has `tool` (single) or `tools` (any of) and optional `args`. Other tool calls may appear between steps.
- **answerContains** — Final answer must contain `substring` (literal) or match regex `pattern`.

Composites: `allOf` (all must pass) and `anyOf` (at least one must pass) for logical grouping.

Example:

```yaml
assertions:
  - name: create then write then read then cleanup
    toolCallOrder:
      - tool: createTempDataset
        args: { type: ["PS", "SEQUENTIAL"] }
      - tool: writeDataset
        args: { lines: ["hello"] }
      - tool: readDataset
      - tool: deleteDatasetsUnderPrefix
  - toolCall:
      tool: readDataset
      minCount: 2
  - answerContains:
      pattern: "success|done"
```

### readDataset pagination

- **Set** `read-pagination` (run with `--set read-pagination`): One question. Mock uses `--preset pagination`; USER.LARGE.SEQ has 2200 lines with a Star Wars character name on line 2100 (third chunk). The agent must page with readDataset (3 calls: 1000, 1000, 200 lines — startLine 1, 1001, 2001) and report the character name (LUKE). Works with any MCP client.

### Search pagination

- **Set** `search-pagination` (run with `--set search-pagination`): One question. Mock uses `--preset pagination`; USER.INVNTORY has 2000 members. The agent must search for a string (e.g. "name"), page through results when `_result.hasMore` is true, and report how many members match.

### Mutations (write and delete)

- **Set** `mutations` (run with `--set mutations`): Two questions. (1) Create a temp sequential data set, write a line, read it back, then delete under the temp prefix. (2) Create a temp PDS, write a member, delete that member, then delete under the temp prefix. Uses **toolCallOrder** to assert the flow.

### Context and core

- **Set** `context` (run with `--set context`): getContext and setSystem/listSystems then getContext. Mock, default preset.
- **Set** `core` (run with `--set core`): info tool to report server and backend type. Mock, default preset.

### Data set attributes and copy/rename

- **Set** `dataset-attributes` (run with `--set dataset-attributes`): getDatasetAttributes for RECFM, LRECL, DSORG. Mock, default preset.
- **Set** `dataset-copy-rename` (run with `--set dataset-copy-rename`): copyDataset (member to temp PDS) and renameDataset (temp sequential) with cleanup. Mock, default preset.

### TSO

- **Set** `tso` (run with `--set tso`): runSafeTsoCommand for LISTALC, LISTDS, WHO. Mock returns canned output. Default preset.

### USS (UNIX System Services)

- **Set** `uss` (run with `--set uss`): getUssHome, listUssFiles, readUssFile, and a write-temp-read-cleanup flow. Mock; init-mock creates a minimal USS tree for the first system/user (`/u/<user>/file.txt`, `subdir`) when using default preset.

### Jobs (native backend only)

- **Set** `jobs` (run with `--set jobs`): listJobs and getJobStatus. **Requires native z/OS backend** (mock does not implement job operations). Use when `native-config.json` and credentials are configured; otherwise this set will fail or be skipped.

## Report

After a run, `evals-report/report.md` contains:

- Summary (total runs, pass rate).
- Per-question pass rate and status.
- Per-tool evaluation count and parameter/values covered.
- Failures section; details also in `evals-report/failures.md` when there are failures.
