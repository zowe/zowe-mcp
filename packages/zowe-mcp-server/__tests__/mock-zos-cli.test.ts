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

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));

it('generates mock-zos fixtures without starting the stdio MCP server', () => {
  const mockDir = mkdtempSync(join(tmpdir(), 'mock-zos-cli-'));
  try {
    const result = spawnSync(
      process.execPath,
      [serverPath, 'mock-zos', 'gen-fixtures', '--mock-dir', mockDir],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: mockDir,
          USERPROFILE: mockDir,
        },
        input: '',
        timeout: 20_000,
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(existsSync(join(mockDir, '_ssh', 'users.json'))).toBe(true);
    expect(result.stdout).not.toMatch(/"jsonrpc"\s*:\s*"2\.0"/);
  } finally {
    rmSync(mockDir, { recursive: true, force: true });
  }
}, 25_000);
