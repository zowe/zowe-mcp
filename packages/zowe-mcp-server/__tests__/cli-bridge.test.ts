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
 *   - CLI argument construction (buildCliArgs)
 *   - Description variant resolution (resolveDescription)
 *   - MCP tool registration (loadAndRegisterPluginYaml)
 *   - buildConnectionArgs (no subprocess spawning needed)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConnectionArgs, invokeZoweCli } from '../src/tools/cli-bridge/cli-invoker.js';
import {
  buildCliArgs,
  loadAndRegisterPluginYaml,
  loadPluginYaml,
  resolveDescription,
  resolveJsonRef,
} from '../src/tools/cli-bridge/cli-tool-loader.js';
import type { CliPluginState, PluginToolDef } from '../src/tools/cli-bridge/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const YAML_PATH = join(__dirname, '..', 'src', 'tools', 'cli-bridge', 'endevor-tools.yaml');

const makeState = (overrides?: Partial<CliPluginState>): CliPluginState => ({
  connection: {
    host: 'localhost',
    port: 8080,
    user: 'USER',
    password: 'PASSWORD',
    pluginParams: { instance: 'ENDEVOR' },
  },
  context: {},
  ...overrides,
});

/** Minimal logger stub for tests. */
const stubLogger = {
  child: () => ({ debug: () => {}, info: () => {}, warning: () => {} }),
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

describe('loadPluginYaml', () => {
  it('loads endevor-tools.yaml successfully', () => {
    const config = loadPluginYaml(YAML_PATH);
    expect(config.plugin).toBe('endevor');
    expect(Array.isArray(config.tools)).toBe(true);
    expect(config.tools.length).toBeGreaterThanOrEqual(9);
  });

  it('has a context block with 5 fields', () => {
    const config = loadPluginYaml(YAML_PATH);
    expect(config.context).toBeDefined();
    expect(config.context?.toolName).toBe('endevorSetContext');
    expect(config.context?.fields.length).toBeGreaterThanOrEqual(5);
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
    // After loading, $.path refs must be replaced with actual strings (not start with $.)
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

  it('resolves $.path references in context field descriptions', () => {
    const config = loadPluginYaml(YAML_PATH);
    for (const field of config.context?.fields ?? []) {
      expect(
        field.description?.startsWith('$.'),
        `Context field '${field.name}' description was not resolved`
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
// CLI argument construction
// ---------------------------------------------------------------------------

describe('buildCliArgs', () => {
  it('builds location args from context defaults', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const contextFields = config.context?.fields ?? [];
    const ctx = {
      environment: 'DEV',
      stageNumber: '1',
      system: 'SYS1',
      subsystem: 'SUB1',
      type: 'COBPGM',
    };
    const args = buildCliArgs(tool, {}, ctx, contextFields);
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
    const contextFields = config.context?.fields ?? [];
    const ctx = { environment: 'DEV', stageNumber: '1' };
    const args = buildCliArgs(tool, { environment: 'PRD' }, ctx, contextFields);
    const envIdx = args.indexOf('--env');
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(args[envIdx + 1]).toBe('PRD');
  });

  it('puts positional arg before options', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorPrintElement')!;
    const contextFields = config.context?.fields ?? [];
    const args = buildCliArgs(tool, { element: 'PROG01', environment: 'DEV' }, {}, contextFields);
    // Positional must come first
    expect(args[0]).toBe('PROG01');
    // Option follows
    expect(args).toContain('--env');
  });

  it('skips params with no value and no default', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const contextFields = config.context?.fields ?? [];
    const args = buildCliArgs(tool, {}, {}, contextFields);
    expect(args).not.toContain('--env');
    expect(args).not.toContain('--sys');
  });

  it('P0b: injects type default * from context field when model omits type with other locationParams', () => {
    // The type context field has default: "*"; resolveLocationParams must propagate it.
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const contextFields = config.context?.fields ?? [];
    // Model provides env/sn/sys/sub but not type — the default should inject --typ *
    const ctx = { environment: 'DEV', stageNumber: '1', system: 'SYS1', subsystem: 'SUB1' };
    const args = buildCliArgs(tool, {}, ctx, contextFields);
    expect(args).toContain('--typ');
    const typIdx = args.indexOf('--typ');
    expect(args[typIdx + 1]).toBe('*');
  });

  it('includes optional params when provided', () => {
    const config = loadPluginYaml(YAML_PATH);
    const tool = config.tools.find(t => t.toolName === 'endevorListElements')!;
    const contextFields = config.context?.fields ?? [];
    const args = buildCliArgs(tool, { search: 'true', data: 'ALL' }, {}, contextFields);
    expect(args).toContain('--sea');
    expect(args).toContain('true');
    expect(args).toContain('--dat');
    expect(args).toContain('ALL');
  });
});

// ---------------------------------------------------------------------------
// buildConnectionArgs (no subprocess spawning)
// ---------------------------------------------------------------------------

describe('buildConnectionArgs', () => {
  // The Endevor YAML defines connection.flags that map pluginParams keys to CLI flags.
  // These tests replicate those flag mappings inline to keep the tests self-contained.
  const endevorFlags = [
    { configKey: 'pluginProfile', cliFlag: 'endevor-profile' },
    { configKey: 'locationProfile', cliFlag: 'endevor-location-profile' },
    { configKey: 'instance', cliFlag: 'instance' },
  ];

  it('builds args from profile-based config via pluginParams + YAML flags', () => {
    const args = buildConnectionArgs(
      { pluginParams: { pluginProfile: 'myprofile', locationProfile: 'mylocation' } },
      endevorFlags
    );
    expect(args).toContain('--endevor-profile');
    expect(args).toContain('myprofile');
    expect(args).toContain('--endevor-location-profile');
    expect(args).toContain('mylocation');
  });

  it('builds args from explicit connection config', () => {
    const args = buildConnectionArgs(
      {
        host: 'mymainframe.example.com',
        port: 8080,
        user: 'USER',
        password: 'PASS',
        pluginParams: { instance: 'ENDEVOR' },
      },
      endevorFlags
    );
    expect(args).toContain('--host');
    expect(args).toContain('mymainframe.example.com');
    expect(args).toContain('--port');
    expect(args).toContain('8080');
    expect(args).toContain('--user');
    expect(args).toContain('--password');
    expect(args).toContain('--instance');
    expect(args).toContain('ENDEVOR');
  });

  it('returns empty array for empty config', () => {
    expect(buildConnectionArgs({})).toEqual([]);
  });

  it('YAML connection.flags are loaded correctly', () => {
    const config = loadPluginYaml(YAML_PATH);
    expect(config.connection?.flags).toBeDefined();
    const flags = config.connection?.flags ?? [];
    const pluginProfileFlag = flags.find(f => f.configKey === 'pluginProfile');
    expect(pluginProfileFlag?.cliFlag).toBe('endevor-profile');
    const instanceFlag = flags.find(f => f.configKey === 'instance');
    expect(instanceFlag?.cliFlag).toBe('instance');
  });
});

// ---------------------------------------------------------------------------
// invokeZoweCli — real spawn with non-existent binary to verify error handling
// ---------------------------------------------------------------------------

describe('invokeZoweCli (binary not found)', () => {
  it('returns ok=false when the binary does not exist', () => {
    const result = invokeZoweCli(['list', 'elements'], [], {
      zoweBin: '_zowe_nonexistent_binary_xyz_',
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MCP tool registration via loadAndRegisterPluginYaml
// ---------------------------------------------------------------------------

describe('loadAndRegisterPluginYaml', () => {
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

  it('registers endevorSetContext tool', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('endevorSetContext');
  });

  it('registers endevorListElements tool', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('endevorListElements');
  });

  it('registers at least 9 endevor* tools (includes context tool)', async () => {
    const { tools } = await client.listTools();
    const endevorTools = tools.filter(t => t.name.startsWith('endevor'));
    expect(endevorTools.length).toBeGreaterThanOrEqual(9);
  });

  it('endevorListElements has readOnlyHint annotation', async () => {
    const { tools } = await client.listTools();
    const listEl = tools.find(t => t.name === 'endevorListElements');
    expect(listEl?.annotations?.readOnlyHint).toBe(true);
  });

  it('endevorSetContext updates state.context', async () => {
    const state = makeState();
    const server2 = new McpServer({ name: 'test2', version: '0.0.0' });
    loadAndRegisterPluginYaml(server2, YAML_PATH, state, stubLogger);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: 'c2', version: '0.0.0' });
    await Promise.all([cl.connect(ct), server2.connect(st)]);

    await cl.callTool({
      name: 'endevorSetContext',
      arguments: { environment: 'PRD', stageNumber: '1' },
    });
    expect(state.context.environment).toBe('PRD');
    expect(state.context.stageNumber).toBe('1');
    await cl.close();
  });

  it('endevorSetContext returns JSON success response', async () => {
    const result = await client.callTool({
      name: 'endevorSetContext',
      arguments: { environment: 'DEV' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    const parsed = JSON.parse(text) as { success: boolean; context: Record<string, string> };
    expect(parsed.success).toBe(true);
    expect(parsed.context.environment).toBe('DEV');
  });
});
