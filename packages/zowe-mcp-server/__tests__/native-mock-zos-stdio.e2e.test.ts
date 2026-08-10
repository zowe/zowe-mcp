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
 * Native (zowex/SSH) backend stdio E2E test against the in-repo mock z/OS SSH
 * host — unlike native-stdio.e2e.test.ts, this test is NOT gated behind
 * ZOWE_MCP_RUN_NATIVE_STDIO_E2E or a real LPAR config. It spins up
 * `spawnMockZos` in-process on an ephemeral port, then spawns the real MCP
 * server binary in `--native --stdio` mode pointed at that mock, driving it
 * entirely over the MCP stdio protocol (StdioClientTransport).
 *
 * This exercises the production RPC-over-SSH code path (zowex-sdk + `ssh2` +
 * the mock's JSON-RPC dispatcher) against the mock instead of a real
 * mainframe, so it runs unconditionally in `npm test`.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toPasswordEnvVarName } from '../src/zos/native/connection-spec.js';
import { disposeMockZos, spawnMockZos, type SpawnedMockZos } from './helpers/spawn-mock-zos.js';

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
  if (result.isError) {
    throw new Error(`Tool ${name} failed: ${getResultText(result)}`);
  }
  const parsed = JSON.parse(getResultText(result)) as unknown;
  return { result, parsed };
}

const MOCK_HOST = '127.0.0.1';
const MOCK_USER = 'USER1';

// Seed a PDS-E with one COBOL member and a sequential dataset so the test can
// exercise listDatasets/listMembers/readDataset against known, deterministic
// content (rather than relying on gen-fixtures's default sample data, which
// is meant for the CLI demo flow, not asserted-on test fixtures).
const SEEDED_PDS_DSN = 'USER1.SAMPLE.COBOL';
const SEEDED_MEMBER = 'HELLO';
const SEEDED_MEMBER_BODY = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. HELLO.',
  '       PROCEDURE DIVISION.',
  '           DISPLAY "HELLO FROM MOCK ZOS".',
  '           STOP RUN.',
].join('\n');
const SEEDED_SEQ_DSN = 'USER1.NOTES.TXT';
const SEEDED_SEQ_CONTENT = 'This is a note seeded for the native-mock-zos-stdio e2e test.\n';

// USS home dir content for USER1 (systemId 'sys1', home '/u/user1' — see
// DEFAULT_USERS in helpers/spawn-mock-zos.ts). spawnMockZos only seeds
// datasets via `seedDatasets`; the USS tree has to be written directly onto
// FilesystemMockBackend's on-disk layout (`<mockDir>/uss/<systemId>/<path>`)
// so getUssHome/listUssFiles/readUssFile have something to find.
const SEEDED_USS_FILE = 'README.txt';
const SEEDED_USS_CONTENT = 'Hello from the mock USS home directory.\n';

describe('Zowe MCP Server (native backend against mock z/OS, stdio E2E)', () => {
  let mock: SpawnedMockZos;
  let client: Client;

  beforeAll(async () => {
    mock = await spawnMockZos({
      seedDatasets: [
        {
          dsn: SEEDED_PDS_DSN,
          dsorg: 'PO-E',
          members: { [SEEDED_MEMBER]: SEEDED_MEMBER_BODY },
        },
        {
          dsn: SEEDED_SEQ_DSN,
          dsorg: 'PS',
          content: SEEDED_SEQ_CONTENT,
        },
      ],
    });

    const ussHomeDir = resolve(mock.mockDir, 'uss', 'sys1', 'u', 'user1');
    await fs.mkdir(ussHomeDir, { recursive: true });
    await fs.writeFile(resolve(ussHomeDir, SEEDED_USS_FILE), SEEDED_USS_CONTENT);

    const systemSpec = `${MOCK_USER}@${MOCK_HOST}:${mock.sshPort}`;
    const passwordEnvVar = toPasswordEnvVarName(MOCK_USER, MOCK_HOST);

    const transport = new StdioClientTransport({
      command: 'node',
      args: [
        serverPath,
        '--stdio',
        '--native',
        '--system',
        systemSpec,
        '--capability-tier',
        'full',
      ],
      env: {
        ...process.env,
        // Force password auth so a developer's real ~/.ssh keys never interfere
        // with the mock's authorizedKeys catalog.
        ZOWE_MCP_DISABLE_SSH_KEY: '1',
        [passwordEnvVar]: 'password',
      } as Record<string, string>,
    });
    client = new Client({ name: 'e2e-native-mock-test', version: '1.0.0' });
    await client.connect(transport);
  }, 120_000);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (mock) {
      await disposeMockZos(mock);
    }
  }, 60_000);

  it('tools/list returns the expected native/zowex tool set', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('listDatasets');
    expect(names).toContain('listMembers');
    expect(names).toContain('readDataset');
    expect(names).toContain('getContext');
    expect(names).toContain('listSystems');
    expect(names).toContain('setSystem');
    expect(names).toContain('getUssHome');
    expect(names).toContain('listUssFiles');
    expect(names).toContain('readUssFile');
    expect(names).toContain('listJobs');
  }, 60_000);

  it('getContext reports the zowex native backend', async () => {
    const { parsed } = await callToolSuccess(client, 'getContext', {});
    const o = parsed as {
      server: { name: string; backend: string | null; components: string[] };
    };
    expect(o.server.name).toBe('Zowe MCP Server');
    expect(o.server.backend).toBe('zowex');
    expect(o.server.components).toContain('datasets');
    expect(o.server.components).toContain('uss');
    expect(o.server.components).toContain('jobs');
  }, 60_000);

  it('setSystem activates the mock system', async () => {
    const { parsed } = await callToolSuccess(client, 'setSystem', { system: MOCK_HOST });
    const o = parsed as { activeSystem: string; userId: string };
    expect(o.activeSystem).toBe(MOCK_HOST);
    expect(o.userId.toUpperCase()).toBe(MOCK_USER);
  }, 60_000);

  it('listDatasets finds the seeded PDS and sequential dataset', async () => {
    const { parsed } = await callToolSuccess(client, 'listDatasets', {
      dsnPattern: "'USER1.*'",
    });
    const o = parsed as {
      _context: { resolvedPattern?: string };
      data: { dsn: string }[];
    };
    expect(o._context).toBeDefined();
    const dsns = o.data.map(d => d.dsn);
    expect(dsns).toContain(SEEDED_PDS_DSN);
    expect(dsns).toContain(SEEDED_SEQ_DSN);
  }, 60_000);

  it('listMembers finds the seeded HELLO member', async () => {
    const { parsed } = await callToolSuccess(client, 'listMembers', {
      dsn: `'${SEEDED_PDS_DSN}'`,
    });
    const o = parsed as { data: { member: string }[] };
    const members = o.data.map(m => m.member);
    expect(members).toContain(SEEDED_MEMBER);
  }, 60_000);

  it('readDataset returns the seeded member content', async () => {
    const { parsed } = await callToolSuccess(client, 'readDataset', {
      dsn: `'${SEEDED_PDS_DSN}'`,
      member: SEEDED_MEMBER,
    });
    const o = parsed as { data: { lines: string[] } };
    const text = o.data.lines.join('\n');
    expect(text).toContain('PROGRAM-ID. HELLO');
    expect(text).toContain('HELLO FROM MOCK ZOS');
  }, 60_000);

  it('readDataset returns the seeded sequential dataset content', async () => {
    const { parsed } = await callToolSuccess(client, 'readDataset', {
      dsn: `'${SEEDED_SEQ_DSN}'`,
    });
    const o = parsed as { data: { lines: string[] } };
    const text = o.data.lines.join('\n');
    expect(text).toContain('This is a note seeded for the native-mock-zos-stdio e2e test.');
  }, 60_000);

  it('getUssHome, listUssFiles, and readUssFile find the seeded USS file', async () => {
    const { parsed: homeParsed } = await callToolSuccess(client, 'getUssHome', {});
    const home = homeParsed as { data: { path: string } };
    expect(home.data.path).toBeDefined();
    expect(home.data.path).toBe('/u/user1');

    const { parsed: listParsed } = await callToolSuccess(client, 'listUssFiles', {
      path: home.data.path,
    });
    const list = listParsed as { data: { name: string }[] };
    expect(Array.isArray(list.data)).toBe(true);
    expect(list.data.map(f => f.name)).toContain(SEEDED_USS_FILE);

    const { parsed: readParsed } = await callToolSuccess(client, 'readUssFile', {
      path: `${home.data.path}/${SEEDED_USS_FILE}`,
    });
    const read = readParsed as { data: { lines: string[] } };
    expect(read.data.lines.join('\n')).toContain('Hello from the mock USS home directory.');
  }, 60_000);
});
