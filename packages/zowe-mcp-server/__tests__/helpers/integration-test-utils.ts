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
 * Shared helpers for in-process integration tests that spin up a FilesystemMockBackend
 * and connect via InMemoryTransport.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, getServer } from '../../src/server.js';
import type { CredentialProvider } from '../../src/zos/credentials.js';
import { FilesystemMockBackend } from '../../src/zos/mock/filesystem-mock-backend.js';
import { MockCredentialProvider } from '../../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../../src/zos/mock/mock-types.js';
import { SystemRegistry } from '../../src/zos/system.js';

/** Extracts the first text content item from an MCP tool call result. */
export function getResultText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[] | undefined;
  const first = content?.[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

/**
 * Creates a connected in-memory MCP client backed by a `FilesystemMockBackend`.
 * The caller is responsible for closing client and server in `afterAll`.
 */
export async function createMockIntegrationClient(
  mockDir: string,
  mockConfig: MockSystemsConfig,
  clientName: string
): Promise<{ client: Client; server: ReturnType<typeof getServer> }> {
  const backend = new FilesystemMockBackend(mockDir);
  const credentialProvider: CredentialProvider = new MockCredentialProvider(mockConfig);
  const systemRegistry = new SystemRegistry();
  for (const sys of mockConfig.systems) {
    systemRegistry.register({
      host: sys.host,
      port: sys.port,
      description: sys.description,
    });
  }

  const server = getServer(
    createServer({
      backend,
      systemRegistry,
      credentialProvider,
      logToolCalls: true,
      capabilityTier: 'full',
    })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  await new Promise(resolve => setTimeout(resolve, 50));
  return { client, server };
}
