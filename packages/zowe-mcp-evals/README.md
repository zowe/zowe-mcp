# Zowe MCP Evals

AI evaluations for the Zowe MCP server: run an LLM agent against the server (mock or native backend), check tool choice and arguments, and optionally answer content.

## Setup

1. **Build the server**: From repo root, run `npm run build` (or `npm run build -w packages/zowe-mcp-server`).

2. **Evals config** (at repo root): Copy the example and set your LLM provider (vLLM or Gemini):

   ```bash
   # From repo root
   cp evals.config.example.json evals.config.json
   ```

   Edit `evals.config.json` at the repo root:

   - **vLLM**: Set `provider`, `base_url`, `server_model`, and optionally `api_key`.
   - **Gemini**: Set `provider`, `server_model`; set `api_key` or the `GEMINI_API_KEY` env var.

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
npm run evals -- --set datasets --number 1
npm run evals -- --set datasets --number 1-2
npm run evals -- --set members --filter listMembers
npm run evals -- --set datasets --id list-systems
```

### CLI options

- **`--set <name>`** — Run one set (e.g. `datasets`) or multiple: `--set datasets,members`. Default: `all` (all YAML files in `questions/`).
- **`--number <n>`** — Run only question index `n` (1-based). **`--number <start>-<end>`** — Run questions in range (e.g. `1-5`).
- **`--id <id>`** — Run only questions whose id equals the given value. **`--id id1,id2`** — Multiple ids.
- **`--filter <substring>`** — Run only questions whose id or prompt contains the substring (case-insensitive).

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

- **toolCall** — A call to `tool` with optional `args` (partial match).
- **answerContains** — Final answer must contain `substring`.
- **singleToolCall** — Exactly one tool call in the first turn, matching `tool` and optional `args`.
- **toolOnly** — At least one call to `tool` with optional `args`; answer content not checked.

## Report

After a run, `evals-report/report.md` contains:

- Summary (total runs, pass rate).
- Per-question pass rate and status.
- Per-tool evaluation count and parameter/values covered.
- Failures section; details also in `evals-report/failures.md` when there are failures.
