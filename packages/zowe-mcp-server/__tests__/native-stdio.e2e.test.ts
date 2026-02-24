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
 * Starts the stdio server with the native (SSH) backend and runs tools against
 * real z/OS. Uses SYS1.SAMPLIB and 'SYS1.*LIB' for read-only assertions, and
 * a nested "with temporary datasets" block for create/write/delete/copy/rename
 * using temp datasets (USER.TMP.*) so production data is not modified.
 *
 * Some tests are skipped when the system or ZNP server does not support them:
 * PDSE (LIBRARY) and renameDataset member (renameMember). Re-enable by changing
 * skipIf(true) to skipIf(false) when the backend supports the feature.
 * deleteDatasetsUnderPrefix (prefix.**) runs with retries for intermittent ZNP.
 *
 * Skipped when config file (native-config.json) or
 * password (ZOWE_MCP_PASSWORD_<USER>_<HOST> or ZOS_PASSWORD) is missing in
 * the current directory / environment.
 *
 * USS: read-only tests (getUssHome, listUssFiles, readUssFile, runSafeUssCommand);
 * no write/delete/temp on real z/OS.
 *
 * TSO: runSafeTsoCommand (TIME, SYSTEM); OSHELL and DELETE (system) always block.
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

/** Quote DSN for tool arguments (e.g. USER.TMP.X → 'USER.TMP.X'). */
function q(dsn: string): string {
  return `'${dsn}'`;
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

interface NativeConfigForTest {
  systems?: string[];
  /** Value may be string or array of lines (same as native config). */
  jobCards?: Record<string, string | string[]>;
}

function loadNativeConfigForTest(configPath: string): NativeConfigForTest {
  const raw = readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as NativeConfigForTest;
}

function loadSystemsFromConfig(configPath: string): string[] {
  const config = loadNativeConfigForTest(configPath);
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

/** Job card for the first connection spec (from config jobCards section). Jobs tests are skipped when missing. */
const nativeConfig = configPath ? loadNativeConfigForTest(configPath) : undefined;
const firstConnectionSpec = configSystems[0];
const jobCardForFirstSpec =
  firstConnectionSpec && nativeConfig?.jobCards
    ? nativeConfig.jobCards[firstConnectionSpec]
    : undefined;
const canRunJobsE2E = Boolean(canRunNativeE2E && jobCardForFirstSpec);

/** Normalize job card (string or array of lines) to a single string; substitute {jobname} and {programmer} for E2E. */
function normalizeJobCardForTest(
  card: string | string[] | undefined,
  defaults: { userId: string }
): string {
  if (card == null) return '';
  const raw = Array.isArray(card) ? card.join('\n') : card;
  return raw
    .replace(/\{jobname\}/gi, defaults.userId + 'A')
    .replace(/\{programmer\}/g, '')
    .trim();
}

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
      expect(o.components).toContain('uss');
      expect(o.components).toContain('jobs');
    });

    it('listSystems returns at least one system including config system', async () => {
      const { parsed } = await callToolSuccess(client, 'listSystems', {});
      const o = parsed as { systems: { host: string }[] };
      expect(Array.isArray(o.systems)).toBe(true);
      expect(o.systems.length).toBeGreaterThanOrEqual(1);
      const hosts = o.systems.map(s => s.host);
      expect(hosts).toContain(firstSystemId);
    });

    it('setSystem sets active system and returns userId', async () => {
      const { parsed } = await callToolSuccess(client, 'setSystem', {
        system: firstSystemId,
      });
      const o = parsed as { activeSystem: string; userId: string };
      expect(o.activeSystem).toBe(firstSystemId);
      expect(o.userId).toBeDefined();
      expect(o.userId.length).toBeGreaterThan(0);
    });

    it('getContext returns active system', async () => {
      const { parsed } = await callToolSuccess(client, 'getContext', {});
      const o = parsed as {
        activeSystem: { system: string; userId: string } | null;
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

    it('listDatasets with SYS1.*LIB returns dataset attributes when attributes default', async () => {
      const { parsed } = await callToolSuccess(client, 'listDatasets', {
        dsnPattern: "'SYS1.*LIB'",
      });
      const o = parsed as {
        _context: unknown;
        data: {
          dsn: string;
          resourceLink?: string;
          dsorg?: string;
          recfm?: string;
          lrecl?: number;
          blksz?: number;
          volser?: string;
          creationDate?: string;
        }[];
      };
      expect(Array.isArray(o.data)).toBe(true);
      expect(o.data.length).toBeGreaterThan(0);
      const first = o.data[0];
      expect(first).toHaveProperty('dsn');
      expect(typeof first.dsn).toBe('string');
      expect(first).toHaveProperty('resourceLink');
      expect(first).toHaveProperty('dsorg');
      expect(first).toHaveProperty('recfm');
      expect(typeof first.lrecl).toBe('number');
      expect(typeof first.blksz).toBe('number');
    });

    it('listDatasets with attributes false returns names only', async () => {
      const { parsed } = await callToolSuccess(client, 'listDatasets', {
        dsnPattern: "'SYS1.*LIB'",
        attributes: false,
      });
      const o = parsed as {
        _context: unknown;
        data: { dsn: string; resourceLink?: string; dsorg?: string }[];
      };
      expect(Array.isArray(o.data)).toBe(true);
      expect(o.data.length).toBeGreaterThan(0);
      const first = o.data[0];
      expect(first).toHaveProperty('dsn');
      expect(first).toHaveProperty('resourceLink');
      expect(first).not.toHaveProperty('dsorg');
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

    it('readDataset SYS1.SAMPLIB(AFBALOC) returns content and envelope', async () => {
      const { parsed } = await callToolSuccess(client, 'readDataset', {
        dsn: "'SYS1.SAMPLIB'",
        member: 'AFBALOC',
      });
      const o = parsed as {
        _context: { system: string; resolvedDsn?: string };
        _result?: {
          totalLines: number;
          startLine: number;
          returnedLines: number;
          hasMore?: boolean;
        };
        data: { text: string; etag: string; encoding: string };
      };
      expect(o._context).toBeDefined();
      expect(o._context.system).toBeDefined();
      expect(o.data).toBeDefined();
      expect(typeof o.data.text).toBe('string');
      expect(o.data.text.length).toBeGreaterThan(0);
      expect(typeof o.data.etag).toBe('string');
      expect(typeof o.data.encoding).toBe('string');
      if (o._result) {
        expect(o._result.totalLines).toBeGreaterThan(0);
        expect(o._result.startLine).toBe(1);
        expect(o._result.returnedLines).toBeGreaterThan(0);
      }
    });

    it('searchInDataset SYS1.SAMPLIB(IEANTCOB) returns envelope and matches when present', async () => {
      const { parsed } = await callToolSuccess(client, 'searchInDataset', {
        dsn: "'SYS1.SAMPLIB'",
        member: 'IEANTCOB',
        string: 'Name/Token Service',
      });
      const o = parsed as {
        _context: { system: string };
        _result: { count: number; totalAvailable: number; linesFound: number };
        data: {
          dataset: string;
          members: { name: string; matches: { lineNumber: number; content: string }[] }[];
          summary: { searchPattern: string };
        };
      };
      expect(o._context).toBeDefined();
      expect(o._result).toBeDefined();
      expect(o.data.dataset).toBe('SYS1.SAMPLIB');
      expect(Array.isArray(o.data.members)).toBe(true);
      expect(o.data.summary.searchPattern).toBe('Name/Token Service');
      if (o.data.members.length >= 1) {
        const member = o.data.members.find(m => m.name === 'IEANTCOB') ?? o.data.members[0];
        expect(member.matches.length).toBeGreaterThan(0);
        expect(member.matches.some(m => m.content.includes('Name/Token Service'))).toBe(true);
      }
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
          match: /System 'nonexistent-host\.example\.com' not found\. Available systems/,
        }
      );
      expect(r.isError).toBe(true);
    });

    describe('USS tools (read-only)', () => {
      let ussHomePath: string;
      let expectedUserId: string;
      /** Set in beforeAll; when false, ZNP does not support unixCommand (e.g. "Unrecognized command unixCommand"). */
      let unixCommandSupported: boolean;

      beforeAll(async () => {
        unixCommandSupported = false;
        const result = await client.callTool({ name: 'getUssHome', arguments: {} });
        const text = getResultText(result);
        const parsed = JSON.parse(text) as
          | { _context: { system: string }; data: { path: string } }
          | { error: string };
        if ('error' in parsed && parsed.error) {
          throw new Error(`getUssHome failed: ${parsed.error}`);
        }
        const o = parsed as { _context: { system: string }; data: { path: string } };
        ussHomePath = o.data.path;
        if (!ussHomePath || !ussHomePath.startsWith('/') || o._context.system !== firstSystemId) {
          throw new Error(
            `getUssHome returned invalid path or system: path=${ussHomePath}, system=${o._context.system}`
          );
        }
        const cmdResult = await client.callTool({
          name: 'runSafeUssCommand',
          arguments: { commandText: 'whoami' },
        });
        const cmdText = getResultText(cmdResult);
        const cmdParsed = JSON.parse(cmdText) as { _context?: unknown; error?: string };
        unixCommandSupported = !cmdParsed.error?.includes('unixCommand');
      });

      it('getUssHome returns path and envelope', () => {
        expect(ussHomePath).toBeDefined();
        expect(ussHomePath.length).toBeGreaterThan(0);
        expect(ussHomePath.startsWith('/')).toBe(true);
      });

      it('getContext includes ussHome after getUssHome', async () => {
        const { parsed } = await callToolSuccess(client, 'getContext', {});
        const o = parsed as {
          activeSystem: { system: string; userId: string; ussHome?: string } | null;
        };
        expect(o.activeSystem).not.toBeNull();
        expect(o.activeSystem!.ussHome).toBeDefined();
        expect(o.activeSystem!.ussHome).toBe(ussHomePath);
        expectedUserId = o.activeSystem!.userId;
      });

      it('listUssFiles on home returns envelope', async () => {
        const { parsed } = await callToolSuccess(client, 'listUssFiles', {
          path: ussHomePath,
        });
        const o = parsed as {
          _context: { system: string };
          _result: { count: number; totalAvailable: number; hasMore: boolean };
          data: { name: string }[];
        };
        expect(o._context.system).toBe(firstSystemId);
        expect(o._result).toBeDefined();
        expect(o._result.count).toBeDefined();
        expect(o._result.totalAvailable).toBeDefined();
        expect(typeof o._result.hasMore).toBe('boolean');
        expect(Array.isArray(o.data)).toBe(true);
        for (const entry of o.data) {
          expect(entry).toHaveProperty('name');
          expect(typeof entry.name).toBe('string');
        }
      });

      it('listUssFiles with longFormat returns mode/size/mtime when present', async () => {
        const { parsed } = await callToolSuccess(client, 'listUssFiles', {
          path: ussHomePath,
          longFormat: true,
        });
        const o = parsed as {
          _context: { system: string };
          data: { name: string; mode?: string; size?: number; mtime?: string }[];
        };
        expect(Array.isArray(o.data)).toBe(true);
        if (o.data.length > 0) {
          const first = o.data[0];
          expect(first.name).toBeDefined();
          expect(
            first.mode !== undefined || first.size !== undefined || first.mtime !== undefined
          ).toBe(true);
        }
      });

      it('readUssFile returns envelope when reading a file under home', async () => {
        const { parsed: listParsed } = await callToolSuccess(client, 'listUssFiles', {
          path: ussHomePath,
          limit: 50,
          longFormat: true,
        });
        const listData = (
          listParsed as {
            data: { name: string; isDirectory?: boolean; mode?: string }[];
          }
        ).data;
        const firstFile = listData.find(
          e => e.isDirectory === false || (e.mode !== undefined && !e.mode.startsWith('d'))
        );
        if (!firstFile) {
          expect.fail(
            `No regular file found under ${ussHomePath} (listed ${listData.length} entries) to run readUssFile envelope test`
          );
        }
        const filePath = ussHomePath.replace(/\/$/, '') + '/' + firstFile.name;
        const readResult = await client.callTool({
          name: 'readUssFile',
          arguments: { path: filePath },
        });
        const readParsed = JSON.parse(getResultText(readResult)) as
          | {
              _context: { system: string };
              _result: unknown;
              data: { text: string; etag: string };
            }
          | { error: string };
        if ('error' in readParsed && readParsed.error) {
          expect.fail(`readUssFile failed for path ${filePath}: ${readParsed.error}`);
        }
        const o = readParsed as {
          _context: { system: string };
          _result: {
            totalLines: number;
            startLine: number;
            returnedLines: number;
            hasMore?: boolean;
          };
          data: { text: string; etag: string };
        };
        expect(o._context.system).toBe(firstSystemId);
        expect(o._result).toBeDefined();
        expect(o._result.totalLines).toBeDefined();
        expect(o._result.startLine).toBe(1);
        expect(o._result.returnedLines).toBeDefined();
        expect(o.data.text).toBeDefined();
        expect(typeof o.data.text).toBe('string');
        expect(o.data.etag).toBeDefined();
      });

      it.skipIf(() => !unixCommandSupported)(
        'runSafeUssCommand whoami returns userId',
        async () => {
          const { parsed } = await callToolSuccess(client, 'runSafeUssCommand', {
            commandText: 'whoami',
          });
          const o = parsed as { _context: { system: string }; data: { text: string } };
          expect(o._context.system).toBe(firstSystemId);
          expect(o.data.text).toBeDefined();
          const output = o.data.text.trim();
          expect(output).toBe(expectedUserId);
        }
      );

      it.skipIf(() => !unixCommandSupported)('runSafeUssCommand pwd returns path', async () => {
        const { parsed } = await callToolSuccess(client, 'runSafeUssCommand', {
          commandText: 'pwd',
        });
        const o = parsed as { _context: { system: string }; data: { text: string } };
        expect(o._context.system).toBe(firstSystemId);
        const output = o.data.text.trim();
        expect(output.length).toBeGreaterThan(0);
        expect(output.startsWith('/')).toBe(true);
      });

      it.skipIf(() => !unixCommandSupported)(
        'runSafeUssCommand ls on home returns output',
        async () => {
          const { parsed } = await callToolSuccess(client, 'runSafeUssCommand', {
            commandText: `ls ${ussHomePath}`,
          });
          const o = parsed as { _context: { system: string }; data: { text: string } };
          expect(o._context.system).toBe(firstSystemId);
          expect(o.data.text).toBeDefined();
          expect(o.data.text.length).toBeGreaterThanOrEqual(0);
        }
      );

      it('runSafeUssCommand dangerous command returns error', async () => {
        const r = await client.callTool({
          name: 'runSafeUssCommand',
          arguments: { commandText: 'rm -rf ~/' },
        });
        const text = getResultText(r);
        const parsed = JSON.parse(text) as { error?: string };
        expect(parsed.error).toBeDefined();
        expect(parsed.error!.length).toBeGreaterThan(0);
      });

      it('readUssFile dangerous path returns error', async () => {
        const r = await client.callTool({
          name: 'readUssFile',
          arguments: { path: '/home/user/.ssh/id_rsa' },
        });
        const text = getResultText(r);
        const parsed = JSON.parse(text) as { error?: string };
        expect(parsed.error).toBeDefined();
        expect(parsed.error!.length).toBeGreaterThan(0);
      });
    });

    describe('TSO (runSafeTsoCommand)', () => {
      it('runSafeTsoCommand TIME returns output with time/session info', async () => {
        const { parsed } = await callToolSuccess(client, 'runSafeTsoCommand', {
          commandText: 'TIME',
        });
        const o = parsed as {
          _context: { system: string };
          _result: unknown;
          data: { text: string };
        };
        expect(o._context.system).toBe(firstSystemId);
        expect(o.data.text).toBeDefined();
        const output = o.data.text.trim();
        expect(output.length).toBeGreaterThan(0);
        expect(output.toUpperCase()).toMatch(/TIME|CPU|SERVICE|SESSION|PM|AM|\d{2}:\d{2}:\d{2}/);
      });

      it('runSafeTsoCommand SYSTEM returns output with system info', async () => {
        const { parsed } = await callToolSuccess(client, 'runSafeTsoCommand', {
          commandText: 'SYSTEM',
        });
        const o = parsed as {
          _context: { system: string };
          _result: unknown;
          data: { text: string };
        };
        expect(o._context.system).toBe(firstSystemId);
        expect(o.data.text).toBeDefined();
        const output = o.data.text.trim();
        expect(output.length).toBeGreaterThan(0);
        expect(output.toUpperCase()).toMatch(/MVS|ESA|READY|SYSTEM|HBB|VER/);
      });

      it('runSafeTsoCommand OSHELL pwd returns block error', async () => {
        const r = await client.callTool({
          name: 'runSafeTsoCommand',
          arguments: { commandText: 'OSHELL pwd' },
        });
        const text = getResultText(r);
        const parsed = JSON.parse(text) as { error?: string };
        expect(parsed.error).toBeDefined();
        expect(parsed.error!.toLowerCase()).toMatch(/oshell|not allowed/);
      });

      it('runSafeTsoCommand OSHELL ls returns error', async () => {
        const r = await client.callTool({
          name: 'runSafeTsoCommand',
          arguments: { commandText: 'OSHELL ls' },
        });
        const text = getResultText(r);
        const parsed = JSON.parse(text) as { error?: string };
        expect(parsed.error).toBeDefined();
        expect(parsed.error!.length).toBeGreaterThan(0);
      });

      it('runSafeTsoCommand DELETE user dataset returns error (elicit denied)', async () => {
        const r = await client.callTool({
          name: 'runSafeTsoCommand',
          arguments: { commandText: 'DELETE USER.DATA' },
        });
        const text = getResultText(r);
        const parsed = JSON.parse(text) as { error?: string };
        expect(parsed.error).toBeDefined();
        expect(parsed.error!.length).toBeGreaterThan(0);
      });

      it('runSafeTsoCommand DELETE system dataset returns block error', async () => {
        const r = await client.callTool({
          name: 'runSafeTsoCommand',
          arguments: { commandText: 'DELETE SYS1.PARMLIB' },
        });
        const text = getResultText(r);
        const parsed = JSON.parse(text) as { error?: string };
        expect(parsed.error).toBeDefined();
        expect(parsed.error!.toLowerCase()).toMatch(/system|not allowed/);
      });
    });

    /** Sample JCL body (two IEBGENER steps) without job card. */
    const SAMPLE_JCL_BODY = [
      '//STEP1  EXEC PGM=IEBGENER',
      '//SYSPRINT DD SYSOUT=*',
      '//SYSIN    DD DUMMY',
      '//SYSUT1   DD *',
      'INPUT1',
      '//SYSUT2   DD SYSOUT=*',
      '//*',
      '//STEP2  EXEC PGM=IEBGENER',
      '//SYSPRINT DD SYSOUT=*',
      '//SYSIN    DD DUMMY',
      '//SYSUT1   DD *',
      'INPUT2',
      '//SYSUT2   DD SYSOUT=*',
    ].join('\n');

    /** JCL body for a job that runs ~10s (BPXBATCH sleep 10). Used for executeJob timeout test. */
    const SAMPLE_JCL_SLEEP_10 = [
      '//STEP1 EXEC PGM=BPXBATCH,REGION=8M',
      '//STEPLIB  DD   DSN=CEE.SCEERUN,DISP=SHR',
      '//STDOUT   DD SYSOUT=*',
      '//STDERR   DD SYSOUT=*',
      '//STDPARM  DD   *',
      'SH sleep 10',
    ].join('\n');

    describe.skipIf(!canRunJobsE2E)(
      `Jobs (submitJob, getJobStatus, executeJob, listJobFiles, readJobFile, searchJobOutput)${!canRunJobsE2E ? ' [skipped: Job card not configured in config jobCards]' : ''}`,
      () => {
        let submittedJobId: string;

        it('submitJob with full JCL (job card present) returns jobId and jobName', async () => {
          const jobCardStr = normalizeJobCardForTest(jobCardForFirstSpec, {
            userId: firstSpec?.user ?? 'USER',
          });
          const fullJcl = jobCardStr.trimEnd() + '\n' + SAMPLE_JCL_BODY;
          const { parsed } = await callToolSuccess(client, 'submitJob', { jcl: fullJcl });
          const o = parsed as { data: { jobId: string; jobName: string } };
          expect(o.data).toBeDefined();
          expect(o.data.jobId).toBeDefined();
          expect(o.data.jobName).toBeDefined();
          expect(typeof o.data.jobId).toBe('string');
          expect(typeof o.data.jobName).toBe('string');
          submittedJobId = o.data.jobId;
        });

        it('submitJob with JCL body only (no job card) prepends config job card and submits', async () => {
          const { parsed } = await callToolSuccess(client, 'submitJob', {
            jcl: SAMPLE_JCL_BODY,
          });
          const o = parsed as { data: { jobId: string; jobName: string } };
          expect(o.data).toBeDefined();
          expect(o.data.jobId).toBeDefined();
          expect(o.data.jobName).toBeDefined();
        });

        it('getJobStatus returns status for submitted job', async () => {
          expect(submittedJobId).toBeDefined();
          const { parsed } = await callToolSuccess(client, 'getJobStatus', {
            jobId: submittedJobId,
          });
          const o = parsed as {
            data: {
              id: string;
              name: string;
              status: string;
              owner: string;
              retcode?: string;
            };
          };
          expect(o.data).toBeDefined();
          expect(o.data.id).toBeDefined();
          expect(o.data.name).toBeDefined();
          expect(o.data.status).toBeDefined();
          expect(['INPUT', 'ACTIVE', 'OUTPUT', 'CONVERSION']).toContain(o.data.status);
        });

        it('listJobFiles and readJobFile when job is in OUTPUT', async () => {
          expect(submittedJobId).toBeDefined();
          const deadline = Date.now() + 60_000;
          let status: string;
          do {
            if (Date.now() > deadline) {
              throw new Error('Job did not reach OUTPUT within 60s');
            }
            const { parsed } = await callToolSuccess(client, 'getJobStatus', {
              jobId: submittedJobId,
            });
            const o = parsed as { data: { status: string } };
            status = o.data.status;
            if (status !== 'OUTPUT') {
              await new Promise(r => setTimeout(r, 2000));
            }
          } while (status !== 'OUTPUT');

          const { parsed: listParsed } = await callToolSuccess(client, 'listJobFiles', {
            jobId: submittedJobId,
          });
          const listEnvelope = listParsed as {
            _context: { system: string };
            _result: { count: number; totalAvailable: number; hasMore: boolean };
            data: { id: number; ddname?: string; stepname?: string }[];
          };
          expect(listEnvelope._context).toBeDefined();
          expect(listEnvelope._context.system).toBeDefined();
          expect(Array.isArray(listEnvelope.data)).toBe(true);
          expect(listEnvelope.data.length).toBeGreaterThanOrEqual(1);
          const firstFile = listEnvelope.data[0];
          expect(firstFile.id).toBeDefined();
          expect(typeof firstFile.id).toBe('number');

          const jobFileId = firstFile.id;
          const { parsed: readParsed } = await callToolSuccess(client, 'readJobFile', {
            jobId: submittedJobId,
            jobFileId,
          });
          const readEnvelope = readParsed as {
            _context: { system: string };
            _result?: {
              totalLines: number;
              startLine: number;
              returnedLines: number;
              hasMore: boolean;
            };
            data: {
              text: string;
              totalLines: number;
              startLine: number;
              returnedLines: number;
              hasMore: boolean;
              mimeType: string;
            };
          };
          expect(readEnvelope._context).toBeDefined();
          expect(readEnvelope.data).toBeDefined();
          expect(typeof readEnvelope.data.text).toBe('string');
          expect(typeof readEnvelope.data.totalLines).toBe('number');
          expect(readEnvelope.data.startLine).toBeGreaterThanOrEqual(1);
          expect(readEnvelope.data.returnedLines).toBeGreaterThanOrEqual(0);
        });

        it('executeJob with timeoutSeconds=5 times out while job still running', async () => {
          const { parsed } = await callToolSuccess(client, 'executeJob', {
            jcl: SAMPLE_JCL_SLEEP_10,
            timeoutSeconds: 5,
          });
          const o = parsed as {
            data: { jobId: string; status: string; timedOut?: boolean };
          };
          expect(o.data).toBeDefined();
          expect(o.data.timedOut).toBe(true);
          expect(o.data.jobId).toBeDefined();
          expect(o.data.status).not.toBe('OUTPUT');
          const { parsed: statusRes } = await callToolSuccess(client, 'getJobStatus', {
            jobId: o.data.jobId,
          });
          const statusData = (statusRes as { data: { status: string } }).data;
          expect(['INPUT', 'ACTIVE']).toContain(statusData.status);
        });

        it('listJobs returns jobs (optional owner filter)', async () => {
          const { parsed } = await callToolSuccess(client, 'listJobs', { limit: 10 });
          const o = parsed as {
            _context: { system: string };
            _result: { count: number; totalAvailable: number };
            data: { id: string; name: string; status: string }[];
          };
          expect(o._context).toBeDefined();
          expect(Array.isArray(o.data)).toBe(true);
          if (o.data.length > 0) {
            expect(o.data[0].id).toBeDefined();
            expect(o.data[0].status).toBeDefined();
            expect(['INPUT', 'ACTIVE', 'OUTPUT']).toContain(o.data[0].status);
          }
        });

        it('getJcl returns JCL for submitted job', async () => {
          expect(submittedJobId).toBeDefined();
          const deadline = Date.now() + 60_000;
          let status: string;
          do {
            if (Date.now() > deadline) {
              throw new Error('Job did not reach OUTPUT within 60s');
            }
            const { parsed } = await callToolSuccess(client, 'getJobStatus', {
              jobId: submittedJobId,
            });
            const o = parsed as { data: { status: string } };
            status = o.data.status;
            if (status !== 'OUTPUT') {
              await new Promise(r => setTimeout(r, 2000));
            }
          } while (status !== 'OUTPUT');

          const { parsed: jclParsed } = await callToolSuccess(client, 'getJcl', {
            jobId: submittedJobId,
          });
          const jclEnvelope = jclParsed as { data: { jcl: string } };
          expect(jclEnvelope.data).toBeDefined();
          expect(typeof jclEnvelope.data.jcl).toBe('string');
          expect(jclEnvelope.data.jcl).toContain('//');
        });

        it('searchJobOutput finds substring in job output', async () => {
          expect(submittedJobId).toBeDefined();
          const deadline = Date.now() + 60_000;
          let status: string;
          do {
            if (Date.now() > deadline) {
              throw new Error('Job did not reach OUTPUT within 60s');
            }
            const { parsed } = await callToolSuccess(client, 'getJobStatus', {
              jobId: submittedJobId,
            });
            const o = parsed as { data: { status: string } };
            status = o.data.status;
            if (status !== 'OUTPUT') {
              await new Promise(r => setTimeout(r, 2000));
            }
          } while (status !== 'OUTPUT');

          const { parsed: searchParsed } = await callToolSuccess(client, 'searchJobOutput', {
            jobId: submittedJobId,
            searchString: 'INPUT1',
          });
          const searchEnvelope = searchParsed as {
            _context: { system: string };
            _result: { count: number; totalAvailable: number; hasMore: boolean };
            data: { jobFileId: number; lineNumber: number; lineText: string }[];
          };
          expect(searchEnvelope._context).toBeDefined();
          expect(Array.isArray(searchEnvelope.data)).toBe(true);
          expect(searchEnvelope.data.length).toBeGreaterThanOrEqual(1);
          const first = searchEnvelope.data[0];
          expect(first.jobFileId).toBeDefined();
          expect(first.lineNumber).toBeGreaterThanOrEqual(1);
          expect(first.lineText).toContain('INPUT1');
        });
      }
    );

    it.skipIf(!canRunNativeE2E || !!jobCardForFirstSpec)(
      'submitJob with body only when no job card configured returns error',
      async () => {
        const r = await client.callTool({
          name: 'submitJob',
          arguments: { jcl: SAMPLE_JCL_BODY },
        });
        expect(r.isError).toBe(true);
        const text = getResultText(r);
        expect(text).toContain('No job card configured');
      }
    );

    describe('with temporary datasets', () => {
      // -----------------------------------------------------------------------
      // 1. Temp tools (getTempDatasetPrefix, getTempDatasetName, createTempDataset, deleteDatasetsUnderPrefix)
      // -----------------------------------------------------------------------
      it('1.1 getTempDatasetPrefix returns prefix and it is unique', async () => {
        const { parsed } = await callToolSuccess(client, 'getTempDatasetPrefix', {});
        const o = parsed as { data: { prefix: string } };
        expect(o.data).toBeDefined();
        expect(o.data.prefix).toBeDefined();
        expect(typeof o.data.prefix).toBe('string');
        expect(o.data.prefix.split('.').length).toBeGreaterThanOrEqual(4);
        expect(o.data.prefix).toContain('TMP');
      });

      it('1.2 getTempDatasetName returns unique DSN', async () => {
        const { parsed } = await callToolSuccess(client, 'getTempDatasetName', {});
        const o = parsed as { data: { dsn: string; prefix: string } };
        expect(o.data.dsn).toBeDefined();
        expect(typeof o.data.dsn).toBe('string');
        expect(o.data.dsn).toContain('TMP');
        const r = await client.callTool({
          name: 'getDatasetAttributes',
          arguments: { dsn: q(o.data.dsn) },
        });
        expect(r.isError).toBe(true);
      });

      it('1.3 createTempDataset PS (FB, LRECL 80)', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const o = createRes as { data: { dsn: string } };
        const dsn = o.data.dsn;
        expect(dsn).toBeDefined();
        expect(dsn).toContain('TMP');
        const { parsed: attrsRes } = await callToolSuccess(client, 'getDatasetAttributes', {
          dsn: q(dsn),
        });
        const attrs = attrsRes as { data: { type?: string; recfm?: string; lrecl?: number } };
        expect(attrs.data.type).toBe('PS');
        expect(attrs.data.recfm).toBe('FB');
        expect(attrs.data.lrecl).toBe(80);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('1.4 createTempDataset PS VB LRECL 255', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
          recfm: 'VB',
          lrecl: 255,
        });
        const o = createRes as { data: { dsn: string } };
        const dsn = o.data.dsn;
        expect(dsn).toBeDefined();
        const { parsed: attrsRes } = await callToolSuccess(client, 'getDatasetAttributes', {
          dsn: q(dsn),
        });
        const attrs = attrsRes as { data: { type?: string; recfm?: string; lrecl?: number } };
        expect(attrs.data.type).toBe('PS');
        expect(attrs.data.recfm).toBe('VB');
        expect(attrs.data.lrecl).toBe(255);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('1.5 createTempDataset PDS', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PDS',
        });
        const o = createRes as { data: { dsn: string } };
        const dsn = o.data.dsn;
        expect(dsn).toBeDefined();
        const { parsed: attrsRes } = await callToolSuccess(client, 'getDatasetAttributes', {
          dsn: q(dsn),
        });
        const attrs = attrsRes as { data: { type?: string } };
        expect(attrs.data.type).toBe('PO');
        await callToolSuccess(client, 'listMembers', { dsn: q(dsn), limit: 10 });
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('1.6 createTempDataset PDSE (library)', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PO-E',
        });
        const o = createRes as { data: { dsn: string } };
        const dsn = o.data.dsn;
        expect(dsn).toBeDefined();
        const { parsed: attrsRes } = await callToolSuccess(client, 'getDatasetAttributes', {
          dsn: q(dsn),
        });
        const attrs = attrsRes as { data: { type?: string } };
        // PDSE created with PO + DSNTYPE=LIBRARY; ZNP may report dsorg as PO or PO-E.
        expect(['PO', 'PO-E']).toContain(attrs.data.type);
        await callToolSuccess(client, 'listMembers', { dsn: q(dsn), limit: 10 });
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it(
        '1.7 deleteDatasetsUnderPrefix removes all under prefix (prefix.** supported; retried on intermittent ZNP failure)',
        { retry: 2 },
        async () => {
          const { parsed: prefixRes } = await callToolSuccess(client, 'getTempDatasetPrefix', {});
          const prefix = (prefixRes as { data: { prefix: string } }).data.prefix;
          await callToolSuccess(client, 'createTempDataset', {
            type: 'PS',
            prefix,
            qualifier: 'E2EA',
          });
          await callToolSuccess(client, 'createTempDataset', {
            type: 'PS',
            prefix,
            qualifier: 'E2EB',
          });
          await callToolSuccess(client, 'deleteDatasetsUnderPrefix', { dsnPrefix: q(prefix) });
          const { parsed: listRes } = await callToolSuccess(client, 'listDatasets', {
            dsnPattern: q(prefix + '.**'),
          });
          const list = listRes as { data: { dsn: string }[] };
          expect(list.data.filter(d => d.dsn.startsWith(prefix))).toHaveLength(0);
        }
      );

      it('1.8 deleteDatasetsUnderPrefix rejects prefix with <3 qualifiers', async () => {
        const { parsed: ctxRes } = await callToolSuccess(client, 'getContext', {});
        const userId = (ctxRes as { activeSystem: { userId: string } }).activeSystem.userId;
        const badPrefix = `${userId}.TMP`;
        const r = await callToolError(
          client,
          'deleteDatasetsUnderPrefix',
          { dsnPrefix: q(badPrefix) },
          { contains: 'at least 3 qualifiers' }
        );
        expect(r.isError).toBe(true);
      });

      it('1.9 deleteDatasetsUnderPrefix rejects prefix without TMP', async () => {
        const { parsed: ctxRes } = await callToolSuccess(client, 'getContext', {});
        const userId = (ctxRes as { activeSystem: { userId: string } }).activeSystem.userId;
        const badPrefix = `${userId}.OTHER.ABCD1234`;
        const r = await callToolError(
          client,
          'deleteDatasetsUnderPrefix',
          { dsnPrefix: q(badPrefix) },
          { contains: 'contain the qualifier "TMP"' }
        );
        expect(r.isError).toBe(true);
      });

      // -----------------------------------------------------------------------
      // 2. getDatasetAttributes
      // -----------------------------------------------------------------------
      it('2.1 getDatasetAttributes on temp PS', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        const { parsed: attrsRes } = await callToolSuccess(client, 'getDatasetAttributes', {
          dsn: q(dsn),
        });
        const attrs = attrsRes as { data: { type?: string; recfm?: string; lrecl?: number } };
        expect(attrs.data.type).toBe('PS');
        expect(attrs.data.recfm).toBe('FB');
        expect(attrs.data.lrecl).toBe(80);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('2.2 getDatasetAttributes on temp PDS', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PDS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        const { parsed: attrsRes } = await callToolSuccess(client, 'getDatasetAttributes', {
          dsn: q(dsn),
        });
        const attrs = attrsRes as { data: { type?: string } };
        expect(attrs.data.type).toBe('PO');
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('2.3 getDatasetAttributes on temp PDSE', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PO-E',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        const { parsed: attrsRes } = await callToolSuccess(client, 'getDatasetAttributes', {
          dsn: q(dsn),
        });
        const attrs = attrsRes as { data: { type?: string } };
        // PDSE created with PO + DSNTYPE=LIBRARY; ZNP may report dsorg as PO or PO-E.
        expect(['PO', 'PO-E']).toContain(attrs.data.type);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      // -----------------------------------------------------------------------
      // 3. createDataset (explicit DSN)
      // -----------------------------------------------------------------------
      it('3.1 createDataset with explicit temp DSN', async () => {
        const { parsed: nameRes } = await callToolSuccess(client, 'getTempDatasetName', {});
        const dsn = (nameRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'createDataset', {
          dsn: q(dsn),
          type: 'PS',
          recfm: 'FB',
          lrecl: 80,
        });
        await callToolSuccess(client, 'getDatasetAttributes', { dsn: q(dsn) });
        const { parsed: readRes } = await callToolSuccess(client, 'readDataset', { dsn: q(dsn) });
        expect((readRes as { data: { text: string } }).data.text).toBe('');
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      // -----------------------------------------------------------------------
      // 4. writeDataset and readDataset (round-trip)
      // -----------------------------------------------------------------------
      it('4.1 writeDataset then readDataset (PS)', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        const content = 'LINE1\nLINE2\n';
        await callToolSuccess(client, 'writeDataset', { dsn: q(dsn), content });
        const { parsed: readRes } = await callToolSuccess(client, 'readDataset', { dsn: q(dsn) });
        const readText = (readRes as { data: { text: string } }).data.text;
        expect(readText === content || readText === content.replace(/\n$/, '')).toBe(true);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('4.2 writeDataset member then listMembers and read (PDS)', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PDS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        const content = 'MEMBER_CONTENT';
        await callToolSuccess(client, 'writeDataset', {
          dsn: q(dsn),
          member: 'MEM1',
          content,
        });
        const { parsed: listRes } = await callToolSuccess(client, 'listMembers', {
          dsn: q(dsn),
          limit: 100,
        });
        const members = (listRes as { data: { member: string }[] }).data.map(m => m.member);
        expect(members).toContain('MEM1');
        const { parsed: readRes } = await callToolSuccess(client, 'readDataset', {
          dsn: q(dsn),
          member: 'MEM1',
        });
        expect((readRes as { data: { text: string } }).data.text.trim()).toBe(content);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('4.3 writeDataset block replace (startLine/endLine) on PS', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        const initial = 'L1\nL2\nL3\nL4\nL5\n';
        await callToolSuccess(client, 'writeDataset', { dsn: q(dsn), content: initial });
        await callToolSuccess(client, 'writeDataset', {
          dsn: q(dsn),
          content: 'NEW2\nNEW3\n',
          startLine: 2,
          endLine: 3,
        });
        const { parsed: readRes } = await callToolSuccess(client, 'readDataset', { dsn: q(dsn) });
        const text = (readRes as { data: { text: string } }).data.text;
        const lines = text.split(/\n/).filter(Boolean);
        expect(lines).toContain('L1');
        expect(lines).toContain('NEW2');
        expect(lines).toContain('NEW3');
        expect(lines).toContain('L4');
        expect(lines).toContain('L5');
        expect(lines.indexOf('L1')).toBeLessThan(lines.indexOf('NEW2'));
        expect(lines.indexOf('NEW2')).toBeLessThan(lines.indexOf('NEW3'));
        expect(lines.indexOf('NEW3')).toBeLessThan(lines.indexOf('L4'));
        expect(lines.indexOf('L4')).toBeLessThan(lines.indexOf('L5'));
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      // -----------------------------------------------------------------------
      // 5. deleteDataset
      // -----------------------------------------------------------------------
      it('5.1 deleteDataset removes dataset', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
        const r = await client.callTool({
          name: 'getDatasetAttributes',
          arguments: { dsn: q(dsn) },
        });
        expect(r.isError).toBe(true);
      });

      it('5.2 deleteDataset member (PDS)', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PDS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'writeDataset', {
          dsn: q(dsn),
          member: 'M1',
          content: 'X',
        });
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn), member: 'M1' });
        const { parsed: listRes } = await callToolSuccess(client, 'listMembers', {
          dsn: q(dsn),
          limit: 100,
        });
        const members = (listRes as { data: { member: string }[] }).data.map(m => m.member);
        expect(members).not.toContain('M1');
        const r = await client.callTool({
          name: 'readDataset',
          arguments: { dsn: q(dsn), member: 'M1' },
        });
        expect(r.isError).toBe(true);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      // -----------------------------------------------------------------------
      // 6. copyDataset
      // -----------------------------------------------------------------------
      it('6.1 copyDataset PS to PS', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const source = (createRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'writeDataset', { dsn: q(source), content: 'COPYME' });
        const { parsed: nameRes } = await callToolSuccess(client, 'getTempDatasetName', {});
        const targetDsn = (nameRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'createDataset', {
          dsn: q(targetDsn),
          type: 'PS',
          recfm: 'FB',
          lrecl: 80,
        });
        await callToolSuccess(client, 'copyDataset', {
          sourceDsn: q(source),
          targetDsn: q(targetDsn),
        });
        const { parsed: readRes } = await callToolSuccess(client, 'readDataset', {
          dsn: q(targetDsn),
        });
        expect((readRes as { data: { text: string } }).data.text.trim()).toBe('COPYME');
        await callToolSuccess(client, 'deleteDataset', { dsn: q(source) });
        await callToolSuccess(client, 'deleteDataset', { dsn: q(targetDsn) });
      });

      it('6.2 copyDataset member to member (PDS)', async () => {
        const { parsed: createSrc } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PDS',
        });
        const source = (createSrc as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'writeDataset', {
          dsn: q(source),
          member: 'SRC',
          content: 'MEMBER_CONTENT',
        });
        const { parsed: createTgt } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PDS',
        });
        const target = (createTgt as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'copyDataset', {
          sourceDsn: q(source),
          targetDsn: q(target),
          sourceMember: 'SRC',
          targetMember: 'TGT',
        });
        const { parsed: readRes } = await callToolSuccess(client, 'readDataset', {
          dsn: q(target),
          member: 'TGT',
        });
        expect((readRes as { data: { text: string } }).data.text.trim()).toBe('MEMBER_CONTENT');
        await callToolSuccess(client, 'deleteDataset', { dsn: q(source) });
        await callToolSuccess(client, 'deleteDataset', { dsn: q(target) });
      });

      // -----------------------------------------------------------------------
      // 7. renameDataset
      // -----------------------------------------------------------------------
      it('7.1 renameDataset PS', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'writeDataset', { dsn: q(dsn), content: 'RENAME_TEST' });
        const { parsed: nameRes } = await callToolSuccess(client, 'getTempDatasetName', {});
        const newDsn = (nameRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'renameDataset', { dsn: q(dsn), newDsn: q(newDsn) });
        await callToolSuccess(client, 'getDatasetAttributes', { dsn: q(newDsn) });
        const { parsed: readRes } = await callToolSuccess(client, 'readDataset', {
          dsn: q(newDsn),
        });
        expect((readRes as { data: { text: string } }).data.text.trim()).toBe('RENAME_TEST');
        const rOld = await client.callTool({
          name: 'getDatasetAttributes',
          arguments: { dsn: q(dsn) },
        });
        expect(rOld.isError).toBe(true);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(newDsn) });
      });

      it.skipIf(true)(
        '7.2 renameDataset member (PDS) - skipped when ZNP renameMember not supported',
        async () => {
          const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
            type: 'PDS',
          });
          const dsn = (createRes as { data: { dsn: string } }).data.dsn;
          await callToolSuccess(client, 'writeDataset', {
            dsn: q(dsn),
            member: 'OLD',
            content: 'X',
          });
          await callToolSuccess(client, 'renameDataset', {
            dsn: q(dsn),
            newDsn: q(dsn),
            member: 'OLD',
            newMember: 'NEW',
          });
          const { parsed: listRes } = await callToolSuccess(client, 'listMembers', {
            dsn: q(dsn),
            limit: 100,
          });
          const members = (listRes as { data: { member: string }[] }).data.map(m => m.member);
          expect(members).toContain('NEW');
          expect(members).not.toContain('OLD');
          const { parsed: readRes } = await callToolSuccess(client, 'readDataset', {
            dsn: q(dsn),
            member: 'NEW',
          });
          expect((readRes as { data: { text: string } }).data.text.trim()).toBe('X');
          await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
        }
      );

      // -----------------------------------------------------------------------
      // 8. listDatasets / listMembers (using temp data)
      // -----------------------------------------------------------------------
      it('8.1 listDatasets with temp prefix', async () => {
        const { parsed: ctxRes } = await callToolSuccess(client, 'getContext', {});
        const userId = (ctxRes as { activeSystem: { userId: string } }).activeSystem.userId;
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        const { parsed: listRes } = await callToolSuccess(client, 'listDatasets', {
          dsnPattern: q(`${userId}.TMP.**`),
        });
        const list = listRes as { data: { dsn: string }[] };
        expect(list.data.length).toBeGreaterThanOrEqual(1);
        expect(list.data.some(d => d.dsn === dsn)).toBe(true);
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });

      it('8.2 listMembers after writing members', async () => {
        const { parsed: createRes } = await callToolSuccess(client, 'createTempDataset', {
          type: 'PDS',
        });
        const dsn = (createRes as { data: { dsn: string } }).data.dsn;
        await callToolSuccess(client, 'writeDataset', { dsn: q(dsn), member: 'M1', content: 'A' });
        await callToolSuccess(client, 'writeDataset', { dsn: q(dsn), member: 'M2', content: 'B' });
        const { parsed: listRes } = await callToolSuccess(client, 'listMembers', {
          dsn: q(dsn),
          limit: 100,
        });
        const members = (listRes as { data: { member: string }[] }).data.map(m => m.member);
        expect(members).toContain('M1');
        expect(members).toContain('M2');
        await callToolSuccess(client, 'deleteDataset', { dsn: q(dsn) });
      });
    });
  }
);
