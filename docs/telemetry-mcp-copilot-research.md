# Research: Telemetry for MCP servers with AI assistants (Copilot)

This document describes how **OpenTelemetry** can unify observability for **GitHub Copilot Chat** (the VS Code client) and **MCP servers** (for example Zowe MCP) during local development and testing. It aligns MCP server recommendations with the [OpenTelemetry semantic conventions for Model Context Protocol](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md) and fits alongside [Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents).

**Status:** Research and design guidance. The Zowe MCP server does not yet ship OpenTelemetry instrumentation; this document informs future implementation and operator setup.

---

## 1. Goals

| Goal | Rationale |
| --- | --- |
| **One trace backend** | Developers should see Copilot agent spans and MCP **server** spans in one tool (for example Aspire Dashboard) when debugging end-to-end. |
| **Conventional signals** | Use [OTel GenAI](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai) and **[MCP-specific](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md)** attributes so traces are portable to Jaeger, Grafana, Langfuse, and so on. |
| **Configurable like Copilot** | Enable/disable telemetry, OTLP endpoint, exporter type, and **opt-in** capture of sensitive payload fields using patterns analogous to Copilot’s `github.copilot.chat.otel.*` settings. |
| **Safe defaults** | Off by default; no prompt/tool body capture unless explicitly enabled (same spirit as Copilot’s `captureContent`). |

---

## 2. How the pieces fit together

### 2.1 Copilot Chat (VS Code)

Copilot Chat emits traces, metrics, and events from **inside the extension process**. See [Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents). Typical spans include `invoke_agent`, `chat` (LLM), and **`execute_tool`** for tool invocations (including MCP tools).

**Implication:** Copilot already records *that* a tool ran from the agent’s perspective. It does not replace **server-side** MCP spans (handling `tools/call`, backend I/O, errors inside the server).

### 2.2 MCP server (separate process)

An MCP server handles JSON-RPC over **stdio** or **Streamable HTTP**. Per [MCP semantic conventions](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md):

- Prefer **MCP conventions** over generic RPC or raw HTTP spans for MCP messages.
- Emit **server** spans (`SpanKind.SERVER`) for each MCP request/notification the server processes, with attributes such as `mcp.method.name`, `mcp.session.id`, `mcp.protocol.version`, `gen_ai.tool.name`, and `gen_ai.operation.name` = `execute_tool` for tool calls.
- Use **metrics** such as `mcp.server.operation.duration` and `mcp.server.session.duration` as defined in the same document.

### 2.3 Joining Copilot and MCP in one view

- **Same OTLP endpoint:** Point both Copilot and the MCP server at the same collector (for example Aspire Dashboard’s OTLP listener). Use **distinct** `service.name` values (for example `copilot-chat` vs `zowe-mcp-server`) via `OTEL_SERVICE_NAME` / resource attributes.
- **Trace linking:** The [MCP conventions](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md#context-propagation) recommend propagating W3C **`traceparent`** / **`tracestate`** in MCP **`params._meta`**. When the **MCP client** (inside VS Code / Copilot) injects this and the **server** extracts it, the server span becomes a child of the client’s MCP span and lines up with Copilot’s agent trace. This requires **client and server** cooperation; propagation format may evolve (see upstream MCP issues referenced in the spec).

Until full `_meta` propagation is ubiquitous, traces may appear as **two related services** in the same backend without a single parent span—still valuable for latency and error analysis.

---

## 3. Configuration parity (Copilot vs MCP server)

Copilot is configured via VS Code settings and environment variables (env wins). See the [monitoring-agents](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents) tables.

For MCP servers, the **standard OpenTelemetry environment variables** are the natural counterpart. A future Zowe MCP implementation should respect the same precedence pattern: **explicit MCP-specific env** (optional) over **generic `OTEL_*`**, aligned with Copilot’s `COPILOT_OTEL_*` vs `OTEL_*` story.

| Concern | Copilot (reference) | MCP server (recommended direction) |
| --- | --- | --- |
| Enable telemetry | `github.copilot.chat.otel.enabled`, or `COPILOT_OTEL_ENABLED=true`, or set `OTEL_EXPORTER_OTLP_ENDPOINT` | `OTEL_EXPORTER_OTLP_ENDPOINT` set, or explicit `ZOWE_MCP_OTEL_ENABLED=true` (if implemented), default **off** |
| OTLP endpoint | `github.copilot.chat.otel.otlpEndpoint`, `COPILOT_OTEL_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT` | `OTEL_EXPORTER_OTLP_ENDPOINT` (and optional `ZOWE_MCP_OTEL_ENDPOINT` override) |
| Protocol | `github.copilot.chat.otel.exporterType`: `otlp-http`, `otlp-grpc`, `console`, `file` | Prefer **`OTEL_EXPORTER_OTLP_PROTOCOL`** (`http/protobuf` vs `grpc`); optional mirror of exporter type for non-OTLP fallbacks |
| Service name | `OTEL_SERVICE_NAME` (default `copilot-chat`) | `OTEL_SERVICE_NAME=zowe-mcp-server` (or similar) |
| Resource attributes | `OTEL_RESOURCE_ATTRIBUTES` | Same |
| **Sensitive payload capture** | `github.copilot.chat.otel.captureContent`, `COPILOT_OTEL_CAPTURE_CONTENT` | Opt-in only: map to **`gen_ai.tool.call.arguments` / `gen_ai.tool.call.result`** (or structured logs), gated by `ZOWE_MCP_OTEL_CAPTURE_CONTENT=true` or equivalent—see [MCP spec opt-in warnings](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md) |
| File export (dev) | `github.copilot.chat.otel.outfile` | Could use OTLP `file` exporter or **OpenTelemetry Collector** file exporter; or defer to collector sidecar |

**Note:** Copilot’s **`console`** and **`file`** exporter types are product-specific convenience. Raw MCP servers usually rely on **OTLP to a collector** or **`console` exporter** via SDK configuration; Aspire and Jaeger below use **OTLP**.

---

## 4. Local development: Aspire Dashboard for Copilot + MCP

[Aspire Dashboard](https://aspire.dev/dashboard/standalone/) accepts OTLP and provides a web UI. The [VS Code monitoring guide](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents#_aspire-dashboard) documents a minimal Docker run.

### 4.1 Start Aspire Dashboard

From the [monitoring-agents](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents) documentation:

```bash
docker run --rm -d \
  -p 18888:18888 \
  -p 4317:18889 \
  --name aspire-dashboard \
  mcr.microsoft.com/dotnet/aspire-dashboard:latest
```

- **UI:** `http://localhost:18888` — open **Traces** (and metrics if exposed).
- **OTLP gRPC:** host port **4317** maps into the container for ingestion (as in the Copilot doc example).

### 4.2 Point Copilot Chat at Aspire

In VS Code **Settings (JSON)** or Settings UI, align with the guide:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-grpc",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:4317"
}
```

Alternatively set environment variables before launching VS Code (they override settings), for example:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export COPILOT_OTEL_ENABLED=true
```

Restart VS Code if needed so the Copilot Chat extension picks up changes.

### 4.3 Point the MCP server at the same endpoint

When the MCP server implements OTLP export, run it with standard OTel env vars so spans share the same backend:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_SERVICE_NAME=zowe-mcp-server
export OTEL_RESOURCE_ATTRIBUTES="service.namespace=dev,deployment.environment=local"
# export ZOWE_MCP_OTEL_ENABLED=true   # if an explicit gate is added
```

For **stdio** MCP started by VS Code, the Zowe MCP extension would pass these via `McpStdioServerDefinition` `env` (same pattern as `MCP_DISCOVERY_DIR` today).

### 4.4 Validate

1. Open Aspire **Traces**.
2. Run a Copilot agent action that calls an MCP tool.
3. Expect services such as **`copilot-chat`** and **`zowe-mcp-server`** (names depend on `OTEL_SERVICE_NAME`).
4. After client/server propagation exists, verify **parent/child** relationships between `execute_tool` / MCP client spans and MCP **server** spans.

### 4.5 Alternative: Jaeger with OTLP HTTP

If you prefer HTTP/protobuf on port **4318** (common for Jaeger OTLP):

```bash
docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:latest
```

Use `otlp-http` and `http://localhost:4318` in Copilot settings; configure the MCP server with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`.

---

## 5. MCP semantic conventions checklist (server implementers)

Use [docs/gen-ai/mcp.md](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md) as the source of truth. Summary for **server** implementers:

| Area | Recommendation |
| --- | --- |
| **Span kind** | `SERVER` for inbound MCP requests/notifications. |
| **Span name** | `{mcp.method.name}` plus low-cardinality target (for example `gen_ai.tool.name`) when applicable. |
| **Required / conditional attrs** | `mcp.method.name`; for tools: `gen_ai.tool.name`; `gen_ai.operation.name` = `execute_tool`; `jsonrpc.request.id` when present; `error.type` on failure (`tool_error` when result has `isError: true`). |
| **Session** | `mcp.session.id` when using session-aware transports. |
| **Transport** | `network.transport`: e.g. `pipe` for stdio per spec; HTTP-based transports use `tcp` / `quic` as appropriate. |
| **Metrics** | `mcp.server.operation.duration`, `mcp.server.session.duration` as specified. |
| **Duplicate spans** | If outer GenAI instrumentation already created an `execute_tool` span, **do not** duplicate; **add MCP attributes** to the existing span when detectable (per spec). |
| **Context** | Extract `traceparent` / `tracestate` from **`params._meta`** and use as parent; link transport context if needed. |

---

## 6. Security and privacy

Mirror Copilot’s model:

| Copilot | MCP server |
| --- | --- |
| OTel off unless enabled | Same: no exporter loaded when disabled (zero overhead goal). |
| No prompt/tool bodies unless `captureContent` | No `gen_ai.tool.call.arguments` / `result` unless opt-in; document risk (credentials, mainframe data). |
| User-chosen endpoint | No default phone-home; operator sets OTLP URL. |

---

## 7. Gaps and follow-ups

1. **Implementation in Zowe MCP:** Add optional `@opentelemetry/*` SDK, instrument MCP request handling (stdio + HTTP), and wire env-based config as in section 3.
2. **VS Code MCP client:** Propagate `traceparent` into `tools/call` **`params._meta`** when Copilot/VS Code exposes trace context—depends on host product roadmap.
3. **Stability:** GenAI and MCP conventions are still **development**; follow `OTEL_SEMCONV_STABILITY_OPT_IN` guidance in the [gen-ai README](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai).
4. **Documentation:** Update Zowe MCP operator docs (`server.json`, README) when OTLP env vars are implemented.

---

## 8. References

- [Monitor agent usage with OpenTelemetry (VS Code)](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents)
- [Semantic conventions for Model Context Protocol (MCP)](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md)
- [Semantic conventions for generative AI (overview)](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai)
- [Aspire Dashboard (standalone)](https://aspire.dev/dashboard/standalone/)
