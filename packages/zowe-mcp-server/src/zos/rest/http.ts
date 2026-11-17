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

import { readFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { request } from 'node:https';
import type { RestConnection } from './connection.js';

export interface RestResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export class RestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly rc?: number
  ) {
    const guidance =
      status === 401
        ? ' Re-authenticate and restart the MCP server if using environment credentials.'
        : status === 403
          ? ' Your SAF identity is not authorized for this resource.'
          : status === 412
            ? ' Content changed since it was read. Read it again before editing; the write was not retried.'
            : status === 501
              ? ' This operation is not supported by this zo-rest server.'
              : '';
    super(`zo-rest HTTP ${status}: ${message}${guidance}`);
    this.name = 'RestError';
  }
}

const MAX_CONTENT_BYTES = 100 * 1024 * 1024;

/** A gateway can echo request credentials in a diagnostic. Scrub only error responses. */
function redactErrorResponse(
  response: RestResponse,
  authorization: string | undefined,
  requestBody?: Buffer,
  requestHeaders?: Record<string, string>
): RestResponse {
  if (response.status < 300) return response;
  const secrets = new Set<string>(authorization ? [authorization] : []);
  for (const [name, value] of Object.entries(requestHeaders ?? {})) {
    if (/authorization|cookie/i.test(name)) {
      secrets.add(value);
      for (const pair of value.split(';')) {
        const index = pair.indexOf('=');
        if (index >= 0 && pair.slice(index + 1).trim()) secrets.add(pair.slice(index + 1).trim());
      }
    }
  }
  const [scheme = '', encoded] = authorization?.split(' ', 2) ?? [];
  if (encoded) secrets.add(encoded);
  if (scheme.toLowerCase() === 'basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon >= 0 && decoded.slice(colon + 1)) secrets.add(decoded.slice(colon + 1));
  }
  function collect(value: unknown, depth = 0): void {
    if (!value || typeof value !== 'object' || depth > 8) return;
    for (const [key, item] of Object.entries(value)) {
      if (
        /password|passphrase|secret|token|credential/i.test(key) &&
        typeof item === 'string' &&
        item
      )
        secrets.add(item);
      else collect(item, depth + 1);
    }
  }
  if (requestBody) {
    try {
      collect(JSON.parse(requestBody.toString('utf8')) as unknown);
    } catch {
      /* Content is not a credential JSON request. */
    }
  }
  const values = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  const scrub = (value: string): string => {
    for (const secret of values)
      value = value
        .replaceAll(secret, '[redacted]')
        .replaceAll(encodeURIComponent(secret), '[redacted]');
    return value;
  };
  function redact(value: unknown): unknown {
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [scrub(key), redact(item)])
      );
    return value;
  }
  let body: string;
  try {
    body = JSON.stringify(redact(JSON.parse(response.body.toString('utf8')) as unknown));
  } catch {
    body = scrub(response.body.toString('utf8'));
  }
  return { ...response, body: Buffer.from(body, 'utf8') };
}

/** A bounded HTTPS client. Does not follow redirects or log headers, payloads, or credentials. */
export class RestHttpClient {
  private readonly ca?: Buffer;

  constructor(private readonly connection: RestConnection) {
    if (connection.caFile) this.ca = readFileSync(connection.caFile);
  }

  async send(
    url: URL,
    authorization: string | undefined,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Buffer;
    } = {}
  ): Promise<RestResponse> {
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Unsafe zo-rest URL.');
    const method = options.method ?? 'GET';
    const body = options.body === undefined ? undefined : Buffer.from(options.body);
    if (body && body.length > MAX_CONTENT_BYTES)
      throw new Error('zo-rest content exceeds the 100 MiB request limit.');
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.once(url, authorization, method, options.headers, body);
        // GET is the only method that may be retried, at most once. Never replay a mutation.
        if (method === 'GET' && attempt === 0 && [502, 503, 504].includes(response.status))
          continue;
        return redactErrorResponse(response, authorization, body, options.headers);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          method === 'GET' &&
          attempt === 0 &&
          ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code ?? '')
        )
          continue;
        // Do not include request objects, headers, or remote HTML error pages in diagnostics.
        throw new Error(
          `Unable to reach zo-rest at ${url.host}${code ? ` (${code})` : ''}. Check the URL, network, site CA (caFile or NODE_EXTRA_CA_CERTS), and timeoutSeconds.`
        );
      }
    }
  }

  private once(
    url: URL,
    authorization: string | undefined,
    method: string,
    headers?: Record<string, string>,
    body?: Buffer
  ): Promise<RestResponse> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), this.connection.timeoutSeconds * 1000);
      const req = request(
        url,
        {
          method,
          signal: controller.signal,
          rejectUnauthorized: this.connection.rejectUnauthorized,
          ...(this.ca ? { ca: this.ca } : {}),
          headers: {
            Accept: '*/*',
            'X-CSRF-ZOSMF-HEADER': 'true',
            ...headers,
            ...(authorization ? { Authorization: authorization } : {}),
            ...(body ? { 'Content-Length': String(body.length) } : {}),
          },
        },
        res => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_CONTENT_BYTES) {
              req.destroy(new Error('zo-rest response exceeds the 100 MiB content limit.'));
            } else chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('aborted', () => reject(new Error('Incomplete zo-rest response.')));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            })
          );
        }
      );
      req.on('error', reject);
      req.on('close', () => clearTimeout(deadline));
      req.end(body);
    });
  }
}

/** Only the service's documented JSON message and rc are exposed, never headers or arbitrary HTML. */
export function requireRestSuccess(response: RestResponse): void {
  if (response.status >= 200 && response.status < 300) return;
  let error: { message?: unknown; rc?: unknown } = {};
  try {
    const parsed: unknown = JSON.parse(response.body.toString('utf8'));
    if (parsed && typeof parsed === 'object') error = parsed;
  } catch {
    /* Gateway may send HTML. */
  }
  throw new RestError(
    response.status,
    typeof error.message === 'string' ? error.message : 'Request failed.',
    typeof error.rc === 'number' ? error.rc : undefined
  );
}
