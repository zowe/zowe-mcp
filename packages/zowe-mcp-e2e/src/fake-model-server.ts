/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import { appendFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  buildOllamaChatResponse,
  buildOllamaChatStreamLines,
  buildOllamaShowResponse,
  buildOllamaTagsResponse,
  buildOllamaVersionResponse,
} from './ollama-api.js';
import {
  buildOpenAiChatCompletion,
  buildOpenAiModelsResponse,
  buildOpenAiStreamChunks,
} from './openai-api.js';
import { DEFAULT_DATASET_PATTERN, DEFAULT_TOOL_PATTERN, decideResponse } from './script-engine.js';
import type {
  ChatMessage,
  RequestLogEntry,
  ScriptEngineOptions,
  ToolDefinition,
} from './types.js';

export interface FakeModelServerOptions {
  /** Port to listen on; 0 (default) picks a free ephemeral port. */
  port?: number;
  /** Host to bind to; defaults to 127.0.0.1. */
  host?: string;
  /** Model id/name advertised by both surfaces; defaults to "fake-e2e". */
  modelId?: string;
  /** Which tool to auto-call; defaults to /listDatasets/i, matched by substring against the tool name. */
  toolPattern?: RegExp;
  /** Explicit overrides for specific tool-call argument property names. */
  toolArgs?: Record<string, unknown>;
  /** Value used for arguments that look like a data set pattern/name; defaults to "USER1.*". */
  datasetPattern?: string;
  /** If set, every request/response is also appended here as JSON lines. */
  logFile?: string;
  /** Clock used for timestamps/ids; defaults to Date.now. Overridable for deterministic tests. */
  clock?: () => number;
}

export interface FakeModelServer {
  port: number;
  url: string;
  requestLog: RequestLogEntry[];
  close(): Promise<void>;
}

interface Body {
  model?: string;
  messages?: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  name?: string;
  [key: string]: unknown;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Body);
      } catch {
        // Tolerate malformed/empty bodies rather than failing the request.
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(payload));
}

export async function startFakeModelServer(
  options: FakeModelServerOptions = {}
): Promise<FakeModelServer> {
  const modelId = options.modelId ?? 'fake-e2e';
  const clock = options.clock ?? Date.now;
  const logFile = options.logFile;
  const requestLog: RequestLogEntry[] = [];

  const scriptOptions: ScriptEngineOptions = {
    toolPattern: options.toolPattern ?? DEFAULT_TOOL_PATTERN,
    toolArgs: options.toolArgs,
    datasetPattern: options.datasetPattern ?? DEFAULT_DATASET_PATTERN,
    clock,
  };

  function log(entry: Omit<RequestLogEntry, 'timestamp'>): void {
    const full: RequestLogEntry = { timestamp: clock(), ...entry };
    requestLog.push(full);
    if (logFile) {
      appendFileSync(logFile, `${JSON.stringify(full)}\n`);
    }
  }

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname;

    if (method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    try {
      // --- OpenAI-compatible surface ---
      if (method === 'GET' && route === '/v1/models') {
        log({ direction: 'request', surface: 'openai', route, streaming: false, body: null });
        const payload = buildOpenAiModelsResponse(modelId, clock);
        log({ direction: 'response', surface: 'openai', route, streaming: false, body: payload });
        writeJson(res, 200, payload);
        return;
      }

      if (method === 'POST' && route === '/v1/chat/completions') {
        const body = await readBody(req);
        const streaming = body.stream === true;
        log({ direction: 'request', surface: 'openai', route, streaming, body });
        const decision = decideResponse(body.messages ?? [], body.tools, scriptOptions);

        if (streaming) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...CORS_HEADERS,
          });
          const chunks = buildOpenAiStreamChunks(decision, modelId, clock);
          for (const chunk of chunks) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          log({
            direction: 'response',
            surface: 'openai',
            route,
            streaming: true,
            body: { chunks },
          });
          res.end();
          return;
        }

        const payload = buildOpenAiChatCompletion(decision, modelId, clock);
        log({ direction: 'response', surface: 'openai', route, streaming: false, body: payload });
        writeJson(res, 200, payload);
        return;
      }

      // --- Ollama-compatible surface ---
      if (method === 'GET' && route === '/api/tags') {
        log({ direction: 'request', surface: 'ollama', route, streaming: false, body: null });
        const payload = buildOllamaTagsResponse(modelId, clock);
        log({ direction: 'response', surface: 'ollama', route, streaming: false, body: payload });
        writeJson(res, 200, payload);
        return;
      }

      if (method === 'GET' && route === '/api/version') {
        log({ direction: 'request', surface: 'ollama', route, streaming: false, body: null });
        const payload = buildOllamaVersionResponse();
        log({ direction: 'response', surface: 'ollama', route, streaming: false, body: payload });
        writeJson(res, 200, payload);
        return;
      }

      if (method === 'POST' && route === '/api/show') {
        const body = await readBody(req);
        log({ direction: 'request', surface: 'ollama', route, streaming: false, body });
        const payload = buildOllamaShowResponse(modelId, clock);
        log({ direction: 'response', surface: 'ollama', route, streaming: false, body: payload });
        writeJson(res, 200, payload);
        return;
      }

      if (method === 'POST' && route === '/api/chat') {
        const body = await readBody(req);
        // Ollama's real default is streaming unless the caller explicitly opts out.
        const streaming = body.stream !== false;
        log({ direction: 'request', surface: 'ollama', route, streaming, body });
        const decision = decideResponse(body.messages ?? [], body.tools, scriptOptions);

        if (streaming) {
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            ...CORS_HEADERS,
          });
          const lines = buildOllamaChatStreamLines(decision, modelId, clock);
          for (const line of lines) {
            res.write(`${JSON.stringify(line)}\n`);
          }
          log({
            direction: 'response',
            surface: 'ollama',
            route,
            streaming: true,
            body: { lines },
          });
          res.end();
          return;
        }

        const payload = buildOllamaChatResponse(decision, modelId, clock);
        log({ direction: 'response', surface: 'ollama', route, streaming: false, body: payload });
        writeJson(res, 200, payload);
        return;
      }

      writeJson(res, 404, { error: { message: `not found: ${method} ${route}` } });
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(`[fake-model-server] unhandled error for ${method} ${route}:\n${detail}`);
      log({
        direction: 'response',
        surface: url.pathname.startsWith('/api') ? 'ollama' : 'openai',
        route,
        streaming: false,
        body: { error: detail },
      });
      writeJson(res, 500, { error: { message: 'internal server error' } });
    }
  }

  await new Promise<void>(resolve => {
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fake model server failed to bind to a port');
  }
  const { port } = address;
  const host = options.host ?? '127.0.0.1';

  return {
    port,
    url: `http://${host}:${port}`,
    requestLog,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      }),
  };
}
