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

import { isAbsolute, resolve } from 'node:path';
import { getConfigDir } from './config.js';

export const PASS = '\u2713';
export const FAIL = '\u2717';

export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const apiErr = err as unknown as Record<string, unknown>;
  if (typeof apiErr.statusCode === 'number')
    parts.push(`statusCode: ${apiErr.statusCode.toString()}`);
  if (typeof apiErr.url === 'string') parts.push(`url: ${apiErr.url}`);
  if (typeof apiErr.responseBody === 'string' && apiErr.responseBody.length > 0) {
    parts.push(`responseBody: ${apiErr.responseBody.slice(0, 2000)}`);
  }
  if (apiErr.cause instanceof Error) parts.push(`cause: ${apiErr.cause.message}`);
  return parts.join('\n  ');
}

/**
 * Resolve relative --config paths in native serverArgs against the config directory (repo root).
 */
export function resolveNativeServerArgs(serverArgs: string): string {
  const tokens = serverArgs.trim().split(/\s+/).filter(Boolean);
  const idx = tokens.indexOf('--config');
  if (idx !== -1 && idx + 1 < tokens.length) {
    const configPath = tokens[idx + 1];
    if (!isAbsolute(configPath)) {
      tokens[idx + 1] = resolve(getConfigDir(), configPath);
    }
  }
  return tokens.join(' ');
}
