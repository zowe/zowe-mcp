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

    it('should list the zowe_info tool', async () => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('zowe_info');
    });

    it('should have a description for zowe_info', async () => {
      const { tools } = await client.listTools();
      expect(tools[0].description).toContain('Zowe MCP server');
    });

    it('should call zowe_info and return server information', async () => {
      const result = await client.callTool({ name: 'zowe_info', arguments: {} });
      expect(result.content).toHaveLength(1);

      const content = result.content as { type: string; text: string }[];
      expect(content[0].type).toBe('text');

      const info = JSON.parse(content[0].text) as {
        name: string;
        version: string;
        description: string;
        components: string[];
      };
      expect(info.name).toBe('Zowe MCP Server');
      expect(info.version).toBe(packageJson.version);
      expect(info.description).toContain('z/OS');
      expect(info.components).toContain('core');
    });

    it('should return version matching package.json', async () => {
      const result = await client.callTool({ name: 'zowe_info', arguments: {} });
      const content = result.content as { type: string; text: string }[];
      const info = JSON.parse(content[0].text) as { version: string };
      expect(info.version).toBe(packageJson.version);
    });
  });
}
