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
 * Integration tests for the z/OS certificate / key ring tools against the
 * filesystem mock backend (which returns canned data).
 *
 * Verifies: tool registration + outputSchema, envelope shape, and the
 * mutually-exclusive-parameter guards (connectCertificate fromRing/fromDatabase,
 * deleteCertificate keyring/database, exportCertificate format p12 requires file
 * and password).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, getServer } from '../src/server.js';
import { refreshFailureWarning } from '../src/tools/certificates/certificate-tools.js';
import type { ToolResponseEnvelope } from '../src/tools/response.js';
import type { CredentialProvider } from '../src/zos/credentials.js';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { SystemRegistry } from '../src/zos/system.js';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function parseEnvelope<T>(result: ToolResult): ToolResponseEnvelope<T> {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text) as ToolResponseEnvelope<T>;
}

const SYSTEM_HOST = 'test-system.example.com';
const DEFAULT_USER = 'TESTUSER';

const mockConfig: MockSystemsConfig = {
  systems: [
    {
      host: SYSTEM_HOST,
      port: 443,
      description: 'Test system',
      credentials: [{ user: DEFAULT_USER, password: 'pass' }],
    },
  ],
};

let mockDir: string;

async function createMockServer(): Promise<{ client: Client; server: McpServer }> {
  const backend = new FilesystemMockBackend(mockDir);
  const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
  const systemRegistry = new SystemRegistry();
  for (const sys of mockConfig.systems) {
    systemRegistry.register({ host: sys.host, port: sys.port, description: sys.description });
  }
  const server = getServer(
    createServer({ backend, systemRegistry, credentialProvider, capabilityTier: 'full' })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  await new Promise(resolve => setTimeout(resolve, 50));
  return { client, server };
}

beforeAll(async () => {
  mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-cert-test-'));
  await fs.writeFile(path.join(mockDir, 'systems.json'), JSON.stringify(mockConfig));
  await fs.mkdir(path.join(mockDir, SYSTEM_HOST), { recursive: true });
});

afterAll(async () => {
  await fs.rm(mockDir, { recursive: true, force: true });
});

const CERT_TOOLS = [
  'showCertificate',
  'connectCertificate',
  'deleteCertificate',
  'exportCertificate',
  'importCertificate',
  'setDefaultCertificate',
  'trustCertificate',
  'renameCertificate',
  'refreshCertificateClass',
];

describe('Certificate / key ring tools with mock backend', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    ({ client, server } = await createMockServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('registers all certificate tools with output schemas', async () => {
    const { tools } = await client.listTools();
    for (const name of CERT_TOOLS) {
      const tool = tools.find(t => t.name === name);
      expect(tool, `tool ${name} should be registered`).toBeDefined();
      expect(tool!.outputSchema).toBeDefined();
      expect(tool!.outputSchema).toHaveProperty('type', 'object');
    }
  });

  it('lists certificates as a component in getContext', async () => {
    const result = await client.callTool({ name: 'getContext', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const ctx = JSON.parse(content[0].text) as { server: { components: string[] } };
    expect(ctx.server.components).toContain('certificates');
  });

  describe('showCertificate', () => {
    it('returns certificate detail', async () => {
      const result = await client.callTool({
        name: 'showCertificate',
        arguments: { owner: 'USER01', keyring: 'RING02', label: 'CERT03' },
      });
      const env = parseEnvelope<{ label: string; owner: string; isDefault: boolean }>(result);
      expect(env.data.label).toBe('CERT03');
      expect(env.data.owner).toBe('USER01');
      expect(env.data).toHaveProperty('isDefault');
      expect(env._result).toBeUndefined();
    });
  });

  describe('connectCertificate', () => {
    it('rejects when neither fromRing nor fromDatabase is given', async () => {
      const result = await client.callTool({
        name: 'connectCertificate',
        arguments: { owner: 'USER01', keyring: 'RING02', label: 'CACERT' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toMatch(/exactly one/i);
    });

    it('rejects when both fromRing and fromDatabase are given', async () => {
      const result = await client.callTool({
        name: 'connectCertificate',
        arguments: {
          owner: 'USER01',
          keyring: 'RING02',
          label: 'CACERT',
          fromRing: 'RING01',
          fromDatabase: true,
        },
      });
      expect(result.isError).toBe(true);
    });

    it('connects when fromDatabase is given', async () => {
      const result = await client.callTool({
        name: 'connectCertificate',
        arguments: { owner: 'USER01', keyring: 'RING02', label: 'CACERT', fromDatabase: true },
      });
      const env = parseEnvelope<{ owner: string; keyring: string; label: string }>(result);
      expect(env.data.label).toBe('CACERT');
      expect(env._result).toEqual({ success: true });
    });
  });

  describe('deleteCertificate', () => {
    it('rejects when neither keyring nor database is given', async () => {
      const result = await client.callTool({
        name: 'deleteCertificate',
        arguments: { owner: 'USER01', label: 'CERT03' },
      });
      expect(result.isError).toBe(true);
    });

    it('rejects when both keyring and database are given', async () => {
      const result = await client.callTool({
        name: 'deleteCertificate',
        arguments: { owner: 'USER01', label: 'CERT03', keyring: 'RING02', database: true },
      });
      expect(result.isError).toBe(true);
    });

    it('deletes from a ring when keyring is given', async () => {
      const result = await client.callTool({
        name: 'deleteCertificate',
        arguments: { owner: 'USER01', label: 'CERT03', keyring: 'RING02' },
      });
      const env = parseEnvelope<{ owner: string; label: string }>(result);
      expect(env.data.label).toBe('CERT03');
      expect(env._result).toEqual({ success: true });
    });

    it('deletes from the database when database is given', async () => {
      const result = await client.callTool({
        name: 'deleteCertificate',
        arguments: { owner: 'USER01', label: 'CERT03', database: true },
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('exportCertificate', () => {
    it('rejects p12 format without a file', async () => {
      const result = await client.callTool({
        name: 'exportCertificate',
        arguments: { owner: 'USER01', keyring: 'RING02', label: 'CERT03', format: 'p12' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toMatch(/file is required/i);
    });

    it('rejects p12 format without a password', async () => {
      const result = await client.callTool({
        name: 'exportCertificate',
        arguments: {
          owner: 'USER01',
          keyring: 'RING02',
          label: 'CERT03',
          format: 'p12',
          file: '/tmp/CERT03.p12',
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toMatch(/password is required/i);
    });

    it('returns inline content for pem without a file', async () => {
      const result = await client.callTool({
        name: 'exportCertificate',
        arguments: { owner: 'USER01', keyring: 'RING02', label: 'CERT03' },
      });
      const env = parseEnvelope<{ content?: string; file?: string; format: string }>(result);
      expect(env.data.format).toBe('pem');
      expect(env.data.content).toBeTruthy();
      expect(env.data.file).toBeUndefined();
    });

    it('writes to a file on z/OS when file is given', async () => {
      const result = await client.callTool({
        name: 'exportCertificate',
        arguments: {
          owner: 'USER01',
          keyring: 'RING02',
          label: 'CERT03',
          format: 'p12',
          file: '/tmp/CERT03.p12',
          password: 'secret',
        },
      });
      const env = parseEnvelope<{ file?: string; bytesWritten?: number }>(result);
      expect(env.data.file).toBe('/tmp/CERT03.p12');
      expect(env.data.bytesWritten).toBeGreaterThan(0);
    });
  });

  describe('importCertificate', () => {
    it('imports a certificate from a PKCS#12 file', async () => {
      const result = await client.callTool({
        name: 'importCertificate',
        arguments: {
          owner: 'USER01',
          keyring: 'RING02',
          label: 'CERT03',
          usage: 'PERSONAL',
          file: '/tmp/file.p12',
          password: 'secret',
        },
      });
      const env = parseEnvelope<{ label: string }>(result);
      expect(env.data.label).toBe('CERT03');
      expect(env._result).toEqual({ success: true });
    });
  });

  describe('setDefaultCertificate', () => {
    it('sets the ring default certificate', async () => {
      const result = await client.callTool({
        name: 'setDefaultCertificate',
        arguments: { owner: 'USER01', keyring: 'RING02', label: 'CERT03' },
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('trustCertificate', () => {
    it('changes the trust status', async () => {
      const result = await client.callTool({
        name: 'trustCertificate',
        arguments: { owner: 'USER01', label: 'CERT03', status: 'NOTRUST' },
      });
      const env = parseEnvelope<{ status: string }>(result);
      expect(env.data.status).toBe('NOTRUST');
    });
  });

  describe('renameCertificate', () => {
    it('renames a certificate label', async () => {
      const result = await client.callTool({
        name: 'renameCertificate',
        arguments: { owner: 'USER01', label: 'OLDLABEL', newLabel: 'NEWLABEL' },
      });
      const env = parseEnvelope<{ newLabel: string }>(result);
      expect(env.data.newLabel).toBe('NEWLABEL');
    });
  });

  describe('refreshCertificateClass', () => {
    it('refreshes the DIGTCERT class', async () => {
      const result = await client.callTool({ name: 'refreshCertificateClass', arguments: {} });
      expect(result.isError).toBeFalsy();
      const env = parseEnvelope<Record<string, never>>(result);
      expect(env._result).toEqual({ success: true });
    });
  });
});

describe('refreshFailureWarning (post-mutation refresh failure)', () => {
  it('converts a refresh-only failure into a warning', () => {
    const w = refreshFailureWarning(
      new Error('IRRSDL64 REFRESH failed: SAF rc: 8, RACF rc: 8, RACF rsn: 92')
    );
    expect(w).toMatch(/change was applied/);
    expect(w).toMatch(/refreshCertificateClass/);
  });

  it('passes through other errors', () => {
    expect(refreshFailureWarning(new Error('IRRSDL64 DataRemove failed: SAF rc: 8'))).toBe(
      undefined
    );
    expect(refreshFailureWarning('not found')).toBe(undefined);
  });
});
