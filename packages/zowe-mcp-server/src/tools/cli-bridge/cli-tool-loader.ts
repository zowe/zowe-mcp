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
 *   3. Generates profile management tools (list/set) for each profile type.
 *   4. Generates Zod schemas from the parameter definitions (tool-specific params +
 *      per-tool-override profile fields).
 *   5. Builds CLI argument arrays from tool call arguments + virtual location context.
 *   6. Resolves the active connection profile and awaits the password before invoking.
 *   7. Registers each tool via `server.registerTool()`.
 *
 * No plugin-specific code lives here. All plugin-specific details (profile type
 * definitions, field names, CLI option names) are read from the YAML.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { load as yamlLoad } from 'js-yaml';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import { buildProfileArgs, invokeZoweCli } from './cli-invoker.js';
import type {
  CliNamedProfile,
  CliPluginConfig,
  CliPluginState,
  PluginParam,
  PluginToolDef,
  ProfileFieldDef,
  ProfileTypeDef,
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
 * Resolves a single `$.` reference string. Returns the original if it does not
 * start with `$.` or if the path cannot be resolved.
 */
function resolveIfRef(value: string | undefined, jsonData: unknown): string | undefined {
  if (!value?.startsWith(JSON_REF_PREFIX)) return value;
  const path = value.slice(JSON_REF_PREFIX.length);
  return resolveJsonRef(path, jsonData) ?? value;
}

/**
 * Resolves all `$.` references in a `description` string and all entries of a
 * `descriptions` variants object, modifying the item in-place.
 * Works for ProfileTypeDef, ProfileFieldDef, PluginParam, and PluginToolDef alike.
 */
function resolveDescribableRefs(
  item: { description?: string; descriptions?: Record<string, string | undefined> },
  jsonData: unknown
): void {
  if (item.description !== undefined) {
    const resolved = resolveIfRef(item.description, jsonData);
    if (resolved !== undefined) item.description = resolved;
  }
  if (item.descriptions) {
    const descs = item.descriptions;
    for (const key of Object.keys(descs)) {
      const resolved = resolveIfRef(descs[key], jsonData);
      if (resolved !== undefined) descs[key] = resolved;
    }
  }
}

/**
 * Attempts to load a companion `<plugin>-commands.json` file from the same
 * directory as the plugin YAML. Returns `null` when the file does not exist.
 */
function loadCompanionJson(yamlPath: string, pluginName: string): unknown {
  const companionPath = join(dirname(yamlPath), `${pluginName}-commands.json`);
  if (!existsSync(companionPath)) return null;
  const raw = readFileSync(companionPath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

/**
 * Resolves all `$.` JSON references in the plugin config in-place.
 * Covers: profile type descriptions, profile field descriptions,
 * tool description variants, and tool param descriptions.
 */
function resolveJsonRefs(config: CliPluginConfig, jsonData: unknown): void {
  // Profile type descriptions and field descriptions
  if (config.profiles) {
    for (const typeDef of Object.values(config.profiles)) {
      // listDescription / listDescriptions and setDescription / setDescriptions
      resolveDescribableRefs(
        {
          description: typeDef.listDescription,
          descriptions: typeDef.listDescriptions,
        },
        jsonData
      );
      // Apply resolved values back (resolveDescribableRefs mutates a proxy object above)
      // We need to handle this differently since ProfileTypeDef has separate fields
      if (typeDef.listDescription?.startsWith(JSON_REF_PREFIX)) {
        const resolved = resolveIfRef(typeDef.listDescription, jsonData);
        if (resolved) typeDef.listDescription = resolved;
      }
      if (typeDef.setDescription?.startsWith(JSON_REF_PREFIX)) {
        const resolved = resolveIfRef(typeDef.setDescription, jsonData);
        if (resolved) typeDef.setDescription = resolved;
      }
      if (typeDef.listDescriptions) {
        for (const key of Object.keys(typeDef.listDescriptions)) {
          const val = typeDef.listDescriptions[key];
          if (val?.startsWith(JSON_REF_PREFIX)) {
            typeDef.listDescriptions[key] = resolveIfRef(val, jsonData) ?? val;
          }
        }
      }
      if (typeDef.setDescriptions) {
        for (const key of Object.keys(typeDef.setDescriptions)) {
          const val = typeDef.setDescriptions[key];
          if (val?.startsWith(JSON_REF_PREFIX)) {
            typeDef.setDescriptions[key] = resolveIfRef(val, jsonData) ?? val;
          }
        }
      }
      // Resolve each field's descriptions
      for (const field of typeDef.fields) {
        resolveDescribableRefs(field, jsonData);
      }
    }
  }
  // Tool descriptions and per-tool params
  for (const tool of config.tools) {
    resolveDescribableRefs(tool, jsonData);
    for (const param of tool.params ?? []) {
      resolveDescribableRefs(param, jsonData);
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
 * Resolves the description for any item that carries either a plain `description`
 * string or a `descriptions` variants object (ProfileFieldDef, PluginParam,
 * or PluginToolDef).
 *
 * Priority:
 *   descriptions[variant] → descriptions.intent → descriptions.cli
 *   → first non-empty descriptions value → description (plain) → ''
 */
export function resolveFieldDescription(
  item: { description?: string; descriptions?: Record<string, string | undefined> },
  variant?: string
): string {
  const v = variant ?? process.env.ZOWE_MCP_CLI_DESC_VARIANT ?? 'intent';
  const descs = item.descriptions;
  if (descs) {
    const text =
      descs[v] ??
      descs.intent ??
      descs.cli ??
      Object.values(descs).find(val => val != null && val !== '');
    if (text) return text;
  }
  return item.description ?? '';
}

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
  return resolveFieldDescription(tool, variant) || tool.toolName;
}

// ---------------------------------------------------------------------------
// Zod schema generation
// ---------------------------------------------------------------------------

/**
 * Resolves which profile fields to inject as location params based on the locationParams field.
 * - false/undefined: none
 * - true: all fields
 * - string[]: only the named fields
 *
 * Profile fields come from the ProfileTypeDef for the `perToolOverride: true` type in the
 * plugin YAML's `profiles:` block — no hardcoded list.
 */
function resolveLocationParams(
  locationParams: PluginToolDef['locationParams'],
  fields: ProfileFieldDef[]
): PluginParam[] {
  if (!locationParams) return [];
  const asParams: PluginParam[] = fields.map(f => ({
    name: f.name,
    cliOption: f.cliOption,
    description: f.description,
    descriptions: f.descriptions,
    default: f.default,
  }));
  if (locationParams === true) return asParams;
  return asParams.filter(p => locationParams.includes(p.name));
}

/** Builds a Zod schema for a single PluginParam. */
function buildParamSchema(param: PluginParam, variant?: string): z.ZodTypeAny {
  // Use z.coerce.string() so AI agents (or call-tool) can pass numbers/booleans; they are coerced to string.
  const desc = resolveFieldDescription(param, variant);
  let schema: z.ZodTypeAny = z.coerce.string().describe(desc);
  if (!param.required) {
    schema = schema.optional();
  }
  return schema;
}

/**
 * Builds the full Zod input schema for a tool, merging:
 *   1. Optional `<typeKey>Id` for each profile type (all types).
 *   2. Location field params from `perToolOverride: true` profile types (if tool.locationParams set).
 *   3. Tool-specific extra params from tool.params.
 *
 * @param profileDefs - the plugin's profile type definitions (from YAML `profiles:`)
 * @param variant     - the active description variant (used for param descriptions)
 */
export function buildToolInputSchema(
  tool: PluginToolDef,
  profileDefs?: Record<string, ProfileTypeDef>,
  variant?: string
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  // Add optional <typeKey>Id parameter for every profile type
  for (const [typeKey, typeDef] of Object.entries(profileDefs ?? {})) {
    const idParamName = `${typeKey}Id`;
    const idDesc = typeDef.required
      ? `Override the active ${typeDef.name} for this single call without changing the global default.`
      : `ID of a named ${typeDef.name} profile to prime field defaults for this call.`;
    shape[idParamName] = z.coerce.string().optional().describe(idDesc);
  }

  // For perToolOverride: true types, inject location fields controlled by tool.locationParams
  for (const [, typeDef] of Object.entries(profileDefs ?? {})) {
    if (!typeDef.perToolOverride) continue;
    const locationParamsList = resolveLocationParams(tool.locationParams, typeDef.fields);
    for (const param of locationParamsList) {
      shape[param.name] = buildParamSchema(param, variant);
    }
  }

  // Tool-specific extra params
  for (const param of tool.params ?? []) {
    shape[param.name] = buildParamSchema(param, variant);
  }

  return shape;
}

// ---------------------------------------------------------------------------
// CLI argument construction
// ---------------------------------------------------------------------------

/**
 * Builds the extra CLI argument array for a tool call (location fields + tool-specific params).
 *
 * For each param:
 *   - cliPositional: true  → value added as bare positional word (first in the result)
 *   - cliOption: 'opt'     → ['--opt', value]
 *
 * Location field params use the effective context when the caller omits the arg.
 * The effective context is already merged (virtual context + per-call locationId profile)
 * before this function is called.
 *
 * @param effectiveContext - pre-merged context for perToolOverride: true profile fields
 * @param locationFields   - field definitions for the perToolOverride: true profile type
 */
export function buildCliArgs(
  tool: PluginToolDef,
  args: Record<string, unknown>,
  effectiveContext: Record<string, string | undefined>,
  locationFields: ProfileFieldDef[]
): string[] {
  const allParams: PluginParam[] = [
    ...resolveLocationParams(tool.locationParams, locationFields),
    ...(tool.params ?? []),
  ];

  const positionals: string[] = [];
  const options: string[] = [];

  // Build a set of location field names for fast lookup
  const locationFieldNames = new Set(locationFields.map(f => f.name));

  for (const param of allParams) {
    // Resolve value: call arg → effective context default (for location fields) → param default
    let value: string | undefined = args[param.name] as string | undefined;

    if (value === undefined && locationFieldNames.has(param.name)) {
      value = effectiveContext[param.name];
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
// Profile tool registration
// ---------------------------------------------------------------------------

/**
 * Registers list and set management tools for each profile type defined in
 * `config.profiles`. Called once from `loadCliBridgeTools`.
 *
 * For each type key (e.g. "connection", "location"):
 *
 *   List tool (toolListName):
 *     - `readOnlyHint: true`
 *     - Returns all configured profiles (non-sensitive fields only), marks active ID
 *     - For `perToolOverride: true` types also shows the current virtual context
 *
 *   Set tool (toolSetName):
 *     - `required: true, perToolOverride: false` (connection-style):
 *         Takes one required `<typeKey>Id` param; validates and sets the active profile.
 *     - `required: false, perToolOverride: true` (location-style):
 *         All params optional; primes from named profile and/or sets individual fields.
 *         No args → clears the virtual context.
 */
function registerProfileTools(
  server: McpServer,
  config: CliPluginConfig,
  state: CliPluginState,
  log: Logger,
  activeDescription?: string
): void {
  if (!config.profiles) return;

  const variant = activeDescription ?? process.env.ZOWE_MCP_CLI_DESC_VARIANT ?? 'intent';

  for (const [typeKey, typeDef] of Object.entries(config.profiles)) {
    // ---- List tool -------------------------------------------------------
    const listDescDefault = `Lists all configured ${typeDef.name} profiles.`;
    const listDesc =
      resolveFieldDescription(
        { description: typeDef.listDescription, descriptions: typeDef.listDescriptions },
        variant
      ) || listDescDefault;

    server.registerTool(
      typeDef.toolListName,
      {
        description: listDesc,
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () => {
        const profiles = (state.profilesByType.get(typeKey) ?? []).map(p => {
          const display: Record<string, unknown> = { id: p.id };
          for (const field of typeDef.fields) {
            if (p[field.name] !== undefined) {
              display[field.name] = p[field.name];
            }
          }
          display.active = state.activeProfileId.get(typeKey) === p.id;
          return display;
        });

        const result: Record<string, unknown> = { profiles };
        if (typeDef.perToolOverride) {
          result.currentContext = state.virtualContextByType.get(typeKey) ?? {};
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    // ---- Set tool --------------------------------------------------------
    const setDescDefault =
      typeDef.required && !typeDef.perToolOverride
        ? `Sets the active ${typeDef.name}. Call once before using tools; auto-selected when only one profile is configured.`
        : `Sets the virtual ${typeDef.name} context used as defaults for subsequent tool calls. All parameters are optional; call with no arguments to clear.`;
    const setDesc =
      resolveFieldDescription(
        { description: typeDef.setDescription, descriptions: typeDef.setDescriptions },
        variant
      ) || setDescDefault;

    if (typeDef.required && !typeDef.perToolOverride) {
      // Connection-style: one required ID param
      const idParamName = `${typeKey}Id`;
      server.registerTool(
        typeDef.toolSetName,
        {
          description: setDesc,
          inputSchema: {
            [idParamName]: z
              .string()
              .describe(`The ID of the ${typeDef.name} profile to activate.`),
          },
          annotations: { readOnlyHint: false },
        },
        (args: Record<string, unknown>) => {
          const id = args[idParamName] as string;
          const profiles = state.profilesByType.get(typeKey) ?? [];
          const profile = profiles.find(p => p.id === id);
          if (!profile) {
            const validIds = profiles.map(p => p.id).join(', ');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: `Unknown ${typeDef.name} profile "${id}". Valid IDs: ${validIds || 'none configured'}`,
                  }),
                },
              ],
              isError: true,
            };
          }
          state.activeProfileId.set(typeKey, id);

          const display: Record<string, unknown> = { id };
          for (const field of typeDef.fields) {
            if (profile[field.name] !== undefined) {
              display[field.name] = profile[field.name];
            }
          }
          log.debug(`Active ${typeDef.name} set`, { typeKey, id });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ success: true, active: display }),
              },
            ],
          };
        }
      );
    } else {
      // Location-style: optional ID + all fields as optional params
      const idParamName = `${typeKey}Id`;
      const shape: Record<string, z.ZodTypeAny> = {
        [idParamName]: z.coerce
          .string()
          .optional()
          .describe(`ID of a named ${typeDef.name} profile to prime the context from.`),
      };
      for (const field of typeDef.fields) {
        shape[field.name] = z.coerce
          .string()
          .optional()
          .describe(resolveFieldDescription(field, variant));
      }

      server.registerTool(
        typeDef.toolSetName,
        {
          description: setDesc,
          inputSchema: shape,
          annotations: { readOnlyHint: false },
        },
        (args: Record<string, unknown>) => {
          // Start fresh (no args = clear)
          const newContext: Record<string, string | undefined> = {};

          // If <typeKey>Id given, prime from that profile
          const primeId = args[idParamName] as string | undefined;
          if (primeId) {
            const profile = state.profilesByType.get(typeKey)?.find(p => p.id === primeId);
            if (profile) {
              for (const f of typeDef.fields) {
                if (profile[f.name] !== undefined) {
                  newContext[f.name] = String(profile[f.name]);
                }
              }
            }
          }

          // Apply directly specified field overrides
          for (const field of typeDef.fields) {
            const val = args[field.name];
            if (typeof val === 'string' && val !== '') {
              newContext[field.name] = val;
            }
          }

          state.virtualContextByType.set(typeKey, newContext);
          log.debug(`Virtual ${typeDef.name} context updated`, { typeKey, context: newContext });

          const contextSummary = Object.entries(newContext)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(', ');

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: true,
                  context: newContext,
                  message: contextSummary
                    ? `${typeDef.name} context set: ${contextSummary}`
                    : `${typeDef.name} context cleared.`,
                }),
              },
            ],
          };
        }
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin tool registration
// ---------------------------------------------------------------------------

function registerPluginTool(
  server: McpServer,
  toolDef: PluginToolDef,
  pluginActiveDescription: string | undefined,
  state: CliPluginState,
  config: CliPluginConfig,
  log: Logger
): void {
  const variant =
    toolDef.activeDescription ??
    pluginActiveDescription ??
    process.env.ZOWE_MCP_CLI_DESC_VARIANT ??
    'intent';
  const description = resolveDescription(toolDef, pluginActiveDescription);
  const inputSchema = buildToolInputSchema(toolDef, config.profiles, variant);

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

      // --- 1. Resolve profiles and build connection args ---
      const allProfileArgs: string[] = [];

      for (const [typeKey, typeDef] of Object.entries(config.profiles ?? {})) {
        if (!typeDef.required) continue;

        // Per-call <typeKey>Id override or fallback to active
        const perCallId = args[`${typeKey}Id`] as string | undefined;
        const profileId = perCallId ?? state.activeProfileId.get(typeKey);

        if (!profileId) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `No active ${typeDef.name} profile. Call ${typeDef.toolSetName} to set one, or pass ${typeKey}Id.`,
                }),
              },
            ],
            isError: true,
          };
        }

        const profiles = state.profilesByType.get(typeKey) ?? [];
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) {
          const validIds = profiles.map(p => p.id).join(', ');
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Unknown ${typeDef.name} profile "${profileId}". Valid IDs: ${validIds || 'none configured'}`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Get password if needed
        let password: string | undefined;
        const usernameField = typeDef.fields.find(f => f.isUsername);
        if (usernameField && state.passwordResolver) {
          const hostField = typeDef.fields.find(f => f.name === 'host');
          const user = String(profile[usernameField.name] ?? '');
          const host = String(profile[hostField?.name ?? 'host'] ?? '');
          if (user && host) {
            try {
              password = await state.passwordResolver.getPassword(user, host);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({ error: `Could not resolve password: ${msg}` }),
                  },
                ],
                isError: true,
              };
            }
          }
        }

        allProfileArgs.push(...buildProfileArgs(profile, typeDef.fields, password));
      }

      // --- 2. Build effective location context for perToolOverride: true types ---
      let effectiveContext: Record<string, string | undefined> = {};
      let locationFields: ProfileFieldDef[] = [];

      for (const [typeKey, typeDef] of Object.entries(config.profiles ?? {})) {
        if (!typeDef.perToolOverride) continue;

        // Start with virtual context
        effectiveContext = { ...(state.virtualContextByType.get(typeKey) ?? {}) };
        locationFields = typeDef.fields;

        // Per-call <typeKey>Id: prime from that profile (override virtual context)
        const perCallLocId = args[`${typeKey}Id`] as string | undefined;
        if (perCallLocId) {
          const profile = state.profilesByType.get(typeKey)?.find(p => p.id === perCallLocId);
          if (profile) {
            for (const f of typeDef.fields) {
              if (profile[f.name] !== undefined) {
                effectiveContext[f.name] = String(profile[f.name]);
              }
            }
          }
        }
      }

      // --- 3. Build extra CLI args (location fields + tool-specific params) ---
      const extraArgs = buildCliArgs(toolDef, args, effectiveContext, locationFields);
      toolLog.debug('Invoking zowe CLI', {
        command,
        extraArgs,
        profileArgCount: allProfileArgs.length,
      });

      // --- 4. Invoke CLI ---
      const result = invokeZoweCli(command, extraArgs, allProfileArgs);

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

      // --- 5. Determine output ---
      const outputPath = toolDef.outputPath ?? 'data';
      let output: unknown;

      if (outputPath === 'stdout') {
        output = result.stdout;
      } else if (outputPath === '.') {
        output = result.data;
      } else {
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
// Top-level tool registration
// ---------------------------------------------------------------------------

/**
 * Registers all tools from the plugin config on the MCP server.
 * Registers profile management tools first, then the plugin command tools.
 */
export function loadCliBridgeTools(
  server: McpServer,
  pluginConfig: CliPluginConfig,
  state: CliPluginState,
  logger: Logger
): void {
  const log = logger.child('cli-bridge');

  // Auto-select single profile for required types (if no active ID already set)
  for (const [typeKey, typeDef] of Object.entries(pluginConfig.profiles ?? {})) {
    if (!typeDef.required) continue;
    const profiles = state.profilesByType.get(typeKey) ?? [];
    const hasActive = state.activeProfileId.get(typeKey) !== undefined;
    if (!hasActive && profiles.length === 1) {
      state.activeProfileId.set(typeKey, profiles[0].id);
      log.debug(`Auto-selected single ${typeDef.name} profile`, { typeKey, id: profiles[0].id });
    }
  }

  // Register profile management tools (list/set for each profile type)
  registerProfileTools(server, pluginConfig, state, log, pluginConfig.activeDescription);

  // Register plugin command tools
  for (const toolDef of pluginConfig.tools) {
    registerPluginTool(server, toolDef, pluginConfig.activeDescription, state, pluginConfig, log);
  }

  const profileToolCount = Object.keys(pluginConfig.profiles ?? {}).length * 2;
  log.info(
    `Registered ${pluginConfig.tools.length} CLI bridge tools + ${profileToolCount} profile management tools from plugin YAML`,
    {
      plugin: pluginConfig.plugin,
      tools: pluginConfig.tools.map(t => t.toolName),
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
export function formatPluginContextForDisplay(
  state: CliPluginState,
  config?: CliPluginConfig
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [typeKey, profiles] of state.profilesByType.entries()) {
    const typeDef = config?.profiles?.[typeKey];
    const activeId = state.activeProfileId.get(typeKey);
    const activeProfile = profiles.find(p => p.id === activeId);

    const display: Record<string, unknown> = {
      activeId,
      profileCount: profiles.length,
    };

    if (activeProfile && typeDef) {
      const activeDisplay: Record<string, unknown> = { id: activeProfile.id };
      for (const field of typeDef.fields) {
        if (activeProfile[field.name] !== undefined && !field.isUsername) {
          activeDisplay[field.name] = activeProfile[field.name];
        }
      }
      display.active = activeDisplay;
    }

    // For perToolOverride types, include current virtual context
    if (typeDef?.perToolOverride) {
      const ctx = state.virtualContextByType.get(typeKey) ?? {};
      if (Object.keys(ctx).length > 0) {
        display.currentContext = ctx;
      }
    }

    result[typeKey] = display;
  }

  return result;
}

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

/**
 * Creates an empty CliPluginState. Useful for tests and generate-docs.
 */
export function createEmptyPluginState(): CliPluginState {
  return {
    profilesByType: new Map<string, CliNamedProfile[]>(),
    activeProfileId: new Map<string, string | undefined>(),
    virtualContextByType: new Map<string, Record<string, string | undefined>>(),
  };
}
