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
 * E2E tests for the init-mock CLI entry point.
 *
 * Verifies that running `node index.js init-mock --output <dir> [--preset ...]`
 * (the subcommand path in the server entry point) generates mock data and exits
 * successfully, without starting the MCP server.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');
const packageRoot = resolve(__dirname, '..');

describe('init-mock CLI entry point', () => {
  let tmpdirPath: string;

  afterEach(() => {
    if (tmpdirPath !== undefined) {
      rmSync(tmpdirPath, { recursive: true, force: true });
    }
  });

  it('should run init-mock via command line and generate mock data (minimal preset)', () => {
    tmpdirPath = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-init-mock-e2e-'));
    const result = spawnSync(
      process.execPath,
      [serverPath, 'init-mock', '--output', tmpdirPath, '--preset', 'minimal'],
      { cwd: packageRoot, encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Generating mock data in:');
    expect(result.stdout).toContain('Systems: 1, Users/system: 1');
    expect(result.stdout).toContain('Generated:');
    expect(result.stdout).toContain('Mock data directory:');

    const systemsPath = join(tmpdirPath, 'systems.json');
    expect(existsSync(systemsPath)).toBe(true);
    const config = JSON.parse(readFileSync(systemsPath, 'utf-8')) as {
      systems: { host: string }[];
    };
    expect(Array.isArray(config.systems)).toBe(true);
    expect(config.systems.length).toBe(1);
    const systemDir = join(tmpdirPath, config.systems[0].host);
    expect(existsSync(systemDir)).toBe(true);
    const hlqs = readdirSync(systemDir).filter(p => !p.startsWith('.'));
    expect(hlqs.length).toBeGreaterThan(0);
  });

  it('should run init-mock via command line with default preset', () => {
    tmpdirPath = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-init-mock-e2e-'));
    const result = spawnSync(
      process.execPath,
      [serverPath, 'init-mock', '--output', tmpdirPath, '--preset', 'default'],
      { cwd: packageRoot, encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Systems: 2, Users/system: 2');
    const config = JSON.parse(readFileSync(join(tmpdirPath, 'systems.json'), 'utf-8')) as {
      systems: { host: string }[];
    };
    expect(config.systems).toHaveLength(2);
  });

  // The pagination eval sets assert exact fixture sizes; lock them here so a change to
  // init-mock that would silently break those evals fails a test instead.
  it('should seed pagination fixtures at the sizes the eval sets expect', () => {
    tmpdirPath = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-init-mock-e2e-'));
    const result = spawnSync(
      process.execPath,
      [serverPath, 'init-mock', '--output', tmpdirPath, '--preset', 'pagination'],
      { cwd: packageRoot, encoding: 'utf-8' }
    );
    expect(result.status).toBe(0);
    const config = JSON.parse(readFileSync(join(tmpdirPath, 'systems.json'), 'utf-8')) as {
      systems: { host: string }[];
    };
    const userDir = join(tmpdirPath, config.systems[0].host, 'USER');
    const members = (pds: string) =>
      readdirSync(join(userDir, pds)).filter(f => f !== '_meta.json').length;
    expect(members('CATALOG')).toBe(350);
    expect(members('PARTS')).toBe(1251); // 1250 ITEM* + ZSPECIAL
    expect(members('INVNTORY')).toBe(2000);
    expect(readdirSync(join(userDir, 'PARTS'))).toContain('ZSPECIAL.txt');
    const largeSeq = readFileSync(join(userDir, 'LARGE.SEQ'), 'utf-8');
    expect(largeSeq.split('\n').filter(Boolean)).toHaveLength(1300);
    expect(largeSeq.split('\n')[1249]).toBe('LUKE SKYWALKER'); // line 1250
  });
});
