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

/**
 * Tests for the MCP Server Card (SEP-2127, draft): the pure `assembleServerCard`
 * builder and the `GET /mcp/server-card` HTTP route (CORS, caching, ETag/304).
 */

import { get as httpGet } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleServerCard } from '../src/server-card.js';
import { createServer, getLogger, getServer } from '../src/server.js';
import { type HttpTransportHandle, startHttp } from '../src/transports/http.js';

interface LocalResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

function getLocal(port: number, path: string, headers?: Record<string, string>): Promise<LocalResponse> {
  return new Promise((resolve, reject) => {
    const req = httpGet(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('assembleServerCard', () => {
  it('produces the required SEP-2127 identity fields', () => {
    const card = assembleServerCard();
    expect(card.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'
    );
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(card.name.split('/').length).toBe(2);
    expect(typeof card.version).toBe('string');
    expect(card.version.length).toBeGreaterThan(0);
    expect(card.description.length).toBeLessThanOrEqual(100);
  });

  it('places capabilityTier under the io.zowe/mcp-server _meta namespace', () => {
    const card = assembleServerCard({ capabilityTier: 'read-strict' });
    const meta = card._meta?.['io.zowe/mcp-server'] as { capabilityTier?: string } | undefined;
    expect(meta?.capabilityTier).toBe('read-strict');
  });

  it('never carries primitive listings or the old SEP-1649 envelope fields', () => {
    const card = assembleServerCard({ capabilityTier: 'full' });
    expect(card).not.toHaveProperty('tools');
    expect(card).not.toHaveProperty('prompts');
    expect(card).not.toHaveProperty('resources');
    expect(card).not.toHaveProperty('resourceTemplates');
    expect(card).not.toHaveProperty('protocolVersion');
    expect(card).not.toHaveProperty('serverInfo');
    expect(card).not.toHaveProperty('_generated');
  });
});

describe('GET /mcp/server-card', () => {
  let handle: HttpTransportHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  });

  async function startServerWithCard(): Promise<HttpTransportHandle> {
    const logger = getLogger();
    handle = await startHttp(
      () => {
        const r = createServer();
        return getServer(r);
      },
      0,
      logger,
      {
        serverCard: assembleServerCard({ capabilityTier: 'read-strict' }),
        getPublicBaseUrl: () => 'https://mcp.example.com',
      }
    );
    return handle;
  }

  it('returns 200 with the SEP-2127 media type, CORS, cache, and ETag headers', async () => {
    const h = await startServerWithCard();
    const res = await getLocal(h.port, '/mcp/server-card');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/mcp-server-card\+json/);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toBe('GET');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type, If-None-Match');
    expect(res.headers['access-control-expose-headers']).toBe('ETag');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers.etag).toBeTruthy();
  });

  it('returns a body whose remotes[0].url ends with /mcp and has no primitive listings', async () => {
    const h = await startServerWithCard();
    const res = await getLocal(h.port, '/mcp/server-card');
    const body = JSON.parse(res.text) as {
      remotes?: { url: string }[];
      tools?: unknown;
      prompts?: unknown;
    };
    expect(body.remotes?.[0]?.url).toMatch(/\/mcp$/);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('prompts');
  });

  it('returns 304 when If-None-Match matches the served ETag', async () => {
    const h = await startServerWithCard();
    const first = await getLocal(h.port, '/mcp/server-card');
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    const second = await getLocal(h.port, '/mcp/server-card', { 'If-None-Match': etag });
    expect(second.statusCode).toBe(304);
  });
});
