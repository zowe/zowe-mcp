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
 * Native stdio E2E tests.
 *
 * Starts the stdio server with the native (SSH) backend and runs a subset of
 * tools (info, context, listDatasets, listMembers) against real z/OS. Uses
 * SYS1.SAMPLIB and 'SYS1.*LIB' for assertions.
 *
 * Skipped when config file (native-config.json) or
 * password (ZOWE_MCP_PASSWORD_<USER>_<HOST> or ZOS_PASSWORD) is missing in
 * the current directory / environment.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConnectionSpec, toPasswordEnvVarName } from '../src/zos/native/connection-spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

/** Parsed tool result content. */
interface ToolContent {
  type: string;
  text: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

/** Call a tool, expect success, return result and parsed JSON. */
async function callToolSuccess(
  c: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ result: ToolResult; parsed: unknown }> {
  const result = await c.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  const parsed = JSON.parse(getResultText(result)) as unknown;
  return { result, parsed };
}

/** Call a tool, return result; optionally assert error message. Caller must expect result.isError. */
async function callToolError(
  c: Client,
  name: string,
  args: Record<string, unknown>,
  opts?: { exact?: string; contains?: string; match?: RegExp }
): Promise<ToolResult> {
  const result = await c.callTool({ name, arguments: args });
  const text = getResultText(result);
  if (opts?.exact !== undefined) {
    expect(text).toBe(opts.exact);
  }
  if (opts?.contains !== undefined) {
    expect(text.toLowerCase()).toContain(opts.contains.toLowerCase());
  }
  if (opts?.match !== undefined) {
    expect(text).toMatch(opts.match);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Skip conditions: config path and password (resolved at load time)
// ---------------------------------------------------------------------------

const cwd = process.cwd();
const CONFIG_NAMES = ['native-config.json', '../../native-config.json'] as const;

function findConfigPath(): string | undefined {
  for (const name of CONFIG_NAMES) {
    const candidatePath = resolve(cwd, name);
    try {
      const stat = statSync(candidatePath);
      if (existsSync(candidatePath) && stat.isFile()) {
        return candidatePath;
      }
    } catch {
      // ignore (e.g. ENOENT, EISDIR)
    }
  }
  return undefined;
}

function loadSystemsFromConfig(configPath: string): string[] {
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as { systems?: string[] };
  if (!Array.isArray(config.systems) || config.systems.length === 0) {
    return [];
  }
  return config.systems;
}

const configPath = findConfigPath();
const configSystems = configPath ? loadSystemsFromConfig(configPath) : [];
const firstSpec = configSystems.length > 0 ? parseConnectionSpec(configSystems[0]) : undefined;
const passwordEnvVar = firstSpec ? toPasswordEnvVarName(firstSpec.user, firstSpec.host) : '';
const passwordFromVar = passwordEnvVar && process.env[passwordEnvVar];
const passwordFromZos = process.env.ZOS_PASSWORD;
const password =
  (passwordFromVar && passwordFromVar.trim() !== '' ? passwordFromVar : undefined) ??
  (passwordFromZos && passwordFromZos.trim() !== '' ? passwordFromZos : undefined);

const firstSystemId = firstSpec?.host;
const canRunNativeE2E = Boolean(configPath && password && firstSystemId);

/** Reason shown when the suite is skipped (missing config or password). */
const skipReason = !canRunNativeE2E
  ? !configPath
    ? 'Missing config file (zowe-native.config or native-config.json in cwd)'
    : !password
      ? `Missing password (set ${passwordEnvVar} or ZOS_PASSWORD)`
      : 'No system in config'
  : '';

// Build env for the child: always pass through process.env; if we're using ZOS_PASSWORD
// as fallback, set the server's expected env var so it sees the password.
function getChildEnv(): Record<string, string> {
  const env = { ...process.env };
  if (password && passwordEnvVar && !process.env[passwordEnvVar]) {
    env[passwordEnvVar] = password;
  }
  return env as Record<string, string>;
}

describe.skipIf(!canRunNativeE2E)(
  `Zowe MCP Server (native stdio E2E)${skipReason ? ` [skipped: ${skipReason}]` : ''}`,
  () => {
    let client: Client;

    beforeAll(async () => {
      const transport = new StdioClientTransport({
        command: 'node',
        args: [serverPath, '--stdio', '--native', '--config', configPath!],
        env: getChildEnv(),
      });
      client = new Client({ name: 'e2e-native-test', version: '1.0.0' });
      await client.connect(transport);
    });

    afterAll(async () => {
      if (client) {
        await client.close();
      }
    });

    it('info returns server name and native backend', async () => {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      const { parsed } = await callToolSuccess(client, 'info', {});
      const o = parsed as { name: string; backend: string | null; components: string[] };
      expect(o.name).toBe('Zowe MCP Server');
      expect(o.backend).toBe('native');
      expect(o.components).toContain('core');
      expect(o.components).toContain('context');
      expect(o.components).toContain('datasets');
    });

    it('listSystems returns at least one system including config system', async () => {
      const { parsed } = await callToolSuccess(client, 'listSystems', {});
      const o = parsed as { systems: { host: string }[] };
      expect(Array.isArray(o.systems)).toBe(true);
      expect(o.systems.length).toBeGreaterThanOrEqual(1);
      const hosts = o.systems.map(s => s.host);
      expect(hosts).toContain(firstSystemId);
    });

    it('setSystem sets active system and returns userId and dsnPrefix', async () => {
      const { parsed } = await callToolSuccess(client, 'setSystem', {
        system: firstSystemId,
      });
      const o = parsed as { activeSystem: string; userId: string; dsnPrefix: string };
      expect(o.activeSystem).toBe(firstSystemId);
      expect(o.userId).toBeDefined();
      expect(o.userId.length).toBeGreaterThan(0);
      expect(o.dsnPrefix).toBeDefined();
      expect(o.dsnPrefix.length).toBeGreaterThan(0);
    });

    it('getContext returns active system', async () => {
      const { parsed } = await callToolSuccess(client, 'getContext', {});
      const o = parsed as {
        activeSystem: { system: string; userId: string; dsnPrefix: string } | null;
      };
      expect(o.activeSystem).not.toBeNull();
      expect(o.activeSystem!.system).toBe(firstSystemId);
    });

    it('listDatasets with SYS1.*LIB returns SAMPLIB and MACLIB', async () => {
      const { parsed } = await callToolSuccess(client, 'listDatasets', {
        dsnPattern: "'SYS1.*LIB'",
      });
      const o = parsed as {
        _context: { resolvedPattern?: string };
        data: { dsn: string }[];
      };
      expect(o._context).toBeDefined();
      expect(o._context.resolvedPattern).toBeDefined();
      expect(Array.isArray(o.data)).toBe(true);
      const dsns = o.data.map(d => d.dsn);
      expect(dsns.some(d => d.includes('SAMPLIB'))).toBe(true);
      expect(dsns.some(d => d.includes('MACLIB'))).toBe(true);
    });

    it('listMembers with SYS1.SAMPLIB returns 1000+ members', async () => {
      const { parsed } = await callToolSuccess(client, 'listMembers', {
        dsn: "'SYS1.SAMPLIB'",
        limit: 1000,
      });
      const o = parsed as {
        _context: unknown;
        _result?: { totalAvailable: number };
        data: { member: string }[];
      };
      expect(o._context).toBeDefined();
      expect(Array.isArray(o.data)).toBe(true);
      if (o._result) {
        expect(o._result.totalAvailable).toBeGreaterThan(1000);
      }
    });

    it('listMembers SYS1.SAMPLIB includes ADFDFLTX and APSIVP', async () => {
      const { parsed } = await callToolSuccess(client, 'listMembers', {
        dsn: "'SYS1.SAMPLIB'",
        limit: 1000,
      });
      const o = parsed as {
        _result?: { totalAvailable: number; hasMore: boolean };
        data: { member: string }[];
      };
      let allMembers = o.data.map(m => m.member);
      if (
        o._result &&
        o._result.totalAvailable > 1000 &&
        o._result.hasMore &&
        (!allMembers.includes('ADFDFLTX') || !allMembers.includes('APSIVP'))
      ) {
        const { parsed: second } = await callToolSuccess(client, 'listMembers', {
          dsn: "'SYS1.SAMPLIB'",
          offset: 1000,
          limit: 1000,
        });
        const secondData = (second as { data: { member: string }[] }).data;
        allMembers = [...allMembers, ...secondData.map(m => m.member)];
      }
      expect(allMembers).toContain('ADFDFLTX');
      expect(allMembers).toContain('APSIVP');
    });

    it('listDatasets with empty pattern returns specific error', async () => {
      const r = await callToolError(
        client,
        'listDatasets',
        { dsnPattern: "''" },
        { exact: 'Dataset list pattern must not be empty' }
      );
      expect(r.isError).toBe(true);
    });

    it('listDatasets with "\'...\'" returns specific error', async () => {
      const r = await callToolError(
        client,
        'listDatasets',
        { dsnPattern: "'...'" },
        {
          exact:
            'Invalid list pattern: empty qualifier in "...". ' +
            "Use valid qualifiers (e.g. 'USER.*', 'SYS1.**') and avoid consecutive or leading/trailing dots.",
        }
      );
      expect(r.isError).toBe(true);
    });

    it('listDatasets with consecutive dots returns specific error', async () => {
      const r = await callToolError(
        client,
        'listDatasets',
        { dsnPattern: "'SYS1..LIB'" },
        {
          exact:
            'Invalid list pattern: empty qualifier in "SYS1..LIB". ' +
            "Use valid qualifiers (e.g. 'USER.*', 'SYS1.**') and avoid consecutive or leading/trailing dots.",
        }
      );
      expect(r.isError).toBe(true);
    });

    it('listDatasets with trailing dot returns specific error', async () => {
      const r = await callToolError(
        client,
        'listDatasets',
        { dsnPattern: "'SYS1.'" },
        {
          exact:
            'Invalid list pattern: empty qualifier in "SYS1.". ' +
            "Use valid qualifiers (e.g. 'USER.*', 'SYS1.**') and avoid consecutive or leading/trailing dots.",
        }
      );
      expect(r.isError).toBe(true);
    });

    it('listMembers with empty dsn returns specific error', async () => {
      const r = await callToolError(
        client,
        'listMembers',
        { dsn: "''" },
        {
          exact: 'Dataset name must not be empty',
        }
      );
      expect(r.isError).toBe(true);
    });

    it('listMembers with invalid qualifier (starts with digit) returns specific error', async () => {
      const r = await callToolError(
        client,
        'listMembers',
        { dsn: "'SYS1.123BAD'" },
        {
          exact: 'Qualifier "123BAD" must start with A-Z, #, @, or $ in: "SYS1.123BAD"',
        }
      );
      expect(r.isError).toBe(true);
    });

    it('listMembers with consecutive dots returns specific error', async () => {
      const r = await callToolError(
        client,
        'listMembers',
        { dsn: "'SYS1..SAMPLIB'" },
        {
          exact: 'Dataset name must not contain consecutive dots: "SYS1..SAMPLIB"',
        }
      );
      expect(r.isError).toBe(true);
    });

    it('listMembers with non-existent dataset returns error', async () => {
      const r = await callToolError(client, 'listMembers', {
        dsn: "'NONEXIST.DATASET.XYZ'",
      });
      expect(r.isError).toBe(true);
      const text = getResultText(r);
      expect(text).toMatch(/could not list members.*NONEXIST\.DATASET\.XYZ.*rc:\s*'-1'/i);
    });

    it('listDatasets with nonexistent system returns specific error', async () => {
      const r = await callToolError(
        client,
        'listDatasets',
        { dsnPattern: "'SYS1.*'", system: 'nonexistent-host.example.com' },
        {
          match:
            /^No connection spec for system "nonexistent-host\.example\.com"( and user "[^"]+")?$/,
        }
      );
      expect(r.isError).toBe(true);
    });
  }
);
