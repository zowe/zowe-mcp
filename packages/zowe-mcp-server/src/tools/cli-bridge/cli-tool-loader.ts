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
import {
  buildCacheKey,
  createResponseCache,
  type ResponseCache,
} from '../../zos/response-cache.js';
import {
  buildContext,
  getListMessages,
  getReadMessages,
  MAX_LIST_LIMIT,
  paginateList,
  PAGINATION_NOTE_LINES,
  PAGINATION_NOTE_LIST,
  sanitizeTextForDisplay,
  windowContent,
  withPaginationNote,
  wrapResponse,
} from '../response.js';
import { buildProfileArgs, invokeZoweCli } from './cli-invoker.js';
import type {
  CliNamedProfile,
  CliPluginConfig,
  CliPluginState,
  PaginationDef,
  PluginContentPaginationConfig,
  PluginListPaginationConfig,
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
 * it is treated as a dotted path into the companion `<plugin>-commands.yaml`
 * (or `.json`) file placed next to the plugin YAML.
 *
 * Example in YAML:  `cli: "$.endevor.list.environments.description"`
 * The loader walks the path in the loaded companion data and substitutes the
 * resolved string.  When the path resolves to an object with a `description`
 * property, that property is returned (backwards-compatible with the richer
 * CLI commands YAML format produced by `scripts/generate-cli-bridge-yaml.mjs`).
 * When the companion file is absent or the path is not found, the original
 * `$.` string is left as-is (no silent failure; a WARN is logged).
 */
const JSON_REF_PREFIX = '$.';

/**
 * Walks a dotted path (e.g. `"endevor.list.environments.description"`) in an
 * arbitrary data object and returns a string value, or `undefined` when the
 * path does not resolve to a string.
 *
 * When the resolved value is an object with a `description` string property,
 * that property is returned — this allows `$.path` refs that point at an
 * option or positional entry in the richer CLI commands YAML format to
 * transparently resolve to the description string without changing existing
 * MCP tools YAML files.
 */
export function resolveJsonRef(path: string, jsonData: unknown): string | undefined {
  const parts = path.split('.');
  let current: unknown = jsonData;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'string') return current;
  if (current !== null && typeof current === 'object') {
    const desc = (current as Record<string, unknown>).description;
    if (typeof desc === 'string') return desc;
  }
  return undefined;
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
 * Attempts to load a companion `<plugin>-commands.yaml` or
 * `<plugin>-commands.json` file from the same directory as the plugin YAML.
 *
 * The richer YAML format (generated by `scripts/generate-cli-bridge-yaml.mjs`)
 * is preferred over the legacy JSON format. Returns `null` when neither file
 * exists.
 */
function loadCompanionFile(yamlPath: string, pluginName: string): unknown {
  const dir = dirname(yamlPath);

  // Prefer the richer auto-generated YAML format.
  const yamlCompanion = join(dir, `${pluginName}-commands.yaml`);
  if (existsSync(yamlCompanion)) {
    const raw = readFileSync(yamlCompanion, 'utf-8');
    return yamlLoad(raw);
  }

  // Fall back to the legacy JSON format.
  const jsonCompanion = join(dir, `${pluginName}-commands.json`);
  if (existsSync(jsonCompanion)) {
    const raw = readFileSync(jsonCompanion, 'utf-8');
    return JSON.parse(raw) as unknown;
  }

  return null;
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

  // Attempt to load companion commands file (.yaml preferred, .json fallback) for $.path refs.
  const jsonData = loadCompanionFile(yamlPath, config.plugin);
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
 *   descriptions[variant] → descriptions.optimized → descriptions.cli
 *   → first non-empty descriptions value → description (plain) → ''
 */
export function resolveFieldDescription(
  item: { description?: string; descriptions?: Record<string, string | undefined> },
  variant?: string
): string {
  const v = variant ?? process.env.ZOWE_MCP_CLI_DESC_VARIANT ?? 'optimized';
  const descs = item.descriptions;
  if (descs) {
    const text =
      descs[v] ??
      descs.optimized ??
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
 *   tool.activeDescription > pluginActiveDescription > ZOWE_MCP_CLI_DESC_VARIANT env > 'optimized' > 'cli' > first available
 */
export function resolveDescription(tool: PluginToolDef, pluginActiveDescription?: string): string {
  const variant =
    tool.activeDescription ??
    pluginActiveDescription ??
    process.env.ZOWE_MCP_CLI_DESC_VARIANT ??
    'optimized';
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
  const desc = resolveFieldDescription(param, variant);

  if (param.valueMap && Object.keys(param.valueMap).length > 0) {
    const keys = Object.keys(param.valueMap) as [string, ...string[]];
    const map = param.valueMap;
    // Build the inner enum — optional when required is not set
    const inner: z.ZodTypeAny = param.required
      ? z.enum(keys).describe(desc)
      : z.enum(keys).describe(desc).optional();
    // Wrap in a preprocess normalizer that accepts both friendly names and raw CLI
    // codes (case-insensitive), so 'ES' and 'es' are treated the same as 'source'.
    return z.preprocess(val => {
      if (val === undefined || val === null) return val;
      // MCP params arrive as strings; skip objects/arrays so z.enum rejects them cleanly
      if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean')
        return val;
      const str = String(val);
      // Accept raw CLI code case-insensitively (e.g. 'ES' → 'source')
      const byCode = Object.entries(map).find(([, code]) => code === str.toUpperCase())?.[0];
      if (byCode !== undefined) return byCode;
      // Accept friendly name case-insensitively (e.g. 'SOURCE' → 'source')
      return keys.find(k => k.toLowerCase() === str.toLowerCase()) ?? str;
      // Unknown values pass through unchanged → z.enum rejects with list of valid values
    }, inner);
  }

  // Use z.coerce.string() so AI agents (or call-tool) can pass numbers/booleans; they are coerced to string.
  let schema: z.ZodTypeAny = z.coerce.string().describe(desc);
  if (!param.required) {
    schema = schema.optional();
  }
  return schema;
}

// ---------------------------------------------------------------------------
// Pagination resolution
// ---------------------------------------------------------------------------

/**
 * Returns true when `name` matches at least one of the given glob patterns.
 *
 * Only `*` (match zero or more characters) is supported.  Matching is
 * case-insensitive to align with z/OS conventions.
 */
function matchesGlobPattern(name: string, patterns: string | string[]): boolean {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some(p => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(name);
  });
}

/**
 * Resolves the effective `PaginationDef` for a tool by combining:
 *   1. Explicit per-tool `pagination:` value (object, 'list', 'content', false)
 *   2. Plugin-level `pagination.list` / `pagination.content` defaults
 *   3. Auto-detection rules (outputPath === 'stdout', name patterns)
 *
 * Returns `undefined` when pagination should not be applied to the tool.
 */
export function resolveToolPagination(
  toolDef: PluginToolDef,
  pluginPagination: CliPluginConfig['pagination']
): PaginationDef | undefined {
  const spec = toolDef.pagination!;
  const pluginList = pluginPagination?.list;
  const pluginContent = pluginPagination?.content;

  // Explicit opt-out
  if (spec === false) return undefined;

  // Explicit shorthand
  if (spec === 'list') return buildListPaginationDef(pluginList);
  if (spec === 'content') return buildContentPaginationDef(pluginContent);

  // Explicit full or partial PaginationDef object
  if (spec !== undefined && typeof spec === 'object') {
    if (spec.type === 'list') return mergeListPaginationDef(spec, pluginList);
    if (spec.type === 'content') return mergeContentPaginationDef(spec, pluginContent);
  }

  // Auto-detection: outputPath: 'stdout' → content
  if (
    toolDef.outputPath === 'stdout' &&
    pluginContent !== undefined &&
    pluginContent.applyToStdout !== false
  ) {
    return buildContentPaginationDef(pluginContent);
  }

  // Auto-detection: list name pattern
  if (pluginList?.applyToPattern !== undefined) {
    if (matchesGlobPattern(toolDef.toolName, pluginList.applyToPattern)) {
      return buildListPaginationDef(pluginList);
    }
  }

  // Auto-detection: content name pattern (beyond applyToStdout)
  if (pluginContent?.applyToPattern !== undefined) {
    if (matchesGlobPattern(toolDef.toolName, pluginContent.applyToPattern)) {
      return buildContentPaginationDef(pluginContent);
    }
  }

  return undefined;
}

function buildListPaginationDef(
  pluginList: PluginListPaginationConfig | undefined
): PaginationDef {
  return {
    type: 'list',
    defaultLimit: pluginList?.defaultLimit,
    maxLimit: pluginList?.maxLimit,
    maxResults: pluginList?.maxResults,
    cacheTtlSeconds: pluginList?.cacheTtlSeconds,
  };
}

function buildContentPaginationDef(
  pluginContent: PluginContentPaginationConfig | undefined
): PaginationDef {
  return {
    type: 'content',
    defaultLineCount: pluginContent?.defaultLineCount,
    cacheTtlSeconds: pluginContent?.cacheTtlSeconds,
  };
}

function mergeListPaginationDef(
  toolSpec: PaginationDef,
  pluginList: PluginListPaginationConfig | undefined
): PaginationDef {
  return {
    type: 'list',
    defaultLimit: toolSpec.defaultLimit ?? pluginList?.defaultLimit,
    maxLimit: toolSpec.maxLimit ?? pluginList?.maxLimit,
    maxResults: toolSpec.maxResults ?? pluginList?.maxResults,
    cacheTtlSeconds: toolSpec.cacheTtlSeconds ?? pluginList?.cacheTtlSeconds,
  };
}

function mergeContentPaginationDef(
  toolSpec: PaginationDef,
  pluginContent: PluginContentPaginationConfig | undefined
): PaginationDef {
  return {
    type: 'content',
    defaultLineCount: toolSpec.defaultLineCount ?? pluginContent?.defaultLineCount,
    cacheTtlSeconds: toolSpec.cacheTtlSeconds ?? pluginContent?.cacheTtlSeconds,
  };
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
  variant?: string,
  resolvedPagination?: PaginationDef
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

  // Pagination params injected last so they appear at the end of the schema
  const pg = resolvedPagination ?? (tool.pagination as PaginationDef | undefined);
  if (pg?.type === 'list') {
    const defaultLimit = pg.defaultLimit ?? 200;
    const maxLimit = pg.maxLimit ?? MAX_LIST_LIMIT;
    shape.offset = z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Zero-based index of the first item to return. Use 0 for the first page.');
    shape.limit = z
      .number()
      .int()
      .min(1)
      .max(maxLimit)
      .default(defaultLimit)
      .describe(`Maximum items to return per page (max ${maxLimit.toString()}).`);
  } else if (pg?.type === 'content') {
    const defaultLineCount = pg.defaultLineCount ?? 1000;
    shape.startLine = z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('First line to return (1-based). Omit to start from line 1.');
    shape.lineCount = z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        `Number of lines per window (default ${defaultLineCount.toString()}). Used with startLine for windowed reads.`
      );
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
      positionals.push(param.valueMap ? (param.valueMap[value] ?? value) : value);
    } else if (param.cliOption) {
      const cliValue = param.valueMap ? (param.valueMap[value] ?? value) : value;
      options.push(`--${param.cliOption}`, cliValue);
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

  const variant = activeDescription ?? process.env.ZOWE_MCP_CLI_DESC_VARIANT ?? 'optimized';

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
          state.onActiveProfilesChanged?.();

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
          state.onActiveProfilesChanged?.();
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
// CLI error diagnostics helpers
// ---------------------------------------------------------------------------

/**
 * Builds a human-readable URL string from a required connection profile for use in
 * error messages and log entries.  Password and other sensitive fields are never included.
 *
 * Looks for common field names (`host`, `port`, `protocol`, `basePath` / `base-path`)
 * in the profile and assembles them into a URL like `https://host:port/basePath`.
 * Returns `undefined` when no `host` field is found.
 */
function buildConnectionSummary(
  profile: CliNamedProfile,
  fields: ProfileFieldDef[]
): string | undefined {
  const find = (...names: string[]) =>
    fields.find(f => names.includes(f.name) || names.includes(f.cliOption ?? ''));
  const get = (f: ProfileFieldDef | undefined) => (f ? String(profile[f.name] ?? '') : '');

  const host = get(find('host'));
  if (!host) return undefined;

  const port = get(find('port'));
  const protocol = get(find('protocol')) || 'http';
  const basePath = get(find('basePath', 'base-path'));

  let url = `${protocol}://${host}`;
  if (port) url += `:${port}`;
  if (basePath) url += `/${basePath.replace(/^\/+/, '')}`;
  return url;
}

/**
 * Returns a remediation hint that tells the user where to look to fix a failed
 * CLI invocation.  The hint is context-aware: it references VS Code settings when
 * the plugin configuration came from the VS Code extension, and the CLI config
 * file otherwise.
 *
 * The returned string is placed in the "suggestion" field of the error payload
 * alongside "stop": true so LLM agents know not to retry.
 */
function buildRemediationHint(state: CliPluginState, pluginName?: string): string {
  const plugin = pluginName ? `${pluginName} ` : '';
  if (state.configSource === 'vscode') {
    return (
      `This is a configuration error — do NOT retry this or other ${plugin}tools. ` +
      `Check the ${plugin}connection in VS Code Settings under ` +
      `"Zowe MCP: Cli Plugin Configuration". ` +
      `Verify that the host, port, and protocol are correct and that the server is reachable, then reload the window.`
    );
  }
  return (
    `This is a configuration error — do NOT retry this or other ${plugin}tools. ` +
    `Check the ${plugin}connection configuration file ` +
    `(passed via --cli-plugin-configuration or configured in mcp.json). ` +
    `Verify that the host, port, and protocol are correct and that the server is reachable.`
  );
}

// ---------------------------------------------------------------------------
// Paginated list handler
// ---------------------------------------------------------------------------

/**
 * Handles the list-pagination path for CLI bridge tools that declare
 * `pagination: { type: 'list' }`.
 *
 * Strategy:
 *   1. Build a stable cache key (tool + args, excluding offset/limit).
 *   2. On cache miss: invoke CLI, extract items array, enforce maxResults guard.
 *   3. Store full items in cache; serve the requested page with paginateList().
 *   4. Wrap in ToolResponseEnvelope (same shape as listDatasets/listMembers).
 */
async function handleListPagination(
  toolDef: PluginToolDef,
  args: Record<string, unknown>,
  command: string[],
  extraArgs: string[],
  allProfileArgs: string[],
  pg: PaginationDef,
  cache: ResponseCache,
  contextSystem: string,
  connectionSummary: string | undefined,
  server: McpServer,
  config: CliPluginConfig,
  state: CliPluginState,
  toolLog: Logger
): Promise<{
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  const offset = (args.offset as number | undefined) ?? 0;
  const defaultLimit = pg.defaultLimit ?? 200;
  const maxLimit = pg.maxLimit ?? MAX_LIST_LIMIT;
  const limit = Math.min((args.limit as number | undefined) ?? defaultLimit, maxLimit);

  // Build a stable cache key from args, excluding pagination params
  const keyParams: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k !== 'offset' && k !== 'limit') {
      keyParams[k] =
        v === undefined
          ? undefined
          : v !== null && typeof v === 'object'
            ? JSON.stringify(v)
            : String(v as string | number | boolean | bigint);
    }
  }
  const cacheKey = buildCacheKey(`cli:list:${toolDef.toolName}`, keyParams);

  // Track errors that need special handling outside getOrFetch
  let cliErrorMsg: string | undefined;
  let maxResultsInfo: { total: number; max: number } | undefined;

  let cached: { items: unknown[] };
  try {
    cached = await cache.getOrFetch(cacheKey, async (): Promise<{ items: unknown[] }> => {
      const result = invokeZoweCli(command, extraArgs, allProfileArgs);
      if (!result.ok) {
        cliErrorMsg = result.errorMessage ?? 'CLI invocation failed';
        throw new Error(cliErrorMsg);
      }

      const outputPath = toolDef.outputPath ?? 'data';
      let rawOutput: unknown;
      if (outputPath === 'stdout') {
        rawOutput = result.stdout;
      } else if (outputPath === '.') {
        rawOutput = result.data;
      } else {
        rawOutput = extractOutputPath(result.data, outputPath);
        if (rawOutput === undefined) rawOutput = result.data;
      }

      const items = Array.isArray(rawOutput) ? rawOutput : [];
      toolLog.debug('CLI list result fetched', { total: items.length, cacheKey });

      // maxResults guard — runs only on cache miss (fresh fetch)
      if (pg.maxResults !== undefined && items.length > pg.maxResults) {
        const tooMany = items.length;
        const maxR = pg.maxResults;
        let elicitAccepted = false;
        try {
          const elicitResult = await (
            server as unknown as {
              server: {
                elicitInput: (
                  params: unknown
                ) => Promise<{ action: string; content?: Record<string, unknown> }>;
              };
            }
          ).server.elicitInput({
            mode: 'form',
            message: `The query returned ${tooMany.toString()} results, which exceeds the limit of ${maxR.toString()}. Do you want to retrieve all ${tooMany.toString()} results?`,
            requestedSchema: {
              type: 'object',
              properties: {
                confirm: {
                  type: 'boolean',
                  title: 'Retrieve all results',
                  description: `Return all ${tooMany.toString()} items. To reduce the count, add more specific filter parameters (element name, type, subsystem, etc.).`,
                },
              },
              required: ['confirm'],
            },
          });
          elicitAccepted =
            elicitResult.action === 'accept' && elicitResult.content?.confirm === true;
        } catch {
          // Elicitation not supported by this client — fall through to error below
        }

        if (!elicitAccepted) {
          // Signal "too many results" without caching anything
          maxResultsInfo = { total: tooMany, max: maxR };
          throw new Error('maxResults exceeded');
        }
      }

      return { items };
    });
  } catch {
    if (maxResultsInfo) {
      const { total: tooMany, max: maxR } = maxResultsInfo;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Result set too large (${tooMany.toString()} items, limit ${maxR.toString()}). Narrow your query or confirm to retrieve all results.`,
              suggestion: `Add more specific filter parameters (element name, type, subsystem, environment, etc.) to reduce the result count. If you need all results, the user can increase the limit in the plugin configuration.`,
              totalAvailable: tooMany,
              maxResults: maxR,
            }),
          },
        ],
        isError: false,
      };
    }
    return buildCliErrorResponse(
      cliErrorMsg ?? 'CLI invocation failed',
      connectionSummary,
      config,
      state,
      command,
      toolLog,
      toolDef
    );
  }

  // Paginate from cached items
  const { data: page, meta } = paginateList(cached.items, offset, limit);
  const ctx = buildContext(contextSystem, {});
  const messages = getListMessages(meta);
  toolLog.debug('List pagination served', {
    offset,
    limit,
    count: page.length,
    hasMore: meta.hasMore,
  });

  return wrapResponse(ctx, meta, page, messages) as {
    content: { type: 'text'; text: string }[];
    structuredContent: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Content windowing handler
// ---------------------------------------------------------------------------

/**
 * Handles the content-windowing path for CLI bridge tools that declare
 * `pagination: { type: 'content' }`.
 *
 * Strategy:
 *   1. Build a stable cache key (tool + args, excluding startLine/lineCount).
 *   2. Use ResponseCache.getOrFetch — cache miss invokes CLI, splits into lines;
 *      TTL handles freshness (no force-refresh needed, consistent with readDataset).
 *   3. Apply windowContent(); sanitize the text.
 *   4. Wrap in ToolResponseEnvelope (same shape as readDataset).
 */
async function handleContentWindowing(
  toolDef: PluginToolDef,
  args: Record<string, unknown>,
  command: string[],
  extraArgs: string[],
  allProfileArgs: string[],
  pg: PaginationDef,
  cache: ResponseCache,
  contextSystem: string,
  connectionSummary: string | undefined,
  config: CliPluginConfig,
  state: CliPluginState,
  toolLog: Logger
): Promise<{
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  const startLine = (args.startLine as number | undefined) ?? 1;
  const defaultLineCount = pg.defaultLineCount ?? 1000;
  const lineCount = (args.lineCount as number | undefined) ?? defaultLineCount;

  // Build a stable cache key from args, excluding windowing params
  const keyParams: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k !== 'startLine' && k !== 'lineCount') {
      keyParams[k] =
        v === undefined
          ? undefined
          : v !== null && typeof v === 'object'
            ? JSON.stringify(v)
            : String(v as string | number | boolean | bigint);
    }
  }
  const cacheKey = buildCacheKey(`cli:content:${toolDef.toolName}`, keyParams);

  let cliErrorMsg: string | undefined;
  let cached: { lines: string[] };
  try {
    cached = await cache.getOrFetch(cacheKey, (): Promise<{ lines: string[] }> => {
      const result = invokeZoweCli(command, extraArgs, allProfileArgs);
      if (!result.ok) {
        cliErrorMsg = result.errorMessage ?? 'CLI invocation failed';
        throw new Error(cliErrorMsg);
      }

      const outputPath = toolDef.outputPath ?? 'data';
      let rawText: string;
      if (outputPath === 'stdout') {
        rawText = result.stdout;
      } else {
        const raw =
          outputPath === '.'
            ? result.data
            : (extractOutputPath(result.data, outputPath) ?? result.data);
        rawText = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
      }

      const lines = rawText === '' ? [] : rawText.split(/\r?\n/);
      // Trim trailing empty line produced by final newline
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      toolLog.debug('CLI content fetched', { totalLines: lines.length, cacheKey });
      return Promise.resolve({ lines });
    });
  } catch {
    return buildCliErrorResponse(
      cliErrorMsg ?? 'CLI invocation failed',
      connectionSummary,
      config,
      state,
      command,
      toolLog,
      toolDef
    );
  }

  const { lines } = cached;
  const fullText = lines.join('\n');
  const { text: windowedText, meta } = windowContent(fullText, startLine, lineCount);
  const sanitized = sanitizeTextForDisplay(windowedText);

  const ctx = buildContext(contextSystem, {});
  const messages = getReadMessages(meta);
  toolLog.debug('Content window served', {
    startLine: meta.startLine,
    returnedLines: meta.returnedLines,
    hasMore: meta.hasMore,
  });

  return wrapResponse(ctx, meta, sanitized, messages) as {
    content: { type: 'text'; text: string }[];
    structuredContent: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Shared CLI error response builder
// ---------------------------------------------------------------------------

/**
 * Determines whether a CLI error is fatal or retryable using the following
 * precedence (highest first):
 *
 * 1. `connectionErrorPatterns` (plugin) matches → fatal (deny-override)
 * 2. `retryableErrorPatterns` (plugin) matches → retryable
 * 3. `fatalOnCliError` (tool) if defined → use that boolean
 * 4. `defaultCliErrorFatal` (plugin, default `true`) → use that boolean
 */
export function classifyCliError(
  errorMessage: string,
  toolDef: PluginToolDef,
  config: CliPluginConfig
): 'fatal' | 'retryable' {
  const connPatterns: string[] | undefined = config.connectionErrorPatterns;
  const retryPatterns: string[] | undefined = config.retryableErrorPatterns;
  if (connPatterns?.some((p) => new RegExp(p).test(errorMessage))) {
    return 'fatal';
  }
  if (retryPatterns?.some((p) => new RegExp(p).test(errorMessage))) {
    return 'retryable';
  }
  if (toolDef.fatalOnCliError !== undefined) {
    return toolDef.fatalOnCliError ? 'fatal' : 'retryable';
  }
  return (config.defaultCliErrorFatal ?? true) ? 'fatal' : 'retryable';
}

/**
 * Builds a CLI error response used by both the paginated and non-paginated paths.
 *
 * Fatality is determined by `classifyCliError` (pattern matching > tool flag >
 * plugin default).  Fatal errors use the FATAL CONFIGURATION ERROR + `stop: true`
 * pattern to prevent the LLM from retrying misconfigured connections.  Retryable
 * errors return a plain `isError: true` so the LLM can correct its input and retry.
 */
function buildCliErrorResponse(
  errorMessage: string,
  connectionSummary: string | undefined,
  config: CliPluginConfig,
  state: CliPluginState,
  command: string[],
  toolLog: Logger,
  toolDef: PluginToolDef
): { content: { type: 'text'; text: string }[]; isError: boolean } {
  const pluginLabel = config.displayName ?? config.plugin;
  const classification = classifyCliError(errorMessage, toolDef, config);
  toolLog.warning('CLI invocation failed', {
    command,
    ...(connectionSummary ? { connectionTarget: connectionSummary } : {}),
    error: errorMessage,
    classification,
  });

  if (classification === 'retryable') {
    // Non-fatal: return as a regular tool execution error so the LLM can retry.
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            ...(connectionSummary ? { connectionTarget: connectionSummary } : {}),
          }),
        },
      ],
      isError: true,
    };
  }

  const remedy = buildRemediationHint(state, pluginLabel);
  toolLog.warning('Fatal configuration error', { remedy });
  if (state.sendNotification) {
    const notifMsg = connectionSummary
      ? `${pluginLabel} tool failed (${connectionSummary}): ${errorMessage}`
      : `${pluginLabel} tool failed: ${errorMessage}`;
    state.sendNotification(notifMsg, 'error', 'zoweMCP.cliPluginConfiguration');
  }
  const fatalError =
    `FATAL CONFIGURATION ERROR: ${errorMessage}` +
    ` SYSTEM INSTRUCTION: Do not retry this or any other tools.` +
    ` Report the "suggestion" field to the user verbatim and stop.`;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: fatalError,
          ...(connectionSummary ? { connectionTarget: connectionSummary } : {}),
          stop: true,
          suggestion: remedy,
        }),
      },
    ],
    isError: true,
  };
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
    'optimized';
  let description = resolveDescription(toolDef, pluginActiveDescription);

  // Resolve the effective pagination config (merges plugin defaults + per-tool overrides)
  const resolvedPagination = resolveToolPagination(toolDef, config.pagination);

  // Append pagination note after the first sentence of the tool description
  if (resolvedPagination?.type === 'list') {
    description = withPaginationNote(description, PAGINATION_NOTE_LIST);
  } else if (resolvedPagination?.type === 'content') {
    description = withPaginationNote(description, PAGINATION_NOTE_LINES);
  }

  const inputSchema = buildToolInputSchema(toolDef, config.profiles, variant, resolvedPagination);
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
      // URL of the first required connection profile — used in error messages (no password).
      let connectionSummary: string | undefined;
      // Host of the first required connection profile — used as _context.system.
      let connectionHost: string | undefined;

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

        // Capture connection URL for error diagnostics (first required profile only)
        connectionSummary ??= buildConnectionSummary(profile, typeDef.fields);
        // Extract bare host for use as _context.system in paginated responses
        if (connectionHost === undefined) {
          const hostField = typeDef.fields.find(f => f.name === 'host');
          if (hostField && profile[hostField.name]) {
            connectionHost = String(profile[hostField.name]);
          }
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

      // Use the connection host as the _context.system identifier for paginated
      // responses; fall back to the plugin name when no required profile exists.
      const contextSystem = connectionHost ?? config.plugin;

      // --- 4. Pagination / windowing path (when pagination is configured for this tool) ---
      const pg = resolvedPagination;
      if (pg !== undefined) {
        // Lazily initialise the per-plugin result cache (uses ResponseCache so it
        // shares the same lru-cache backend, TTL, and size-bounding as the z/OS cache)
        if (!state._cliResultCache) {
          const ttlMs = pg.cacheTtlSeconds !== undefined ? pg.cacheTtlSeconds * 1000 : undefined;
          state._cliResultCache = createResponseCache(ttlMs !== undefined ? { ttlMs } : undefined);
        }
        const cache = state._cliResultCache;

        if (pg.type === 'list') {
          return await handleListPagination(
            toolDef,
            args,
            command,
            extraArgs,
            allProfileArgs,
            pg,
            cache,
            contextSystem,
            connectionSummary,
            server,
            config,
            state,
            toolLog
          );
        } else {
          return await handleContentWindowing(
            toolDef,
            args,
            command,
            extraArgs,
            allProfileArgs,
            pg,
            cache,
            contextSystem,
            connectionSummary,
            config,
            state,
            toolLog
          );
        }
      }

      // --- 4 (non-paginated). Invoke CLI ---
      const result = invokeZoweCli(command, extraArgs, allProfileArgs);

      if (!result.ok) {
        return buildCliErrorResponse(
          result.errorMessage ?? 'CLI invocation failed',
          connectionSummary,
          config,
          state,
          command,
          toolLog,
          toolDef
        );
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
