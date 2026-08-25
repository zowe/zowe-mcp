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
 * esbuild rewrites `import.meta.url` (and hence any `__dirname`/`__filename`
 * derived from it) to point at whatever *output* file a module's code ends
 * up in, not its original source location — see the long comment in
 * `packages/zowe-mcp-server/src/runtime/asset-root.ts` for how the server
 * source copes with that. Bundling ESM output also needs a real `require`
 * for any inlined CommonJS dependency that calls it dynamically (Node
 * builtins pulled in through a `__commonJS`-wrapped package, etc.) — esbuild
 * throws "Dynamic require is not supported" without one. The banner below
 * supplies `require`/`__filename`/`__dirname` for that purpose. A handful of
 * this package's own entry points already declare their own (needed so they
 * keep working when run unbundled from `dist/`); those were deliberately
 * renamed away from the standard names in src/index.ts, src/scripts/call-tool.ts
 * `scriptDir`, src/scripts/generate-docs.ts and src/tools/response.ts
 * `loadCjsModule` so they can't collide with this banner.
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPkgDir = path.resolve(extDir, '..', 'zowe-mcp-server');

const NODE_TARGET = 'node20';

// Only `require` is shimmed here — NOT `__dirname`/`__filename`. Several
// inlined dependencies (both ours and third-party, e.g. yargs' ESM
// platform shim) compute their own top-level `const __dirname =
// fileURLToPath(import.meta.url)`; injecting another top-level
// `__dirname`/`__filename` binding via this banner collides with those
// ("Identifier '__dirname' has already been declared") since they land in
// the same output file/chunk. `require` doesn't have that problem: no
// inlined ESM source in this codebase declares its own top-level `require`
// (the handful that used to were renamed — see src/index.ts's `scriptDir`,
// src/scripts/call-tool.ts's `scriptDir`, src/scripts/generate-docs.ts's
// and src/tools/response.ts's `loadCjsModule` — specifically to avoid
// colliding with this shim), and CJS dependencies esbuild wraps in
// `__commonJS` never declare their own outer `require` either (they
// reference the ambient one, which is exactly what `__require`'s
// `typeof require !== "undefined"` fallback picks up).
const SERVER_BANNER = [
  'import { createRequire as __zoweMcpCreateRequire } from "node:module";',
  'const require = __zoweMcpCreateRequire(import.meta.url);',
].join('\n');

/**
 * External packages for the server bundle: kept as real node_modules,
 * never inlined.
 *  - `ssh2` (+ its optional native deps `cpu-features`/`nan`) and
 *    `@zowe/zowex-for-zowe-sdk`: native `.node` bindings / install scripts
 *    that can't be bundled as plain JS.
 *  - `hardstop-patterns`: loads its `patterns/*.json` files via its own
 *    top-level `path.join(__dirname, 'patterns')` (real CommonJS
 *    `__dirname`, not `import.meta.url`-derived). If inlined, that
 *    `__dirname` reference has nothing to bind to in bundled ESM output
 *    (Node throws "__dirname is not defined in ES module scope") — keeping
 *    it external lets it resolve its own patterns/ directory normally.
 */
export const SERVER_EXTERNAL = [
  'ssh2',
  'cpu-features',
  'nan',
  '@zowe/zowex-for-zowe-sdk',
  'hardstop-patterns',
];

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
 * Bundles @zowe/mcp-server's compiled `dist/` into `outDir` (the
 * extension's `server/` directory) as ESM with code-splitting across the
 * five CLI entry points. Only compiles what's already in
 * `packages/zowe-mcp-server/dist` — run `npm run build -w @zowe/mcp-server`
 * first.
 *
 * Output layout mirrors dist/'s entry-point structure exactly
 * (`index.js` at the root, `scripts/<name>.js` one level down) so the
 * `resolve(scriptDir, 'scripts', ...)` / `resolve(scriptDir, 'tools', ...)`
 * calls in src/index.ts and src/scripts/call-tool.ts resolve identically in
 * both the unbundled `dist/` build and this bundled layout — those files
 * are always entry points here, never split into a shared chunk, so their
 * own `import.meta.url` reliably points at their own output file.
 */
export async function buildServer(outDir) {
  const serverDist = path.join(serverPkgDir, 'dist');
  if (!existsSync(path.join(serverDist, 'index.js'))) {
    throw new Error(
      `${serverDist}/index.js not found — run "npm run build -w @zowe/mcp-server" first.`
    );
  }

  const entryPoints = {
    index: path.join(serverDist, 'index.js'),
    'scripts/init-mock': path.join(serverDist, 'scripts', 'init-mock.js'),
    'scripts/generate-docs': path.join(serverDist, 'scripts', 'generate-docs.js'),
    'scripts/mock-zos': path.join(serverDist, 'scripts', 'mock-zos.js'),
    'scripts/call-tool': path.join(serverDist, 'scripts', 'call-tool.js'),
  };

  await esbuild.build({
    entryPoints,
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: NODE_TARGET,
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    external: SERVER_EXTERNAL,
    banner: { js: SERVER_BANNER },
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
