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
 * Stateless-tools mode: setSystem and changeUssDirectory are not registered and
 * every call must name its target system when several are configured.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, getServer } from '../src/server.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { SystemRegistry } from '../src/zos/system.js';

const REMOVED_TOOLS = ['setSystem', 'changeUssDirectory'];

const config: MockSystemsConfig = {
  systems: [
    {
      host: 'sys1.example.com',
      port: 443,
      description: 'System 1',
      credentials: [{ user: 'USER1', password: 'pass1' }],
    },
    {
      host: 'sys2.example.com',
      port: 443,
      description: 'System 2',
      credentials: [{ user: 'USER2', password: 'pass2' }],
    },
  ],
};

async function writeDataset(dir: string, host: string, user: string, content: string) {
  const hlq = path.join(dir, host, user);
  await fs.mkdir(hlq, { recursive: true });
  await fs.writeFile(path.join(hlq, 'DATA.INPUT'), content);
  await fs.writeFile(
    path.join(hlq, 'DATA.INPUT_meta.json'),
    JSON.stringify({ dsn: `${user}.DATA.INPUT`, dsorg: 'PS', recfm: 'FB', lrecl: 80 })
  );
}

interface Connected {
  client: Client;
  server: McpServer;
}

async function connect(
  dir: string,
  systems: MockSystemsConfig,
  statelessTools?: boolean
): Promise<Connected> {
  const systemRegistry = new SystemRegistry();
  for (const sys of systems.systems) {
    systemRegistry.register({ host: sys.host, port: sys.port, description: sys.description });
  }
  const server = getServer(
    createServer({
      backend: new FilesystemMockBackend(dir),
      systemRegistry,
      credentialProvider: new MockCredentialProvider(systems),
      capabilityTier: 'full',
      statelessTools,
    })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  await new Promise(resolve => setTimeout(resolve, 50));
  return { client, server };
}

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0].text;
}

describe('stateless tools mode', () => {
  let dir: string;
  let conn: Connected | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-stateless-'));
    await fs.writeFile(path.join(dir, 'systems.json'), JSON.stringify(config));
    await writeDataset(dir, 'sys1.example.com', 'USER1', 'FROM SYSTEM ONE');
    await writeDataset(dir, 'sys2.example.com', 'USER2', 'FROM SYSTEM TWO');
  });

  afterEach(async () => {
    delete process.env.ZOWE_MCP_STATELESS_TOOLS;
    await conn?.client.close();
    await conn?.server.close();
    conn = undefined;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('registers setSystem and changeUssDirectory by default', async () => {
    conn = await connect(dir, config);
    const names = (await conn.client.listTools()).tools.map(t => t.name);
    for (const name of REMOVED_TOOLS) expect(names).toContain(name);
  });

  it('hides both tools and every mention of them when enabled by option', async () => {
    conn = await connect(dir, config, true);
    const listed = (await conn.client.listTools()).tools;
    const names = listed.map(t => t.name);
    for (const name of REMOVED_TOOLS) expect(names).not.toContain(name);
    expect(names).toContain('listSystems');

    const serialized = JSON.stringify(listed);
    const instructions = conn.client.getInstructions() ?? '';
    for (const name of REMOVED_TOOLS) {
      expect(serialized).not.toContain(name);
      expect(instructions).not.toContain(name);
    }
    expect(instructions).toContain('Pass the `system` parameter');
  });

  it('is enabled by ZOWE_MCP_STATELESS_TOOLS', async () => {
    process.env.ZOWE_MCP_STATELESS_TOOLS = 'true';
    conn = await connect(dir, config);
    const names = (await conn.client.listTools()).tools.map(t => t.name);
    for (const name of REMOVED_TOOLS) expect(names).not.toContain(name);
  });

  it('fails without system when several systems are configured, listing valid values', async () => {
    conn = await connect(dir, config, true);
    const result = await conn.client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER1.DATA.INPUT' },
    });
    expect(result.isError).toBe(true);
    const message = text(result);
    expect(message).toContain('sys1.example.com');
    expect(message).toContain('sys2.example.com');
    expect(message).not.toContain('setSystem');
  });

  it('works with system, and an explicit call does not become a hidden default', async () => {
    conn = await connect(dir, config, true);
    const ok = await conn.client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER2.DATA.INPUT', system: 'sys2.example.com' },
    });
    expect(ok.isError).not.toBe(true);
    expect(text(ok)).toContain('FROM SYSTEM TWO');

    const next = await conn.client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER2.DATA.INPUT' },
    });
    expect(next.isError).toBe(true);
    expect(text(next)).toContain('Valid values');
  });

  it('applies to USS tools too', async () => {
    conn = await connect(dir, config, true);
    const result = await conn.client.callTool({ name: 'getUssHome', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('sys1.example.com');
    expect(text(result)).not.toContain('setSystem');
  });

  it('still defaults to the only system when one is configured', async () => {
    const single: MockSystemsConfig = { systems: [config.systems[0]] };
    conn = await connect(dir, single, true);
    const result = await conn.client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'USER1.DATA.INPUT' },
    });
    expect(result.isError).not.toBe(true);
    expect(text(result)).toContain('FROM SYSTEM ONE');
  });

  describe('active system reporting', () => {
    async function callAfterExplicitCall(statelessTools: boolean) {
      conn = await connect(dir, config, statelessTools);
      await conn.client.callTool({
        name: 'readDataset',
        arguments: { dsn: 'USER2.DATA.INPUT', system: 'sys2.example.com' },
      });
      const context = text(await conn.client.callTool({ name: 'getContext', arguments: {} }));
      const systems = text(await conn.client.callTool({ name: 'listSystems', arguments: {} }));
      return { context, systems };
    }

    it('omits activeSystem, active flags and recently used systems with several systems', async () => {
      const { context, systems } = await callAfterExplicitCall(true);
      for (const json of [context, systems]) {
        expect(json).not.toContain('"active"');
        expect(json).not.toContain('activeSystem');
        expect(json).not.toContain('ussCwd');
      }
      expect(JSON.parse(context)).toMatchObject({ recentlyUsedSystems: [] });
      expect((JSON.parse(systems) as { systems: unknown[] }).systems).toHaveLength(2);
    });

    it('still reports the active system and flags when the switch is off', async () => {
      const { context, systems } = await callAfterExplicitCall(false);
      expect(context).toContain('"activeSystem"');
      expect(context).toContain('"active": true');
      expect(systems).toContain('"active": true');
    });

    it('reports the implicit system when exactly one is configured', async () => {
      conn = await connect(dir, { systems: [config.systems[0]] }, true);
      const context = JSON.parse(
        text(await conn.client.callTool({ name: 'getContext', arguments: {} }))
      ) as {
        activeSystem: { system: string; ussCwd?: string };
        allSystems: { active: boolean }[];
      };
      expect(context.activeSystem.system).toBe('sys1.example.com');
      expect(context.activeSystem.ussCwd).toBeUndefined();
      expect(context.allSystems[0].active).toBe(true);
    });
  });
});
