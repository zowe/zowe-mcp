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
 * Shared esbuild configuration for bundling @zowe/mcp-server's compiled
 * `dist/` into a mostly self-contained ESM tree with code-splitting across
 * its five CLI entry points (`index.js` + four `scripts/*.js` helpers it
 * re-spawns itself into).
 *
 * Used by BOTH:
 *   - packages/zowe-mcp-vscode/scripts/esbuild.mjs — bundles into the
 *     extension's `server/` directory for VSIX packaging.
 *   - packages/zowe-mcp-server/scripts/bundle-for-pack.cjs — bundles into
 *     the server package's own `dist/`, replacing the tsc output, before
 *     `npm pack`.
 *
 * Keeping this in one place means the "what must stay external and why"
 * reasoning and the `require`-shim banner are defined once instead of
 * drifting between two copies that both need to change together whenever a
 * new native/`__dirname`-relative dependency shows up.
 *
 * This file is CommonJS (not ESM like esbuild.mjs) so both a plain `require`
 * from `bundle-for-pack.cjs` and Node's CJS-to-ESM interop from
 * `esbuild.mjs`'s `import` work without an async dynamic import — `esbuild`
 * itself ships a usable CJS entry point, so there's no need for this
 * particular file to be ESM.
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const NODE_TARGET = 'node20';

/**
 * esbuild rewrites `import.meta.url` (and hence any `__dirname`/`__filename`
 * derived from it) to point at whatever *output* file a module's code ends
 * up in, not its original source location — see the long comment in
 * `packages/zowe-mcp-server/src/runtime/asset-root.ts` for how the server
 * source copes with that. Bundling ESM output also needs a real `require`
 * for any inlined CommonJS dependency that calls it dynamically (Node
 * builtins pulled in through a `__commonJS`-wrapped package, etc.) — esbuild
 * throws "Dynamic require is not supported" without one. The banner below
 * supplies `require` for that purpose.
 *
 * Only `require` is shimmed here — NOT `__dirname`/`__filename`. Several
 * inlined dependencies (both ours and third-party, e.g. yargs' ESM
 * platform shim) compute their own top-level `const __dirname =
 * fileURLToPath(import.meta.url)`; injecting another top-level
 * `__dirname`/`__filename` binding via this banner collides with those
 * ("Identifier '__dirname' has already been declared") since they land in
 * the same output file/chunk. `require` doesn't have that problem: no
 * inlined ESM source in this codebase declares its own top-level `require`
 * (the handful that used to were renamed — see src/index.ts's `scriptDir`,
 * src/scripts/call-tool.ts's `scriptDir`, src/scripts/generate-docs.ts's
 * and src/tools/response.ts's `loadCjsModule` — specifically to avoid
 * colliding with this shim), and CJS dependencies esbuild wraps in
 * `__commonJS` never declare their own outer `require` either (they
 * reference the ambient one, which is exactly what `__require`'s
 * `typeof require !== "undefined"` fallback picks up).
 *
 * No shebang is injected here even though `dist/index.js` is the package's
 * `bin` target: esbuild automatically hoists a leading `#!` line already
 * present in an entry point's *input* source above whatever banner is
 * configured, once per output file, and never duplicates it. `src/index.ts`
 * (and `src/scripts/init-mock.ts`, `src/scripts/mock-zos.ts`) already carry
 * `#!/usr/bin/env node` as their first line, tsc preserves it verbatim into
 * `dist/*.js`, and esbuild in turn preserves it into the bundled output —
 * the same mechanism already verified working for the VSIX's
 * `server/index.js`. Adding an explicit shebang to this banner would risk a
 * doubled `#!` line on exactly those entry points.
 */
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
 *  - `@zowe/imperative` and `@zowe/zos-uss-for-zowe-sdk`: NOT here for
 *    native-binding reasons — our own code imports both, and esbuild can
 *    inline plain JS like theirs just fine. They're external because
 *    `@zowe/zowex-for-zowe-sdk` (itself external, above) declares them as
 *    `peerDependencies` and does its own top-level
 *    `require("@zowe/zos-uss-for-zowe-sdk")` / `require("@zowe/imperative")`
 *    at runtime. zowex's `require` resolves against real node_modules —
 *    it has no visibility into code esbuild inlined into *our* bundle, so
 *    if these were inlined, npm would never install a real copy for zowex
 *    to find and `require("@zowe/zos-uss-for-zowe-sdk")` would throw
 *    `Cannot find module` in any packed/installed tree (this shipped
 *    broken once already — mock mode masked it in every test that doesn't
 *    load zowex, since only the native/SSH backend ever requires it).
 *    Keeping them external instead makes both our code and zowex resolve
 *    the same single real installed copy — do not "fix" this by inlining
 *    them again while also letting npm install a second copy; that
 *    duplicates a large dependency tree for nothing.
 */
const SERVER_EXTERNAL = [
  'ssh2',
  'cpu-features',
  'nan',
  '@zowe/zowex-for-zowe-sdk',
  '@zowe/imperative',
  '@zowe/zos-uss-for-zowe-sdk',
  'hardstop-patterns',
];

/**
 * Bundles @zowe/mcp-server's compiled `serverDistDir` (the tsc + copy-resources
 * output — index.js, scripts/*.js, and everything they import) into `outDir`
 * as ESM with code-splitting. Only compiles what's already on disk in
 * `serverDistDir` — the caller is responsible for having run
 * `npm run build -w @zowe/mcp-server` (or equivalent) first.
 *
 * Output layout mirrors `serverDistDir`'s entry-point structure exactly
 * (`index.js` at the root, `scripts/<name>.js` one level down) so the
 * `resolve(scriptDir, 'scripts', ...)` / `resolve(scriptDir, 'tools', ...)`
 * calls in src/index.ts and src/scripts/call-tool.ts resolve identically
 * whether `outDir` is the VSIX extension's `server/` directory or the npm
 * package's own bundled `dist/`. Those five files are always entry points
 * here, never split into a shared chunk, so their own `import.meta.url`
 * reliably points at their own output file.
 */
async function buildServer(serverDistDir, outDir) {
  if (!fs.existsSync(path.join(serverDistDir, 'index.js'))) {
    throw new Error(
      `${serverDistDir}/index.js not found — run "npm run build -w @zowe/mcp-server" first.`
    );
  }

  const entryPoints = {
    index: path.join(serverDistDir, 'index.js'),
    'scripts/init-mock': path.join(serverDistDir, 'scripts', 'init-mock.js'),
    'scripts/generate-docs': path.join(serverDistDir, 'scripts', 'generate-docs.js'),
    'scripts/mock-zos': path.join(serverDistDir, 'scripts', 'mock-zos.js'),
    'scripts/call-tool': path.join(serverDistDir, 'scripts', 'call-tool.js'),
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
    // No sourcemaps: keeping them out avoids shipping extra files in either
    // consumer (the VSIX's .vscodeignore re-include rules, or the npm
    // tarball's file count). `minify: false` keeps stack traces (file/line
    // in the bundled output, original identifier names) useful without them.
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });
}

module.exports = {
  NODE_TARGET,
  SERVER_BANNER,
  SERVER_EXTERNAL,
  buildServer,
};
