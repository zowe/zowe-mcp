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
 * Integration tests for binary (base64, no-conversion) dataset and USS file
 * transfer via MCP with the mock backend.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';
import { createMockIntegrationClient, getResultText } from './helpers/integration-test-utils.js';

const SYSTEM_HOST = 'binary-test.example.com';
const DEFAULT_USER = 'testuser';

const mockConfig: MockSystemsConfig = {
  systems: [
    {
      host: SYSTEM_HOST,
      port: 443,
      description: 'Binary transfer test system',
      credentials: [{ user: DEFAULT_USER, password: 'pass' }],
    },
  ],
};

// Bytes that are NOT valid UTF-8 and NOT EBCDIC-translatable text — a
// text-mode round trip would corrupt them, a binary one must not.
const rawBytes = Buffer.from([
  0x00, 0x01, 0xff, 0xfe, 0x10, 0x88, 0xc3, 0x28, 0x00, 0x9f, 0x41, 0x0d, 0x0a, 0x7f, 0x80, 0xa0,
]);
const rawBase64 = rawBytes.toString('base64');

describe('binary transfer integration', () => {
  let mockDir: string;
  let client: Client;
  let server: Awaited<ReturnType<typeof createMockIntegrationClient>>['server'];

  beforeAll(async () => {
    mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-binary-'));
    await fs.writeFile(path.join(mockDir, 'systems.json'), JSON.stringify(mockConfig));
    await fs.mkdir(path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER), {
      recursive: true,
    });

    ({ client, server } = await createMockIntegrationClient(mockDir, mockConfig, 'binary-test'));
    // Populate ussHome in the session so home-relative paths pass read validation
    await client.callTool({ name: 'getUssHome', arguments: {} });
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    if (mockDir) await fs.rm(mockDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('round-trips raw bytes through writeUssFile/readUssFile with binary: true', async () => {
    const ussPath = `/u/${DEFAULT_USER}/payload.bin`;
    const writeResult = await client.callTool({
      name: 'writeUssFile',
      arguments: { path: ussPath, binary: true, contentBase64: rawBase64 },
    });
    expect(writeResult.isError ?? false).toBe(false);

    const readResult = await client.callTool({
      name: 'readUssFile',
      arguments: { path: ussPath, binary: true },
    });
    const envelope = JSON.parse(getResultText(readResult)) as {
      data: { lines: string[]; contentBase64?: string };
      _result: { mimeType: string };
    };
    expect(envelope.data.contentBase64).toBe(rawBase64);
    expect(envelope.data.lines).toEqual([]);
    expect(envelope._result.mimeType).toBe('application/octet-stream');

    // The stored file must be byte-identical to the original
    const onDisk = await fs.readFile(
      path.join(mockDir, 'uss', SYSTEM_HOST, 'u', DEFAULT_USER, 'payload.bin')
    );
    expect(Buffer.compare(onDisk, rawBytes)).toBe(0);
  });

  it('round-trips raw bytes through writeDataset/readDataset with binary: true', async () => {
    const dsn = `${DEFAULT_USER.toUpperCase()}.BIN.PAYLOAD`;
    const writeResult = await client.callTool({
      name: 'writeDataset',
      arguments: { dsn, binary: true, contentBase64: rawBase64 },
    });
    expect(writeResult.isError ?? false).toBe(false);

    const readResult = await client.callTool({
      name: 'readDataset',
      arguments: { dsn, binary: true },
    });
    const envelope = JSON.parse(getResultText(readResult)) as {
      data: { lines: string[]; contentBase64?: string; encoding: string };
    };
    expect(envelope.data.contentBase64).toBe(rawBase64);
    expect(envelope.data.encoding).toBe('binary');
    expect(envelope.data.lines).toEqual([]);
  });

  it('rejects binary combined with text-mode arguments', async () => {
    const readWindowed = await client.callTool({
      name: 'readDataset',
      arguments: { dsn: 'ANY.DSN', binary: true, startLine: 5 },
    });
    expect(readWindowed.isError).toBe(true);
    expect(getResultText(readWindowed)).toContain('binary cannot be combined');

    const writeWithLines = await client.callTool({
      name: 'writeDataset',
      arguments: { dsn: 'ANY.DSN', binary: true, contentBase64: rawBase64, lines: ['x'] },
    });
    expect(writeWithLines.isError).toBe(true);
    expect(getResultText(writeWithLines)).toContain('binary cannot be combined');

    const writeMissingContent = await client.callTool({
      name: 'writeUssFile',
      arguments: { path: `/u/${DEFAULT_USER}/x.bin`, binary: true },
    });
    expect(writeMissingContent.isError).toBe(true);
    expect(getResultText(writeMissingContent)).toContain('contentBase64');
  });

  it('still requires lines for text-mode writes', async () => {
    const result = await client.callTool({
      name: 'writeDataset',
      arguments: { dsn: 'ANY.DSN' },
    });
    expect(result.isError).toBe(true);
    expect(getResultText(result)).toContain('lines is required');
  });
});
