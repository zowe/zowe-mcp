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
 * Common tests that run against every transport.
 *
 * Each test is executed once per transport provider (in-memory, stdio, HTTP)
 * to ensure consistent behavior regardless of how the client connects.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allProviders, TransportProvider } from './transport-providers.js';

const require = createRequire(import.meta.url);
const packageJson: { version: string } = require('../package.json') as {
  version: string;
};

for (const createProvider of allProviders) {
  const provider: TransportProvider = createProvider();

  describe(`Common tests [${provider.name}]`, () => {
    let client: Client;

    beforeEach(async () => {
      client = await provider.setup();
    });

    afterEach(async () => {
      await provider.teardown();
    });

    it('should list the info tool', async () => {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(1);
      expect(tools.find(t => t.name === 'getContext')).toBeDefined();
    });

    it('should have a description for getContext', async () => {
      const { tools } = await client.listTools();
      expect(tools[0].description).toContain('Zowe MCP server');
    });

    it('should list getContext tool with outputSchema (MCP output schema)', async () => {
      const { tools } = await client.listTools();
      expect(tools[0].name).toBe('getContext');
      expect(tools[0].outputSchema).toBeDefined();
      expect(tools[0].outputSchema).toHaveProperty('type', 'object');
      expect(tools[0].outputSchema).toHaveProperty('properties');
      const props =
        (tools[0].outputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(props).toHaveProperty('server');
      expect(props).toHaveProperty('activeSystem');
      expect(props).toHaveProperty('allSystems');
    });

    it('should call getContext and return server information with structuredContent', async () => {
      const result = await client.callTool({ name: 'getContext', arguments: {} });
      expect(result.content).toHaveLength(1);

      const content = result.content as { type: string; text: string }[];
      expect(content[0].type).toBe('text');

      const ctx = JSON.parse(content[0].text) as {
        server: {
          name: string;
          version: string;
          description: string;
          components: string[];
          backend: string | null;
        };
        activeSystem: null;
        allSystems: unknown[];
        recentlyUsedSystems: unknown[];
        messages?: string[];
      };
      expect(ctx.server.name).toBe('Zowe MCP Server');
      expect(ctx.server.version).toBe(packageJson.version);
      expect(ctx.server.description).toContain('z/OS');
      expect(ctx.server.components).toContain('context');
      expect(ctx.server.backend).toBeNull();
      expect(ctx.activeSystem).toBeNull();
      expect(ctx.allSystems).toEqual([]);
      expect(ctx.messages).toBeDefined();

      expect(result.structuredContent).toBeDefined();
      const structured = result.structuredContent as Record<string, unknown>;
      const structuredServer = structured.server as Record<string, unknown>;
      expect(structuredServer.name).toBe('Zowe MCP Server');
      expect(structuredServer.version).toBe(packageJson.version);
      expect(structuredServer.backend).toBeNull();
    });

    it('should return version matching package.json', async () => {
      const result = await client.callTool({ name: 'getContext', arguments: {} });
      const content = result.content as { type: string; text: string }[];
      const ctx = JSON.parse(content[0].text) as { server: { version: string } };
      expect(ctx.server.version).toBe(packageJson.version);
    });

    it('should advertise the logging capability', () => {
      const capabilities = client.getServerCapabilities();
      expect(capabilities?.logging).toBeDefined();
    });
  });
}
