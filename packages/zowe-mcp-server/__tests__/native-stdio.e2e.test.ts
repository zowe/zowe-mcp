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
import { afterAll, describe, expect, it } from 'vitest';
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

interface ToolTestCase {
  name: string;
  arguments?: Record<string, unknown>;
  /** When set, called with the parsed JSON result to assert expected values. */
  assertResult?: (parsed: unknown) => void;
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

    afterAll(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should run supported tools against native backend in one session', async () => {
      const transport = new StdioClientTransport({
        command: 'node',
        args: [serverPath, '--stdio', '--native', '--config', configPath!],
        env: getChildEnv(),
      });
      client = new Client({ name: 'e2e-native-test', version: '1.0.0' });
      await client.connect(transport);

      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);

      const toolCases: ToolTestCase[] = [
        {
          name: 'info',
          arguments: {},
          assertResult(parsed) {
            const o = parsed as { name: string; backend: string | null; components: string[] };
            expect(o.name).toBe('Zowe MCP Server');
            expect(o.backend).toBe('native');
            expect(o.components).toContain('core');
            expect(o.components).toContain('context');
            expect(o.components).toContain('datasets');
          },
        },
        {
          name: 'listSystems',
          arguments: {},
          assertResult(parsed) {
            const o = parsed as { systems: { host: string }[] };
            expect(Array.isArray(o.systems)).toBe(true);
            expect(o.systems.length).toBeGreaterThanOrEqual(1);
            const hosts = o.systems.map(s => s.host);
            expect(hosts).toContain(firstSystemId);
          },
        },
        {
          name: 'setSystem',
          arguments: { system: firstSystemId },
          assertResult(parsed) {
            const o = parsed as { activeSystem: string; userId: string; dsnPrefix: string };
            expect(o.activeSystem).toBe(firstSystemId);
            expect(o.userId).toBeDefined();
            expect(o.userId.length).toBeGreaterThan(0);
            expect(o.dsnPrefix).toBeDefined();
            expect(o.dsnPrefix.length).toBeGreaterThan(0);
          },
        },
        {
          name: 'getContext',
          arguments: {},
          assertResult(parsed) {
            const o = parsed as {
              activeSystem: { system: string; userId: string; dsnPrefix: string } | null;
            };
            expect(o.activeSystem).not.toBeNull();
            expect(o.activeSystem!.system).toBe(firstSystemId);
          },
        },
        {
          name: 'listDatasets',
          arguments: { dsnPattern: "'SYS1.*LIB'" },
          assertResult(parsed) {
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
          },
        },
        {
          name: 'listMembers',
          arguments: { dsn: "'SYS1.SAMPLIB'", limit: 1000 },
          assertResult(parsed) {
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
          },
        },
      ];

      let listMembersParsed: {
        _result?: { totalAvailable: number; hasMore: boolean };
        data: { member: string }[];
      } | null = null;

      for (const tc of toolCases) {
        const result = await client.callTool({
          name: tc.name,
          arguments: tc.arguments ?? {},
        });
        expect(result.isError).toBeFalsy();
        const text = getResultText(result);
        const parsed = JSON.parse(text) as unknown;
        if (tc.name === 'listMembers') {
          listMembersParsed = parsed as typeof listMembersParsed;
        }
        tc.assertResult?.(parsed);
      }

      // Assert ADFDFLTX and APSIVP exist; they may be in the first or second page
      expect(listMembersParsed).not.toBeNull();
      let allMembers = listMembersParsed!.data.map(m => m.member);
      if (
        listMembersParsed!._result &&
        listMembersParsed!._result.totalAvailable > 1000 &&
        listMembersParsed!._result.hasMore &&
        (!allMembers.includes('ADFDFLTX') || !allMembers.includes('APSIVP'))
      ) {
        const secondResult = await client.callTool({
          name: 'listMembers',
          arguments: { dsn: "'SYS1.SAMPLIB'", offset: 1000, limit: 1000 },
        });
        expect(secondResult.isError).toBeFalsy();
        const secondPage = JSON.parse(getResultText(secondResult)) as {
          data: { member: string }[];
        };
        allMembers = [...allMembers, ...secondPage.data.map(m => m.member)];
      }
      expect(allMembers).toContain('ADFDFLTX');
      expect(allMembers).toContain('APSIVP');
    });
  }
);
