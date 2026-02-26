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
 * Integration tests for dataset tools with the Native backend.
 *
 * Uses a mock SSH client cache that returns a fake SDK client (no real SSH).
 * Verifies listMembers and listDatasets tools end-to-end with envelope structure.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, getServer } from '../src/server.js';
import type { ListResultMeta, ToolResponseEnvelope } from '../src/tools/response.js';
import type { ParsedConnectionSpec } from '../src/zos/native/connection-spec.js';
import { NativeBackend } from '../src/zos/native/native-backend.js';
import { NativeCredentialProvider } from '../src/zos/native/native-credential-provider.js';
import type { SshClientCache } from '../src/zos/native/ssh-client-cache.js';
import { cacheKey } from '../src/zos/native/ssh-client-cache.js';
import { SystemRegistry } from '../src/zos/system.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ToolContent {
  type: string;
  text: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

function parseEnvelope<T>(result: ToolResult): ToolResponseEnvelope<T> {
  return JSON.parse(getResultText(result)) as ToolResponseEnvelope<T>;
}

const NATIVE_SYSTEM_HOST = 'host.example.com';
const NATIVE_USER = 'USER';
const SPEC: ParsedConnectionSpec = {
  user: NATIVE_USER,
  host: NATIVE_SYSTEM_HOST,
  port: 22,
};

/** Fake SDK client shape for listDsMembers / listDatasets. */
function createFakeNativeClient() {
  const fullItems = [
    {
      name: 'USER.PDS.LIB',
      dsorg: 'PO',
      recfm: 'FB',
      lrecl: 80,
      blksize: 27920,
      cdate: '2024-01-01',
      volser: 'VOL1',
    },
  ];
  return {
    ds: {
      listDatasets: (req: { pattern: string; attributes?: boolean }) =>
        Promise.resolve({
          items: req.attributes === false ? [{ name: 'USER.PDS.LIB' }] : fullItems,
        }),
      listDsMembers: () =>
        Promise.resolve({
          items: [{ name: 'MEM1' }, { name: 'MEM2' }, { name: 'MEM3' }],
        }),
    },
  };
}

/** Create server with NativeBackend and mock client cache. */
async function createNativeServer(): Promise<{ client: Client; server: McpServer }> {
  const systemRegistry = new SystemRegistry();
  systemRegistry.register({
    host: NATIVE_SYSTEM_HOST,
    port: SPEC.port,
    description: 'Test native system',
  });

  const passwordStore = new Map<string, string>();
  passwordStore.set(cacheKey(SPEC), 'secret');

  const credentialProvider = new NativeCredentialProvider({
    connectionSpecs: [SPEC],
    useEnvForPassword: false,
    passwordStore,
  });

  const fakeClient = createFakeNativeClient();
  const clientCache = {
    getOrCreate: () => Promise.resolve(fakeClient),
    evict: (): void => {
      /* no-op for test */
    },
    hasKey: () => true,
  } as unknown as SshClientCache;

  function getSpec(systemId: string): ParsedConnectionSpec | undefined {
    return systemId === NATIVE_SYSTEM_HOST ? SPEC : undefined;
  }

  const backend = new NativeBackend({
    credentialProvider,
    clientCache,
    getSpec,
  });

  const server = getServer(
    createServer({
      backend,
      systemRegistry,
      credentialProvider,
      logToolCalls: true,
    })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  // Allow auto-activation to complete
  await new Promise(resolve => setTimeout(resolve, 50));

  return { client, server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dataset tools with native backend', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    ({ client, server } = await createNativeServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  describe('listMembers', () => {
    it('should return envelope with _context, _result, and data containing members', async () => {
      const result = await client.callTool({
        name: 'listMembers',
        arguments: { dsn: `${NATIVE_USER}.PDS.LIB` },
      });

      const envelope = parseEnvelope<{ member: string }[]>(result);

      expect(envelope._context).toBeDefined();
      // No resolvedDsn when input already normalized

      const listResult = envelope._result as ListResultMeta | undefined;
      expect(listResult).toBeDefined();
      expect(listResult!.count).toBe(3);
      expect(listResult!.totalAvailable).toBe(3);
      expect(listResult!.hasMore).toBe(false);

      expect(Array.isArray(envelope.data)).toBe(true);
      expect(envelope.data).toHaveLength(3);
      const memberNames = envelope.data.map(m => m.member);
      expect(memberNames).toContain('MEM1');
      expect(memberNames).toContain('MEM2');
      expect(memberNames).toContain('MEM3');
    });

    it('should apply pagination (offset/limit) at tool layer', async () => {
      const result = await client.callTool({
        name: 'listMembers',
        arguments: { dsn: 'PDS.LIB', offset: 0, limit: 2 },
      });

      const envelope = parseEnvelope<{ member: string }[]>(result);

      const listResult = envelope._result as ListResultMeta | undefined;
      expect(listResult).toBeDefined();
      expect(listResult!.offset).toBe(0);
      expect(listResult!.count).toBe(2);
      expect(listResult!.totalAvailable).toBe(3);
      expect(listResult!.hasMore).toBe(true);
      expect(envelope.data).toHaveLength(2);
    });
  });

  describe('listDatasets', () => {
    it('should return envelope with _context, _result, and data containing datasets with attributes', async () => {
      const result = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: '*' },
      });

      const envelope = parseEnvelope<
        {
          dsn: string;
          dsorg?: string;
          recfm?: string;
          lrecl?: number;
          blksz?: number;
          volser?: string;
          creationDate?: string;
        }[]
      >(result);

      expect(envelope._context).toBeDefined();
      // No resolvedPattern when input already normalized (pattern '*')
      expect(envelope._result).toBeDefined();
      expect(Array.isArray(envelope.data)).toBe(true);
      expect(envelope.data).toHaveLength(1);
      expect(envelope.data[0]).toMatchObject({
        dsn: 'USER.PDS.LIB',
        dsorg: 'PO',
        recfm: 'FB',
        lrecl: 80,
        blksz: 27920,
        volser: 'VOL1',
        creationDate: '2024-01-01',
      });
    });

    it('should return only dsn and resourceLink when attributes: false', async () => {
      const result = await client.callTool({
        name: 'listDatasets',
        arguments: { dsnPattern: '*', attributes: false },
      });

      const envelope = parseEnvelope<{ dsn: string; resourceLink?: string }[]>(result);

      expect(envelope.data).toHaveLength(1);
      expect(envelope.data[0].dsn).toBe('USER.PDS.LIB');
      expect(envelope.data[0]).toHaveProperty('resourceLink');
      // Names-only: no attribute fields
      expect(envelope.data[0]).not.toHaveProperty('dsorg');
      expect(envelope.data[0]).not.toHaveProperty('recfm');
      expect(envelope.data[0]).not.toHaveProperty('lrecl');
    });
  });
});
