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
 * Bundles @zowe/mcp-server into the extension's `server/` directory for VSIX
 * packaging:
 *
 *  1. esbuild-bundles the server's compiled `dist/` (index.js + the four
 *     `scripts/*.js` CLI entry points it re-spawns itself into) as ESM with
 *     code-splitting, inlining everything except a handful of packages that
 *     can't be bundled as plain JS (native bindings, install scripts, or
 *     their own `__dirname`-relative asset loading) — see
 *     scripts/esbuild.mjs's SERVER_EXTERNAL for exactly which and why.
 *  2. Copies the runtime assets those bundled entries load relative to
 *     themselves at startup (resources/, tools/*\/*.json, cli-bridge
 *     plugins) into the same relative layout under `server/`.
 *  3. Assembles a *minimal* `server/node_modules` containing only the
 *     externals above (plus their own transitive deps) — not a full
 *     `npm install --omit=dev` of every production dependency, which is
 *     what used to blow the VSIX up to 18k+ files.
 *
 * This intentionally reuses only the file: tgz staging + install/dereference
 * helpers from `scripts/bundle-production-deps.cjs` (the workspace-dep
 * bundling and full-dependency-set install are no longer needed here — the
 * server's own code and its zowe-mcp-common workspace dependency are now
 * inlined by esbuild instead of npm-installed). `bundle-production-deps.cjs`
 * is also used unchanged by the standalone server's `pack:server`/airgap
 * flow — only this file's usage of it changed.
 */

const fs = require('fs');
const path = require('path');

const {
  prepareFileDepsForBundle,
  dereferenceSymlinks,
  npmInstallProduction,
  pruneNapiRsCli,
  pruneRuntimeDeadFiles,
  copyRuntimeAssets,
} = require('../../../scripts/bundle-production-deps.cjs');

const extDir = path.resolve(__dirname, '..');
const serverPkg = path.resolve(extDir, '..', 'zowe-mcp-server');
const repoRoot = path.resolve(extDir, '..', '..');
const targetDir = path.join(extDir, 'server');

/**
 * Directories (relative to repo root) that may contain file: tgz dependencies.
 * Each entry maps the prefix used in package.json (e.g. "file:../../bin/") to
 * the absolute directory where the tgz lives.
 */
const fileDepDirs = [
  { prefix: 'file:../../bin/', absDir: path.join(repoRoot, 'bin') },
  { prefix: 'file:../../deps/', absDir: path.join(repoRoot, 'deps') },
  { prefix: 'file:../../resources/', absDir: path.join(repoRoot, 'resources') },
];

// copyRuntimeAssets, pruneNapiRsCli, and pruneRuntimeDeadFiles now live in
// scripts/bundle-production-deps.cjs (shared with bundle-for-pack.cjs's npm
// pack/airgap flow) — see the require() destructure above.

// --- Main ---

async function main() {
  // esbuild.mjs is ESM (the package has no "type": "module"), so it must be
  // loaded via dynamic import() from this CommonJS script.
  const { buildServer, SERVER_EXTERNAL } = await import('./esbuild.mjs');

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, maxRetries: 3, retryDelay: 100 });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  console.log('esbuild-bundling @zowe/mcp-server into server/...');
  await buildServer(targetDir);

  console.log('Copying runtime assets into server/...');
  copyRuntimeAssets(path.join(serverPkg, 'dist'), targetDir);

  // These are exactly the assets the bundled code resolves at runtime via
  // resolveAsset's package-root fallback (see
  // packages/zowe-mcp-server/src/runtime/asset-root.ts) once its module code
  // has been esbuild-bundled and no longer lives next to the asset on disk.
  // If copy-resources.cjs (which populates dist/) or copyRuntimeAssets above
  // drifts and stops shipping one of these, we want the BUILD to fail here,
  // not the installed VSIX at first tool invocation.
  const REQUIRED_RUNTIME_ASSETS = [
    path.join('tools', 'tso', 'tso-command-patterns.json'),
    path.join('tools', 'console', 'console-command-patterns.json'),
    path.join('resources', 'dslevel-pattern.txt'),
  ];
  const missingAssets = REQUIRED_RUNTIME_ASSETS.filter(
    relPath => !fs.existsSync(path.join(targetDir, relPath))
  );
  if (missingAssets.length > 0) {
    throw new Error(
      `Missing required runtime asset(s) under server/ after copyRuntimeAssets: ${missingAssets.join(', ')}`
    );
  }

  // Copy vendor CLI plugin files into the bundle so the extension works with
  // vendor-extracted content (vendor/ is gitignored on develop but populated
  // via `npm run vendor:extract`).
  const vendorDir = path.join(repoRoot, 'vendor');
  const bundledPluginsDir = path.join(targetDir, 'tools', 'cli-bridge', 'plugins');
  if (fs.existsSync(vendorDir)) {
    for (const vendorEntry of fs.readdirSync(vendorDir, { withFileTypes: true })) {
      if (!vendorEntry.isDirectory()) continue;
      const vPluginsDir = path.join(vendorDir, vendorEntry.name, 'cli-bridge-plugins');
      if (!fs.existsSync(vPluginsDir)) continue;
      fs.mkdirSync(bundledPluginsDir, { recursive: true });
      for (const f of fs.readdirSync(vPluginsDir)) {
        fs.cpSync(path.join(vPluginsDir, f), path.join(bundledPluginsDir, f));
      }
      console.log(
        `Bundled vendor CLI plugins from vendor/${vendorEntry.name}/cli-bridge-plugins/`
      );
    }
  }

  // Minimal server/package.json: just enough for Node to run the bundle
  // (name/version/type) plus dependencies for the externals esbuild left
  // un-inlined. Versions are taken from the real server package.json so
  // dependency bumps there propagate here automatically.
  const serverPackageJson = JSON.parse(
    fs.readFileSync(path.join(serverPkg, 'package.json'), 'utf-8')
  );
  const externalDeps = {};
  for (const name of SERVER_EXTERNAL) {
    if (name === 'cpu-features' || name === 'nan') continue; // ssh2's own optional deps
    const spec = serverPackageJson.dependencies?.[name];
    if (!spec) {
      throw new Error(`SERVER_EXTERNAL lists "${name}" but it isn't a dependency of ${serverPkg}`);
    }
    externalDeps[name] = spec;
  }
  const targetPackageJson = path.join(targetDir, 'package.json');
  fs.writeFileSync(
    targetPackageJson,
    JSON.stringify(
      {
        name: serverPackageJson.name,
        version: serverPackageJson.version,
        type: 'module',
        dependencies: externalDeps,
      },
      null,
      2
    )
  );

  // Rewrite file: tgz deps (@zowe/zowex-for-zowe-sdk) to .unpack/ local paths.
  prepareFileDepsForBundle({ targetDir, targetPackageJsonPath: targetPackageJson, fileDepDirs });

  console.log('Installing minimal server dependencies (externals only)...');
  npmInstallProduction(targetDir);
  dereferenceSymlinks(path.join(targetDir, 'node_modules'));

  console.log('Pruning unpack staging and stray devDependency leaks...');
  fs.rmSync(path.join(targetDir, '.unpack'), { recursive: true, force: true });
  fs.rmSync(path.join(targetDir, '.local'), { recursive: true, force: true });
  fs.rmSync(path.join(targetDir, 'package-lock.json'), { force: true });
  pruneNapiRsCli(path.join(targetDir, 'node_modules'));

  console.log('Pruning runtime-dead files (.ts/.mts/.cts, .mjs, .map, docs) from node_modules...');
  // pruneEsmVariants: true — this server/node_modules tree is reached
  // exclusively via CJS require (see pruneRuntimeDeadFiles's doc comment in
  // bundle-production-deps.cjs), so .mjs is dead weight here.
  const deadFilesPruned = pruneRuntimeDeadFiles(path.join(targetDir, 'node_modules'), {
    pruneEsmVariants: true,
  });
  console.log(`Pruned ${deadFilesPruned} runtime-dead files.`);

  // Install zowe-mcp-common into out/node_modules/ so the extension code
  // (out/extension.js, used by the VS Code integration test suite) can
  // resolve `require("zowe-mcp-common")` at runtime. The packaged
  // dist/extension.js bundle (scripts/esbuild.mjs) inlines zowe-mcp-common
  // directly and doesn't need this.
  const commonPkg = path.resolve(extDir, '..', 'zowe-mcp-common');
  const outDir = path.join(extDir, 'out');
  const outCommonDir = path.join(outDir, 'node_modules', 'zowe-mcp-common');
  fs.mkdirSync(outCommonDir, { recursive: true });
  const commonDistDir = path.join(commonPkg, 'dist');
  if (!fs.existsSync(commonDistDir)) {
    throw new Error('zowe-mcp-common has no dist/ — run "npm run build" first.');
  }
  fs.cpSync(commonDistDir, path.join(outCommonDir, 'dist'), { recursive: true });
  const commonPkgJson = JSON.parse(fs.readFileSync(path.join(commonPkg, 'package.json'), 'utf-8'));
  fs.writeFileSync(
    path.join(outCommonDir, 'package.json'),
    JSON.stringify(
      {
        name: commonPkgJson.name,
        version: commonPkgJson.version,
        main: commonPkgJson.main,
        types: commonPkgJson.types,
      },
      null,
      2
    )
  );

  console.log('Server bundled successfully into server/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
