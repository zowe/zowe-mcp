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
 * Resolve and validate local filesystem paths for upload/download tools against MCP roots
 * or configured fallback directories.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** MCP root entry (from roots/list). */
export interface McpRoot {
  uri: string;
  name?: string;
}

export class LocalPathResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalPathResolutionError';
  }
}

/**
 * Returns true if `child` is equal to `parent` or contained within `parent` (after resolve).
 * Does not use realpath (callers may wrap with realpath for symlink hardening).
 */
export function isPathInsideDirectory(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  const rel = path.relative(p, c);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function fileUriToAbsolutePath(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'file:') {
      throw new LocalPathResolutionError(`Root URI must use file:// scheme, got: ${uri}`);
    }
    return fileURLToPath(u.href);
  } catch (e) {
    if (e instanceof LocalPathResolutionError) throw e;
    throw new LocalPathResolutionError(`Invalid root URI: ${uri}`);
  }
}

export interface ResolveLocalPathOptions {
  /** Roots from MCP roots/list (file:// URIs). */
  mcpRoots: McpRoot[];
  /**
   * Absolute directories used when MCP roots are empty or unavailable (e.g. ZOWE_MCP_WORKSPACE_DIR).
   * Resolved with path.resolve.
   */
  fallbackDirectories: string[];
  /**
   * Path from the tool: absolute, or relative to the first allowed root (MCP or fallback order).
   */
  localPath: string;
  /** When true, allow resolving relative paths only against fallback dirs if MCP roots are empty. */
  allowFallbackForRelative: boolean;
}

export interface ResolvedLocalPath {
  absolutePath: string;
  /** file:// URI of the root directory that contains the path. */
  rootUri: string;
  /** Whether validation used MCP roots or fallback directories. */
  source: 'mcp' | 'fallback';
}

/**
 * Resolves `localPath` to an absolute path that lies under one of the MCP roots, or under a fallback directory.
 *
 * - **Absolute** `localPath`: must lie under at least one root (MCP first, then fallback).
 * - **Relative** `localPath`: resolved against the **first** root in `mcpRoots` if non-empty; else first fallback dir when `allowFallbackForRelative`.
 */
export function resolveLocalPathUnderRoots(options: ResolveLocalPathOptions): ResolvedLocalPath {
  const trimmed = options.localPath.trim();
  if (!trimmed) {
    throw new LocalPathResolutionError('localPath must be non-empty.');
  }

  const mcpDirs = options.mcpRoots.map(r => ({
    rootUri: r.uri,
    dir: path.resolve(fileUriToAbsolutePath(r.uri)),
  }));

  const fallbackDirs = options.fallbackDirectories
    .filter(d => d.trim().length > 0)
    .map(d => path.resolve(d.trim()));

  const tryResolve = (
    dirs: { rootUri: string; dir: string }[],
    source: 'mcp' | 'fallback'
  ): ResolvedLocalPath | undefined => {
    if (dirs.length === 0) return undefined;

    if (path.isAbsolute(trimmed)) {
      const abs = path.resolve(trimmed);
      for (const { rootUri, dir } of dirs) {
        if (isPathInsideDirectory(dir, abs)) {
          return { absolutePath: abs, rootUri, source };
        }
      }
      return undefined;
    }

    const first = dirs[0];
    if (!first) return undefined;
    const abs = path.resolve(first.dir, trimmed);
    if (!isPathInsideDirectory(first.dir, abs)) {
      throw new LocalPathResolutionError(
        'Relative localPath escapes the workspace root; use a path under the first root.'
      );
    }
    return { absolutePath: abs, rootUri: first.rootUri, source };
  };

  const fromMcp = tryResolve(mcpDirs, 'mcp');
  if (fromMcp) return fromMcp;

  if (path.isAbsolute(trimmed)) {
    const fromFallback = tryResolve(
      fallbackDirs.map(dir => ({
        rootUri: pathToFileUriString(dir),
        dir,
      })),
      'fallback'
    );
    if (fromFallback) return fromFallback;
    throw new LocalPathResolutionError(
      'localPath is not under any allowed MCP root or configured workspace directory.'
    );
  }

  if (!options.allowFallbackForRelative || fallbackDirs.length === 0) {
    throw new LocalPathResolutionError(
      mcpDirs.length === 0 && fallbackDirs.length === 0
        ? 'No MCP roots and no fallback directory (e.g. ZOWE_MCP_WORKSPACE_DIR or ZOWE_MCP_LOCAL_FILES_ROOT). Cannot resolve relative localPath.'
        : 'Relative localPath requires MCP roots, or set ZOWE_MCP_WORKSPACE_DIR / ZOWE_MCP_LOCAL_FILES_ROOT when the client does not support roots/list.'
    );
  }

  const firstFb = fallbackDirs[0];
  const abs = path.resolve(firstFb, trimmed);
  if (!isPathInsideDirectory(firstFb, abs)) {
    throw new LocalPathResolutionError(
      'Relative localPath escapes the fallback workspace directory.'
    );
  }
  return {
    absolutePath: abs,
    rootUri: pathToFileUriString(firstFb),
    source: 'fallback',
  };
}

function pathToFileUriString(dir: string): string {
  return pathToFileURL(dir).href;
}

/**
 * Realpath hardening: throws unless the path (after following symlinks) still lies under the
 * root directory (also realpath'd). For paths that do not exist yet (e.g. download targets),
 * the deepest existing ancestor is resolved and the remaining components are re-joined, so a
 * symlinked parent directory cannot smuggle the write outside the root. A dangling symlink is
 * rejected outright: reads fail anyway and writes would follow it to an unvalidated location.
 */
export function assertRealpathStillInsideRoot(
  rootDirAbsolute: string,
  resolvedFileAbsolute: string
): void {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootDirAbsolute);
  } catch {
    throw new LocalPathResolutionError(
      'Allowed root directory does not exist or cannot be resolved.'
    );
  }

  try {
    if (fs.lstatSync(resolvedFileAbsolute).isSymbolicLink()) {
      try {
        fs.realpathSync(resolvedFileAbsolute);
      } catch {
        throw new LocalPathResolutionError('Path is a symbolic link with an unresolvable target.');
      }
    }
  } catch (e) {
    if (e instanceof LocalPathResolutionError) throw e;
    // Path does not exist yet — validated via its deepest existing ancestor below.
  }

  let existing = resolvedFileAbsolute;
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(existing);
      const realFile = suffix.length > 0 ? path.join(real, ...suffix) : real;
      if (!isPathInsideDirectory(realRoot, realFile)) {
        throw new LocalPathResolutionError(
          'Path resolves outside the allowed directory (symlink escape).'
        );
      }
      return;
    } catch (e) {
      if (e instanceof LocalPathResolutionError) throw e;
      const parent = path.dirname(existing);
      if (parent === existing) {
        throw new LocalPathResolutionError('Path cannot be resolved against the filesystem.');
      }
      suffix.unshift(path.basename(existing));
      existing = parent;
    }
  }
}
