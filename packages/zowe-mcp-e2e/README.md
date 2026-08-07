# zowe-mcp-e2e

A deterministic **fake LLM server** used to test VS Code Copilot Chat
bring-your-own-key (BYOK) integration end-to-end, without calling a real
model provider.

## Why

VS Code (1.122+) lets users register BYOK chat model providers via a
`chatLanguageModels.json` file — either an Ollama provider
(`{"name":"Ollama","vendor":"ollama","url":"http://localhost:11434"}`) or a
custom OpenAI-compatible endpoint. Our e2e harness points VS Code at this
fake server instead of a real model. The "model" is scripted: when Copilot
agent mode sends a chat request that includes tool definitions, the server
deterministically calls a Zowe MCP tool; once it receives the tool result back
it produces a final answer containing a sentinel string
(`E2E-SENTINEL-OK ...`) that the test can assert on. This keeps the e2e
hermetic and CI-friendly — no API keys, no network calls, no model
non-determinism.

## What it implements

One HTTP server exposes **both** API surfaces on a single port:

- **OpenAI-compatible**: `GET /v1/models`, `POST /v1/chat/completions`
  (both `stream: false` and `stream: true` — SSE with `data: {...}\n\n`
  chunks and a final `data: [DONE]`). Tool calls use the OpenAI
  `tool_calls` format; in streaming mode the first chunk carries the tool
  call's `id`/`type`/`function.name`, later chunks carry `function.arguments`
  fragments (index-addressed), and the terminal chunk sets
  `finish_reason: "tool_calls"`.
- **Ollama-compatible**: `GET /api/tags`, `GET /api/version`,
  `POST /api/show` (includes `capabilities: ["completion","tools"]` plus a
  `details`/`model_info` superset for VS Code's Ollama BYOK provider), and
  `POST /api/chat` (streaming NDJSON — one JSON object per line — and
  non-streaming). Ollama tool calls use `message.tool_calls[].function`
  with **object-typed** `arguments` (not a JSON string, unlike OpenAI).

The scripted decision logic (`src/script-engine.ts`) is shared by both
surfaces:

1. No tools offered → replies `E2E-SENTINEL-PONG`.
2. Tools offered, no tool result yet → picks the first tool whose name
   matches `toolPattern` (default `/listDatasets/i`, matched by substring so
   prefixed names like `mcp_zowe_listDatasets` work) and emits a tool call
   with minimal valid arguments synthesized from the tool's JSON Schema.
3. Tools offered and a `role: "tool"` result message is present → replies
   `E2E-SENTINEL-OK <up to 200 chars of the tool result>`, proving data flowed
   from the mock backend through the tool call into the chat reply.

Every request/response is recorded in `requestLog` (in-memory) and, if
`logFile` is set, appended there as JSON lines.

## Usage

### Programmatic

```ts
import { startFakeModelServer } from 'zowe-mcp-e2e';

const server = await startFakeModelServer({
  port: 0, // 0 picks a free ephemeral port
  modelId: 'fake-e2e',
  toolPattern: /listDatasets/i,
  datasetPattern: 'USER1.*',
  logFile: './fake-model-server.log',
});

console.log(server.url); // e.g. http://127.0.0.1:54321

// Point VS Code's chatLanguageModels.json at server.url (OpenAI-compatible)
// or use it as the Ollama provider's `url`.

await server.close();
```

### CLI

```sh
npm run build
node dist/cli.js --port 0 --log-file ./fake-model-server.log
# or, once installed/linked: fake-model-server --port 0 --log-file ./fake-model-server.log
```

On startup the CLI prints a single JSON line to stdout —
`{"port":..., "url":"..."}` — so a shell harness can pick up the assigned
port even when `--port` is omitted (random ephemeral port). It shuts down
cleanly on `SIGINT`/`SIGTERM`.

Flags: `--port`, `--host`, `--model-id`, `--log-file`, `--tool-pattern`
(a RegExp source, case-insensitive), `--dataset-pattern`.

## Testing

```sh
npm run build
npx vitest run
```
