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
 * AT-TLS aware outbound HTTP for the MCP server's own upstream calls (OIDC
 * discovery and JWKS fetches to the IdP). On z/OS a deployment may speak
 * plain `http://` to the IdP and rely on an outbound AT-TLS rule for TLS;
 * AT-TLS fails open, so ZOWE_MCP_ATTLS_CLIENT (off | monitor | required)
 * routes those requests through the zos-attls client guard, which verifies
 * the stack secured the connection BEFORE the request is written
 * (docs/zos-attls-client-mode.md).
 *
 * Routing rules for atTlsAwareJsonGet:
 * - `https://` URLs always use global fetch (TLS is done in-process by Node;
 *   AT-TLS client mode is about plain-http-over-AT-TLS transports).
 * - `http://` URLs go through the guard's gated http.Agent when the guard is
 *   active, and through global fetch otherwise (dev/test setups).
 */

import * as http from 'node:http';
import {
  createAtTlsClientGuard,
  parseAtTlsMode,
  parseLoopbackClear,
  type AtTlsClientGuardOptions,
  type AtTlsMode,
} from 'zos-attls';

/** The response subset bearer-jwt.ts needs — matches fetch's Response shape. */
export interface JsonGetResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

interface ActiveClient {
  mode: AtTlsMode;
  agent: http.Agent;
}

let active: ActiveClient | undefined;

/**
 * Reads the AT-TLS client env contract. Module path and the loopback-clear
 * opt-in are host-level facts shared with the inbound gate
 * (ZOWE_MCP_ATTLS_MODULE / ZOWE_MCP_ATTLS_LOOPBACK_CLEAR).
 */
export function loadAtTlsClientEnvOptions(): Pick<
  AtTlsClientGuardOptions,
  'mode' | 'modulePath' | 'allowLoopbackClear'
> {
  const modulePath = process.env.ZOWE_MCP_ATTLS_MODULE?.trim();
  return {
    mode: parseAtTlsMode(process.env.ZOWE_MCP_ATTLS_CLIENT?.trim()),
    modulePath: modulePath === undefined || modulePath === '' ? undefined : modulePath,
    allowLoopbackClear: parseLoopbackClear(process.env.ZOWE_MCP_ATTLS_LOOPBACK_CLEAR),
  };
}

/**
 * Creates the client guard and its gated agent. Call once at startup, before
 * the first upstream fetch (OIDC discovery). Throws in `required` mode when
 * the guard cannot run (off z/OS, addon missing) — same fail-fast contract
 * as the inbound gate. Returns the effective mode ('off' disables routing).
 */
export function initAtTlsClientHttp(opts: AtTlsClientGuardOptions): AtTlsMode {
  if (opts.mode === 'off') {
    active = undefined;
    return 'off';
  }
  const guard = createAtTlsClientGuard(opts);
  if (guard.mode === 'off') {
    // monitor degraded (warned by the guard) — keep plain fetch.
    active = undefined;
    return 'off';
  }
  // keepAlive stays off: one socket per request, so every request is gated.
  active = { mode: guard.mode, agent: guard.createHttpAgent() };
  return guard.mode;
}

/** Effective client mode ('off' when not initialized or degraded). */
export function atTlsClientMode(): AtTlsMode {
  return active?.mode ?? 'off';
}

/** Drops the module-level guard state — for tests only. */
export function __resetAtTlsClientHttpForTests(): void {
  active?.agent.destroy();
  active = undefined;
}

function gatedJsonGet(
  agent: http.Agent,
  url: string,
  headers?: Record<string, string>,
  timeoutMs?: number
): Promise<JsonGetResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      { agent, headers, ...(timeoutMs ? { timeout: timeoutMs } : {}) },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            json: () =>
              Promise.resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown),
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
  });
}

/**
 * GET a JSON document from an upstream URL, honoring AT-TLS client mode.
 * When the guard rejects (required mode, connection not secured by AT-TLS),
 * the promise rejects with the guard's AtTlsClientError before any request
 * bytes were written.
 */
export async function atTlsAwareJsonGet(
  url: string,
  headers?: Record<string, string>,
  timeoutMs?: number
): Promise<JsonGetResponse> {
  if (active && new URL(url).protocol === 'http:') {
    return gatedJsonGet(active.agent, url, headers, timeoutMs);
  }
  return fetch(url, {
    ...(headers ? { headers } : {}),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
}
