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

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isPathInsideDirectory,
  LocalPathResolutionError,
  resolveLocalPathUnderRoots,
} from '../src/tools/local-files/path-under-roots.js';

describe('path-under-roots', () => {
  it('isPathInsideDirectory allows same path and children', () => {
    const base = path.resolve('/tmp/ws');
    expect(isPathInsideDirectory(base, '/tmp/ws')).toBe(true);
    expect(isPathInsideDirectory(base, path.join('/tmp/ws', 'a', 'b'))).toBe(true);
  });

  it('isPathInsideDirectory rejects outside paths', () => {
    const base = path.resolve('/tmp/ws');
    expect(isPathInsideDirectory(base, '/tmp/other')).toBe(false);
    expect(isPathInsideDirectory(base, '/tmp/ws../evil')).toBe(false);
  });

  it('resolves relative path against first MCP root', () => {
    const fileUri = pathToFileURL('/tmp/mockroot').href;
    const r = resolveLocalPathUnderRoots({
      mcpRoots: [{ uri: fileUri }],
      fallbackDirectories: [],
      localPath: 'out/x.txt',
      allowFallbackForRelative: false,
    });
    expect(r.source).toBe('mcp');
    expect(r.absolutePath).toBe(path.resolve('/tmp/mockroot/out/x.txt'));
  });

  it('resolves absolute path under MCP root', () => {
    const fileUri = pathToFileURL('/tmp/mockroot').href;
    const target = path.join('/tmp/mockroot', 'sub', 'f.txt');
    const r = resolveLocalPathUnderRoots({
      mcpRoots: [{ uri: fileUri }],
      fallbackDirectories: [],
      localPath: target,
      allowFallbackForRelative: false,
    });
    expect(r.source).toBe('mcp');
    expect(r.absolutePath).toBe(path.resolve(target));
  });

  it('uses fallback when MCP roots empty', () => {
    const fb = path.resolve('/tmp/fallback');
    const r = resolveLocalPathUnderRoots({
      mcpRoots: [],
      fallbackDirectories: [fb],
      localPath: 'rel.txt',
      allowFallbackForRelative: true,
    });
    expect(r.source).toBe('fallback');
    expect(r.absolutePath).toBe(path.join(fb, 'rel.txt'));
  });

  it('throws when no roots and no fallback for relative path', () => {
    expect(() =>
      resolveLocalPathUnderRoots({
        mcpRoots: [],
        fallbackDirectories: [],
        localPath: 'x.txt',
        allowFallbackForRelative: false,
      })
    ).toThrow(LocalPathResolutionError);
  });
});
