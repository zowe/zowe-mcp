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
