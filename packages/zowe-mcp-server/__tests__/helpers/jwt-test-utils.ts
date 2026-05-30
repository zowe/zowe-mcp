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
 * Shared JWT test helpers: URL extraction, base64url encoding, RS256 signing,
 * and HTTP helpers used by bearer-jwt, http-transport-jwt, and keycloak JWT tests.
 */

import type { KeyObject } from 'node:crypto';
import { createSign } from 'node:crypto';
import { request as httpRequest } from 'node:http';

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

export function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signJwt(
  payload: Record<string, unknown>,
  privateKey: KeyObject,
  kid: string
): string {
  const header = { alg: 'RS256', kid };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  sign.end();
  const sig = sign.sign(privateKey);
  return `${data}.${b64url(sig)}`;
}

/** POST JSON to a local HTTP MCP server. Does not use global `fetch`. */
export function postMcpLocal(
  port: number,
  body: object,
  extraHeaders: Record<string, string> = {}
): Promise<{ statusCode: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...extraHeaders,
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
