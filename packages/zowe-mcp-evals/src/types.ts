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
 * Set-level mock init options: one string passed as-is to init-mock (after --output <dir>).
 * In YAML each line can be one option, e.g. "initArgs: --preset default" or multiline.
 */
export interface SetMockConfig {
  /** Extra arguments for init-mock, one string (split on whitespace when passing). */
  initArgs: string;
}

/**
 * Set-level native backend config: one string for server args (e.g. "--native --config path").
 */
export interface SetNativeConfig {
  /** Server arguments after --stdio, one string (split on whitespace when passing). */
  serverArgs: string;
}

/**
 * Set-level backend: mock (with init params) or native.
 */
export type SetBackendConfig = { mock: SetMockConfig } | { native: SetNativeConfig };

/**
 * Generic external mock server started and optionally initialized by the eval harness.
 * Suitable for any CLI-based mock server (not just Endevor EWS).
 */
export interface MockServerDef {
  /** Human-readable name used in log messages. */
  name: string;
  /**
   * Absolute path to the Node.js CLI script (invoked as `node <cliScript>`).
   */
  cliScript: string;
  /**
   * Arguments for the init subcommand. When present, the harness runs
   * `node <cliScript> <initArgs>` once in a harness-managed temp directory
   * before starting the server. The `{dataDir}` placeholder is replaced with
   * `<tempDir>/data` (a non-existing sub-path so init tools that reject
   * pre-existing directories work correctly). The init command is run with
   * CWD set to the temp directory so any config file it creates lands there.
   * Example: "init ENDEVOR --output {dataDir}"
   */
  initArgs?: string;
  /**
   * Optional config template (JSON-serializable object) written to a temp file
   * and passed as `--config <file>` to the start command. All string values
   * have `{dataDir}` and `{port}` placeholders substituted. When absent and
   * `initArgs` is set the harness looks for the file named by `configOutputName`
   * (default `mock-ews-config.json`) created in the temp directory by the init
   * command. When absent and `initArgs` is also absent no `--config` flag is
   * added.
   */
  configTemplate?: Record<string, unknown>;
  /**
   * Filename of the config file created by `initArgs` in the temp directory.
   * Default: `"mock-ews-config.json"`.
   */
  configOutputName?: string;
  /**
   * CLI flag used to pass the config file when starting the server.
   * Default: `"--config"`.
   */
  configFlag?: string;
  /**
   * Extra arguments appended after the start subcommand and config flag.
   * `{dataDir}` and `{port}` placeholders are substituted.
   */
  startArgs?: string;
  /** Port the server listens on; the harness waits for it to be ready (default 8080). */
  port?: number;
  /**
   * When set, the harness automatically creates a CLI bridge connection for this plugin
   * pointing to `localhost:<port>`. Plugin-specific defaults are applied (e.g. for
   * `endevor`: user=USER, password=PASSWORD, protocol=http, etc.), so no separate
   * `cliPluginConnections` entry is needed for the common case.
   * Explicit `cliPluginConnections` entries always take precedence if present.
   */
  pluginName?: string;
}

/**
 * Connection config for one CLI bridge plugin. All fields are optional; the harness
 * applies plugin-specific defaults for known plugins (e.g. host/user/password/basePath
 * for the `endevor` plugin) so only `port` is usually needed in the YAML.
 */
export interface CliPluginConnection {
  /** Hostname (default for endevor: 'localhost'). */
  host?: string;
  /** Port number. */
  port?: number;
  /** Username (default for endevor: 'USER'). */
  user?: string;
  /** Password (default for endevor: 'PASSWORD'). */
  password?: string;
  /** Protocol: 'http' or 'https' (default for endevor: 'http'). */
  protocol?: string;
  /** API base path (default for endevor: 'EndevorService/api/v2'). */
  basePath?: string;
  /** Plugin-specific parameters (default for endevor: { instance: 'ENDEVOR' }). */
  pluginParams?: Record<string, string>;
}

/**
 * Set-level eval config (repetitions, success rate, backend, system prompt).
 */
export interface SetConfig {
  name?: string;
  description?: string;
  repetitions?: number;
  minSuccessRate?: number;
  mock?: SetMockConfig;
  native?: SetNativeConfig;
  /**
   * Generic mock servers to start before the MCP server. Each entry can specify
   * an optional init command run in a harness-managed temp directory so the
   * data store and config are created fresh per eval run.
   */
  mockServers?: MockServerDef[];
  /**
   * Connection config per CLI plugin name. The harness writes each entry as a temp
   * JSON connection file and passes `--cli-plugin-connection <name>=<file>` to the server.
   * Known plugin defaults are applied automatically (e.g. for `endevor` the host, user,
   * password, protocol, basePath, and pluginParams are pre-filled).
   */
  cliPluginConnections?: Record<string, CliPluginConnection>;
  /**
   * Override for the CLI plugins directory (--cli-plugins-dir).
   * Defaults to `<server-dist>/tools/cli-bridge/plugins/`.
   */
  cliPluginsDir?: string;
  /**
   * Description variant for CLI bridge tools (--cli-plugin-desc-variant).
   * Values: 'cli' | 'intent' | 'optimized' or any custom variant name.
   */
  cliPluginDescVariant?: string;
  /**
   * Path to an alternative MCP server script (e.g. code4z-gen-ai stdio-server.js).
   * When set, this server is started instead of the default zowe-mcp-server.
   */
  mcpServerScript?: string;
  /** Extra args for the alternative MCP server, one string split on whitespace. */
  mcpServerArgs?: string;
  /**
   * Tool name aliases: maps actual tool names from the server to the canonical assertion
   * names used in question YAML. Applied after each run so assertions use stable names.
   * Example: { "get_elements": "endevorListElements" }
   */
  toolAliases?: Record<string, string>;
  systemPrompt?: string;
  systemPromptAddition?: string;
  /** When set, the entire question set is skipped with this reason. */
  skip?: string;
  /**
   * Load questions from another named question set instead of defining them locally.
   * The referenced set must exist in the questions/ directory. Used by mirror sets
   * (e.g. endevor-code4z) that run the same questions against a different server.
   */
  questionsFrom?: string;
}

/**
 * Unified tool-call assertion. Absorbs the former toolCall, singleToolCall, toolOnly,
 * minToolCalls, and toolCallOneOf assertion types.
 *
 * Modes (mutually exclusive tool specifiers):
 * - `tool`  — single tool name; checks the last matching call + optional args.
 * - `tools` — any of these tool names matches (no per-tool args).
 * - `oneOf` — any of these {tool, args?} specs matches (per-tool args).
 *
 * Optional count constraints:
 * - `count`    — exact number of total tool calls expected.
 * - `minCount` — minimum number of calls expected.
 */
export interface AssertToolCall {
  type: 'toolCall';
  name?: string;
  tool?: string;
  tools?: string[];
  oneOf?: { tool: string; args?: Record<string, unknown> }[];
  args?: Record<string, unknown>;
  count?: number;
  minCount?: number;
}

/**
 * Ordered tool-call sequence. Absorbs the former toolCallOrder and toolCallSequence types.
 * Each step: `tool` (single) or `tools` (any of), plus optional `args` (partial match).
 * Steps are matched in order against actual tool calls; other calls may appear in between.
 */
export interface AssertToolCallOrder {
  type: 'toolCallOrder';
  name?: string;
  sequence: {
    tool?: string;
    tools?: string[];
    /** Partial match. If array, step matches when actual args match any element. */
    args?: Record<string, unknown> | Record<string, unknown>[];
  }[];
}

/**
 * Assert that the final answer text contains a literal substring or matches a regex.
 * Use `substring` for exact phrase or `pattern` for regex; if both are set, `pattern` is used.
 */
export interface AssertAnswerContains {
  type: 'answerContains';
  name?: string;
  substring?: string;
  pattern?: string;
}

/** Leaf assertion (no nested allOf/anyOf). */
export type Assertion = AssertToolCall | AssertToolCallOrder | AssertAnswerContains;

/**
 * Composite: all nested items must pass (logical AND).
 */
export interface AssertAllOf {
  allOf: AssertionItem[];
}

/**
 * Composite: at least one nested item must pass (logical OR).
 */
export interface AssertAnyOf {
  anyOf: AssertionItem[];
}

/**
 * One assertion: either a leaf assertion or a composite (allOf/anyOf).
 * Composites can be nested (e.g. allOf containing an anyOf).
 */
export type AssertionItem = Assertion | AssertAllOf | AssertAnyOf;

/**
 * Normalized assertion block for a question. Default is allOf (all items must pass).
 * Backward compat: a YAML array of assertions is treated as allOf.
 */
export interface AssertionBlock {
  mode: 'all' | 'any';
  items: AssertionItem[];
}

/**
 * One question in a set.
 */
export interface Question {
  id: string;
  prompt: string;
  /** Mock preset when using mock backend (default | inventory). Overridden by set-level mock.preset when set. */
  preset?: 'default' | 'inventory';
  /** Normalized assertion block (all items must pass when mode is 'all'; any item must pass when mode is 'any'). */
  assertionBlock: AssertionBlock;
  /** When set, this question is skipped with this reason. */
  skip?: string;
}

/**
 * Loaded question set (from YAML).
 */
export interface QuestionSet {
  config: SetConfig;
  questions: Question[];
}

/**
 * One tool call made by the agent (for assertions and report).
 */
export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  /** Tool result (server response text), when captured for reporting. */
  result?: string;
}

/**
 * Token usage for one agent run, from the Vercel AI SDK result.usage.
 */
export interface TokenUsage {
  /** Tokens in the LLM prompt (input). */
  input: number;
  /** Tokens in the LLM response (output). */
  output: number;
  /** Total tokens (input + output). */
  total: number;
}

/**
 * Result of one run (one question, one repetition).
 */
export interface RunResult {
  questionId: string;
  prompt?: string;
  runIndex: number;
  passed: boolean;
  toolCalls: ToolCallRecord[];
  finalText: string;
  error?: string;
  assertionFailed?: string;
  /** Wall-clock duration of the agent run in milliseconds. */
  durationMs?: number;
  /** Token usage for this run (from Vercel AI SDK). */
  tokenUsage?: TokenUsage;
  /** Number of agent steps (tool call rounds) taken. */
  stepCount?: number;
}
