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
 * CLI invoker for the plugin CLI bridge.
 *
 * Spawns `zowe <command> --rfj` subprocesses and parses the structured
 * JSON response. The --rfj flag makes Zowe CLI output a JSON envelope:
 *   { success: boolean, exitCode: number, message: string, stdout: string,
 *     stderr: string, data: unknown }
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import type { CliConnectionConfig, CliConnectionFlag } from './types.js';

/** Structured --rfj response from Zowe CLI. */
export interface ZoweRfjResponse {
  success: boolean;
  exitCode: number;
  message: string;
  stdout: string;
  stderr: string;
  data: unknown;
}

/** Result returned by invokeZoweCli. */
export interface CliInvokeResult {
  ok: boolean;
  /** Parsed .data field from --rfj response, or null when not applicable. */
  data: unknown;
  /** Raw stdout (for text output modes). */
  stdout: string;
  /** Error message when ok === false. */
  errorMessage?: string;
  /** Raw exit code. */
  exitCode: number;
}

/**
 * Build the connection arguments array from the connection config.
 *
 * Generic flags (host, port, user, password, etc.) are always added when present.
 * Plugin-specific flags are driven by the `flags` parameter from the YAML
 * `connection.flags` block: each entry maps a `pluginParams` config key to a CLI flag.
 *
 * @param connection - connection config
 * @param flags - plugin-specific flag mappings from the YAML `connection.flags` block
 */
export function buildConnectionArgs(
  connection: CliConnectionConfig,
  flags: CliConnectionFlag[] = []
): string[] {
  const args: string[] = [];

  // Plugin-specific params driven entirely by the YAML connection.flags block
  for (const flag of flags) {
    const value = connection.pluginParams?.[flag.configKey];
    if (value !== undefined) {
      args.push(`--${flag.cliFlag}`, value);
    }
  }

  // Generic connection params (common to all Zowe CLI plugins)
  if (connection.host) {
    args.push('--host', connection.host);
  }
  if (connection.port !== undefined) {
    args.push('--port', String(connection.port));
  }
  if (connection.user) {
    args.push('--user', connection.user);
  }
  if (connection.password) {
    args.push('--password', connection.password);
  }
  if (connection.rejectUnauthorized !== undefined) {
    args.push('--reject-unauthorized', String(connection.rejectUnauthorized));
  }
  if (connection.protocol) {
    args.push('--protocol', connection.protocol);
  }
  if (connection.basePath) {
    args.push('--base-path', connection.basePath);
  }

  return args;
}

/**
 * Invoke a Zowe CLI command with --rfj and parse the response.
 *
 * @param command - zowe subcommand args array, e.g. ['endevor', 'list', 'elements']
 * @param extraArgs - additional CLI args (options, positionals) already built
 * @param connection - connection config
 * @param connectionFlags - plugin-specific flag mappings from YAML `connection.flags`
 * @param env - optional extra env vars (e.g. ZOWE_CLI_HOME for custom config dir)
 */
export function invokeZoweCli(
  command: string[],
  extraArgs: string[],
  connection: CliConnectionConfig,
  connectionFlags: CliConnectionFlag[] = [],
  env?: Record<string, string>
): CliInvokeResult {
  const zoweBin = connection.zoweBin ?? 'zowe';
  const connectionArgs = buildConnectionArgs(connection, connectionFlags);

  // Build full args: [subcommand parts..., extra args..., connection args..., --rfj]
  const args = [...command, ...extraArgs, ...connectionArgs, '--rfj'];

  const spawnEnv: Record<string, string> = { ...process.env, ...(env ?? {}) } as Record<
    string,
    string
  >;

  // When a custom config dir is set, point ZOWE_CLI_HOME there so the
  // generated zowe.config.json is used instead of the user's global config.
  if (connection.zoweConfigDir) {
    spawnEnv.ZOWE_CLI_HOME = connection.zoweConfigDir;
  }

  const options: SpawnSyncOptions = {
    encoding: 'utf-8',
    env: spawnEnv,
    maxBuffer: 32 * 1024 * 1024, // 32 MB
  };

  const result = spawnSync(zoweBin, args, options);

  // Handle spawn error (e.g. 'zowe' not found in PATH)
  if (result.error) {
    return {
      ok: false,
      data: null,
      stdout: '',
      errorMessage: `Failed to spawn '${zoweBin}': ${result.error.message}`,
      exitCode: -1,
    };
  }

  const rawOutput = (result.stdout as string) ?? '';

  // Try to parse the --rfj JSON envelope
  let parsed: ZoweRfjResponse | null = null;
  try {
    parsed = JSON.parse(rawOutput) as ZoweRfjResponse;
  } catch {
    // Not JSON — return raw stdout as text output (e.g. print element)
    const rawStderr = (result.stderr as string) ?? '';
    if (result.status !== 0) {
      return {
        ok: false,
        data: null,
        stdout: rawOutput,
        errorMessage:
          rawStderr.trim() || rawOutput.trim() || `zowe exited with code ${result.status ?? -1}`,
        exitCode: result.status ?? -1,
      };
    }
    return {
      ok: true,
      data: null,
      stdout: rawOutput,
      exitCode: result.status ?? 0,
    };
  }

  if (!parsed.success) {
    const msg =
      parsed.message?.trim() ||
      parsed.stderr?.trim() ||
      `zowe command failed (exitCode ${parsed.exitCode})`;
    return {
      ok: false,
      data: parsed.data ?? null,
      stdout: parsed.stdout ?? '',
      errorMessage: msg,
      exitCode: parsed.exitCode,
    };
  }

  return {
    ok: true,
    data: parsed.data ?? null,
    stdout: parsed.stdout ?? '',
    exitCode: parsed.exitCode,
  };
}
