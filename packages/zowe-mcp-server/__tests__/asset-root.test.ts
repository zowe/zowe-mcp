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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAsset } from '../src/runtime/asset-root.js';

/**
 * Lays out a fake installed package: package.json at the root, a bundled
 * chunk under dist/chunks/, and assets wherever the test puts them.
 */
describe('resolveAsset package-root fallback', () => {
  let root: string;
  let chunkUrl: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'asset-root-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: '@zowe/mcp-server', version: '0.0.0' })
    );
    mkdirSync(join(root, 'dist', 'chunks'), { recursive: true });
    chunkUrl = pathToFileURL(join(root, 'dist', 'chunks', 'server-abc123.js')).href;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const parts = ['tools', 'tso', 'tso-command-patterns.json'];

  it('finds assets shipped under <packageRoot>/dist (npm tarball layout)', () => {
    mkdirSync(join(root, 'dist', 'tools', 'tso'), { recursive: true });
    writeFileSync(join(root, 'dist', ...parts), '{}');
    expect(resolveAsset(chunkUrl, ['tso-command-patterns.json'], parts)).toBe(
      join(root, 'dist', ...parts)
    );
  });

  it('prefers assets directly under the package root (VSIX server/ layout)', () => {
    mkdirSync(join(root, 'tools', 'tso'), { recursive: true });
    writeFileSync(join(root, ...parts), '{}');
    expect(resolveAsset(chunkUrl, ['tso-command-patterns.json'], parts)).toBe(
      join(root, ...parts)
    );
  });

  it('returns the package-root path when the asset exists nowhere', () => {
    expect(resolveAsset(chunkUrl, ['tso-command-patterns.json'], parts)).toBe(
      join(root, ...parts)
    );
  });
});
