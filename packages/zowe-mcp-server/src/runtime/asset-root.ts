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
 * Locates this package's own root directory and runtime asset root at
 * runtime, in a way that works across three very different layouts:
 *
 *  1. Source (vitest): modules run from `src/`, next to their own
 *     `*.json`/`*.txt` assets and one level below `package.json`.
 *  2. Unbundled tsc build (`npm pack` / the published npm package):
 *     modules run from `dist/`, which mirrors `src/`'s directory
 *     structure 1:1 (see `scripts/copy-resources.cjs`); `package.json`
 *     lives one level above `dist/`.
 *  3. esbuild-bundled into the VS Code extension's VSIX (`server/`):
 *     everything is inlined into a handful of entry files
 *     (`server/index.js`, `server/scripts/*.js`) plus shared chunks
 *     (`server/chunks/*.js`) for code reachable from more than one entry
 *     point. `server/package.json` is shipped directly inside `server/`.
 *
 * Bundling breaks any path resolution based on an individual module's own
 * `import.meta.url`: esbuild rewrites `import.meta.url` to point at the
 * *output* file the module's code physically ended up in, not its original
 * source location. For a module reachable from a single entry point that
 * is the entry file itself; for a module reachable from multiple entry
 * points (e.g. `server.ts`, imported by `index.ts`, `call-tool.ts`, and
 * `generate-docs.ts`) esbuild's code-splitting hoists it into a shared
 * chunk file, whose location (`server/chunks/<name>-<hash>.js`) is not
 * something callers can hardcode.
 *
 * Rather than hardcode a relative depth, we walk up from the *calling*
 * module's own `import.meta.url` until we find a `package.json` whose
 * `name` is `@zowe/mcp-server` (content-validated, not just
 * existence-checked, so we never accidentally latch onto an unrelated
 * package.json — e.g. the VS Code extension's own package.json one level
 * above `server/` when this module's code happens to be inlined directly
 * into the `server/index.js` entry rather than hoisted into a chunk).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_PACKAGE_NAME = '@zowe/mcp-server';

/** Minimal shape we care about from package.json. */
export interface ServerPackageJson {
  name?: string;
  version?: string;
  [key: string]: unknown;
}

/**
 * `ServerPackageJson` with `version` narrowed to a guaranteed non-empty
 * string. Returned only by `getServerPackageJson`, which validates the
 * field before handing the object back (see there for why).
 */
export type ServerPackageJsonWithVersion = ServerPackageJson & { version: string };

function readPackageJsonIfMatches(dir: string): ServerPackageJson | undefined {
  const candidate = join(dir, 'package.json');
  if (!existsSync(candidate)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as ServerPackageJson;
    return pkg.name === SERVER_PACKAGE_NAME ? pkg : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk up from the directory containing `importMetaUrl` until a
 * `package.json` named `@zowe/mcp-server` is found.
 */
function findServerPackageDir(importMetaUrl: string): { dir: string; pkg: ServerPackageJson } {
  let dir = dirname(fileURLToPath(importMetaUrl));
  // 12 levels is far more than any real layout needs; it just bounds the
  // walk instead of looping forever if something is badly misconfigured.
  for (let i = 0; i < 12; i++) {
    const pkg = readPackageJsonIfMatches(dir);
    if (pkg) return { dir, pkg };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `runtime-root: could not locate ${SERVER_PACKAGE_NAME}'s package.json by walking up ` +
      `from ${dirname(fileURLToPath(importMetaUrl))}`
  );
}

/**
 * Returns the parsed `package.json` for `@zowe/mcp-server` itself,
 * resolved relative to the calling module (pass its own `import.meta.url`).
 *
 * Throws if the located package.json has no non-empty `version` field. A
 * `@zowe/mcp-server` package.json without a version means some packaging
 * step upstream (esbuild bundling, npm pack, ...) produced a broken
 * `server/package.json` — we want that to fail loudly at startup, not
 * silently masquerade as some placeholder version.
 */
export function getServerPackageJson(importMetaUrl: string): ServerPackageJsonWithVersion {
  const { dir, pkg } = findServerPackageDir(importMetaUrl);
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(
      `runtime-root: ${SERVER_PACKAGE_NAME}'s package.json at ${join(dir, 'package.json')} ` +
        `has no version — this indicates a broken packaging step, not a valid release.`
    );
  }
  return pkg as ServerPackageJsonWithVersion;
}

/**
 * Resolves a runtime asset (a JSON pattern file, a `resources/*` text
 * file, ...) that ships next to the requesting module.
 *
 * `moduleRelativeParts` is the path relative to the calling module's own
 * directory, exactly as it would be in source (vitest) or the unbundled
 * tsc `dist/` build — both mirror `src/`'s directory structure 1:1, so the
 * asset is always found there directly. We deliberately check for the
 * asset's *actual presence* there rather than guessing whether we are
 * running from `src/` or `dist/` (a `dist/` directory may well exist
 * alongside `src/` from a previous build even while running tests from
 * source, so "does dist/ exist" is not a reliable signal).
 *
 * `packageRootRelativeParts` is the fallback path relative to the package
 * root, used only once the first attempt comes up empty — i.e. once this
 * module's code has been esbuild-bundled and no longer lives next to the
 * asset on disk (inlined into an entry file or hoisted into a shared
 * chunk). Assets are copied into the bundled `server/` layout at exactly
 * this path (see `packages/zowe-mcp-vscode/scripts/bundle-server.js`).
 *
 * The direct probe is only accepted if the resulting path both exists AND
 * resolves inside the server package directory. Existence alone isn't
 * enough: in the esbuild-bundled layout, `moduleRelativeParts` can contain
 * `..` segments deep enough (e.g. `['..', '..', 'resources',
 * 'dslevel-pattern.txt']`) to walk out of the server package entirely once
 * `moduleDir` is some `server/chunks/` directory rather than the source
 * location the parts were written relative to — at that point the joined
 * path could coincidentally exist elsewhere on disk (a sibling package, an
 * unrelated file with the same name) and we'd silently resolve to the
 * wrong asset instead of falling through to the fallback. Requiring
 * containment means a coincidental match outside the package is rejected
 * and we fall through instead of returning a bogus path.
 */
export function resolveAsset(
  importMetaUrl: string,
  moduleRelativeParts: string[],
  packageRootRelativeParts: string[]
): string {
  const moduleDir = dirname(fileURLToPath(importMetaUrl));
  const direct = join(moduleDir, ...moduleRelativeParts);

  // findServerPackageDir is needed either way (to bound the direct probe or
  // to build the fallback), so resolve it once up front rather than only on
  // the fallback path.
  const { dir: packageDir } = findServerPackageDir(importMetaUrl);

  if (existsSync(direct)) {
    const resolvedDirect = resolve(direct);
    const resolvedPackageDir = resolve(packageDir);
    const isContained =
      resolvedDirect === resolvedPackageDir || resolvedDirect.startsWith(resolvedPackageDir + sep);
    if (isContained) return direct;
  }

  return join(packageDir, ...packageRootRelativeParts);
}
