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
 * CLI plugin bridge — loads a plugin YAML metadata file and dynamically registers
 * MCP tools on the given server.
 *
 * The loader:
 *   1. Reads and validates the YAML plugin config.
 *   2. Resolves the active description variant (YAML default → env override).
 *   3. Generates Zod schemas from the parameter definitions.
 *   4. Builds CLI argument arrays from tool call arguments + CliContext.
 *   5. Registers each tool via `server.registerTool()`.
 *   6. Registers the set-context tool from the `context:` block.
 *
 * No plugin-specific code lives here. All plugin-specific details (location field
 * names, CLI option names, connection flag names) are read from the YAML.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { load as yamlLoad } from 'js-yaml';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import { invokeZoweCli } from './cli-invoker.js';
import type {
  CliConnectionFlag,
  CliContext,
  CliPluginConfig,
  CliPluginState,
  ContextDef,
  ContextFieldDef,
  PluginParam,
  PluginToolDef,
} from './types.js';

// ---------------------------------------------------------------------------
// JSON reference resolution ($.dot.path syntax)
// ---------------------------------------------------------------------------

/**
 * The JSON reference prefix. When a description string starts with `$.`
 * it is treated as a dotted path into the companion `<plugin>-commands.json`
 * file placed next to the plugin YAML.
 *
 * Example in YAML:  `cli: "$.endevor.list.environments.description"`
 * The loader walks the path in the loaded JSON and substitutes the resolved
 * string.  When the companion JSON is absent or the path is not found, the
 * original `$.` string is left as-is (no silent failure; a WARN is logged).
 */
const JSON_REF_PREFIX = '$.';

/**
 * Walks a dotted path (e.g. `"endevor.list.environments.description"`) in an
 * arbitrary JSON object and returns the string value, or `undefined` if the
 * path does not resolve to a string.
 */
export function resolveJsonRef(path: string, jsonData: unknown): string | undefined {
  const parts = path.split('.');
  let current: unknown = jsonData;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Resolves all `$.` references in a string value using the provided JSON data.
 * Returns the original string unchanged if it does not start with `$.`.
 */
function resolveIfRef(value: string | undefined, jsonData: unknown): string | undefined {
  if (!value?.startsWith(JSON_REF_PREFIX)) return value;
  const path = value.slice(JSON_REF_PREFIX.length);
  return resolveJsonRef(path, jsonData) ?? value;
}

/**
 * Attempts to load a companion `<plugin>-commands.json` file from the same
 * directory as the plugin YAML. Returns `null` when the file does not exist.
 */
function loadCompanionJson(yamlPath: string, pluginName: string): unknown | null {
  const companionPath = join(dirname(yamlPath), `${pluginName}-commands.json`);
  if (!existsSync(companionPath)) return null;
  const raw = readFileSync(companionPath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

/**
 * Resolves all `$.` JSON references in the plugin config in-place.
 * Modifies tool descriptions and context field descriptions.
 */
function resolveJsonRefs(config: CliPluginConfig, jsonData: unknown): void {
  // Resolve context field descriptions
  if (config.context?.fields) {
    for (const field of config.context.fields) {
      const resolved = resolveIfRef(field.description, jsonData);
      if (resolved !== undefined) field.description = resolved;
    }
  }
  // Resolve tool description variants
  for (const tool of config.tools) {
    const descs = tool.descriptions;
    for (const key of Object.keys(descs) as (keyof typeof descs)[]) {
      const resolved = resolveIfRef(descs[key], jsonData);
      if (resolved !== undefined) descs[key] = resolved;
    }
  }
}

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

/** Loads and parses a plugin YAML file. Throws on parse error. */
export function loadPluginYaml(yamlPath: string): CliPluginConfig {
  const raw = readFileSync(yamlPath, 'utf-8');
  const config = yamlLoad(raw) as CliPluginConfig;

  // Attempt to load the companion JSON for $.path reference resolution
  const jsonData = loadCompanionJson(yamlPath, config.plugin);
  if (jsonData !== null) {
    resolveJsonRefs(config, jsonData);
  }

  return config;
}

// ---------------------------------------------------------------------------
// Description variant resolution
// ---------------------------------------------------------------------------

/**
 * Returns the active description text for a tool.
 *
 * Priority:
 *   tool.activeDescription > pluginActiveDescription > ZOWE_MCP_CLI_DESC_VARIANT env > 'intent' > 'cli' > first available
 */
export function resolveDescription(tool: PluginToolDef, pluginActiveDescription?: string): string {
  const variant =
    tool.activeDescription ??
    pluginActiveDescription ??
    process.env.ZOWE_MCP_CLI_DESC_VARIANT ??
    'intent';

  const text =
    tool.descriptions[variant] ??
    tool.descriptions.intent ??
    tool.descriptions.cli ??
    Object.values(tool.descriptions).find(v => v != null && v !== '') ??
    tool.toolName;

  return text ?? tool.toolName;
}

// ---------------------------------------------------------------------------
// Zod schema generation
// ---------------------------------------------------------------------------

/**
 * Resolves which context fields to inject as location params based on the locationParams field.
 * - false/undefined: none
 * - true: all context fields
 * - string[]: only the named fields
 *
 * Context fields come from the plugin YAML `context.fields` block — no hardcoded list.
 */
function resolveLocationParams(
  locationParams: PluginToolDef['locationParams'],
  contextFields: ContextFieldDef[]
): PluginParam[] {
  if (!locationParams) return [];
  const asParams: PluginParam[] = contextFields.map(f => ({
    name: f.name,
    cliOption: f.cliOption,
    description: f.description,
    default: f.default,
  }));
  if (locationParams === true) return asParams;
  return asParams.filter(p => locationParams.includes(p.name));
}

/** Builds a Zod schema for a single PluginParam. */
function buildParamSchema(param: PluginParam): z.ZodTypeAny {
  // Use z.coerce.string() so AI agents (or call-tool) can pass numbers/booleans; they are coerced to string.
  let schema: z.ZodTypeAny = z.coerce.string().describe(param.description);
  if (!param.required) {
    schema = schema.optional();
  }
  return schema;
}

/**
 * Builds the full Zod input schema for a tool, merging location params + extra params.
 * @param contextFields - the plugin's context fields (from YAML `context.fields`)
 */
export function buildToolInputSchema(
  tool: PluginToolDef,
  contextFields: ContextFieldDef[]
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const allParams: PluginParam[] = [
    ...resolveLocationParams(tool.locationParams, contextFields),
    ...(tool.params ?? []),
  ];
  for (const param of allParams) {
    shape[param.name] = buildParamSchema(param);
  }
  return shape;
}

// ---------------------------------------------------------------------------
// CLI argument construction
// ---------------------------------------------------------------------------

/**
 * Builds the extra CLI argument array for a tool call.
 *
 * For each param:
 *   - cliPositional: true  → value added as bare positional word (first in the result)
 *   - cliOption: 'opt'     → ['--opt', value]
 *
 * Context field params use the context value when the caller omits the arg.
 * Because the context keys are the same as the param names (both come from
 * the YAML `context.fields` block), the lookup is a direct key match.
 *
 * @param contextFields - the plugin's context fields (from YAML `context.fields`)
 */
export function buildCliArgs(
  tool: PluginToolDef,
  args: Record<string, unknown>,
  context: CliContext,
  contextFields: ContextFieldDef[]
): string[] {
  const allParams: PluginParam[] = [
    ...resolveLocationParams(tool.locationParams, contextFields),
    ...(tool.params ?? []),
  ];

  const positionals: string[] = [];
  const options: string[] = [];

  // Build a set of context field names for fast lookup
  const contextFieldNames = new Set(contextFields.map(f => f.name));

  for (const param of allParams) {
    // Resolve value: call arg → context default (for context fields) → param default
    let value: string | undefined = args[param.name] as string | undefined;

    if (value === undefined && contextFieldNames.has(param.name)) {
      value = context[param.name];
    }
    if (value === undefined && param.default !== undefined) {
      value = param.default;
    }

    if (value === undefined) continue;

    if (param.cliPositional) {
      positionals.push(value);
    } else if (param.cliOption) {
      options.push(`--${param.cliOption}`, value);
    }
  }

  // Positionals come before options in Zowe CLI
  return [...positionals, ...options];
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Registers all tools from the plugin config on the MCP server.
 * Also registers the set-context tool if a context block is defined.
 */
export function loadCliBridgeTools(
  server: McpServer,
  pluginConfig: CliPluginConfig,
  state: CliPluginState,
  logger: Logger
): void {
  const log = logger.child('cli-bridge');
  const contextFields = pluginConfig.context?.fields ?? [];

  if (pluginConfig.context) {
    registerContextTool(server, pluginConfig.context, state, log);
  }

  const connectionFlags = pluginConfig.connection?.flags ?? [];

  for (const toolDef of pluginConfig.tools) {
    registerPluginTool(
      server,
      toolDef,
      pluginConfig.activeDescription,
      state,
      contextFields,
      connectionFlags,
      log
    );
  }

  log.info(`Registered ${pluginConfig.tools.length} CLI bridge tools from plugin YAML`, {
    plugin: pluginConfig.plugin,
    tools: pluginConfig.tools.map(t => t.toolName),
  });
}

// ---------------------------------------------------------------------------
// Context tool registration
// ---------------------------------------------------------------------------

function registerContextTool(
  server: McpServer,
  contextDef: ContextDef,
  state: CliPluginState,
  log: Logger
): void {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of contextDef.fields) {
    shape[field.name] = z.coerce.string().optional().describe(field.description);
  }

  const description =
    contextDef.description ??
    'Sets the default location context for subsequent tool calls. Call this once to avoid repeating location parameters on every tool invocation.';

  server.registerTool(
    contextDef.toolName,
    {
      description,
      inputSchema: shape,
      annotations: { readOnlyHint: false },
    },
    (args: Record<string, unknown>) => {
      const prev = { ...state.context };
      for (const field of contextDef.fields) {
        const val = args[field.name];
        if (typeof val === 'string') {
          state.context[field.name] = val;
        }
      }
      log.debug('Context updated', { prev, next: state.context });

      const contextSummary = Object.entries(state.context)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ');

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              context: state.context,
              message: contextSummary ? `Context set: ${contextSummary}` : 'Context cleared.',
            }),
          },
        ],
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Plugin tool registration
// ---------------------------------------------------------------------------

function registerPluginTool(
  server: McpServer,
  toolDef: PluginToolDef,
  pluginActiveDescription: string | undefined,
  state: CliPluginState,
  contextFields: ContextFieldDef[],
  connectionFlags: CliConnectionFlag[],
  log: Logger
): void {
  const description = resolveDescription(toolDef, pluginActiveDescription);
  const inputSchema = buildToolInputSchema(toolDef, contextFields);

  // Split zoweCommand into args array: "endevor list elements" → ['endevor', 'list', 'elements']
  const command = toolDef.zoweCommand.trim().split(/\s+/);

  server.registerTool(
    toolDef.toolName,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: toolDef.readOnlyHint ?? false,
        destructiveHint: toolDef.destructiveHint ?? false,
      },
    },
    async (args: Record<string, unknown>) => {
      const toolLog = log.child(toolDef.toolName);
      toolLog.debug('Tool called', { args });

      const extraArgs = buildCliArgs(toolDef, args, state.context, contextFields);
      toolLog.debug('Invoking zowe CLI', { command, extraArgs });

      const result = invokeZoweCli(command, extraArgs, state.connection, connectionFlags);

      if (!result.ok) {
        toolLog.warning('CLI invocation failed', {
          command,
          extraArgs,
          error: result.errorMessage,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: result.errorMessage }),
            },
          ],
          isError: true,
        };
      }

      // Determine output
      const outputPath = toolDef.outputPath ?? 'data';
      let output: unknown;

      if (outputPath === 'stdout') {
        output = result.stdout;
      } else if (outputPath === '.') {
        output = result.data;
      } else {
        // Extract nested key from data (e.g. "data" or "data.items")
        output = extractOutputPath(result.data, outputPath);
        if (output === undefined) {
          output = result.data;
        }
      }

      const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      toolLog.debug('Tool result', { outputLength: text.length });
      return {
        content: [{ type: 'text' as const, text }],
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Convenience: load YAML and register in one call
// ---------------------------------------------------------------------------

/**
 * Reads a plugin YAML file and registers all defined tools on the server.
 * Returns the plugin config (for inspection/testing).
 */
export function loadAndRegisterPluginYaml(
  server: McpServer,
  yamlPath: string,
  state: CliPluginState,
  logger: Logger
): CliPluginConfig {
  const config = loadPluginYaml(yamlPath);
  loadCliBridgeTools(server, config, state, logger);
  return config;
}

// ---------------------------------------------------------------------------
// Output path extraction
// ---------------------------------------------------------------------------

/**
 * Traverses a nested object by dot-separated key path.
 * e.g. extractOutputPath({ data: { items: [1,2] } }, 'data.items') → [1,2]
 */
export function extractOutputPath(body: unknown, path: string): unknown {
  if (path === '.' || path === '' || body == null) return body;
  let current: unknown = body;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Context display helpers
// ---------------------------------------------------------------------------

/** Returns the current CliPluginState as a display record (for getContext). */
export function formatPluginContextForDisplay(state: CliPluginState): Record<string, unknown> {
  const connDisplay: Record<string, unknown> = {};
  if (state.connection.host) connDisplay.host = state.connection.host;
  if (state.connection.port !== undefined) connDisplay.port = state.connection.port;
  if (state.connection.user) connDisplay.user = state.connection.user;
  if (state.connection.pluginParams) {
    const params = state.connection.pluginParams;
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && k !== 'password') {
        connDisplay[k] = v;
      }
    }
  }

  return {
    connection: connDisplay,
    location: Object.fromEntries(Object.entries(state.context).filter(([, v]) => v !== undefined)),
  };
}
