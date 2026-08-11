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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeModelServer, type FakeModelServer } from '../src/fake-model-server.js';
import type { ToolDefinition } from '../src/types.js';

const listDatasetsTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'mcp_zowe_listDatasets',
    description: 'List data sets matching a pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Data set search pattern' },
      },
      required: ['pattern'],
    },
  },
};

const TOOL_RESULT_CONTENT = 'USER1.DATA1\nUSER1.DATA2\nUSER1.COBOL.SRC';

describe('fake-model-server', () => {
  let server: FakeModelServer;

  beforeAll(async () => {
    server = await startFakeModelServer({ modelId: 'fake-e2e-test' });
  });

  afterAll(async () => {
    await server.close();
  });

  it('lists exactly one model on the OpenAI surface', async () => {
    const res = await fetch(`${server.url}/v1/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('fake-e2e-test');
  });

  it('lists exactly one model on the Ollama surface', async () => {
    const res = await fetch(`${server.url}/api/tags`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { name: string }[] };
    expect(body.models).toHaveLength(1);
    expect(body.models[0].name).toBe('fake-e2e-test:latest');
  });

  it('reports version on the Ollama surface', async () => {
    const res = await fetch(`${server.url}/api/version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string };
    expect(typeof body.version).toBe('string');
  });

  it('reports tools capability on /api/show', async () => {
    const res = await fetch(`${server.url}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'fake-e2e-test:latest' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capabilities: string[] };
    expect(body.capabilities).toContain('tools');
    expect(body.capabilities).toContain('completion');
  });

  it('replies with the ask-mode sentinel when no tools are offered', async () => {
    const res = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-e2e-test',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      }),
    });
    const body = (await res.json()) as {
      choices: { message: { content: string }; finish_reason: string }[];
    };
    expect(body.choices[0].message.content).toBe('E2E-SENTINEL-PONG');
    expect(body.choices[0].finish_reason).toBe('stop');
  });

  it('drives a full tool-call -> tool-result -> sentinel flow over non-streaming OpenAI chat completions', async () => {
    const firstRes = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-e2e-test',
        messages: [{ role: 'user', content: 'list my data sets' }],
        tools: [listDatasetsTool],
        stream: false,
      }),
    });
    expect(firstRes.status).toBe(200);
    const first = (await firstRes.json()) as {
      choices: {
        message: {
          role: string;
          content: string | null;
          tool_calls?: {
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }[];
        };
        finish_reason: string;
      }[];
    };

    expect(first.choices[0].finish_reason).toBe('tool_calls');
    expect(first.choices[0].message.content).toBeNull();
    const toolCall = first.choices[0].message.tool_calls?.[0];
    expect(toolCall).toBeDefined();
    expect(toolCall?.function.name).toBe('mcp_zowe_listDatasets');
    const parsedArgs = JSON.parse(toolCall!.function.arguments) as { pattern: string };
    expect(parsedArgs.pattern).toBe('USER1.*');

    const secondRes = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-e2e-test',
        messages: [
          { role: 'user', content: 'list my data sets' },
          { role: 'assistant', content: null, tool_calls: first.choices[0].message.tool_calls },
          { role: 'tool', tool_call_id: toolCall!.id, content: TOOL_RESULT_CONTENT },
        ],
        tools: [listDatasetsTool],
        stream: false,
      }),
    });
    expect(secondRes.status).toBe(200);
    const second = (await secondRes.json()) as {
      choices: { message: { content: string }; finish_reason: string }[];
    };
    expect(second.choices[0].finish_reason).toBe('stop');
    expect(second.choices[0].message.content).toContain('E2E-SENTINEL-OK');
    expect(second.choices[0].message.content).toContain('USER1.DATA1');
  });

  it('emits a well-formed OpenAI SSE tool-call stream', async () => {
    const res = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-e2e-test',
        messages: [{ role: 'user', content: 'list my data sets' }],
        tools: [listDatasetsTool],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    const dataLines = text
      .split('\n\n')
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.startsWith('data: '))
      .map(chunk => chunk.slice('data: '.length));

    expect(dataLines[dataLines.length - 1]).toBe('[DONE]');
    const events = dataLines.slice(0, -1).map(line => JSON.parse(line) as unknown) as {
      object: string;
      choices: {
        delta: {
          role?: string;
          tool_calls?: {
            index: number;
            id?: string;
            type?: string;
            function: { name?: string; arguments?: string };
          }[];
        };
        finish_reason: string | null;
      }[];
    }[];

    expect(events.length).toBeGreaterThan(2);
    events.forEach(event => expect(event.object).toBe('chat.completion.chunk'));

    const first = events[0].choices[0];
    expect(first.delta.role).toBe('assistant');
    expect(first.delta.tool_calls?.[0].id).toMatch(/^call_/);
    expect(first.delta.tool_calls?.[0].type).toBe('function');
    expect(first.delta.tool_calls?.[0].function.name).toBe('mcp_zowe_listDatasets');
    expect(first.delta.tool_calls?.[0].index).toBe(0);

    // Reassemble the streamed argument fragments and confirm they form valid JSON.
    const argumentFragments = events
      .slice(1, -1)
      .map(event => event.choices[0].delta.tool_calls?.[0]?.function.arguments ?? '');
    const reassembled = JSON.parse(argumentFragments.join('')) as { pattern: string };
    expect(reassembled.pattern).toBe('USER1.*');

    const last = events[events.length - 1].choices[0];
    expect(last.finish_reason).toBe('tool_calls');
  });

  it('emits a well-formed Ollama NDJSON tool-call stream with object-typed arguments', async () => {
    const res = await fetch(`${server.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-e2e-test:latest',
        messages: [{ role: 'user', content: 'list my data sets' }],
        tools: [listDatasetsTool],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const text = await res.text();
    const lines = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as unknown) as {
      model: string;
      done: boolean;
      done_reason?: string;
      message: {
        role?: string;
        content: string;
        tool_calls?: { function: { name: string; arguments: unknown } }[];
      };
    }[];

    expect(lines.length).toBeGreaterThanOrEqual(2);
    const toolCallLine = lines.find(line => line.message.tool_calls);
    expect(toolCallLine).toBeDefined();
    const toolCall = toolCallLine!.message.tool_calls![0];
    expect(toolCall.function.name).toBe('mcp_zowe_listDatasets');
    // Ollama tool call arguments must be a JSON object, not a stringified JSON.
    expect(typeof toolCall.function.arguments).toBe('object');
    expect((toolCall.function.arguments as { pattern: string }).pattern).toBe('USER1.*');

    const finalLine = lines[lines.length - 1];
    expect(finalLine.done).toBe(true);
    expect(finalLine.done_reason).toBe('tool_calls');
  });

  it('drives the tool-result -> sentinel flow over non-streaming Ollama chat', async () => {
    const res = await fetch(`${server.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-e2e-test:latest',
        messages: [
          { role: 'user', content: 'list my data sets' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'mcp_zowe_listDatasets', arguments: { pattern: 'USER1.*' } } },
            ],
          },
          { role: 'tool', content: TOOL_RESULT_CONTENT },
        ],
        tools: [listDatasetsTool],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: { content: string };
      done: boolean;
      done_reason: string;
    };
    expect(body.done).toBe(true);
    expect(body.done_reason).toBe('stop');
    expect(body.message.content).toContain('E2E-SENTINEL-OK');
    expect(body.message.content).toContain('USER1.DATA1');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await fetch(`${server.url}/not-a-real-route`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('not found');
  });

  it('records requests and responses in the in-memory request log', async () => {
    const before = server.requestLog.length;
    await fetch(`${server.url}/v1/models`);
    expect(server.requestLog.length).toBeGreaterThan(before);
    const last = server.requestLog[server.requestLog.length - 1];
    expect(last.surface).toBe('openai');
    expect(typeof last.timestamp).toBe('number');
  });
});
