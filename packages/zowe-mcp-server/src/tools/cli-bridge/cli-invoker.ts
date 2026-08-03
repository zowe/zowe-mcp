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
 * Validate a single profile field value against its declared constraints
 * (`maxLength` and/or `pattern`).
 *
 * Returns `null` when the value is acceptable, or a human-readable error
 * string when a constraint is violated.  A malformed `pattern` regex is
 * silently ignored so a bad YAML annotation never crashes the server.
 */
export function validateProfileField(
  fieldName: string,
  value: string,
  field: ProfileFieldDef
): string | null {
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return (
      `Profile field "${fieldName}" value is too long ` +
      `(${value.length.toString()} characters; maximum ${field.maxLength.toString()})`
    );
  }
  if (field.pattern !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(field.pattern);
    } catch {
      // Malformed pattern in the plugin YAML — skip validation rather than crash.
      return null;
    }
    if (!re.test(value)) {
      return (
        `Profile field "${fieldName}" value contains disallowed characters ` +
        `(must match ${field.pattern})`
      );
    }
  }
  return null;
}

/**
 * Build the CLI argument array from a named profile's field values.
 *
 * Iterates the ProfileFieldDef array in order and maps each field to
 * `--<cliOption> <value>`. Fields with no value in the profile are skipped.
 *
 * Passwords are intentionally excluded from the returned array. Pass them
 * to {@link invokeZoweCli} as the `password` argument so they are delivered
 * via the `ZOWE_OPT_PASSWORD` environment variable and never appear in the
 * process argument list (where they would be visible to other local users
 * via `ps`/`/proc/<pid>/cmdline`).
 *
 * Throws when a field value violates a `maxLength` or `pattern` constraint
 * declared in the plugin YAML. The caller should map this to an MCP
 * `isError: true` response rather than letting it propagate as an uncaught
 * exception.
 *
 * @param profile - the named profile instance (contains field values)
 * @param fields  - ordered field definitions from the profile type
 */
export function buildProfileArgs(profile: CliNamedProfile, fields: ProfileFieldDef[]): string[] {
  const args: string[] = [];
  for (const field of fields) {
    const value = profile[field.name];
    if (value !== undefined && value !== '' && field.cliOption) {
      const strValue = String(value);
      const err = validateProfileField(field.name, strValue, field);
      if (err !== null) {
        throw new Error(err);
      }
      assertNotOptionShaped(field.name, strValue);
      args.push(`--${field.cliOption}`, strValue);
    }
  }
  return args;
}

/**
 * Rejects option-shaped values so caller-controlled input cannot inject Zowe CLI flags
 * (e.g. a "host" of `--reject-unauthorized false`). Values are appended verbatim to the
 * spawned argv, and yargs would otherwise parse a leading-dash value as an option.
 * Negative numbers are allowed (legitimate numeric arguments).
 */
export function assertNotOptionShaped(name: string, value: string): void {
  if (value.startsWith('-') && !/^-\d+(\.\d+)?$/.test(value)) {
    throw new Error(
      `Value for "${name}" must not begin with "-" (it would be parsed as a CLI option).`
    );
  }
}

/**
 * Invoke a Zowe CLI command with --rfj and parse the response.
 *
 * @param command     - zowe subcommand args array, e.g. ['endevor', 'list', 'elements']
 * @param extraArgs   - additional CLI args (location params, tool-specific options) already built
 * @param profileArgs - connection profile CLI args built via buildProfileArgs (host, user, …)
 * @param env         - optional extra env vars (e.g. ZOWE_CLI_HOME for a custom config dir)
 * @param password    - plaintext password injected as `ZOWE_OPT_PASSWORD` in the child process
 *                      environment — never added to argv so it is not visible in process listings
 */
export function invokeZoweCli(
  command: string[],
  extraArgs: string[],
  profileArgs: string[] = [],
  env?: Record<string, string>,
  password?: string
): CliInvokeResult {
  const zoweBin = process.env.ZOWE_MCP_ZOWE_BIN ?? 'zowe';

  // Build full args: [subcommand parts..., extra args..., profile args..., --rfj]
  const args = [...command, ...extraArgs, ...profileArgs, '--rfj'];

  const spawnEnv: Record<string, string> = {
    ...process.env,
    // Caller-provided env (e.g. ZOWE_CLI_HOME) overrides the process env.
    ...(env ?? {}),
    // The explicit `password` arg is authoritative and spread last, so a
    // ZOWE_OPT_PASSWORD in the caller env can never clobber it. Delivered via
    // env so it never appears in argv / ps output.
    ...(password !== undefined ? { ZOWE_OPT_PASSWORD: password } : {}),
  };

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
