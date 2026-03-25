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
 * Type definitions for the CLI plugin bridge.
 *
 * The bridge reads YAML metadata files that describe how Zowe CLI plugin commands
 * map to MCP tools. The execution engine spawns `zowe <command> --rfj` subprocesses,
 * using either a pre-configured Zowe profile or explicit connection parameters.
 *
 * All plugin-specific details (profile flag names, location parameter names and CLI
 * options, connection flag mappings) are defined in the plugin YAML — no plugin-specific
 * code belongs here.
 */

// ---------------------------------------------------------------------------
// Connection / runtime config (passed at server startup, not in YAML)
// ---------------------------------------------------------------------------

/**
 * Generic connection configuration for the CLI bridge.
 * Either profile mode (Zowe resolves host/port/creds) or explicit mode.
 *
 * Plugin-specific flags (e.g. --endevor-profile, --instance) are NOT hardcoded here.
 * Instead, the plugin YAML defines a `connection.flags` block that maps keys from
 * `pluginParams` to the correct CLI flag names.
 */
export interface CliConnectionConfig {
  // --- Explicit connection params ---
  /** Remote host. */
  host?: string;
  /** Remote port. */
  port?: number;
  /** Mainframe username. */
  user?: string;
  /** Mainframe password. */
  password?: string;
  /** When true, TLS certificate errors are rejected. */
  rejectUnauthorized?: boolean;
  /** HTTP protocol. Default: https. Use 'http' for local/dev servers. */
  protocol?: string;
  /** Base path for the API (e.g. EndevorService/api/v2). */
  basePath?: string;

  // --- Path to zowe binary (optional, defaults to 'zowe' from PATH) ---
  zoweBin?: string;

  // --- Optional zowe config dir (when a generated zowe.config.json is in a temp dir) ---
  zoweConfigDir?: string;

  /**
   * Plugin-specific connection params, keyed by configKey as declared in the YAML
   * `connection.flags` block. For example, for Endevor:
   *   pluginParams: { pluginProfile: 'myprofile', locationProfile: 'myloc', instance: 'ENDEVOR' }
   */
  pluginParams?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// YAML-driven connection flags definition
// ---------------------------------------------------------------------------

/** Maps a pluginParams key to the CLI flag name that should carry its value. */
export interface CliConnectionFlag {
  /** Key in CliConnectionConfig.pluginParams to read the value from. */
  configKey: string;
  /** CLI flag name without '--' (e.g. 'endevor-profile', 'instance'). */
  cliFlag: string;
}

/** The optional `connection:` block in the plugin YAML. */
export interface CliConnectionDef {
  /** Plugin-specific flags to append to every Zowe CLI invocation. */
  flags?: CliConnectionFlag[];
}

// ---------------------------------------------------------------------------
// YAML-driven context definition
// ---------------------------------------------------------------------------

/** A single context field (e.g. environment, stageNumber, system). */
export interface ContextFieldDef {
  /** MCP parameter name (camelCase, e.g. environment, stageNumber). */
  name: string;
  /** CLI option name without '--' (e.g. env, sn, sys). Used when building CLI args. */
  cliOption?: string;
  /** Human-readable description for the MCP parameter. */
  description: string;
  /** Optional default value for the context field. */
  default?: string;
}

/** The context block in the plugin YAML — describes the set-context tool. */
export interface ContextDef {
  /** MCP tool name for the context setter, e.g. endevorSetContext. */
  toolName: string;
  /** Tool description. */
  description?: string;
  /** Location fields (e.g. environment, stageNumber, system, subsystem, type). */
  fields: ContextFieldDef[];
}

// ---------------------------------------------------------------------------
// YAML-driven tool definition
// ---------------------------------------------------------------------------

/**
 * Description variants for a tool — allows A/B testing of description quality.
 *
 * Any variant name is valid (the index signature accepts any key).  The active
 * variant is resolved by `resolveDescription()` using this priority:
 *   tool.activeDescription > plugin.activeDescription > ZOWE_MCP_CLI_DESC_VARIANT > 'intent' > 'cli' > first available
 *
 * **JSON-path reference syntax**: any variant value (including `context.fields[].description`)
 * that starts with `$.` is treated as a dotted path into a companion
 * `<plugin>-commands.json` file located next to the plugin YAML.
 * The loader resolves the reference at load time and replaces the `$.path`
 * string with the value found in the JSON.
 *
 * Example:
 * ```yaml
 * descriptions:
 *   cli: "$.endevor.list.environments.description"
 *   intent: "Lists all available Endevor environments..."
 * ```
 */
export interface DescriptionVariants {
  /** Original wording from the CLI --help text (or a `$.path` JSON reference). */
  cli?: string;
  /** Intent-centric rewrite designed for AI agents. */
  intent?: string;
  /** LLM-optimized, generated by rephrase-tool-descriptions script. */
  optimized?: string;
  [key: string]: string | undefined;
}

/** A single extra parameter for a tool. */
export interface PluginParam {
  /** MCP parameter name (camelCase). */
  name: string;
  /**
   * CLI option name without '--' (e.g. env, sn, sys, search, data).
   * When set, the value is passed as `--<cliOption> <value>`.
   */
  cliOption?: string;
  /**
   * When true, this parameter is passed as a positional argument
   * (the first bare word after the sub-command), not as --option value.
   */
  cliPositional?: boolean;
  /** Human-readable description. */
  description: string;
  /** Whether this parameter is required. */
  required?: boolean;
  /** Default value if not provided by the caller. */
  default?: string;
}

/** A single MCP tool definition in the plugin YAML. */
export interface PluginToolDef {
  /** MCP tool name (camelCase with plugin prefix, e.g. endevorListElements). */
  toolName: string;
  /**
   * The `zowe` command string to execute, e.g. "endevor list elements".
   * The bridge prepends "zowe" and appends "--rfj" plus connection flags.
   */
  zoweCommand: string;
  /**
   * Which description variant to use for this tool.
   * Falls back to the plugin-level activeDescription, then env ZOWE_MCP_CLI_DESC_VARIANT,
   * then 'intent', then first available.
   */
  activeDescription?: string;
  /** Description text variants. */
  descriptions: DescriptionVariants;
  /** When true, VS Code skips the confirmation dialog before calling this tool. */
  readOnlyHint?: boolean;
  /** When true, VS Code shows a warning before calling this tool. */
  destructiveHint?: boolean;
  /**
   * When true, automatically inject all context fields defined in the plugin's `context.fields`
   * as optional parameters (with context defaults).
   * When a string array, only the named context fields are injected.
   */
  locationParams?: boolean | string[];
  /** Additional tool-specific parameters beyond the location params. */
  params?: PluginParam[];
  /**
   * Key to extract from the parsed --rfj JSON response.
   * Default: "data". Use "stdout" for text output (e.g. print element content).
   * Use "." for the entire response body.
   */
  outputPath?: string;
}

// ---------------------------------------------------------------------------
// Top-level plugin YAML config
// ---------------------------------------------------------------------------

/** Top-level structure of a plugin YAML metadata file. */
export interface CliPluginConfig {
  /** Plugin identifier, e.g. "endevor". */
  plugin: string;
  /**
   * Default active description variant for all tools that don't specify their own.
   * Can be overridden at runtime by ZOWE_MCP_CLI_DESC_VARIANT env var.
   */
  activeDescription?: string;
  /** Optional connection flags block — maps pluginParams keys to CLI flag names. */
  connection?: CliConnectionDef;
  /** Context definition (generates the set-context tool). */
  context?: ContextDef;
  /** Tool definitions. */
  tools: PluginToolDef[];
}

// ---------------------------------------------------------------------------
// Runtime session state
// ---------------------------------------------------------------------------

/**
 * Generic runtime context — a key-value map where the keys are the field names
 * defined in the plugin YAML's `context.fields` block.
 */
export type CliContext = Record<string, string | undefined>;

/** Mutable container for the plugin session state. */
export interface CliPluginState {
  connection: CliConnectionConfig;
  context: CliContext;
}
