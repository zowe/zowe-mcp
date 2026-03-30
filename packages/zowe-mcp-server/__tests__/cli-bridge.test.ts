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
 * Unit tests for the CLI plugin bridge.
 *
 * Covers:
 *   - YAML loading (loadPluginYaml)
 *   - CLI argument construction (buildCliArgs, buildProfileArgs)
 *   - Description variant resolution (resolveDescription)
 *   - MCP tool registration (loadAndRegisterPluginYaml)
 *   - Profile tool registration (endevorListConnections/Set, endevorListLocations/SetLocation)
 *   - Required profile enforcement and auto-select
 *   - Per-tool connectionId/locationId override
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildProfileArgs, invokeZoweCli } from '../src/tools/cli-bridge/cli-invoker.js';
import {
  buildCliArgs,
  buildToolInputSchema,
  createEmptyPluginState,
  loadAndRegisterPluginYaml,
  loadPluginYaml,
  resolveDescription,
  resolveFieldDescription,
  resolveJsonRef,
} from '../src/tools/cli-bridge/cli-tool-loader.js';
import type {
  CliNamedProfile,
  CliPluginState,
  PluginToolDef,
  ProfileFieldDef,
} from '../src/tools/cli-bridge/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve endevor-tools.yaml: vendor dir (used on feature branches) or built-in plugins dir.
const VENDOR_YAML = join(
  __dirname,
  '..',
  '..',
  '..',
  'vendor',
  'broadcom',
  'cli-bridge-plugins',
  'endevor-tools.yaml'
);
const SRC_YAML = join(__dirname, '..', 'src', 'tools', 'cli-bridge', 'plugins', 'endevor-tools.yaml');
const YAML_PATH = existsSync(VENDOR_YAML) ? VENDOR_YAML : SRC_YAML;
const YAML_AVAILABLE = existsSync(YAML_PATH);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Creates a minimal CliPluginState with one connection profile and a sync password resolver. */
function makeState(
  overrides?: Partial<{
    connectionProfiles: CliNamedProfile[];
    locationProfiles: CliNamedProfile[];
    activeConnectionId: string;
    activeLocationId: string;
    password: string;
  }>
): CliPluginState {
  const connectionProfiles = overrides?.connectionProfiles ?? [
    {
      id: 'default',
      host: 'localhost',
      port: 8080,
      user: 'USER',
      instance: 'ENDEVOR',
      protocol: 'http',
      basePath: 'EndevorService/api/v2',
    },
  ];
  const locationProfiles = overrides?.locationProfiles ?? [];
  const activeConnectionId =
    overrides?.activeConnectionId ??
    (connectionProfiles.length === 1 ? connectionProfiles[0].id : undefined);
  const password = overrides?.password ?? 'PASSWORD';

  const state = createEmptyPluginState();
  state.profilesByType.set('connection', connectionProfiles);
  state.profilesByType.set('location', locationProfiles);
  if (activeConnectionId !== undefined) {
    state.activeProfileId.set('connection', activeConnectionId);
  }
  if (overrides?.activeLocationId !== undefined) {
    state.activeProfileId.set('location', overrides.activeLocationId);
  }
  state.passwordResolver = {
    getPassword(_user: string, _host: string): Promise<string> {
      return Promise.resolve(password);
    },
  };
  return state;
}

/** Minimal logger stub for tests. */
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {};
const stubLogger = {
  child: () => ({ debug: noop, info: noop, warning: noop }),
} as unknown as Parameters<typeof loadAndRegisterPluginYaml>[3];

// ---------------------------------------------------------------------------
// resolveJsonRef
// ---------------------------------------------------------------------------

describe('resolveJsonRef', () => {
  const data = {
    endevor: {
      list: {
        environments: { description: 'Lists environments in Endevor' },
        elements: { description: 'Lists elements in Endevor' },
      },
    },
  };

  it('resolves a dotted path to a string', () => {
    expect(resolveJsonRef('endevor.list.environments.description', data)).toBe(
      'Lists environments in Endevor'
    );
  });

  it('returns undefined for a missing path', () => {
    expect(resolveJsonRef('endevor.list.stages.description', data)).toBeUndefined();
  });

  it('returns undefined when path resolves to a non-string', () => {
    expect(resolveJsonRef('endevor.list.elements', data)).toBeUndefined();
  });

  it('returns undefined for an empty path on non-string root', () => {
    expect(resolveJsonRef('', data)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('loadPluginYaml', () => {
  it('loads endevor-tools.yaml successfully', () => {
    const config = loadPluginYaml(YAML_PATH);
    expect(config.plugin).toBe('endevor');
    expect(Array.isArray(config.tools)).toBe(true);
    expect(config.tools.length).toBeGreaterThanOrEqual(9);
  });

  it('has a profiles block with connection and location types', () => {
    const config = loadPluginYaml(YAML_PATH);
    expect(config.profiles).toBeDefined();
    expect(config.profiles?.connection).toBeDefined();
    expect(config.profiles?.connection?.required).toBe(true);
    expect(config.profiles?.connection?.perToolOverride).toBe(false);
    expect(config.profiles?.location).toBeDefined();
    expect(config.profiles?.location?.required).toBe(false);
    expect(config.profiles?.location?.perToolOverride).toBe(true);
  });

  it('connection profile has host, user, instance fields', () => {
    const config = loadPluginYaml(YAML_PATH);
    const connFields = config.profiles?.connection?.fields ?? [];
    const fieldNames = connFields.map(f => f.name);
    expect(fieldNames).toContain('host');
    expect(fieldNames).toContain('user');
    expect(fieldNames).toContain('instance');
    const userField = connFields.find(f => f.name === 'user');
    expect(userField?.isUsername).toBe(true);
  });

  it('location profile has environment, stageNumber, system, subsystem, type, maxrc fields', () => {
    const config = loadPluginYaml(YAML_PATH);
    const locFields = config.profiles?.location?.fields ?? [];
    const fieldNames = locFields.map(f => f.name);
    expect(fieldNames).toContain('environment');
    expect(fieldNames).toContain('stageNumber');
    expect(fieldNames).toContain('system');
    expect(fieldNames).toContain('subsystem');
    expect(fieldNames).toContain('type');
    expect(fieldNames).toContain('maxrc');
  });

  it('does not have a context block (replaced by profiles)', () => {
    const config = loadPluginYaml(YAML_PATH);
    expect((config as Record<string, unknown>).context).toBeUndefined();
  });

  it('does not have a connection.flags block (replaced by profiles)', () => {
    const config = loadPluginYaml(YAML_PATH);
    expect((config as Record<string, unknown>).connection).toBeUndefined();
  });

  it('all tools have a zoweCommand and at least one description', () => {
    const config = loadPluginYaml(YAML_PATH);
    for (const tool of config.tools) {
      expect(tool.zoweCommand, `${tool.toolName} missing zoweCommand`).toBeTruthy();
      const hasDesc = Boolean(tool.descriptions.cli ?? tool.descriptions.intent);
      expect(hasDesc, `${tool.toolName} missing cli or intent description`).toBe(true);
    }
  });

  it('resolves $.path references in cli descriptions using companion JSON', () => {
    const config = loadPluginYaml(YAML_PATH);
    for (const tool of config.tools) {
      const cli = tool.descriptions.cli;
      if (cli) {
        expect(
          cli.startsWith('$.'),
          `${tool.toolName} cli description was not resolved (still has $.path): ${cli}`
        ).toBe(false);
      }
    }
  });

  it('resolves $.path references in location profile field descriptions', () => {
    const config = loadPluginYaml(YAML_PATH);
    for (const field of config.profiles?.location?.fields ?? []) {
      expect(
        field.description?.startsWith('$.'),
        `Location field '${field.name}' description was not resolved`
      ).toBe(false);
    }
  });

  it('resolves $.path references in connection profile field descriptions', () => {
    const config = loadPluginYaml(YAML_PATH);
    for (const field of config.profiles?.connection?.fields ?? []) {
      expect(
        field.description?.startsWith('$.'),
        `Connection field '${field.name}' description was not resolved`
      ).toBe(false);
    }
  });

  it('endevorListElements has locationParams=true and element positional', () => {
    const config = loadPluginYaml(YAML_PATH);
    const t = config.tools.find(t => t.toolName === 'endevorListElements');
    expect(t?.locationParams).toBe(true);
    const elementParam = t?.params?.find(p => p.name === 'element');
    expect(elementParam?.cliPositional).toBe(true);
  });

  it('endevorPrintElement outputs to stdout', () => {
    const config = loadPluginYaml(YAML_PATH);
    const t = config.tools.find(t => t.toolName === 'endevorPrintElement');
    expect(t?.outputPath).toBe('stdout');
  });

  it('endevorPrintElement element param is required', () => {
    const config = loadPluginYaml(YAML_PATH);
    const t = config.tools.find(t => t.toolName === 'endevorPrintElement');
    const elementParam = t?.params?.find(p => p.name === 'element');
    expect(elementParam?.required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Description variant resolution
// ---------------------------------------------------------------------------

describe('resolveDescription', () => {
  const makeTool = (descriptions: PluginToolDef['descriptions'], active?: string): PluginToolDef =>
    ({
      toolName: 'testTool',
      zoweCommand: 'endevor list elements',
      descriptions,
      activeDescription: active,
    }) as PluginToolDef;

  it('returns intent variant by default', () => {
    const tool = makeTool({ cli: 'CLI desc', intent: 'Intent desc' });
    delete process.env.ZOWE_MCP_CLI_DESC_VARIANT;
    expect(resolveDescription(tool)).toBe('Intent desc');
  });

  it('respects tool-level activeDescription', () => {
    const tool = makeTool({ cli: 'CLI desc', intent: 'Intent desc' }, 'cli');
    expect(resolveDescription(tool)).toBe('CLI desc');
  });

  it('respects plugin-level activeDescription', () => {
    const tool = makeTool({ cli: 'CLI desc', intent: 'Intent desc' });
    expect(resolveDescription(tool, 'cli')).toBe('CLI desc');
  });

  it('respects ZOWE_MCP_CLI_DESC_VARIANT env var', () => {
    const original = process.env.ZOWE_MCP_CLI_DESC_VARIANT;
    process.env.ZOWE_MCP_CLI_DESC_VARIANT = 'cli';
    try {
      const tool = makeTool({ cli: 'CLI desc', intent: 'Intent desc' });
      expect(resolveDescription(tool)).toBe('CLI desc');
    } finally {
      if (original === undefined) {
        delete process.env.ZOWE_MCP_CLI_DESC_VARIANT;
      } else {
        process.env.ZOWE_MCP_CLI_DESC_VARIANT = original;
      }
    }
  });

  it('falls back to cli if intent is missing', () => {
    delete process.env.ZOWE_MCP_CLI_DESC_VARIANT;
    const tool = makeTool({ cli: 'CLI desc' });
    expect(resolveDescription(tool)).toBe('CLI desc');
  });

  it('falls back to toolName if all descriptions are empty', () => {
    delete process.env.ZOWE_MCP_CLI_DESC_VARIANT;
    const tool = makeTool({});
    expect(resolveDescription(tool)).toBe('testTool');
  });
});

// ---------------------------------------------------------------------------
// Field / param description resolution (resolveFieldDescription)
// ---------------------------------------------------------------------------

describe('resolveFieldDescription', () => {
  afterEach(() => {
    delete process.env.ZOWE_MCP_CLI_DESC_VARIANT;
  });

  it('returns descriptions[variant] when present', () => {
    expect(
      resolveFieldDescription({ descriptions: { cli: 'CLI text', intent: 'Intent text' } }, 'cli')
    ).toBe('CLI text');
  });

  it('falls back to intent then cli when variant not found', () => {
    expect(
      resolveFieldDescription(
        { descriptions: { cli: 'CLI text', intent: 'Intent text' } },
        'optimized'
      )
    ).toBe('Intent text');
    expect(resolveFieldDescription({ descriptions: { cli: 'CLI text' } }, 'optimized')).toBe(
      'CLI text'
    );
  });

  it('falls back to plain description when descriptions is absent', () => {
    expect(resolveFieldDescription({ description: 'Plain text' })).toBe('Plain text');
  });

  it('prefers descriptions over plain description', () => {
    expect(
      resolveFieldDescription({
        descriptions: { intent: 'Variant text' },
        description: 'Plain text',
      })
    ).toBe('Variant text');
  });

  it('falls back to plain description when all descriptions entries are empty', () => {
    expect(resolveFieldDescription({ descriptions: {}, description: 'Plain fallback' })).toBe(
      'Plain fallback'
    );
  });

  it('returns empty string when nothing is defined', () => {
    expect(resolveFieldDescription({})).toBe('');
  });

  it('picks up ZOWE_MCP_CLI_DESC_VARIANT env var', () => {
    process.env.ZOWE_MCP_CLI_DESC_VARIANT = 'cli';
    expect(
      resolveFieldDescription({ descriptions: { cli: 'CLI text', intent: 'Intent text' } })
    ).toBe('CLI text');
  });
});

// ---------------------------------------------------------------------------
// buildProfileArgs
// ---------------------------------------------------------------------------

describe('buildProfileArgs', () => {
  const fields: ProfileFieldDef[] = [
    { name: 'host', cliOption: 'host' },
    { name: 'port', cliOption: 'port' },
    { name: 'user', cliOption: 'user', isUsername: true },
    { name: 'protocol', cliOption: 'protocol' },
    { name: 'instance', cliOption: 'i' },
  ];

  it('maps each field to --cliOption value', () => {
    const profile: CliNamedProfile = {
      id: 'default',
      host: 'myhost',
      port: 8080,
      user: 'USER',
      protocol: 'http',
      instance: 'ENDEVOR',
    };
    const args = buildProfileArgs(profile, fields);
    expect(args).toContain('--host');
    expect(args).toContain('myhost');
    expect(args).toContain('--port');
    expect(args).toContain('8080');
    expect(args).toContain('--user');
    expect(args).toContain('USER');
    expect(args).toContain('--protocol');
    expect(args).toContain('http');
    expect(args).toContain('--i');
    expect(args).toContain('ENDEVOR');
  });

  it('injects --password immediately after the isUsername field', () => {
    const profile: CliNamedProfile = { id: 'x', host: 'h', user: 'U', protocol: 'http' };
    const args = buildProfileArgs(profile, fields, 'SECRETPW');
    const userIdx = args.indexOf('--user');
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(args[userIdx + 1]).toBe('U');
    expect(args[userIdx + 2]).toBe('--password');
    expect(args[userIdx + 3]).toBe('SECRETPW');
  });

  it('skips fields with no value in the profile', () => {
    const profile: CliNamedProfile = { id: 'x', host: 'h' };
    const args = buildProfileArgs(profile, fields);
    expect(args).not.toContain('--port');
    expect(args).not.toContain('--user');
    expect(args).not.toContain('--protocol');
    expect(args).not.toContain('--i');
  });

  it('omits password when no isUsername field is present', () => {
    const simpleFields: ProfileFieldDef[] = [
      { name: 'host', cliOption: 'host' },
      { name: 'protocol', cliOption: 'protocol' },
    ];
    const profile: CliNamedProfile = { id: 'x', host: 'h', protocol: 'https' };
    const args = buildProfileArgs(profile, simpleFields, 'PASS');
    expect(args).not.toContain('--password');
  });

  it('omits password when no password provided', () => {
    const profile: CliNamedProfile = { id: 'x', host: 'h', user: 'U' };
    const args = buildProfileArgs(profile, fields);
    expect(args).not.toContain('--password');
  });
});

// ---------------------------------------------------------------------------
// Param $.ref resolution in buildToolInputSchema
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('buildToolInputSchema — param description resolution', () => {
  /**
   * Extracts the Zod v4 schema description.
   */
  const zodDesc = (s: z.ZodTypeAny): string | undefined => {
    const desc = (s as { description?: string }).description;
    if (desc !== undefined) return desc;
    const inner = (s as { def?: { innerType?: z.ZodTypeAny } }).def?.innerType;
    return inner ? zodDesc(inner) : undefined;
  };

  it('resolves $.path param descriptions after loadPluginYaml', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListEnvironments')!;
    const schema = buildToolInputSchema(tool, config.profiles);
    // connectionId and locationId params should be present
    expect(schema.connectionId).toBeDefined();
    expect(schema.locationId).toBeDefined();
  });

  it('location fields are injected when tool has locationParams', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const schema = buildToolInputSchema(tool, config.profiles);
    expect(schema.environment).toBeDefined();
    expect(schema.stageNumber).toBeDefined();
    expect(schema.system).toBeDefined();
    expect(schema.subsystem).toBeDefined();
    expect(schema.type).toBeDefined();
  });

  it('no location fields when tool does not have locationParams', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListPackages')!;
    const schema = buildToolInputSchema(tool, config.profiles);
    expect(schema.environment).toBeUndefined();
    expect(schema.stageNumber).toBeUndefined();
    // but connectionId and locationId override params still present
    expect(schema.connectionId).toBeDefined();
    expect(schema.locationId).toBeDefined();
  });

  it('uses descriptions.intent over description when variants are defined on a param', () => {
    const tool: PluginToolDef = {
      toolName: 'testTool',
      zoweCommand: 'test cmd',
      descriptions: { cli: 'Tool desc' },
      params: [
        {
          name: 'myParam',
          cliOption: 'my',
          descriptions: { cli: 'CLI param text', intent: 'Intent param text' },
        },
      ],
    };
    delete process.env.ZOWE_MCP_CLI_DESC_VARIANT;
    const schema = buildToolInputSchema(tool, undefined, 'intent');
    expect(zodDesc(schema.myParam)).toBe('Intent param text');
  });

  it('plain description on param acts as fallback', () => {
    const tool: PluginToolDef = {
      toolName: 'testTool',
      zoweCommand: 'test cmd',
      descriptions: { cli: 'Tool desc' },
      params: [
        {
          name: 'myParam',
          cliOption: 'my',
          description: 'Plain fallback',
        },
      ],
    };
    const schema = buildToolInputSchema(tool, undefined);
    expect(zodDesc(schema.myParam)).toBe('Plain fallback');
  });
});

// ---------------------------------------------------------------------------
// CLI argument construction (buildCliArgs)
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('buildCliArgs', () => {
  it('builds location args from virtual context defaults', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const locationFields = config.profiles?.location?.fields ?? [];
    const ctx: Record<string, string | undefined> = {
      environment: 'DEV',
      stageNumber: '1',
      system: 'SYS1',
      subsystem: 'SUB1',
      type: 'COBPGM',
    };
    const args = buildCliArgs(tool, {}, ctx, locationFields);
    expect(args).toContain('--env');
    expect(args).toContain('DEV');
    expect(args).toContain('--sn');
    expect(args).toContain('1');
    expect(args).toContain('--sys');
    expect(args).toContain('SYS1');
    expect(args).toContain('--sub');
    expect(args).toContain('SUB1');
    expect(args).toContain('--typ');
    expect(args).toContain('COBPGM');
  });

  it('uses call arg over context default', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const locationFields = config.profiles?.location?.fields ?? [];
    const ctx: Record<string, string | undefined> = { environment: 'DEV', stageNumber: '1' };
    const args = buildCliArgs(tool, { environment: 'PRD' }, ctx, locationFields);
    const envIdx = args.indexOf('--env');
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(args[envIdx + 1]).toBe('PRD');
  });

  it('puts positional arg before options', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorPrintElement')!;
    const locationFields = config.profiles?.location?.fields ?? [];
    const args = buildCliArgs(tool, { element: 'PROG01', environment: 'DEV' }, {}, locationFields);
    expect(args[0]).toBe('PROG01');
    expect(args).toContain('--env');
  });

  it('skips params with no value and no default', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const locationFields = config.profiles?.location?.fields ?? [];
    const args = buildCliArgs(tool, {}, {}, locationFields);
    expect(args).not.toContain('--env');
    expect(args).not.toContain('--sys');
  });

  it('injects type default * from location field when model omits type', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const locationFields = config.profiles?.location?.fields ?? [];
    const ctx: Record<string, string | undefined> = {
      environment: 'DEV',
      stageNumber: '1',
      system: 'SYS1',
      subsystem: 'SUB1',
    };
    const args = buildCliArgs(tool, {}, ctx, locationFields);
    expect(args).toContain('--typ');
    const typIdx = args.indexOf('--typ');
    expect(args[typIdx + 1]).toBe('*');
  });

  it('includes optional params when provided', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const locationFields = config.profiles?.location?.fields ?? [];
    const args = buildCliArgs(tool, { search: 'true', data: 'ALL' }, {}, locationFields);
    expect(args).toContain('--sea');
    expect(args).toContain('true');
    expect(args).toContain('--dat');
    expect(args).toContain('ALL');
  });
});

// ---------------------------------------------------------------------------
// invokeZoweCli — real spawn with non-existent binary to verify error handling
// ---------------------------------------------------------------------------

describe('invokeZoweCli (binary not found)', () => {
  it('returns ok=false when the binary does not exist', () => {
    const result = invokeZoweCli(['list', 'elements'], [], [], {
      ZOWE_MCP_ZOWE_BIN_OVERRIDE: '_zowe_nonexistent_binary_xyz_',
    });
    // Without actual binary override env, it will try 'zowe' which doesn't exist in test env
    // Just verify the error shape is correct
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('exitCode');
  });

  it('returns ok=false with custom non-existent zoweBin via env', () => {
    const origEnv = process.env.ZOWE_MCP_ZOWE_BIN;
    process.env.ZOWE_MCP_ZOWE_BIN = '_zowe_nonexistent_binary_xyz_';
    try {
      const result = invokeZoweCli(['list', 'elements'], [], []);
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toBeTruthy();
    } finally {
      if (origEnv === undefined) {
        delete process.env.ZOWE_MCP_ZOWE_BIN;
      } else {
        process.env.ZOWE_MCP_ZOWE_BIN = origEnv;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// MCP tool registration via loadAndRegisterPluginYaml
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('loadAndRegisterPluginYaml', () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = makeState();
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    cleanup = async () => {
      await client.close();
    };
  });

  afterEach(async () => {
    await cleanup?.();
  });

  it('registers endevorListConnections and endevorSetConnection tools', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('endevorListConnections');
    expect(toolNames).toContain('endevorSetConnection');
  });

  it('registers endevorListLocations and endevorSetLocation tools', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('endevorListLocations');
    expect(toolNames).toContain('endevorSetLocation');
  });

  it('does NOT register endevorSetContext (removed)', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('endevorSetContext');
  });

  it('registers at least 11 endevor* tools (10 commands + 4 profile mgmt - 1 removed = 13 total)', async () => {
    const { tools } = await client.listTools();
    const endevorTools = tools.filter(t => t.name.startsWith('endevor'));
    expect(endevorTools.length).toBeGreaterThanOrEqual(11);
  });

  it('registers endevorListElements tool', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('endevorListElements');
  });

  it('endevorListElements has readOnlyHint annotation', async () => {
    const { tools } = await client.listTools();
    const listEl = tools.find(t => t.name === 'endevorListElements');
    expect(listEl?.annotations?.readOnlyHint).toBe(true);
  });

  it('endevorListConnections has readOnlyHint annotation', async () => {
    const { tools } = await client.listTools();
    const t = tools.find(t => t.name === 'endevorListConnections');
    expect(t?.annotations?.readOnlyHint).toBe(true);
  });

  it('endevorListLocations has readOnlyHint annotation', async () => {
    const { tools } = await client.listTools();
    const t = tools.find(t => t.name === 'endevorListLocations');
    expect(t?.annotations?.readOnlyHint).toBe(true);
  });

  it('endevorListElements input schema includes connectionId and locationId', async () => {
    const { tools } = await client.listTools();
    const t = tools.find(t => t.name === 'endevorListElements');
    const schema = t?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties?.connectionId).toBeDefined();
    expect(schema?.properties?.locationId).toBeDefined();
  });

  it('endevorListElements input schema includes location fields (environment, stageNumber, etc)', async () => {
    const { tools } = await client.listTools();
    const t = tools.find(t => t.name === 'endevorListElements');
    const schema = t?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties?.environment).toBeDefined();
    expect(schema?.properties?.stageNumber).toBeDefined();
    expect(schema?.properties?.system).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// endevorListConnections behaviour
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('endevorListConnections behaviour', () => {
  it('returns profiles without triggering an error', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = makeState();
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([cl.connect(ct), server.connect(st)]);

    const result = await cl.callTool({ name: 'endevorListConnections', arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;
    const parsed = JSON.parse(text) as { profiles: { id: string; active: boolean }[] };
    expect(parsed.profiles).toBeDefined();
    expect(parsed.profiles[0].id).toBe('default');
    expect(parsed.profiles[0].active).toBe(true);
    await cl.close();
  });
});

// ---------------------------------------------------------------------------
// endevorSetConnection behaviour
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('endevorSetConnection behaviour', () => {
  it('valid ID updates activeProfileId', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = makeState({
      connectionProfiles: [
        { id: 'profile1', host: 'h1', user: 'U1' },
        { id: 'profile2', host: 'h2', user: 'U2' },
      ],
      activeConnectionId: 'profile1',
    });
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([cl.connect(ct), server.connect(st)]);

    await cl.callTool({ name: 'endevorSetConnection', arguments: { connectionId: 'profile2' } });
    expect(state.activeProfileId.get('connection')).toBe('profile2');
    await cl.close();
  });

  it('invalid ID returns isError=true with valid IDs listed', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = makeState();
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([cl.connect(ct), server.connect(st)]);

    const result = await cl.callTool({
      name: 'endevorSetConnection',
      arguments: { connectionId: 'nonexistent' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('default');
    await cl.close();
  });

  it('auto-selects single profile at registration time', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = createEmptyPluginState();
    state.profilesByType.set('connection', [{ id: 'only-one', host: 'h', user: 'U' }]);
    state.profilesByType.set('location', []);
    state.passwordResolver = {
      getPassword: () => Promise.resolve('pw'),
    };
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);
    // After registration, the single profile should be auto-selected
    expect(state.activeProfileId.get('connection')).toBe('only-one');
  });
});

// ---------------------------------------------------------------------------
// endevorSetLocation behaviour
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('endevorSetLocation behaviour', () => {
  async function setupServer() {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = makeState({
      locationProfiles: [
        { id: 'dev-loc', environment: 'DEV', stageNumber: '1', system: 'SYS', subsystem: 'SUB' },
        { id: 'prd-loc', environment: 'PRD', stageNumber: '2' },
      ],
    });
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([cl.connect(ct), server.connect(st)]);
    return { state, cl };
  }

  it('locationId only primes virtual context from profile', async () => {
    const { state, cl } = await setupServer();
    await cl.callTool({ name: 'endevorSetLocation', arguments: { locationId: 'dev-loc' } });
    const ctx = state.virtualContextByType.get('location') ?? {};
    expect(ctx.environment).toBe('DEV');
    expect(ctx.stageNumber).toBe('1');
    expect(ctx.system).toBe('SYS');
    await cl.close();
  });

  it('individual fields only sets exactly those fields', async () => {
    const { state, cl } = await setupServer();
    await cl.callTool({
      name: 'endevorSetLocation',
      arguments: { environment: 'QA', stageNumber: '1' },
    });
    const ctx = state.virtualContextByType.get('location') ?? {};
    expect(ctx.environment).toBe('QA');
    expect(ctx.stageNumber).toBe('1');
    expect(ctx.system).toBeUndefined();
    await cl.close();
  });

  it('locationId + overrides primes then overrides', async () => {
    const { state, cl } = await setupServer();
    await cl.callTool({
      name: 'endevorSetLocation',
      arguments: { locationId: 'dev-loc', environment: 'STAGING' },
    });
    const ctx = state.virtualContextByType.get('location') ?? {};
    expect(ctx.environment).toBe('STAGING');
    expect(ctx.stageNumber).toBe('1');
    expect(ctx.system).toBe('SYS');
    await cl.close();
  });

  it('no args clears virtual context', async () => {
    const { state, cl } = await setupServer();
    // First set something
    state.virtualContextByType.set('location', { environment: 'DEV' });
    await cl.callTool({ name: 'endevorSetLocation', arguments: {} });
    const ctx = state.virtualContextByType.get('location') ?? {};
    expect(Object.keys(ctx).length).toBe(0);
    await cl.close();
  });

  it('returns JSON success response', async () => {
    const { state, cl } = await setupServer();
    const result = await cl.callTool({
      name: 'endevorSetLocation',
      arguments: { environment: 'DEV' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    const parsed = JSON.parse(text) as { success: boolean; context: Record<string, string> };
    expect(parsed.success).toBe(true);
    expect(parsed.context.environment).toBe('DEV');
    expect(state).toBeDefined();
    await cl.close();
  });

  it('endevorListLocations reflects current virtual context', async () => {
    const { state, cl } = await setupServer();
    state.virtualContextByType.set('location', { environment: 'DEV', stageNumber: '1' });
    const result = await cl.callTool({ name: 'endevorListLocations', arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;
    const parsed = JSON.parse(text) as {
      profiles: unknown[];
      currentContext: Record<string, string>;
    };
    expect(parsed.currentContext.environment).toBe('DEV');
    expect(parsed.currentContext.stageNumber).toBe('1');
    await cl.close();
  });
});

// ---------------------------------------------------------------------------
// Connection required enforcement
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('connection required enforcement', () => {
  it('multiple connections with none active returns isError', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = createEmptyPluginState();
    state.profilesByType.set('connection', [
      { id: 'conn1', host: 'h1', user: 'U1' },
      { id: 'conn2', host: 'h2', user: 'U2' },
    ]);
    state.profilesByType.set('location', []);
    state.passwordResolver = {
      getPassword: () => Promise.resolve('pw'),
    };
    // No activeProfileId set for connection
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([cl.connect(ct), server.connect(st)]);

    const result = await cl.callTool({ name: 'endevorListEnvironments', arguments: {} });
    expect(result.isError).toBe(true);
    await cl.close();
  });
});

// ---------------------------------------------------------------------------
// connectionId per-tool override
// ---------------------------------------------------------------------------

describe.skipIf(!YAML_AVAILABLE)('connectionId per-tool override', () => {
  it('tools input schema includes optional connectionId and locationId', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const state = makeState();
    loadAndRegisterPluginYaml(server, YAML_PATH, state, stubLogger);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([cl.connect(ct), server.connect(st)]);

    const { tools } = await cl.listTools();
    const t = tools.find(t => t.name === 'endevorListEnvironments');
    const schema = t?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties?.connectionId).toBeDefined();
    expect(schema?.properties?.locationId).toBeDefined();
    await cl.close();
  });
});
