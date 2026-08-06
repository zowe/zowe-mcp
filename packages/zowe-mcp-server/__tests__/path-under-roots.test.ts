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

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertRealpathStillInsideRoot,
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

describe('assertRealpathStillInsideRoot (symlink escape hardening)', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'zowe-mcp-symlink-'));
    root = path.join(base, 'root');
    outside = path.join(base, 'outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('accepts a regular file inside the root', () => {
    const f = path.join(root, 'ok.txt');
    writeFileSync(f, 'x');
    expect(() => assertRealpathStillInsideRoot(root, f)).not.toThrow();
  });

  it('accepts a not-yet-existing file under an existing directory in the root', () => {
    const f = path.join(root, 'sub', 'new.txt');
    mkdirSync(path.dirname(f), { recursive: true });
    expect(() => assertRealpathStillInsideRoot(root, f)).not.toThrow();
  });

  it('accepts a symlink that stays inside the root', () => {
    const target = path.join(root, 'real.txt');
    writeFileSync(target, 'x');
    const link = path.join(root, 'link.txt');
    symlinkSync(target, link);
    expect(() => assertRealpathStillInsideRoot(root, link)).not.toThrow();
  });

  it('rejects a symlinked file pointing outside the root', () => {
    const target = path.join(outside, 'secret.txt');
    writeFileSync(target, 'secret');
    const link = path.join(root, 'link.txt');
    symlinkSync(target, link);
    expect(() => assertRealpathStillInsideRoot(root, link)).toThrow(LocalPathResolutionError);
  });

  it('rejects a symlinked parent directory pointing outside the root', () => {
    const link = path.join(root, 'dir');
    symlinkSync(outside, link);
    expect(() => assertRealpathStillInsideRoot(root, path.join(link, 'f.txt'))).toThrow(
      LocalPathResolutionError
    );
  });

  it('rejects a not-yet-existing file under a symlinked directory escaping the root', () => {
    const link = path.join(root, 'dir');
    symlinkSync(outside, link);
    expect(() =>
      assertRealpathStillInsideRoot(root, path.join(link, 'deeper', 'new.txt'))
    ).toThrow(LocalPathResolutionError);
  });

  it('rejects a dangling symlink', () => {
    const link = path.join(root, 'dangling.txt');
    symlinkSync(path.join(outside, 'does-not-exist.txt'), link);
    expect(() => assertRealpathStillInsideRoot(root, link)).toThrow(LocalPathResolutionError);
  });

  it('rejects when the root itself does not exist', () => {
    expect(() =>
      assertRealpathStillInsideRoot(path.join(base, 'missing-root'), path.join(root, 'f.txt'))
    ).toThrow(LocalPathResolutionError);
  });

  it('accepts when the root itself is a symlink and the file stays within it', () => {
    const linkRoot = path.join(base, 'root-link');
    symlinkSync(root, linkRoot);
    const f = path.join(linkRoot, 'ok.txt');
    writeFileSync(path.join(root, 'ok.txt'), 'x');
    expect(() => assertRealpathStillInsideRoot(linkRoot, f)).not.toThrow();
  });
});
