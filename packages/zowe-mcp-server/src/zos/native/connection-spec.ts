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
 * Connection spec parsing for Zowe Native (SSH) backend.
 *
 * Parses user@host and user@host:port strings, and provides helpers
 * for env var names (standalone) and secret storage keys (shared Zowe OSS convention).
 */

/** Parsed connection spec: user, host, and optional port. */
export interface ParsedConnectionSpec {
  user: string;
  host: string;
  port: number;
}

const DEFAULT_SSH_PORT = 22;

/**
 * Normalizes host for use in env var names and secret storage keys:
 * dots replaced by underscores, lowercase for consistency.
 */
export function toHostNormalized(host: string): string {
  return host.replace(/\./g, '_').toLowerCase();
}

/**
 * Returns the environment variable name for a password in standalone mode.
 * Format: ZOWE_MCP_PASSWORD_<USER>_<HOST> with USER uppercase and HOST with dots replaced by _.
 */
export function toPasswordEnvVarName(user: string, host: string): string {
  const userPart = user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const hostPart = toHostNormalized(host)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');
  return `ZOWE_MCP_PASSWORD_${userPart}_${hostPart}`;
}

/**
 * Returns the shared Zowe OSS secret storage key for an SSH password.
 * Format: zowe.ssh.password.${user}.${hostNormalized}
 * Other Zowe extensions can use this key to share credentials for the same user@host.
 */
export function toSecretStorageKey(user: string, host: string): string {
  return `zowe.ssh.password.${user.toUpperCase()}.${toHostNormalized(host)}`;
}

/**
 * Parses a single connection spec string.
 * Accepted forms: "user@host" or "user@host:port".
 *
 * @param spec - Connection spec (e.g. "USERID@sys1.example.com" or "user@host:22").
 * @returns Parsed spec with user, host, port (default 22).
 * @throws Error if the spec is invalid.
 */
export function parseConnectionSpec(spec: string): ParsedConnectionSpec {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw new Error('Connection spec is empty');
  }

  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    throw new Error(`Invalid connection spec "${spec}": expected user@host or user@host:port`);
  }

  const user = trimmed.slice(0, atIndex).trim();
  const hostAndPort = trimmed.slice(atIndex + 1).trim();
  if (!user || !hostAndPort) {
    throw new Error(`Invalid connection spec "${spec}": user and host are required`);
  }

  let host: string;
  let port = DEFAULT_SSH_PORT;
  const colonIndex = hostAndPort.lastIndexOf(':');
  if (colonIndex > 0 && colonIndex < hostAndPort.length - 1) {
    const portStr = hostAndPort.slice(colonIndex + 1);
    const portNum = parseInt(portStr, 10);
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
      throw new Error(`Invalid port in connection spec "${spec}": ${portStr}`);
    }
    port = portNum;
    host = hostAndPort.slice(0, colonIndex).trim();
  } else {
    host = hostAndPort;
  }

  if (!host) {
    throw new Error(`Invalid connection spec "${spec}": host is required`);
  }

  return { user, host: host.toLowerCase(), port };
}

/**
 * Returns a canonical connection string for the given spec (same rules as addZosConnection):
 * `user@host` when port is 22, otherwise `user@host:port`.
 */
export function formatNormalizedConnectionSpec(spec: string): string {
  const p = parseConnectionSpec(spec);
  return p.port === DEFAULT_SSH_PORT ? `${p.user}@${p.host}` : `${p.user}@${p.host}:${p.port}`;
}

/**
 * Parses an array of connection spec strings.
 * Duplicates (same user@host:port) are preserved in order; callers can dedupe if needed.
 *
 * @param specs - Array of connection specs.
 * @returns Array of parsed specs.
 * @throws Error if any spec is invalid.
 */
export function parseConnectionSpecs(specs: string[]): ParsedConnectionSpec[] {
  return specs.map(s => parseConnectionSpec(s));
}

/**
 * Normalized lookup key for {@link parseZoweMcpCredentialsEnv} / {@link getStandalonePasswordFromEnv}.
 * User and host are lowercased; port 22 is omitted from the key (same as typical `user@host` form).
 */
export function toConnectionsEnvLookupKey(user: string, host: string, port: number): string {
  const u = user.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (port === DEFAULT_SSH_PORT) {
    return `${u}@${h}`;
  }
  return `${u}@${h}:${port}`;
}

/**
 * Parses `ZOWE_MCP_CREDENTIALS`: a JSON object mapping `user@host` or `user@host:port` keys to password strings.
 * Each key is normalized with {@link parseConnectionSpec} and {@link toConnectionsEnvLookupKey}.
 *
 * @param raw - Value of `process.env.ZOWE_MCP_CREDENTIALS`, or undefined.
 * @returns Map from normalized key to password. Empty when `raw` is undefined or blank.
 * @throws Error if `raw` is non-blank but not valid JSON, or not a non-array object.
 */
export function parseZoweMcpCredentialsEnv(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (raw === undefined || raw.trim() === '') {
    return map;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw) as unknown;
  } catch (e) {
    throw new Error(
      `ZOWE_MCP_CREDENTIALS must be valid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(
      'ZOWE_MCP_CREDENTIALS must be a JSON object mapping connection specs (user@host) to password strings.'
    );
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value !== 'string' || value === '') {
      continue;
    }
    try {
      const spec = parseConnectionSpec(key);
      map.set(toConnectionsEnvLookupKey(spec.user, spec.host, spec.port), value);
    } catch {
      // Ignore keys that are not valid connection specs
    }
  }
  return map;
}

/**
 * Standalone password resolution for native SSH and CLI bridge plugins.
 *
 * Precedence: `ZOWE_MCP_PASSWORD_<USER>_<HOST>` (existing) first, then `ZOWE_MCP_CREDENTIALS` JSON map.
 */
export function getStandalonePasswordFromEnv(spec: ParsedConnectionSpec): string | undefined {
  const envVar = toPasswordEnvVarName(spec.user, spec.host);
  const fromVar = process.env[envVar];
  if (fromVar !== undefined && fromVar !== '') {
    return fromVar;
  }
  const map = parseZoweMcpCredentialsEnv(process.env.ZOWE_MCP_CREDENTIALS);
  const key = toConnectionsEnvLookupKey(spec.user, spec.host, spec.port);
  const fromMap = map.get(key);
  if (fromMap !== undefined && fromMap !== '') {
    return fromMap;
  }
  return undefined;
}

/**
 * Standalone password resolution: env first, then optional Vault KV (see `vault-kv-credentials.ts`).
 */
export async function resolveStandalonePassword(
  spec: ParsedConnectionSpec
): Promise<string | undefined> {
  const fromEnv = getStandalonePasswordFromEnv(spec);
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  const { getStandalonePasswordFromVault } = await import('./vault-kv-credentials.js');
  return getStandalonePasswordFromVault(spec);
}
