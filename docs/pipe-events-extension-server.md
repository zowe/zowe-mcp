# Pipe Events Between Extension and MCP Server

<!-- markdownlint-disable MD060 -->

This document explains how the Zowe MCP VS Code extension and the Zowe MCP server communicate **outside** the MCP protocol (stdio/HTTP). It is intended for developers who want to implement similar bidirectional communication between their own VS Code extension and an MCP server (or any long-lived child process).

---

## Why a Separate Channel?

The MCP transport (stdio or HTTP) is used for the Model Context Protocol: tools, resources, prompts. Sometimes you need a **second channel** for:

- **Extension → Server**: Push settings (e.g. log level, system list) without restarting the server.
- **Server → Extension**: Show logs in the VS Code Output panel, show notifications, or request secrets (e.g. passwords) from the extension’s Secret Storage or UI.

Zowe MCP uses a **named pipe** (Unix domain socket on macOS/Linux, Windows named pipe) for this. The extension runs the **pipe server**; the server runs the **pipe client**. They exchange typed **events** as newline-delimited JSON (NDJSON).

We use pipes but we are not connected to [Pied Piper](https://silicon-valley.fandom.com/wiki/Pied_Piper_(company)). We don’t do middle-out compression — we do AI and mainframe integration.

---

## Registering the MCP Server with VS Code and Copilot

To make your MCP server available inside VS Code and to AI features (e.g. GitHub Copilot Chat), the extension uses the **MCP API** to register a **server definition provider**. VS Code then starts your server process when needed and routes tool/resource requests to it.

### Contribution point

In your extension’s `package.json`, declare an MCP server definition provider:

```json
"contributes": {
  "mcpServerDefinitionProviders": [
    { "id": "your-mcp-id", "label": "Your MCP" }
  ]
}
```

- **id**: Unique identifier for your provider (e.g. `zowe`, `my-tools`). Copilot exposes tools as `mcp_<id>_<toolName>` (e.g. `mcp_zowe_listDatasets`).
- **label**: Human-readable name shown in the UI.

### Provider API

In your extension’s `activate()` function, register the provider with the same `id`:

```ts
context.subscriptions.push(
  vscode.lm.registerMcpServerDefinitionProvider('your-mcp-id', {
    provideMcpServerDefinitions: () => {
      const serverModule = path.join(context.extensionPath, 'server', 'index.js');
      const args = [serverModule, '--stdio'];
      return [
        new vscode.McpStdioServerDefinition(
          'Your MCP',           // display name
          'node',               // command to run
          args,                 // arguments (e.g. path to server script + --stdio)
          {                     // optional env for the server process
            MCP_DISCOVERY_DIR: discoveryDir,
            WORKSPACE_ID: workspaceId,
          }
        ),
      ];
    },
  })
);
```

- **vscode.lm** is the Language Model API (VS Code 1.101+). It hosts MCP servers used by Copilot and other chat/agent features.
- **provideMcpServerDefinitions** is called when VS Code needs to start or enumerate MCP servers. Return one or more definitions.
- **McpStdioServerDefinition(name, command, args, env)** describes a server that runs as a child process and speaks MCP over stdio. The `env` object is passed as the process environment, which is how the extension passes the pipe discovery path and workspace id so the server can connect to the pipe.

You can return different definitions based on workspace configuration (e.g. different `args` or `env` per workspace or setting).

### How it fits with the pipe

1. Extension starts the **pipe server** and gets `discoveryDir` and `workspaceId`.
2. Extension registers **provideMcpServerDefinitions** and returns an **McpStdioServerDefinition** whose `env` includes `MCP_DISCOVERY_DIR` and `WORKSPACE_ID`.
3. When VS Code (or Copilot) starts the MCP server, it runs `node server/index.js --stdio` with that env.
4. The server reads the discovery file, connects to the pipe, and can then send/receive events (logs, settings, secrets) in addition to handling MCP tools over stdio.

So: **MCP protocol = stdio** (tools, resources, prompts). **Pipe = extra channel** (logs, notifications, settings, secrets) enabled by the same `env` you pass in the server definition.

**Tying it together in `activate()`:**

```ts
export function activate(context: vscode.ExtensionContext): void {
  const { workspaceId, discoveryDir } = startPipeServer(context);

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('your-mcp-id', {
      provideMcpServerDefinitions: () => [
        new vscode.McpStdioServerDefinition('Your MCP', 'node', [serverModule, '--stdio'], {
          MCP_DISCOVERY_DIR: discoveryDir,
          WORKSPACE_ID: workspaceId,
        }),
      ],
    })
  );

  // Optional: when settings change, push to connected servers
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('your-mcp.logLevel')) {
        const level = vscode.workspace.getConfiguration('your-mcp').get('logLevel', 'info');
        sendLogLevelEvent(level);  // sends over pipe to all connected servers
      }
    })
  );
}
```

---

## High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│  VS Code Extension (Node.js in extension host)                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Pipe server (net.createServer)                                │ │
│  │  - Listens on socket path (e.g. /tmp/zowe-mcp-<workspace>.sock)│ │
│  │  - Writes discovery file: mcp-discovery-<workspaceId>.json     │ │
│  │  - On connection: parse NDJSON, dispatch to event handler      │ │
│  │  - sendEventToServers(): write NDJSON to all client sockets    │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
         │                                    ▲
         │ discovery dir + workspace id       │ events (NDJSON)
         │ (env vars on server process)       │
         ▼                                    │
┌───────────────────────────────────────────────────────────────────┐
│  MCP Server (separate Node process, e.g. node server.js --stdio)  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Extension client (connects to pipe)                         │ │
│  │  - Reads MCP_DISCOVERY_DIR, WORKSPACE_ID from env            │ │
│  │  - Reads discovery file → socket path                        │ │
│  │  - Connects; retries until discovery file appears            │ │
│  │  - sendEvent(): write NDJSON to socket                       │ │
│  │  - onEvent(): parse NDJSON, dispatch to registered handlers─ │ │
│  └──────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

- **Extension** starts the pipe server on activation and passes `discoveryDir` and `workspaceId` to the server process via the MCP server definition’s `env`.
- **Server** reads `MCP_DISCOVERY_DIR` and `WORKSPACE_ID`, locates the discovery file, connects to the socket path found there, then sends and receives events.

---

## Discovery Mechanism

The extension must tell the server **where** to connect. It does that with a **discovery file** plus **environment variables**.

### 1. Extension: where to put the file

- Use a stable, writable directory. Zowe uses the extension’s **global storage path**: `context.globalStorageUri.fsPath`.
- Ensure the directory exists (e.g. `fs.mkdirSync(discoveryDir, { recursive: true })`).

**Workspace id and pipe path (extension):**

```ts
function getWorkspaceId(): string {
  const folderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folderPath) {
    return crypto.createHash('md5').update(folderPath).digest('hex').substring(0, 8);
  }
  return `window-${Date.now()}`;
}

function getPipeName(workspaceId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\zowe-mcp-${workspaceId}`;
  }
  return path.join('/tmp', `zowe-mcp-${workspaceId}.sock`);
}

// In activate():
const discoveryDir = context.globalStorageUri.fsPath;
const workspaceId = getWorkspaceId();
const pipeName = getPipeName(workspaceId);
```

### 2. Extension: what to write

Write a JSON file per “session” or workspace. Zowe uses:

- **Filename**: `mcp-discovery-<workspaceId>.json`
- **Contents** (example):

```json
{
  "socketPath": "/tmp/zowe-mcp-a1b2c3d4.sock",
  "workspaceId": "a1b2c3d4",
  "timestamp": 1234567890123,
  "pid": 12345
}
```

- `socketPath`: path the server must use to connect (Unix socket path or Windows pipe path).
- `workspaceId`: short, stable id for the workspace (e.g. hash of first folder path) so one file per workspace.
- `timestamp` / `pid`: optional; useful for debugging or cleanup.

**Writing the discovery file (extension, inside `server.listen` callback):**

```ts
fs.mkdirSync(discoveryDir, { recursive: true });
const discoveryFile = path.join(discoveryDir, `mcp-discovery-${workspaceId}.json`);
fs.writeFileSync(
  discoveryFile,
  JSON.stringify({
    socketPath: pipeName,
    workspaceId,
    timestamp: Date.now(),
    pid: process.pid,
  })
);
```

### 3. Server: how to find the file

- **Environment variables** (set by the extension when it spawns the server):
  - `MCP_DISCOVERY_DIR`: directory containing the discovery file.
  - `WORKSPACE_ID`: same id used in the filename.
- **Path**: `path.join(MCP_DISCOVERY_DIR, 'mcp-discovery-' + WORKSPACE_ID + '.json')`.

**Reading discovery and deciding whether to connect (server):**

```ts
const discoveryDir = process.env.MCP_DISCOVERY_DIR;
const workspaceId = process.env.WORKSPACE_ID;

if (!discoveryDir || !workspaceId) {
  // Standalone mode: no pipe, run without extension
  return undefined;
}

const discoveryPath = join(discoveryDir, `mcp-discovery-${workspaceId}.json`);
// Then: poll for file existence, read JSON, get discovery.socketPath, connect(socketPath)
```

The extension sets these in the MCP server definition, for example:

```ts
new vscode.McpStdioServerDefinition('YourName', 'node', [serverModule, '--stdio'], {
  MCP_DISCOVERY_DIR: discoveryDir,
  WORKSPACE_ID: workspaceId,
});
```

### 4. Timing and retries

The server process may start **before** the discovery file exists. Zowe’s client retries reading the file (e.g. up to 10 times, 1 second apart). If the file never appears, the server continues without the pipe (standalone mode).

**Server: connect with retries:**

```ts
const MAX_CONNECT_ATTEMPTS = 10;
const CONNECT_RETRY_MS = 1000;

async connect(discoveryDir: string, workspaceId: string, logger: Logger): Promise<void> {
  const discoveryPath = join(discoveryDir, `mcp-discovery-${workspaceId}.json`);

  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    if (existsSync(discoveryPath)) {
      try {
        const raw = readFileSync(discoveryPath, 'utf-8');
        const discovery = JSON.parse(raw) as { socketPath: string };
        await this._connectToPipe(discovery.socketPath, logger);
        return;
      } catch (err) {
        logger.warning(`Extension pipe connect attempt ${attempt} failed`, err);
      }
    }
    if (attempt < MAX_CONNECT_ATTEMPTS) {
      await new Promise<void>(r => setTimeout(r, CONNECT_RETRY_MS));
    }
  }
  logger.warning('Could not connect to VS Code extension pipe after all retries');
}
```

---

## Wire Format: NDJSON

Every message is a **single line**: one JSON object followed by a newline (`\n`). No length prefix.

- **Framing**: split incoming data on `\n`, buffer incomplete lines for the next chunk.
- **Encoding**: UTF-8.

**Parsing incoming NDJSON (same pattern on both sides):**

```ts
let buffer = '';
socket.on('data', (data: Buffer) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';  // keep incomplete line for next chunk
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const event = JSON.parse(line);
    dispatchByType(event);
  }
});
```

Example:

```json
{"type":"log","data":{"level":"info","message":"Started"},"timestamp":1234567890}
{"type":"log-level","data":{"level":"debug"},"timestamp":1234567891}
```

---

## Event Envelope

All events share a common envelope. Zowe uses:

```ts
interface McpEvent<T extends string = string, D = unknown> {
  type: T;
  data: D;
  timestamp: number;  // e.g. Date.now()
}
```

- `type`: discriminator for the event (e.g. `"log"`, `"log-level"`).
- `data`: payload; shape depends on `type`.
- `timestamp`: optional but useful for ordering and debugging.

**Union types (server vs extension direction):**

```ts
// Server → Extension
export type ServerToExtensionEvent =
  | McpEvent<'log', LogEventData>
  | McpEvent<'notification', NotificationEventData>
  | McpEvent<'request-password', RequestPasswordEventData>
  | McpEvent<'password-invalid', PasswordInvalidEventData>;

// Extension → Server
export type ExtensionToServerEvent =
  | McpEvent<'log-level', LogLevelEventData>
  | McpEvent<'password', PasswordEventData>
  | McpEvent<'systems-update', SystemsUpdateEventData>;
```

---

## Event Direction and Types

Define two unions: events **server → extension** and **extension → server**.

### Server → Extension (examples in Zowe)

| type                 | Purpose                            | data (example)                                    |
|----------------------|------------------------------------|---------------------------------------------------|
| `log`                | Show in VS Code Output channel     | `{ level, logger?, message, data? }`              |
| `notification`       | Show message (info/warning/error)  | `{ severity, message }`                           |
| `request-password`   | Ask extension for a secret         | `{ user, host, port? }`                           |
| `password-invalid`   | Tell extension to delete secret    | `{ user, host, port? }`                           |

### Extension → Server (examples in Zowe)

| type             | Purpose                   | data (example)                    |
|------------------|---------------------------|-----------------------------------|
| `log-level`      | Change server log level   | `{ level }`                       |
| `password`       | Supply requested password | `{ user, host, port?, password }` |
| `systems-update` | Update list of systems    | `{ systems: string[] }`           |

You can add your own event types; keep the same envelope and document `type` and `data` for each.

**Example payload type (server → extension):**

```ts
interface LogEventData {
  level: LogLevel;
  logger?: string;
  message: string;
  data?: unknown;
}
// Event: { type: 'log', data: LogEventData, timestamp: number }
```

**Example: extension sends log-level (extension → server):**

```ts
sendEventToServers({
  type: 'log-level',
  data: { level: 'debug' },
  timestamp: Date.now(),
});
```

---

## Implementation Checklist

### Extension (pipe server)

1. **Start the pipe server on activation**
   - Choose a **pipe/socket path** (see `getPipeName` in Discovery above).
   - On Unix, remove a stale socket file if it exists, then `net.createServer()` and `server.listen(pipeName)`.

   ```ts
   if (process.platform !== 'win32' && fs.existsSync(pipeName)) {
   fs.unlinkSync(pipeName);
   }
   const server = net.createServer((socket: net.Socket) => {
   connectedClients.push(socket);
   let buffer = '';
   socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
         if (line.trim().length === 0) continue;
         const event = JSON.parse(line);
         handleServerEvent(log, event, { context, sendEventToServers });
      }
      // ... error, close
   });
   });
   server.listen(pipeName, () => { /* write discovery file */ });
   ```

2. **Write the discovery file** after `server.listen` callback:
   - Path: `path.join(discoveryDir, 'mcp-discovery-' + workspaceId + '.json')`.
   - Content: `{ socketPath, workspaceId, timestamp, pid }` (or your schema).

3. **Pass env to the server**
   - In `McpStdioServerDefinition(..., { env })`, set `MCP_DISCOVERY_DIR: discoveryDir` and `WORKSPACE_ID: workspaceId` (or your own names).

4. **Handle incoming data from each client socket**
   - Accumulate data in a buffer; split on `\n`; parse each line as JSON; dispatch by `event.type` to your handler (e.g. show in Output channel, show notification, store/retrieve secrets, send response events).

5. **Send events to the server**
   - Keep a list of connected client sockets. When you want to push an event (e.g. settings changed), `JSON.stringify(event) + '\n'` and `socket.write(payload)` for each writable socket.

   ```ts
   const connectedClients: net.Socket[] = [];

   function sendEventToServers(event: ExtensionToServerEvent): void {
   const payload = JSON.stringify(event) + '\n';
   for (const socket of connectedClients) {
      if (socket.writable) socket.write(payload);
   }
   }
   ```

6. **Cleanup on deactivation**
   - In `context.subscriptions`, dispose: close all client sockets, `server.close()`, remove socket file (Unix), delete discovery file.

```ts
context.subscriptions.push({
  dispose: () => {
    for (const socket of connectedClients) socket.destroy();
    connectedClients.length = 0;
    server.close();
    if (process.platform !== 'win32' && fs.existsSync(pipeName)) fs.unlinkSync(pipeName);
    if (fs.existsSync(discoveryFile)) fs.unlinkSync(discoveryFile);
  },
});
```

### Server (pipe client)

1. **Optional connection**
   - Read `MCP_DISCOVERY_DIR` and `WORKSPACE_ID`. If either is missing, skip the pipe and run without it (e.g. standalone mode).

2. **Connect**
   - See “Timing and retries” above for the retry loop. Use `net.connect(socketPath)`; on `connect`, store the socket and consider the pipe ready.

3. **Send events**
   - When you need to notify the extension: build an object `{ type, data, timestamp }`, then `socket.write(JSON.stringify(event) + '\n')`. Guard with `socket?.writable`.

   ```ts
   sendEvent(event: ServerToExtensionEvent): void {
   if (this._socket?.writable) {
      this._socket.write(JSON.stringify(event) + '\n');
   }
   }
   ```

4. **Receive events**
   - On `socket.on('data', ...)`: append to a buffer; split on `\n`; for each complete line, `JSON.parse(line)` and dispatch by `event.type` to registered handlers.

   ```ts
   extensionClient.onEvent(event => {
   if (event.type === 'log-level') {
      logger.setLevel(event.data.level);
   }
   if (event.type === 'password') {
      const { user, host, port, password } = event.data;
      passwordStore.set(cacheKey({ user, host, port: port ?? 22 }), password);
   }
   });
   ```

5. **Lifecycle**
   - On `close` or `error`, set socket to null and optionally log. Do not crash the server; the rest of the app can continue without the pipe.

---

## Platform Notes

- **Unix**: Socket path is a file path (e.g. `/tmp/...sock`). The extension must delete any leftover file before `listen()` and on dispose.
- **Windows**: Pipe name is `\\.\pipe\<name>`. No file to delete; the kernel manages the pipe.

Use a small helper so both sides use the same path format (see `getPipeName` in “Discovery – Extension: where to put the file”).

---

## Security and Secrets

- The pipe is **local** (no network). Only processes that can read the discovery directory and connect to the socket can talk to the extension.
- For **passwords**, Zowe’s pattern is:
  - Server sends `request-password` with `user`/`host` (and optional `port`).
  - Extension reads from `context.secrets` (SecretStorage) or prompts the user, then sends a `password` event.
  - If the server detects an invalid password, it sends `password-invalid`; the extension deletes that secret so it is not reused.

You can mirror this pattern for your own secrets.

---

## Benefits of This Integration

Combining the **MCP server provider API** (registration with VS Code/Copilot) and the **pipe** (extension ↔ server events) gives you:

| Benefit | Description |
|---------|-------------|
| **Single install** | Users install one VS Code extension; the MCP server is bundled and started by VS Code. No separate “run the server” step. |
| **AI/Copilot integration** | Tools are exposed to GitHub Copilot Chat and other language-model features. The provider id namespaces tools (e.g. `mcp_zowe_listDatasets`). |
| **Settings-driven behavior** | Extension reads VS Code settings (e.g. mock data dir, log level, system list) and passes them via server args or env. The server can adapt without user-editing config files. |
| **Dynamic updates without restart** | The pipe lets the extension push changes (log level, system list) to the server at runtime. Users change a setting and the server reacts immediately. |
| **Unified logging and UX** | Server logs and notifications go over the pipe to the extension, which shows them in the Output channel and as VS Code messages. One place for the user to see what the server is doing. |
| **Secure secrets** | The server can ask for passwords via the pipe; the extension uses SecretStorage or a prompt and sends the secret back. Invalid credentials can be cleared from storage so they are not reused. |
| **Per-workspace server** | Discovery uses a workspace id, so each workspace can have its own server process and its own pipe connection, matching VS Code’s model. |
| **Leverage VS Code APIs** | The extension can use any VS Code API on behalf of the server. For example: send **telemetry** (e.g. tool usage, errors) via `vscode.env.sendTelemetryEvent`, open documents or webviews, run tasks, or integrate with other extensions. The server sends events over the pipe; the extension translates them into VS Code API calls. |

Together, the provider API and the pipe make the MCP server feel like a native part of the editor: configured via Settings, visible in the Output panel, and able to use VS Code’s secret storage and UI.

---

## Summary

| Concern              | Approach                                                                  |
|----------------------|---------------------------------------------------------------------------|
| Who is server/client | Extension = pipe **server**; MCP server process = pipe **client**         |
| Discovery            | Extension writes a JSON file (path + workspace id); server reads via env  |
| Wire format          | One JSON object per line (NDJSON), UTF-8                                  |
| Event shape          | `{ type, data, timestamp }`; define unions for each direction             |
| When env missing     | Server skips pipe and runs in standalone mode                             |
| Retries              | Server retries reading discovery file until success or limit              |
| Cleanup              | Extension closes sockets, server; deletes socket file and discovery file  |

Implementing these steps in your own extension and server will give you a robust, bidirectional event channel alongside the MCP protocol. For concrete code, see:

- **Extension**: `packages/zowe-mcp-vscode/src/pipe-server.ts`, `event-handler.ts`, and `extension.ts` (env and `startPipeServer`).
- **Server**: `packages/zowe-mcp-server/src/extension-client.ts`, `events.ts`, and `index.ts` (connect and event handlers).
