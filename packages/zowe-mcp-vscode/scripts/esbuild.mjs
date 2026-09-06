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
 * esbuild driver for the VS Code extension.
 *
 * Produces two bundles:
 *  - The extension host (`src/extension.ts` -> `dist/extension.js`), a
 *    single CJS file. `vscode` and `@zowe/imperative` stay external:
 *    `vscode` is provided by the host at runtime, and `@zowe/imperative` is
 *    deliberately absent from the VSIX (src/zowe-profile.ts lazy-requires
 *    it in a try/catch and degrades gracefully when it's missing).
 *  - The MCP server (`@zowe/mcp-server`'s compiled `dist/index.js` and
 *    `dist/scripts/*.js`) -> the extension's `server/` directory, as ESM
 *    with code-splitting so the five entry points share one copy of their
 *    common code instead of duplicating it five times. `ssh2` (+ its
 *    optional native deps `cpu-features`/`nan`) and
 *    `@zowe/zowex-for-zowe-sdk` (native `.node` bindings + a `.pax.Z`
 *    payload) stay external — see bundle-server.js for how a minimal
 *    `server/node_modules` is assembled for them.
 *
 * The server-bundling half of this (entry points, externals, the `require`
 * banner, format/target/splitting settings) lives in the repo-root
 * `scripts/esbuild-server-config.cjs` instead of here, because
 * `packages/zowe-mcp-server/scripts/bundle-for-pack.cjs` (the npm `prepack`
 * step) needs the exact same configuration to bundle the same server code
 * into its own `dist/` before `npm pack`. Only the extension-host bundle
 * below is specific to this package.
 */

import * as esbuild from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildServer as buildServerShared,
  SERVER_EXTERNAL,
} from '../../../scripts/esbuild-server-config.cjs';

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPkgDir = path.resolve(extDir, '..', 'zowe-mcp-server');

const NODE_TARGET = 'node20';

export { SERVER_EXTERNAL };

/**
 * Bundles the extension host into a single CJS file at `dist/extension.js`.
 * Kept separate from the tsc `build` script (which still produces `out/`
 * for the VS Code integration test suite).
 */
export async function buildExtension() {
  await esbuild.build({
    entryPoints: [path.join(extDir, 'src', 'extension.ts')],
    outfile: path.join(extDir, 'dist', 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    external: ['vscode', '@zowe/imperative'],
    // No sourcemaps: keeping them out of server/ entirely avoids relying on
    // .vscodeignore's directory re-include (`!server/**`) also correctly
    // re-excluding `**/*.map` underneath it, which isn't reliable across
    // ignore-pattern engines. `minify: false` keeps stack traces (file/line
    // in the bundled output, original identifier names) useful without them.
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });
}

/**
 * Bundles @zowe/mcp-server's compiled `packages/zowe-mcp-server/dist` into
 * `outDir` (the extension's `server/` directory). Thin wrapper around the
 * shared `buildServer` in `scripts/esbuild-server-config.cjs` — see there
 * for the actual entry points, externals, and esbuild settings.
 */
export async function buildServer(outDir) {
  const serverDist = path.join(serverPkgDir, 'dist');
  await buildServerShared(serverDist, outDir);
}

// Allow running directly: `node scripts/esbuild.mjs [extension|server|all]`
const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const mode = process.argv[2] ?? 'extension';
  mkdirSync(path.join(extDir, 'dist'), { recursive: true });
  if (mode === 'extension' || mode === 'all') {
    await buildExtension();
    console.log('Extension bundled into dist/extension.js');
  }
  if (mode === 'server' || mode === 'all') {
    const outDir = path.join(extDir, 'server');
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    await buildServer(outDir);
    console.log(`Server bundled into ${path.relative(extDir, outDir)}/`);
  }
}
