<!-- markdownlint-disable MD024 -->

# MCP Features: VS Code and Claude Code Support

> **Last updated**: June 3, 2026  
> **Sources**: [VS Code MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) (June 3, 2026), [VS Code add MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) (June 3, 2026), [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) (June 3, 2026)

This document summarises how every MCP specification feature is supported in **Visual Studio Code (GitHub Copilot)** and **Claude Code (terminal)** as of June 2026.

---

## Feature support matrix

| MCP Feature | VS Code | Claude Code |
| --- | --- | --- |
| **Transports** – stdio | ✅ | ✅ |
| **Transports** – Streamable HTTP | ✅ | ✅ |
| **Transports** – SSE | ✅ (legacy) | ✅ (deprecated) |
| **Transports** – WebSocket | ❌ | ✅ |
| **Tools** | ✅ | ✅ |
| **Prompts** | ✅ | ✅ |
| **Resources** | ✅ | ✅ |
| **Elicitation** | ✅ (since Jun 2025) | ✅ (since Mar 2026 v2.1.76) |
| **Sampling** | ✅ | ❌ not implemented |
| **Authorization (OAuth)** | ✅ | ✅ (HTTP/SSE only) |
| **Server instructions** | ✅ | ✅ |
| **Roots** | ✅ | ✅ |
| **Progress notifications** | ✅ | ⚠️ known regression |
| **Dynamic tool updates** | ✅ | ✅ |
| **Icons** | ✅ (since Jun 2025) | ❌ |
| **MCP Apps** (VS Code extension) | ✅ (since Jan 2026) | ❌ |
| **Channels / push messages** | ❌ | ✅ (Claude Code-specific) |
| **Tool Search / deferral** | ❌ | ✅ (Claude Code-specific) |
| **Sandboxing** | ✅ (macOS/Linux) | ❌ |

---

## 1. Transports

### VS Code

VS Code supports three transports:

- **stdio** – local process, stdin/stdout
- **Streamable HTTP** (`http`) – remote server
- **SSE** (`sse`) – legacy, still supported

Configure via `.vscode/mcp.json`:

```json
{
  "servers": {
    "remote": { "type": "http", "url": "https://api.example.com/mcp" },
    "local":  { "command": "npx", "args": ["-y", "my-mcp-server"] }
  }
}
```

### Claude Code

Claude Code supports four transports:

- **stdio** – local processes (`claude mcp add -- <command>`)
- **Streamable HTTP** (`http` or `streamable-http`) – recommended for remote
- **SSE** (`sse`) – deprecated, use HTTP instead
- **WebSocket** (`ws`) – bidirectional, for event-push scenarios; configure via `claude mcp add-json`

```bash
# HTTP
claude mcp add --transport http notion https://mcp.notion.com/mcp

# stdio
claude mcp add --transport stdio airtable -- npx -y airtable-mcp-server

# WebSocket (JSON config only)
claude mcp add-json events-server \
  '{"type":"ws","url":"wss://mcp.example.com/socket"}'
```

---

## 2. Tools

MCP tools extend agent capabilities with callable functions (e.g. query a database, run a browser action).

### VS Code

**Tool picker** — users enable or disable individual tools per request. Tool descriptions and names appear in the picker and in the confirmation dialog.

![Screenshot that shows the tools picker in agent mode, highlighting tools from an MCP server](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-tools-picker.png)

**Tool confirmation dialog** — shown for all tools not annotated with `readOnlyHint`. Users can edit model-generated input parameters before the tool runs.

![Screenshot that shows the tool confirmation dialog with input parameters for an MCP tool](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-tool-input-parameters.png)

**Tool annotations** supported:

| Annotation | Effect |
| --- | --- |
| `title` | Human-readable title shown in Chat view when tool is invoked |
| `readOnlyHint` | Tool is read-only; VS Code skips the confirmation dialog |
| `destructiveHint` | Tool modifies state (affects UI indication) |

**Dynamic tool discovery** — servers can add/remove tools at runtime without reconnecting (via `list_changed` notifications).

**Icons** — each tool, resource, and server can carry an `icons.src` URI (data URI, `file:///`, or same-origin HTTP).

### Claude Code

The `/mcp` slash command shows connected servers, tool counts, and connection status. Tools are invoked automatically by Claude; users are asked to confirm individual tool calls based on permissions.

**Tool Search (deferral)** — by default, only tool names and server instructions are loaded into context at session start. Claude uses a `ToolSearch` call to discover relevant tool schemas on demand. This keeps context usage low even with dozens of MCP servers.

```bash
ENABLE_TOOL_SEARCH=false claude   # load all tools upfront
ENABLE_TOOL_SEARCH=auto claude    # hybrid: load upfront if within 10% of context window
```

Individual tools or servers can opt out of deferral:

```json
{ "mcpServers": { "core-tools": { "type": "http", "url": "...", "alwaysLoad": true } } }
```

**Dynamic updates** — Claude Code supports `list_changed` notifications and refreshes tool/prompt/resource lists without reconnecting.

**Output limits** — Claude Code warns when MCP tool output exceeds 10 000 tokens; configurable with `MAX_MCP_OUTPUT_TOKENS`.

---

## 3. Prompts

MCP prompts are reusable chat prompt templates that users invoke by name.

### VS Code

Prompts appear as slash commands in the chat input:

```text
/mcp.servername.promptname [arguments]
```

If a prompt defines argument completions, VS Code shows a dialog to collect the values. Users can also run a terminal command in the dialog and use its output as an argument.

When a prompt response includes a resource, VS Code attaches it as context.

![Screenshot that shows the prompt dialog for an MCP prompt with input parameters](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-prompt-argument.png)

Server code example using `completable` for argument suggestions:

```typescript
server.prompt(
  'teamGreeting',
  'Generate a greeting for team members',
  {
    name: completable(z.string(), value =>
      ['Alice', 'Bob', 'Charlie'].filter(n => n.startsWith(value)))
  },
  async ({ name }) => ({ messages: [{ role: 'assistant', content: { type: 'text', text: `Hello ${name}!` } }] })
);
```

### Claude Code

Prompts appear as slash commands with double-underscore separators:

```text
/mcp__servername__promptname [arg1 arg2 ...]
```

Type `/` to see all available prompts. Arguments are space-separated. Prompt results are injected directly into the conversation.

---

## 4. Resources

Resources provide read-only data (files, logs, API responses, screenshots) that can be attached to chat requests.

### VS Code

Resources are accessible via:

- **MCP: Browse Resources** command — opens a Quick Pick of all available resources
- **Add Context → MCP Resource** in the Chat view
- Drag-and-drop into the workspace

![Screenshot that shows the MCP Resources Quick Pick](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-resources-picker.png)

**Real-time updates** — VS Code tracks `resources/updated` notifications and reflects live changes in the editor (e.g. a log file that keeps growing).

**Resource templates** — parameterised resources prompt users for arguments via a Quick Pick with completions (e.g. "which database table?").

Resources can contain text or binary content. The MIME type should be set so VS Code handles the content appropriately (e.g. `image/png` for screenshots).

### Claude Code

Resources are referenced using `@` mentions:

```text
@server:protocol://resource/path
```

Typing `@` in the prompt shows all available resources from connected servers alongside local files. Multiple resources can be referenced in one prompt. Resources are fetched automatically and included as attachments.

---

## 5. Elicitation

Elicitation lets an MCP server pause a tool call and ask the user for structured input mid-task, rather than failing when a required parameter is missing.

Flow: server sends `elicitation/create` → client renders a form or opens a browser URL → user responds → server continues.

### VS Code

VS Code has supported elicitation since **June 2025** (merged [PR #251872](https://github.com/microsoft/vscode/pull/251872)).

Two modes:

- **Form mode** — inline in the chat turn when associated with a tool call; via a notification Quick Pick otherwise. Fields are rendered from the JSON Schema `requestedSchema`.
- **URL mode** — opens the user's browser for OAuth-style approval flows.

The native UI feels like the VS Code Command Palette — fields are rendered as Quick Pick items.

> Screenshot from [Den Delimarsky's blog post](https://den.dev/blog/vscode-mcp-elicitations-stop-guessing/) (June 2025):  
> *"As you can see from this GIF, the prompts are natively integrated in the Visual Studio Code user interface."*

Server-side example:

```typescript
const result = await server.request(
  { method: 'elicitation/create',
    params: {
      message: 'Choose your preferences',
      requestedSchema: {
        type: 'object',
        properties: {
          color:   { type: 'string', enum: ['red', 'green', 'blue'] },
          rating:  { type: 'number', minimum: 1, maximum: 100 },
          pet:     { type: 'string' }
        },
        required: ['color']
      }
    }
  },
  z.any()
);
```

Supported JSON Schema formats: `email`, `uri`, `date`, `date-time`. Users can `Accept`, `Decline`, or `Cancel`; the server is informed of the outcome.

> **Security note**: elicitation must not request passwords or API keys — the spec explicitly prohibits this. Use OAuth / out-of-band credential flows instead.

### Claude Code

Claude Code added elicitation in **v2.1.76 (March 14, 2026)**.

Two modes (same as VS Code):

- **Form mode** — interactive terminal dialog with labelled fields.
- **URL mode** — browser window opens; CLI confirms after the user completes the flow.

**Elicitation hooks** allow programmatic interception:

```json
// settings.json
{
  "hooks": {
    "Elicitation": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "auto-responder.sh" }] }],
    "ElicitationResult": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "log-result.sh" }] }]
  }
}
```

- **`Elicitation` hook** — fires when the server requests input; can inspect, modify, or auto-respond before the dialog is shown.
- **`ElicitationResult` hook** — fires after the user responds; can override or log the result before it is sent back to the server.

---

## 6. Sampling

Sampling lets an MCP server make its own language-model requests using the client's configured model and subscription — no API key needed in the server.

### VS Code

VS Code fully supports sampling since **June 2025** ([blog post](https://code.visualstudio.com/blogs/2025/06/12/full-mcp-spec-support)).

The first time a server makes a sampling request, the user must authorize it:

![Screenshot that shows the authorization prompt for an MCP server to access models](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-allow-sampling.png)

After authorization, users can restrict which models the server is allowed to use:

- **Command**: MCP: List Servers → Configure Model Access
- Honors `modelPreferences` hints from the server

![Screenshot that shows the Configure Model Access dialog for an MCP server](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-configure-model-access.png)

Users can inspect past sampling calls via: MCP: List Servers → Show Sampling Requests.

Use cases: summarise large datasets before returning them, extract structured data, implement agentic decision logic inside a tool.

### Claude Code

**Sampling is not implemented** in Claude Code. The server can declare the capability but Claude Code will not fulfil `sampling/createMessage` requests.

---

## 7. Authorization (OAuth)

MCP servers that require authentication use OAuth 2.0/2.1. The MCP server acts as a Resource Server; the actual Authorization Server is your existing IdP (GitHub, Entra, Keycloak, Okta, etc.).

### VS Code

VS Code supports the full OAuth authorization flow as of **June 2025**:

1. **Dynamic Client Registration (DCR)** — VS Code registers as an OAuth client automatically.
2. **Client credentials fallback** — when DCR is not supported, VS Code prompts for a Client ID (and optionally a secret).
3. **Built-in providers** — GitHub and Microsoft Entra are supported natively; users manage trust through **Accounts menu → Manage Trusted MCP Servers**.

![Screenshot that shows the Accounts menu with the Manage Trusted MCP Servers action](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/manage-trusted-mcp.png)

When DCR is not supported:

![Screenshot that shows the authorization flow when DCR is not supported](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-auth-dynamic-client-required.png)

When the server requires a static Client ID:

![Screenshot that shows the Client ID prompt for a MCP server](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-auth-client-id.png)

Required redirect URIs: `http://127.0.0.1:33418` and `https://vscode.dev/redirect`.

Remove stored dynamic registrations: **Authentication: Remove Dynamic Authentication Providers** from the Command Palette.

### Claude Code

OAuth is supported for **HTTP and SSE** transports. Use `/mcp` in a session to authenticate:

```bash
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
# then in Claude Code:
/mcp   # opens browser for OAuth login
```

**Fixed callback port** (needed when the server requires a pre-registered redirect URI):

```bash
claude mcp add --transport http --callback-port 8080 my-server https://mcp.example.com/mcp
```

**Pre-configured credentials** (when DCR is not supported):

```bash
claude mcp add --transport http --client-id your-id --client-secret --callback-port 8080 \
  my-server https://mcp.example.com/mcp
```

**Dynamic headers helper** for non-OAuth schemes (Kerberos, SSO tokens):

```json
{ "mcpServers": { "internal": { "type": "http", "url": "...", "headersHelper": "/opt/get-token.sh" } } }
```

**Override OAuth discovery**:

```json
{ "oauth": { "authServerMetadataUrl": "https://auth.example.com/.well-known/openid-configuration" } }
```

**Restrict scopes**:

```json
{ "oauth": { "scopes": "channels:read chat:write" } }
```

---

## 8. Server instructions

The server's `instructions` field (sent at initialization) tells the client what the server does and how to interact with it. Clients may incorporate this into the system prompt.

### VS Code

VS Code passes server instructions to the model. Instructions help the model decide when to invoke tools from that server.

### Claude Code

Server instructions are especially important in Claude Code because **Tool Search** uses them to decide which tools to load into context when the model needs them:

> *"Add clear, descriptive server instructions that explain: what category of tasks your tools handle, when Claude should search for your tools, key capabilities your server provides."*

Claude Code truncates tool descriptions and server instructions at **2 KB each** — keep them concise and put critical details near the start.

---

## 9. Roots

Roots provide the MCP server with information about the client's workspace root directories.

### VS Code

VS Code automatically provides workspace root folder information to MCP servers via the `roots/list` capability.

### Claude Code

Claude Code sets the `CLAUDE_PROJECT_DIR` environment variable in the spawned server's environment, pointing to the project root. Servers can also call `roots/list` to discover workspace directories. This variable is set in the server's environment — use `${CLAUDE_PROJECT_DIR:-.}` as a safe default in `.mcp.json` `args`.

---

## 10. Progress notifications

Long-running tools can send `notifications/progress` messages so the user knows what is happening.

### VS Code

VS Code shows progress messages in the chat turn as the tool executes. Since **September/October 2025** it also renders a **numeric progress bar** (after [PR #266064](https://github.com/microsoft/vscode/pull/266064) fixed an earlier regression where progress was not shown at all).

Only the **text message** is displayed, not raw numeric `progress`/`total` values. The progress bar is positioned in the chat UI alongside the tool invocation card.

### Claude Code

Progress notification support exists but has had regressions. As of recent versions:

- MCP tool calls show "Calling {server}..." but **progress messages were not streamed visibly** during tool execution (regression tracked in [issue #51713](https://github.com/anthropics/claude-code/issues/51713)).
- The changelog notes "Fixed MCP tool progress notifications not rendering in the collapsed tool view."
- A separate known issue: enabling active progress emission on some versions also triggers the stdio transport to close (`-32000 Connection closed` on the next call — tracked in [#47378](https://github.com/anthropics/claude-code/issues/47378)).

> **Recommendation for Zowe MCP server**: gate `notifications/progress` emission behind a feature flag or avoid it for Claude Code until the transport-kill regression is confirmed resolved. The VS Code pipe already handles progress correctly.

---

## 11. Icons (VS Code only)

VS Code (since June 2025) renders icons on MCP servers, resources, and tools. The `icons.src` property accepts:

| Server type | Icon source |
| --- | --- |
| HTTP / SSE | URL from the same origin as the server (`https://example.com/icon.png`) |
| stdio | `file:///` URI pointing to a local file |
| Any | Data URI (`data:image/png;base64,...`) |

Claude Code does not currently render MCP icons.

---

## 12. MCP Apps (VS Code only, January 2026)

MCP Apps are an official MCP extension (not part of the base spec) announced in January 2026. They allow tool calls to return interactive HTML/UI components that render inline in the VS Code chat panel inside a sandboxed iframe.

**Announcement**: [Giving Agents a Visual Voice: MCP Apps Support in VS Code](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support) (January 26, 2026)

**Architecture**:

1. Tool returns `_meta.ui.resourceUri` pointing to a `ui://` resource.
2. Server registers that resource with MIME type `text/html;profile=mcp-app`.
3. VS Code renders the HTML in a sandboxed iframe.
4. The app uses the `@modelcontextprotocol/ext-apps` SDK to communicate bidirectionally with VS Code.

**Use cases**: drag-and-drop list reordering, interactive flame graphs for profiling, feature-flag selectors, forms, Storybook component previews.

**VS Code-specific limitations**:

| Feature | VS Code support |
| --- | --- |
| Display modes | Inline only (no fullscreen or picture-in-picture) |
| `sendMessage` | Fills chat input; does not auto-send |
| Context updates | Appear as chat attachments |
| Clipboard write | Supported |
| Camera / mic / geolocation | Not supported |

**Security**: declare `connectDomains`, `resourceDomains`, and `frameDomains` in the resource definition. CSP is enforced by VS Code.

Claude Code does not implement MCP Apps.

---

## 13. Channels / push messages (Claude Code only)

Claude Code supports an Anthropic-specific extension: MCP servers that declare the `claude/channel` capability can push messages directly into the running Claude Code session without waiting for a tool call. This lets Claude react to external events — CI results, monitoring alerts, incoming chat messages, webhook events.

Enable at startup:

```bash
claude --channels
```

Claude Code does not support this as an MCP client (it exposes no equivalent mechanism to VS Code).

---

## 14. Tool Search / deferred loading (Claude Code only)

By default Claude Code defers all MCP tool schemas from context at session start. Only tool names and server instructions load upfront. When Claude needs a tool, it issues a `ToolSearch` call (which requires Sonnet 4 or later / Opus 4 or later).

Control:

| `ENABLE_TOOL_SEARCH` value | Behaviour |
| --- | --- |
| (unset, default) | All MCP tools deferred; falls back to upfront on Vertex AI |
| `true` | Force all tools deferred (even on Vertex AI) |
| `auto` | Hybrid: upfront if within 10 % of context window, else defer |
| `auto:N` | Hybrid with custom N % threshold |
| `false` | All tools loaded upfront (no deferral) |

VS Code does not implement this pattern — it always provides tools to the model directly.

---

## 15. Sandboxing (VS Code only, macOS/Linux)

VS Code lets you sandbox local stdio MCP servers to restrict file system and network access:

```json
{
  "servers": { "myServer": { "type": "stdio", "command": "...", "sandboxEnabled": true } },
  "sandbox": {
    "filesystem": { "allowWrite": ["${workspaceFolder}"] },
    "network":    { "allowedDomains": ["api.example.com"] }
  }
}
```

When sandboxing is enabled, tool calls are auto-approved (no confirmation dialog). Not available on Windows.

Claude Code has no equivalent sandboxing feature.

---

## 16. Management and configuration

### VS Code

**Extensions view** — the "MCP SERVERS - INSTALLED" section shows all configured servers. Right-click for start/stop/restart/uninstall/show output.

![Screenshot showing the MCP servers in the Extensions view](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/extensions-view-mcp-servers.png)

**Config file editor** — open `.vscode/mcp.json` to see inline code lenses (start / stop / restart) directly above each server definition.

![MCP server configuration with code lenses to manage server](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-server-config-lenses.png)

**Error indicator** — when an MCP server fails, an error badge appears in the Chat view. "Show Output" opens the server log.

![MCP Server Error indicator](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-error-loading-tool.png)

![MCP Server Error output panel](https://code.visualstudio.com/assets/api/extension-guides/ai/mcp/mcp-server-error-output.png)

**Installation options**:

- MCP gallery in Extensions view (`@mcp`)
- `vscode:mcp/install?{json-config}` deep-link URL
- `code --add-mcp '{...}'` CLI
- `.vscode/mcp.json` or user-profile `mcp.json`
- `devcontainer.json` `customizations.vscode.mcp`
- Extension API (`vscode.lm.registerMcpServerDefinitionProvider`)
- Auto-discovery from Claude Desktop

**Development mode**: Add a `dev.watch` glob and `dev.debug` block to the server config for hot-reload on file changes and debugger attachment (Node.js `node` or Python `debugpy`).

**Settings Sync**: MCP server configurations sync across devices when Settings Sync is enabled (enable "MCP Servers" in the sync category list).

### Claude Code

```bash
claude mcp list                    # list all servers and their status
claude mcp get <name>              # details for one server
claude mcp remove <name>           # remove a server
claude mcp add-from-claude-desktop # import from Claude Desktop (macOS / WSL)
/mcp                               # in-session: inspect servers, trigger OAuth
```

**Scopes**:

| Scope | Stored in | Shared |
| --- | --- | --- |
| `local` (default) | `~/.claude.json` per project path | No |
| `project` | `.mcp.json` in project root | Yes (version control) |
| `user` | `~/.claude.json` globally | No (all your projects) |

**Automatic reconnection** — HTTP/SSE servers reconnect with exponential backoff (up to 5 attempts, 1 s initial, doubling each time). Stdio servers are not reconnected automatically.

**Plugin-provided MCP servers** — Claude Code plugins can bundle MCP servers that start automatically when the plugin is enabled.

---

## Summary

VS Code provides the richest MCP client experience: it covers nearly every spec feature including sampling, MCP Apps (interactive UI), server sandboxing, and development-mode debugging. Screenshots and confirmation dialogs make the experience accessible to non-developers.

Claude Code covers the core MCP primitives (tools, prompts, resources, elicitation, OAuth) needed for automation and coding workflows. Its **Tool Search** feature makes it scale better to many MCP servers by keeping context usage low. Sampling is the main gap. Progress notifications have had a reliability regression that may affect long-running Zowe MCP operations.

For the Zowe MCP server, the practical implications are:

- **Elicitation** works in both clients (password collection via URL mode in standalone HTTP).
- **Sampling** is VS Code only — do not rely on it from Claude Code.
- **Progress** — safe in VS Code; test carefully in Claude Code given the known regression.
- **MCP Apps** — VS Code only; not available for Claude Code users.
- **Server instructions** — important for Claude Code Tool Search discovery; keep them under 2 KB.
