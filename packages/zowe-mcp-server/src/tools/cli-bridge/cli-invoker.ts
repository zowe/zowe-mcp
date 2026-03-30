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
import type { CliNamedProfile, ProfileFieldDef } from './types.js';

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
 * Build the CLI argument array from a named profile's field values.
 *
 * Iterates the ProfileFieldDef array in order and maps each field to
 * `--<cliOption> <value>`.  When a field is marked `isUsername: true`,
 * the password argument (`--password <pw>`) is injected immediately
 * after the username argument.
 *
 * Fields with no value in the profile are skipped.
 *
 * @param profile - the named profile instance (contains field values)
 * @param fields  - ordered field definitions from the profile type
 * @param password - plaintext password to inject after the isUsername field
 */
export function buildProfileArgs(
  profile: CliNamedProfile,
  fields: ProfileFieldDef[],
  password?: string
): string[] {
  const args: string[] = [];
  for (const field of fields) {
    const value = profile[field.name];
    if (value !== undefined && value !== '' && field.cliOption) {
      args.push(`--${field.cliOption}`, String(value));
    }
    if (field.isUsername && password !== undefined) {
      args.push('--password', password);
    }
  }
  return args;
}

/**
 * Invoke a Zowe CLI command with --rfj and parse the response.
 *
 * @param command     - zowe subcommand args array, e.g. ['endevor', 'list', 'elements']
 * @param extraArgs   - additional CLI args (location params, tool-specific options) already built
 * @param profileArgs - connection profile CLI args built via buildProfileArgs (host, user, password, …)
 * @param env         - optional extra env vars (e.g. ZOWE_CLI_HOME for a custom config dir)
 */
export function invokeZoweCli(
  command: string[],
  extraArgs: string[],
  profileArgs: string[] = [],
  env?: Record<string, string>
): CliInvokeResult {
  const zoweBin = process.env.ZOWE_MCP_ZOWE_BIN ?? 'zowe';

  // Build full args: [subcommand parts..., extra args..., profile args..., --rfj]
  const args = [...command, ...extraArgs, ...profileArgs, '--rfj'];

  const spawnEnv: Record<string, string> = { ...process.env, ...(env ?? {}) } as Record<
    string,
    string
  >;

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
