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
 * Generates a Markdown document describing all MCP tools, prompts, resources,
 * and resource templates registered by the Zowe MCP Server.
 *
 * Spins up the server in-memory with a temporary mock backend, connects an
 * MCP client, lists everything, calls each tool with sample inputs from
 * mcp-reference-inputs.yaml, and writes the output to a file.
 *
 * Usage:
 *   npx @zowe/mcp-server generate-docs [--output <path>] [--inputs <path>]
 *
 * Default output: docs/mcp-reference.md (relative to repo root)
 * Default inputs: docs/mcp-reference-inputs.yaml (relative to repo root)
 *
 * If the inputs file does not exist, a skeleton is generated with empty
 * arguments for every tool and written to the inputs path.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '../log.js';
import { createServer, getServer, SERVER_VERSION } from '../server.js';
import {
  createEmptyPluginState,
  loadAndRegisterPluginYaml,
} from '../tools/cli-bridge/cli-tool-loader.js';

const log = new Logger({ name: 'generate-docs' });

interface ParsedCliArgs {
  output: string;
  inputs: string;
}

function parseArgs(): ParsedCliArgs {
  const args = process.argv.slice(2);
  let output: string | undefined;
  let inputs: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) {
      output = args[++i];
    } else if (args[i].startsWith('--output=')) {
      output = args[i].slice(9);
    } else if (args[i] === '--inputs' && i + 1 < args.length) {
      inputs = args[++i];
    } else if (args[i].startsWith('--inputs=')) {
      inputs = args[i].slice(9);
    }
  }
  const cwd = process.cwd();
  return {
    output: output ?? resolve(cwd, 'docs', 'mcp-reference.md'),
    inputs: inputs ?? resolve(cwd, 'docs', 'mcp-reference-inputs.yaml'),
  };
}

// ---------------------------------------------------------------------------
// Type definitions for MCP metadata
// ---------------------------------------------------------------------------

interface SchemaProperty {
  [key: string]: unknown;
  type?: string | string[];
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  anyOf?: SchemaProperty[];
}

interface JsonSchema {
  type: 'object';
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
}

interface ToolExample {
  label?: string;
  args: Record<string, unknown>;
  output: string;
}

interface PromptInfo {
  name: string;
  title?: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

interface ResourceInfo {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

interface ResourceTemplateInfo {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

/** A named group of tools for doc generation (core tools or a CLI plugin). */
interface ToolGroup {
  /** Heading text used as `## <label>`. */
  label: string;
  /** Optional introductory paragraph shown under the heading. */
  description?: string;
  tools: ToolInfo[];
}

// ---------------------------------------------------------------------------
// YAML helpers (minimal, no dependency)
// ---------------------------------------------------------------------------

function yamlStringify(obj: Record<string, Record<string, unknown>>): string {
  const lines: string[] = [];
  lines.push('# Sample inputs for generate-docs. Each key is a tool name.');
  lines.push('# Set arguments to call the tool and include an output example in the docs.');
  lines.push('# Tools with `skip: true` will not be called (output example omitted).');
  lines.push('# Use toolName[label] for additional examples, e.g. readUssFile[sensitive path].');
  lines.push('# Regenerate this skeleton: delete the file and run `npm run generate-docs`.');
  lines.push('');
  for (const [toolName, entry] of Object.entries(obj)) {
    lines.push(`${toolName}:`);
    for (const [k, v] of Object.entries(entry)) {
      if (v === true || v === false) {
        lines.push(`  ${k}: ${String(v)}`);
      } else if (typeof v === 'number') {
        lines.push(`  ${k}: ${v}`);
      } else if (typeof v === 'string') {
        if (v.includes("'") || v.includes('"') || v.includes('\n')) {
          lines.push(`  ${k}: "${v.replace(/"/g, '\\"')}"`);
        } else {
          lines.push(`  ${k}: "${v}"`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Parsed input entry: one example invocation for a tool.
 * `yamlKey` is the raw key (e.g. "readUssFile" or "readUssFile[sensitive path]").
 * `toolName` is the tool (e.g. "readUssFile").
 * `label` is the optional bracket label (e.g. "sensitive path") or undefined for the default.
 */
interface InputEntry {
  yamlKey: string;
  toolName: string;
  label?: string;
  args: Record<string, unknown>;
}

function parseYamlKey(key: string): { toolName: string; label?: string } {
  const bracketIdx = key.indexOf('[');
  if (bracketIdx === -1) return { toolName: key };
  const toolName = key.slice(0, bracketIdx);
  const label = key.slice(bracketIdx + 1, key.endsWith(']') ? -1 : undefined);
  return { toolName, label };
}

function yamlParse(text: string): InputEntry[] {
  const entries: InputEntry[] = [];
  let currentKey: string | null = null;
  let currentArgs: Record<string, unknown> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!line.startsWith(' ') && line.endsWith(':')) {
      if (currentKey !== null) {
        const { toolName, label } = parseYamlKey(currentKey);
        entries.push({ yamlKey: currentKey, toolName, label, args: currentArgs });
      }
      currentKey = line.slice(0, -1).trim();
      currentArgs = {};
    } else if (currentKey && line.startsWith('  ')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      let val: unknown = line.slice(colonIdx + 1).trim();
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
      else if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"'))
        val = val.slice(1, -1);
      else if (typeof val === 'string' && val.startsWith("'") && val.endsWith("'"))
        val = val.slice(1, -1);
      currentArgs[key] = val;
    }
  }
  if (currentKey !== null) {
    const { toolName, label } = parseYamlKey(currentKey);
    entries.push({ yamlKey: currentKey, toolName, label, args: currentArgs });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Markdown rendering helpers
// ---------------------------------------------------------------------------

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatPropertyType(prop: SchemaProperty): string {
  if (prop.enum) {
    return prop.enum.map(v => `\`${v}\``).join(' \\| ');
  }
  if (prop.anyOf) {
    return prop.anyOf.map(s => formatPropertyType(s)).join(' \\| ');
  }
  const type = prop.type;
  if (Array.isArray(type)) {
    return type.map(t => `\`${t}\``).join(' \\| ');
  }
  if (type === 'array' && prop.items) {
    const inner = formatPropertyType(prop.items);
    return `${inner}[]`;
  }
  return type ? `\`${type}\`` : 'unknown';
}

function reorderSchemaProperties(
  properties: Record<string, SchemaProperty>
): [string, SchemaProperty][] {
  const preferredOrder = ['_context', '_result', 'messages'];
  const entries = Object.entries(properties);
  const ordered: [string, SchemaProperty][] = [];
  for (const key of preferredOrder) {
    const entry = entries.find(([k]) => k === key);
    if (entry) ordered.push(entry);
  }
  for (const entry of entries) {
    if (!preferredOrder.includes(entry[0])) {
      ordered.push(entry);
    }
  }
  return ordered;
}

/**
 * Resolve the object properties for a schema property, handling plain
 * objects, arrays of objects (via items), and union types (anyOf) where
 * one variant is an object.
 */
function resolveObjectProperties(
  prop: SchemaProperty
): { properties: Record<string, SchemaProperty>; required: string[] } | undefined {
  if (prop.type === 'object' && prop.properties) {
    return { properties: prop.properties, required: prop.required ?? [] };
  }
  if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
    return { properties: prop.items.properties, required: prop.items.required ?? [] };
  }
  if (prop.anyOf) {
    for (const variant of prop.anyOf) {
      const resolved = resolveObjectProperties(variant);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

/**
 * Fingerprint a nested object by its child keys and types so we can detect
 * structurally identical sub-schemas across tools (e.g. `_context`).
 */
function nestedFingerprint(
  name: string,
  nested: { properties: Record<string, SchemaProperty>; required: string[] }
): string {
  const parts = Object.entries(nested.properties).map(([k, v]) => `${k}:${formatPropertyType(v)}`);
  return `${name}|${parts.join(',')}`;
}

/**
 * Tracks which nested objects have been fully expanded already.
 * Maps fingerprint → first tool name that expanded it.
 */
type NestedFieldTracker = Map<string, string>;

function renderSchemaTable(
  schema: JsonSchema,
  label: string,
  toolName?: string,
  nestedTracker?: NestedFieldTracker
): string {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return `*No ${label.toLowerCase()}.*\n`;
  }
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];
  lines.push(`| ${label} | Type | Required | Description |`);
  lines.push('| --- | --- | --- | --- |');
  for (const [name, prop] of reorderSchemaProperties(schema.properties)) {
    const type = formatPropertyType(prop);
    const isRequired = required.has(name) ? 'Yes' : 'No';
    const desc = escapeMarkdown(prop.description ?? '');
    const defaultVal =
      prop.default !== undefined ? ` (default: \`${JSON.stringify(prop.default)}\`)` : '';

    const nested = resolveObjectProperties(prop);
    if (nested && nestedTracker && toolName) {
      const fp = nestedFingerprint(name, nested);
      const firstTool = nestedTracker.get(fp);
      if (firstTool) {
        const anchor = `${firstTool.toLowerCase()}-output-schema`;
        lines.push(
          `| \`${name}\` | ${type} | ${isRequired} | ${desc} *(same as [\`${firstTool}\`](#${anchor}))*${defaultVal} |`
        );
        continue;
      }
      nestedTracker.set(fp, toolName);
    }

    lines.push(`| \`${name}\` | ${type} | ${isRequired} | ${desc}${defaultVal} |`);

    if (nested) {
      const nestedRequired = new Set(nested.required);
      const children = Object.entries(nested.properties);
      children.forEach(([childName, childProp], idx) => {
        const childType = formatPropertyType(childProp);
        const childIsRequired = nestedRequired.has(childName) ? 'Yes' : 'No';
        const childDesc = escapeMarkdown(childProp.description ?? '');
        const childDefault =
          childProp.default !== undefined
            ? ` (default: \`${JSON.stringify(childProp.default)}\`)`
            : '';
        const branch = idx === children.length - 1 ? '└─' : '├─';
        lines.push(
          `| &ensp;${branch} \`${childName}\` | ${childType} | ${childIsRequired} | ${childDesc}${childDefault} |`
        );
      });
    }
  }
  return lines.join('\n') + '\n';
}

function renderAnnotations(annotations: ToolInfo['annotations']): string {
  if (!annotations) return '';
  const badges: string[] = [];
  if (annotations.readOnlyHint) badges.push('Read-only');
  if (annotations.destructiveHint) badges.push('Destructive');
  if (annotations.idempotentHint) badges.push('Idempotent');
  if (annotations.openWorldHint) badges.push('Open-world');
  if (badges.length === 0) return '';
  return '> ' + badges.join(' · ') + '\n';
}

/**
 * Reorder top-level keys so metadata (_context, _result, messages) appears
 * before the large payload (data), ensuring they survive truncation.
 */
function reorderEnvelopeKeys(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;
  const record = obj as Record<string, unknown>;
  const preferredOrder = ['_context', '_result', 'messages'];
  const ordered: Record<string, unknown> = {};
  for (const key of preferredOrder) {
    if (key in record) {
      ordered[key] = record[key];
    }
  }
  for (const key of Object.keys(record)) {
    if (!(key in ordered)) {
      ordered[key] = record[key];
    }
  }
  return ordered;
}

function addLanguageToBareFences(text: string): string {
  return text.replace(/^```$/gm, (match, offset: number) => {
    const before = text.slice(0, offset);
    const openFences = (before.match(/^```/gm) ?? []).length;
    if (openFences % 2 === 0) {
      const after = text.slice(offset + match.length);
      if (/jcl|JOB|EXEC|DD /m.test(after.split('```')[0])) return '```jcl';
      if (/DIVISION|PROGRAM-ID|COBOL/m.test(after.split('```')[0])) return '```cobol';
      return '```text';
    }
    return match;
  });
}

function truncateJson(json: string, maxLines: number): string {
  const lines = json.split('\n');
  if (lines.length <= maxLines) return json;
  return lines.slice(0, maxLines).join('\n') + '\n  // ... truncated ...';
}

/**
 * Replace volatile runtime values in example output so docs don't change
 * between regenerations.
 *
 * - ETags (hex MD5) → stable realistic-looking 32-char hex
 * - Temp DSN qualifiers (USER.TMP.XXXXXXXX...) → stable placeholders preserving segment count and length
 */
function stabilizeOutput(text: string): string {
  return (
    text
      // ETags: 32-char hex strings (MD5) → stable realistic hex
      .replace(/"etag": "[0-9a-f]{32}"/g, '"etag": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"')
      // Temp DSN prefix/name: USER.TMP followed by 1-3 random 8-char qualifiers
      .replace(/USER\.TMP\.[A-Z0-9]{8}(\.[A-Z0-9]{8}){0,2}/g, _match => {
        const segments = _match.split('.');
        const placeholders = ['A1B2C3D4', 'E5F6G7H8', 'J9K0L1M2'];
        return segments.map((seg, i) => (i < 2 ? seg : (placeholders[i - 2] ?? seg))).join('.');
      })
  );
}

const require = createRequire(import.meta.url);

/**
 * Format all Markdown tables in the given text using markdown-table-prettify
 * so columns are consistently aligned.
 */
function formatMarkdownTables(markdown: string): string {
  const { CliPrettify } = require('markdown-table-prettify') as {
    CliPrettify: { prettify: (text: string) => string };
  };
  return CliPrettify.prettify(markdown);
}

/**
 * Strip the pagination note prefix that `withPaginationNote()` prepends.
 * Pagination notes start with "Results are paginated" or "Results may be
 * line-windowed" and end with a period; the functional description follows.
 */
function stripPaginationPrefix(description: string): string {
  return description.replace(/^Results (?:are paginated|may be line-windowed)[^.]*\.\s*/i, '');
}

/**
 * Extract the first sentence from a tool description for the summary table.
 *
 * Splits on ". " (period followed by space) or ".\n" but skips common
 * abbreviations (e.g., i.e., etc.) and version-like patterns (v0.6.0).
 * Falls back to the full string if no sentence boundary is found.
 */
function extractFirstSentence(description: string): string {
  const text = stripPaginationPrefix(description).trim();
  if (!text) return '';
  const sentenceEnd = /\.(?:\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    if (/(?:e\.g|i\.e|etc|vs|vol|v\d)$/i.test(before)) continue;
    if (/\d$/.test(before) && /^\.\d/.test(text.slice(match.index))) continue;
    return before;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Section generators
// ---------------------------------------------------------------------------

/**
 * Renders one tool's detail section (Parameters, Output Schema, Example Output).
 * Heading level: `###` for the tool name, `####` for sub-sections.
 * The `outputNestedTracker` is shared across groups so repeated nested schemas
 * get the cross-tool "same as" shortcut only once.
 */
function renderToolDetail(
  tool: ToolInfo,
  examples: Map<string, ToolExample[]>,
  outputNestedTracker: NestedFieldTracker
): string[] {
  const lines: string[] = [];
  lines.push(`### \`${tool.name}\`\n`);
  lines.push(renderAnnotations(tool.annotations));
  if (tool.description) {
    lines.push(tool.description + '\n');
  }

  lines.push('#### Parameters\n');
  lines.push(renderSchemaTable(tool.inputSchema, 'Parameter'));

  if (tool.outputSchema) {
    const schemaAnchor = `${tool.name.toLowerCase()}-output-schema`;
    lines.push(`<a id="${schemaAnchor}"></a>\n`);
    lines.push('#### Output Schema\n');
    lines.push(renderSchemaTable(tool.outputSchema, 'Field', tool.name, outputNestedTracker));
  }

  const toolExamples = examples.get(tool.name);
  if (toolExamples && toolExamples.length > 0) {
    if (toolExamples.length === 1) {
      const ex = toolExamples[0];
      const heading = ex.label ? `#### Example Output — ${ex.label}` : '#### Example Output';
      lines.push(heading + '\n');
      if (ex.args && Object.keys(ex.args).length > 0) {
        lines.push('Input:\n');
        lines.push('```json');
        lines.push(JSON.stringify(ex.args, null, 2));
        lines.push('```\n');
        lines.push('Output:\n');
      }
      lines.push('```json');
      lines.push(truncateJson(ex.output, 60));
      lines.push('```\n');
    } else {
      lines.push('#### Example Outputs\n');
      for (const ex of toolExamples) {
        const subtitle = ex.label ?? 'default';
        lines.push(`##### ${subtitle}\n`);
        if (ex.args && Object.keys(ex.args).length > 0) {
          lines.push('Input:\n');
          lines.push('```json');
          lines.push(JSON.stringify(ex.args, null, 2));
          lines.push('```\n');
          lines.push('Output:\n');
        }
        lines.push('```json');
        lines.push(truncateJson(ex.output, 60));
        lines.push('```\n');
      }
    }
  }

  lines.push('---\n');
  return lines;
}

/**
 * Generates all tool sections.
 *
 * Each group becomes its own `## <label>` section with a summary table
 * followed by individual `### \`toolName\`` detail sections.
 * The `outputNestedTracker` spans all groups so that repeated output
 * schemas share the "same as" cross-reference.
 */
function generateToolsSection(groups: ToolGroup[], examples: Map<string, ToolExample[]>): string {
  const outputNestedTracker: NestedFieldTracker = new Map();
  const lines: string[] = [];

  // Pass 1: all summary sections (heading + count + description + table only)
  for (const group of groups) {
    lines.push(`## ${group.label}\n`);

    const countWord = group.tools.length === 1 ? 'tool' : 'tools';
    lines.push(`The server provides **${group.tools.length}** ${countWord}.\n`);

    if (group.description) {
      lines.push(group.description + '\n');
    }

    lines.push('| # | Tool | Description |');
    lines.push('| --- | --- | --- |');
    group.tools.forEach((tool, i) => {
      const desc = escapeMarkdown(extractFirstSentence(tool.description ?? ''));
      lines.push(`| ${i + 1} | [\`${tool.name}\`](#${tool.name.toLowerCase()}) | ${desc} |`);
    });
    lines.push('');
  }

  // Pass 2: all tool detail sections together, after the complete list
  lines.push('## Tool Reference\n');
  lines.push(
    'Full parameter and output schema details for every tool. ' +
      'Links in the summary tables above point to the corresponding section here.\n'
  );
  for (const group of groups) {
    for (const tool of group.tools) {
      lines.push(...renderToolDetail(tool, examples, outputNestedTracker));
    }
  }

  return lines.join('\n');
}

interface PromptMessage {
  role: string;
  content: { type: string; text?: string };
}

function generatePromptsSection(
  prompts: PromptInfo[],
  promptMessages: Map<string, PromptMessage[]>
): string {
  if (prompts.length === 0) return '';
  const lines: string[] = [];
  lines.push('## Prompts\n');
  lines.push(`The server provides **${prompts.length}** prompts.\n`);

  for (const prompt of prompts) {
    lines.push(`### \`${prompt.name}\`\n`);
    if (prompt.description) {
      lines.push(prompt.description + '\n');
    }
    if (prompt.arguments && prompt.arguments.length > 0) {
      lines.push('#### Arguments\n');
      lines.push('| Argument | Required | Description |');
      lines.push('| --- | --- | --- |');
      for (const arg of prompt.arguments) {
        const isRequired = arg.required ? 'Yes' : 'No';
        const desc = escapeMarkdown(arg.description ?? '');
        lines.push(`| \`${arg.name}\` | ${isRequired} | ${desc} |`);
      }
      lines.push('');
    } else {
      lines.push('*No arguments.*\n');
    }

    const messages = promptMessages.get(prompt.name);
    if (messages && messages.length > 0) {
      lines.push('#### Prompt Text\n');
      for (const msg of messages) {
        let text = msg.content.text ?? '';
        text = addLanguageToBareFences(text);
        lines.push(`**${msg.role}:**\n`);
        lines.push(text + '\n');
      }
    }

    lines.push('---\n');
  }
  return lines.join('\n');
}

function generateResourcesSection(resources: ResourceInfo[]): string {
  if (resources.length === 0) return '';
  const lines: string[] = [];
  lines.push('## Resources\n');
  lines.push(`The server provides **${resources.length}** static resources.\n`);

  lines.push('| Name | URI | MIME Type | Description |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of resources) {
    const desc = escapeMarkdown(r.description ?? '');
    lines.push(`| \`${r.name}\` | \`${r.uri}\` | ${r.mimeType ?? 'N/A'} | ${desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function generateResourceTemplatesSection(templates: ResourceTemplateInfo[]): string {
  if (templates.length === 0) return '';
  const lines: string[] = [];
  lines.push('## Resource Templates\n');
  lines.push(`The server provides **${templates.length}** resource templates.\n`);

  for (const t of templates) {
    lines.push(`### \`${t.name}\`\n`);
    lines.push(`**URI Template:** \`${t.uriTemplate}\`\n`);
    if (t.mimeType) {
      lines.push(`**MIME Type:** ${t.mimeType}\n`);
    }
    if (t.description) {
      lines.push(t.description + '\n');
    }
    lines.push('---\n');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Default inputs skeleton generator
// ---------------------------------------------------------------------------

function generateDefaultInputs(tools: ToolInfo[]): Record<string, Record<string, unknown>> {
  const defaults: Record<string, Record<string, unknown>> = {};
  for (const tool of tools) {
    const entry: Record<string, unknown> = {};
    const props = tool.inputSchema.properties ?? {};
    const required = new Set(tool.inputSchema.required ?? []);
    const hasRequiredParams = Object.keys(props).some(k => required.has(k));

    if (!hasRequiredParams && Object.keys(props).length === 0) {
      // No-arg tools: call them
    } else {
      // Provide sensible defaults for well-known tools
      entry.skip = true;
    }
    defaults[tool.name] = entry;
  }

  // Override with sensible defaults for tools we know work in mock mode
  const knownInputs: Record<string, Record<string, unknown>> = {
    info: {},
    listSystems: {},
    getContext: {},
    listDatasets: { dsnPattern: 'USER.*' },
    listMembers: { dsn: 'USER.SRC.COBOL' },
    readDataset: { dsn: 'USER.SRC.COBOL(CUSTFILE)' },
    getDatasetAttributes: { dsn: 'USER.SRC.COBOL' },
    searchInDataset: { dsn: 'USER.SRC.COBOL', string: 'DIVISION' },
    listUssFiles: { path: '/' },
    readUssFile: { path: '/etc/profile' },
    runSafeTsoCommand: { command: 'TIME' },
    getUssHome: {},
  };

  for (const [name, args] of Object.entries(knownInputs)) {
    if (defaults[name]) {
      defaults[name] = args;
    }
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { output, inputs: inputsPath } = parseArgs();
  log.info('Generating MCP reference documentation', { output, inputsPath });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Create a temporary mock data directory via the init-mock CLI
  const tmpDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-docs-'));
  try {
    log.info('Initializing temporary mock data', { dir: tmpDir });
    const indexPath = resolve(__dirname, '..', 'index.js');
    const init = spawnSync(
      process.execPath,
      [indexPath, 'init-mock', '--output', tmpDir, '--preset', 'default'],
      { encoding: 'utf-8' }
    );
    if (init.status !== 0) {
      throw new Error(`init-mock failed: ${init.stderr ?? init.stdout}`);
    }

    const { loadMock } = await import('../zos/mock/load-mock.js');
    const mock = await loadMock(tmpDir);
    const created = createServer({
      backend: mock.backend,
      systemRegistry: mock.systemRegistry,
      credentialProvider: mock.credentialProvider,
    });
    const server = getServer(created);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'generate-docs', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      // 1. List all MCP metadata
      const [toolsResult, promptsResult, resourcesResult, templatesResult] = await Promise.all([
        client.listTools(),
        client.listPrompts(),
        client.listResources(),
        client.listResourceTemplates(),
      ]);

      // Core tools (z/OS components registered by createServer)
      const coreTools = toolsResult.tools as unknown as ToolInfo[];
      const coreToolNameSet = new Set(coreTools.map(t => t.name));
      const prompts = promptsResult.prompts as unknown as PromptInfo[];
      const resources = resourcesResult.resources as unknown as ResourceInfo[];
      const templates = templatesResult.resourceTemplates as unknown as ResourceTemplateInfo[];

      // ---------------------------------------------------------------------------
      // Component grouping for core tools.
      // Keep in sync with the component registration in server.ts when new tools
      // are added (unrecognised tool names fall through to an "Other" group).
      // ---------------------------------------------------------------------------
      const CORE_COMPONENT_GROUPS: {
        label: string;
        description: string;
        toolNames: string[];
      }[] = [
        {
          label: 'Context',
          description:
            'Server information and session management — set the active z/OS system and query the current session state (systems, active connection, active user).',
          toolNames: ['getContext', 'listSystems', 'setSystem'],
        },
        {
          label: 'Data Sets',
          description:
            'z/OS data set operations — list, search, read, write, create, copy, rename, delete, and manage PDS/E members and temporary data sets.',
          toolNames: [
            'listDatasets',
            'listMembers',
            'searchInDataset',
            'getDatasetAttributes',
            'readDataset',
            'writeDataset',
            'createDataset',
            'createTempDataset',
            'getTempDatasetPrefix',
            'getTempDatasetName',
            'copyDataset',
            'renameDataset',
            'deleteDataset',
            'deleteDatasetsUnderPrefix',
            'restoreDataset',
          ],
        },
        {
          label: 'USS',
          description:
            'UNIX System Services — navigate directories, read/write files, manage permissions and tags, run shell commands, and work with temporary files.',
          toolNames: [
            'getUssHome',
            'changeUssDirectory',
            'listUssFiles',
            'readUssFile',
            'writeUssFile',
            'createUssFile',
            'deleteUssFile',
            'chmodUssFile',
            'chownUssFile',
            'chtagUssFile',
            'copyUssFile',
            'runSafeUssCommand',
            'getUssTempDir',
            'getUssTempPath',
            'createTempUssDir',
            'createTempUssFile',
            'deleteUssTempUnderDir',
          ],
        },
        {
          label: 'TSO',
          description: 'Time Sharing Option — run TSO commands interactively on z/OS.',
          toolNames: ['runSafeTsoCommand'],
        },
        {
          label: 'Jobs',
          description:
            'z/OS batch job management — submit JCL, monitor job status, read spool output, search output, and manage job lifecycle (cancel, hold, release, delete).',
          toolNames: [
            'submitJob',
            'submitJobFromDataset',
            'submitJobFromUss',
            'getJobStatus',
            'listJobFiles',
            'readJobFile',
            'getJobOutput',
            'searchJobOutput',
            'listJobs',
            'getJcl',
            'cancelJob',
            'holdJob',
            'releaseJob',
            'deleteJob',
          ],
        },
        {
          label: 'Local Files',
          description:
            'Transfer files between z/OS (data sets and USS paths) and the local workspace.',
          toolNames: [
            'downloadDatasetToFile',
            'uploadFileToDataset',
            'downloadUssFileToFile',
            'uploadFileToUssFile',
            'downloadJobFileToFile',
          ],
        },
        {
          label: 'Zowe Explorer',
          description:
            'Open z/OS resources in Zowe Explorer editor tabs. Available only when the VS Code Zowe Explorer extension is installed and active.',
          toolNames: ['openDatasetInEditor', 'openUssFileInEditor', 'openJobInEditor'],
        },
      ];

      // Build per-component ToolGroups; unrecognised tool names fall into "Other"
      const coreToolsById = new Map(coreTools.map(t => [t.name, t]));
      const assignedToolNames = new Set<string>();
      const toolGroups: ToolGroup[] = [];

      for (const { label, description, toolNames } of CORE_COMPONENT_GROUPS) {
        const componentTools = toolNames
          .map(name => coreToolsById.get(name))
          .filter((t): t is ToolInfo => t !== undefined);
        if (componentTools.length > 0) {
          toolGroups.push({ label, description, tools: componentTools });
          componentTools.forEach(t => assignedToolNames.add(t.name));
        }
      }

      const unassignedCoreTools = coreTools.filter(t => !assignedToolNames.has(t.name));
      if (unassignedCoreTools.length > 0) {
        toolGroups.push({ label: 'Other', tools: unassignedCoreTools });
      }

      const pluginsDir = resolve(__dirname, '..', 'tools', 'cli-bridge', 'plugins');
      if (existsSync(pluginsDir)) {
        const pluginYamlFiles = readdirSync(pluginsDir).filter((f: string) => f.endsWith('.yaml'));
        for (const yamlFile of pluginYamlFiles) {
          const yamlPath = resolve(pluginsDir, yamlFile);
          // Docs generation never calls tools, so an empty state is sufficient here.
          const pluginState = createEmptyPluginState();
          const pluginConfig = loadAndRegisterPluginYaml(server, yamlPath, pluginState, log);
          const updatedToolsResult = await client.listTools();
          const allTools = updatedToolsResult.tools as unknown as ToolInfo[];
          const knownToolNames = new Set([
            ...coreToolNameSet,
            ...toolGroups.flatMap(g => g.tools.map(t => t.name)),
          ]);
          const pluginTools = allTools.filter(t => !knownToolNames.has(t.name));
          if (pluginTools.length > 0) {
            toolGroups.push({
              label: `${pluginConfig.plugin} CLI Plugin Tools`,
              description:
                `Registered from \`plugins/${yamlFile}\`. ` +
                'Configure a connection via `zoweMCP.cliPluginConfiguration` (VS Code) or ' +
                `\`--cli-plugin-connection ${pluginConfig.plugin}=<connfile>\` (standalone).`,
              tools: pluginTools,
            });
            log.info('Registered CLI bridge plugin tools', {
              plugin: pluginConfig.plugin,
              yamlFile,
              count: pluginTools.length,
            });
          }
        }
        if (pluginYamlFiles.length === 0) {
          log.info('No plugin YAML files found in plugins directory', { pluginsDir });
        }
      } else {
        log.info('CLI plugins directory not found — skipping plugin tools', { pluginsDir });
      }

      const tools = toolGroups.flatMap(g => g.tools);

      log.info('Collected MCP metadata', {
        coreTools: coreTools.length,
        pluginGroups: toolGroups.length - 1,
        totalTools: tools.length,
        prompts: prompts.length,
        resources: resources.length,
        resourceTemplates: templates.length,
      });

      // 2. Load or generate inputs YAML
      let inputEntries: InputEntry[];
      if (existsSync(inputsPath)) {
        log.info('Loading inputs from', { path: inputsPath });
        inputEntries = yamlParse(readFileSync(inputsPath, 'utf-8'));
      } else {
        log.info('Inputs file not found — generating skeleton', { path: inputsPath });
        const defaults = generateDefaultInputs(tools);
        writeFileSync(inputsPath, yamlStringify(defaults), 'utf-8');
        log.info(`Inputs skeleton written to ${inputsPath}`);
        process.stdout.write(`Inputs skeleton written to ${inputsPath}\n`);
        inputEntries = yamlParse(readFileSync(inputsPath, 'utf-8'));
      }

      // 3. Call each tool with sample inputs and collect examples (multiple per tool)
      const examples = new Map<string, ToolExample[]>();
      for (const entry of inputEntries) {
        if (entry.args.skip === true) continue;

        const args: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(entry.args)) {
          if (k === 'skip') continue;
          args[k] = v;
        }

        try {
          log.info(
            `Calling tool ${entry.toolName}${entry.label ? ` [${entry.label}]` : ''}`,
            args
          );
          const result = await client.callTool({ name: entry.toolName, arguments: args });
          const content = result.content as { type: string; text?: string }[];
          const isError = (result as { isError?: boolean }).isError === true;
          const textParts = content.filter(c => c.type === 'text' && c.text).map(c => c.text!);
          if (textParts.length > 0) {
            const firstText = textParts[0];
            let output: string;
            try {
              const parsed = JSON.parse(firstText) as unknown;
              const reordered = reorderEnvelopeKeys(parsed);
              output = JSON.stringify(reordered, null, 2);
            } catch {
              output = firstText;
            }
            output = stabilizeOutput(output);
            if (isError) {
              output = `// isError: true\n${output}`;
            }
            const arr = examples.get(entry.toolName) ?? [];
            arr.push({ label: entry.label, args, output });
            examples.set(entry.toolName, arr);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.warning(`Tool ${entry.toolName} failed`, { label: entry.label, error: errMsg });
          const arr = examples.get(entry.toolName) ?? [];
          arr.push({
            label: entry.label,
            args,
            output: `// Error calling tool\n${JSON.stringify({ error: errMsg }, null, 2)}`,
          });
          examples.set(entry.toolName, arr);
        }
      }

      log.info('Collected tool examples', {
        tools: examples.size,
        total: [...examples.values()].reduce((sum, arr) => sum + arr.length, 0),
      });

      // 4. Call each prompt with sample args and collect the prompt text
      const promptSampleArgs: Record<string, Record<string, string>> = {
        reflectZoweMcp: {},
        reviewJcl: { dsn: 'USER.JCL.CNTL', member: 'COMPILE' },
        explainDataset: { dsn: 'USER.SRC.COBOL' },
        compareMembers: { dsn: 'USER.SRC.COBOL', member1: 'CUSTFILE', member2: 'ACCTPROC' },
      };
      const promptMessages = new Map<string, PromptMessage[]>();
      for (const prompt of prompts) {
        const sampleArgs = promptSampleArgs[prompt.name];
        if (sampleArgs === undefined) continue;
        try {
          log.info(`Getting prompt ${prompt.name}`, sampleArgs);
          const result = await client.getPrompt({
            name: prompt.name,
            arguments: sampleArgs,
          });
          const msgs = result.messages as unknown as PromptMessage[];
          promptMessages.set(prompt.name, msgs);
        } catch (err) {
          log.warning(`Prompt ${prompt.name} failed — skipping`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      log.info('Collected prompt messages', { count: promptMessages.size });

      // 5. Assemble the Markdown document
      let commitHash = '';
      try {
        const gitResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
          encoding: 'utf-8',
        });
        if (gitResult.status === 0 && gitResult.stdout) {
          commitHash = gitResult.stdout.trim();
        }
      } catch {
        // Not in a git repo or git not available
      }

      const sections: string[] = [];
      // markdownlint front-matter: disable rules triggered by MCP tool/prompt
      // descriptions that the generator cannot control, and structural duplicates.
      sections.push(
        '<!-- markdownlint-disable MD004 MD009 MD012 MD024 MD031 MD032 MD034 MD036 MD037 MD060 -->\n'
      );
      sections.push(`# Zowe MCP Server Reference\n`);
      const commitInfo = commitHash ? `, commit ${commitHash}` : '';
      sections.push(
        `> Auto-generated from the MCP server (v${SERVER_VERSION}${commitInfo}). ` +
          `Do not edit manually — run \`npx @zowe/mcp-server generate-docs\` to regenerate.\n`
      );
      const tocLinks: string[] = [];
      for (const g of toolGroups) {
        const anchor = g.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/-+$/, '');
        tocLinks.push(`[${g.label}](#${anchor})`);
      }
      tocLinks.push('[Tool Reference](#tool-reference)');
      if (prompts.length > 0) tocLinks.push('[Prompts](#prompts)');
      if (resources.length > 0) tocLinks.push('[Resources](#resources)');
      if (templates.length > 0) tocLinks.push('[Resource Templates](#resource-templates)');
      sections.push(
        'This document describes all ' +
          tocLinks.join(', ') +
          ' provided by the Zowe MCP Server.\n'
      );
      sections.push(generateToolsSection(toolGroups, examples));
      sections.push(generatePromptsSection(prompts, promptMessages));
      sections.push(generateResourcesSection(resources));
      sections.push(generateResourceTemplatesSection(templates));

      const markdown = formatMarkdownTables(sections.join('\n'));
      writeFileSync(output, markdown, 'utf-8');
      log.info(`Documentation written to ${output}`);
      process.stdout.write(`Documentation written to ${output}\n`);
    } finally {
      await client.close();
      await server.close();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  log.error('Error', error);
  process.exit(1);
});
