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
 * Shared startup resolution for the AT-TLS gate (inbound) and client guard
 * (outbound): both fail fast in `required` mode on anything a doctor could
 * detect (wrong platform, addon load failure) and degrade to `off` with a
 * warning in `monitor` mode. Package-internal.
 */

import { loadAtTlsModule, type AtTlsQueryResult } from './attls-load.js';

export type AtTlsMode = 'off' | 'monitor' | 'required';

export type AtTlsLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AtTlsLogFn = (
  level: AtTlsLogLevel,
  msg: string,
  fields?: Record<string, unknown>
) => void;

export type AtTlsQueryFn = (fd: number) => AtTlsQueryResult;

export interface ResolveAtTlsRuntimeOptions {
  mode: AtTlsMode;
  /** Injected for tests; when absent the native addon is loaded. */
  queryFn?: AtTlsQueryFn;
  /** ZOWE_MCP_ATTLS_MODULE — explicit addon path for out-of-tree builds. */
  modulePath?: string;
  log: AtTlsLogFn;
  /** Injected for tests; defaults to process.platform. */
  platform?: string;
  /** Names the feature in messages: "AT-TLS aware mode" / "… client mode". */
  what: string;
}

export interface ResolvedAtTlsRuntime {
  /** Effective mode — may be 'off' after a monitor-mode degradation. */
  mode: AtTlsMode;
  /** Set whenever mode !== 'off'. */
  queryFn?: AtTlsQueryFn;
}

/** errno-style code from an addon error, when present. */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function resolveAtTlsRuntime(opts: ResolveAtTlsRuntimeOptions): ResolvedAtTlsRuntime {
  const platform = opts.platform ?? process.platform;
  let mode = opts.mode;
  let queryFn = opts.queryFn;

  if (mode !== 'off' && !queryFn) {
    if (platform !== 'os390') {
      const msg = `${opts.what} needs z/OS (platform is ${platform})`;
      if (mode === 'required') throw new Error(msg);
      opts.log('warn', `${msg} — degrading AT-TLS mode to off`);
      mode = 'off';
    } else {
      try {
        const addon = loadAtTlsModule(opts.modulePath);
        queryFn = fd => addon.query(fd);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const msg = `AT-TLS query addon failed to load: ${detail}`;
        if (mode === 'required') throw new Error(msg);
        opts.log('warn', `${msg} — degrading AT-TLS mode to off`);
        mode = 'off';
      }
    }
  }

  return { mode, queryFn };
}
