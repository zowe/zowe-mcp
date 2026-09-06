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
 * Prepares the npm-pack tarball so it can be installed offline (no registry,
 * no monorepo, no external file: dependencies) while staying small.
 *
 * This used to do a full `npm install --omit=dev` of all 17 production
 * dependencies into `node_modules` (bundledDependencies), the same shape as
 * a plain `npm install` in an app that depends on this package. That was
 * simple but expensive: ~26.6 MB download, ~76.6 MB unpacked, 10,456 files.
 * Most of that weight is dependencies whose entire compiled JS this
 * package's own code is small enough to just inline.
 *
 * This version instead mirrors the VS Code extension's approach (see
 * `packages/zowe-mcp-vscode/scripts/bundle-server.js`, which solves the
 * identical problem for the identical server code): esbuild-bundle the
 * compiled `dist/` into a handful of entry points with code-splitting, and
 * only npm-install the small set of packages that can't be inlined (native
 * bindings, install scripts, or their own `__dirname`-relative asset
 * loading — see `scripts/esbuild-server-config.cjs`'s `SERVER_EXTERNAL` for
 * exactly which and why).
 *
 * Strategy:
 *   1. Backup package.json (byte-exact, for postpack to restore).
 *   2. esbuild-bundle the tsc-built `dist/` in place: bundle into a staging
 *      directory, copy the runtime assets `copy-resources.cjs` put into the
 *      tsc `dist/` (resources/, tools/**\/*.json, tools/cli-bridge/**) into
 *      that same staging directory, ALSO copy the tsc-emitted `.d.ts` files
 *      (esbuild doesn't emit declarations, but `package.json`'s `types:
 *      "dist/index.d.ts"` is a real contract for anyone doing `import type
 *      ... from '@zowe/mcp-server'`, and `dist/index.d.ts`'s own relative
 *      imports need the rest of the `.d.ts` tree to actually resolve — ~124
 *      files / ~350 KB, a rounding error against the ~11 MB the bundle
 *      saves), then swap the staging directory in as the new `dist/`.
 *      `main`/`types`/`bin` all stay `dist/index.js` (or `dist/index.d.ts`)
 *      — no consumer-visible path changes — because the bundle is written
 *      into `dist/` itself rather than some other directory.
 *   3. Prune `dependencies` down to just `SERVER_EXTERNAL`'s own packages
 *      (everything else is now inlined by esbuild and would otherwise be
 *      npm-installed for nothing). `zowe-mcp-common` — previously handled
 *      by staging a local copy under `.local/` because the unbundled ESM
 *      tree needed a real `node_modules/zowe-mcp-common` to `import` at
 *      runtime — is dropped from `dependencies` entirely for the same
 *      reason: esbuild inlines its compiled `dist/` directly into this
 *      package's own bundle, so nothing resolves it as a package at runtime
 *      any more. (It was also never a real fix for offline installs on its
 *      own: `"zowe-mcp-common": "*"` doesn't resolve against the public
 *      registry — bundledDependencies papered over that. Removing it here
 *      removes the papering-over along with the dependency.)
 *   4. Rewrite the file: tgz dependency (`@zowe/zowex-for-zowe-sdk`) in
 *      place, same as before.
 *   5. Copy the rewritten package.json to an isolated temp directory
 *      (outside the monorepo so npm install doesn't hoist deps to root).
 *   6. Run `npm install --omit=dev --omit=optional` in the isolated dir.
 *      `--omit=optional` is the big remaining win: it drops `russh`, an
 *      optionalDependency of `@zowe/zowex-for-zowe-sdk` shipping ~33 MB
 *      across 7 platform-specific native prebuilds. It backs the SDK's
 *      `createClient(useNativeSsh)` path, which nothing in this repo ever
 *      enables (the server always talks SSH through `ssh2`/`node-ssh`) — see
 *      `npmInstallProduction`'s doc comment in
 *      `scripts/bundle-production-deps.cjs` for the full reasoning. If a
 *      future change turns `useNativeSsh` on, `russh` needs to come back
 *      (either by installing without `--omit=optional`, or by staging it
 *      the way the zowex tgz itself is staged).
 *   7. Dereference symlinks created by the file: dep.
 *   8. Prune dead weight: `@napi-rs/cli` (a russh devDependency npm installs
 *      anyway) and runtime-dead files. Unlike the pre-esbuild version of
 *      this script, `.mjs` files ARE dead weight here now — this
 *      node_modules tree backs a BUNDLED server (same as the VSIX's
 *      `server/node_modules`), not an unbundled ESM tree, so `pruneEsmVariants:
 *      true` is correct — see `pruneRuntimeDeadFiles`'s doc comment in
 *      bundle-production-deps.cjs.
 *   9. Copy the resulting node_modules back into the package.
 *  10. Add `bundledDependencies: true` for npm pack.
 *
 * Runs as a prepack script (before npm pack), which itself runs after
 * `npm run build -w @zowe/mcp-server` (see the root `pack:server` script) —
 * so `dist/` already holds the tsc + copy-resources output when this runs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  prepareFileDepsForBundle,
  dereferenceSymlinks,
  npmInstallProduction,
  pruneNapiRsCli,
  pruneRuntimeDeadFiles,
  copyRuntimeAssets,
} = require('../../../scripts/bundle-production-deps.cjs');
const { buildServer, SERVER_EXTERNAL } = require('../../../scripts/esbuild-server-config.cjs');

const serverPkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverPkgDir, '..', '..');
const packageJsonPath = path.join(serverPkgDir, 'package.json');
const backupPath = path.join(serverPkgDir, '.package.json.backup');
const distDir = path.join(serverPkgDir, 'dist');
// Staging directory for the esbuild output, outside dist/ itself — esbuild
// reads dist/*.js as input while it bundles, so it can't also be told to
// write its output into the same directory it's reading from mid-build.
const distStagingDir = path.join(serverPkgDir, '.dist-esbuild-staging');

const fileDepDirs = [
  { prefix: 'file:../../bin/', absDir: path.join(repoRoot, 'bin') },
  { prefix: 'file:../../deps/', absDir: path.join(repoRoot, 'deps') },
  { prefix: 'file:../../resources/', absDir: path.join(repoRoot, 'resources') },
];

// These are exactly the assets the bundled code resolves at runtime via
// resolveAsset's package-root fallback (see
// packages/zowe-mcp-server/src/runtime/asset-root.ts) once its module code
// has been esbuild-bundled and no longer lives next to the asset on disk. If
// copy-resources.cjs (which populates the tsc dist/) or copyRuntimeAssets
// drifts and stops shipping one of these, we want the BUILD to fail here,
// not the installed package at first tool invocation.
const REQUIRED_RUNTIME_ASSETS = [
  path.join('tools', 'tso', 'tso-command-patterns.json'),
  path.join('tools', 'console', 'console-command-patterns.json'),
  path.join('resources', 'dslevel-pattern.txt'),
];

/**
 * Copies just the `.d.ts` declaration files from `srcDir` (the tsc `dist/`)
 * into `destDir` (the esbuild staging dir), preserving relative paths.
 * esbuild doesn't emit declarations when bundling plain `.js`, but
 * `package.json`'s `types: "dist/index.d.ts"` is a real external contract —
 * dropping it would leave that field pointing at a file that doesn't exist.
 * `dist/index.d.ts` itself re-exports from sibling modules (`./log`,
 * `./events`, ...) via relative imports, so the whole `.d.ts` tree needs to
 * come along, not just the one entry file.
 *
 * `.d.ts.map` sourcemaps are deliberately EXCLUDED (matched by name ending
 * in `.d.ts`, not `.d.ts.map`): they map declaration positions back to the
 * tsc-emitted `.js` files that this same prepack step just deleted when it
 * swapped `dist/` for the bundle — a sourcemap pointing at a file that no
 * longer exists is worse than no sourcemap, so shipping it would be pure
 * dead weight.
 *
 * Note this never runs afoul of `pruneRuntimeDeadFiles`'s own `.ts` (which
 * also matches `.d.ts`) pruning below: that function is only ever called on
 * `<isoDir>/node_modules` (see step 8), never on `dist/` — the two don't
 * interact.
 */
function copyTypeDeclarations(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTypeDeclarations(srcPath, destPath);
    } else if (entry.name.endsWith('.d.ts')) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  if (!fs.existsSync(path.join(distDir, 'index.js'))) {
    throw new Error(
      `${distDir}/index.js not found — run "npm run build -w @zowe/mcp-server" first ` +
        '(the root "pack:server" script does this automatically).'
    );
  }

  // 1. Backup original package.json verbatim (byte-exact, so postpack can
  //    restore it without changing formatting — e.g. the trailing newline).
  fs.copyFileSync(packageJsonPath, backupPath);

  // Everything after the backup is wrapped so a failure restores the
  // original package.json and removes scratch dirs — otherwise a crash here
  // leaves the repo half-rewritten (postpack, which restores, only runs
  // after a *successful* pack).
  try {
    // 2. esbuild-bundle the tsc dist/ into a staging directory, copy the
    //    runtime assets alongside it, then swap it in as the new dist/.
    console.log('esbuild-bundling dist/ for pack...');
    fs.rmSync(distStagingDir, { recursive: true, force: true });
    fs.mkdirSync(distStagingDir, { recursive: true });
    await buildServer(distDir, distStagingDir);
    copyRuntimeAssets(distDir, distStagingDir);
    copyTypeDeclarations(distDir, distStagingDir);

    const missingAssets = REQUIRED_RUNTIME_ASSETS.filter(
      relPath => !fs.existsSync(path.join(distStagingDir, relPath))
    );
    if (missingAssets.length > 0) {
      throw new Error(
        `Missing required runtime asset(s) under dist/ after bundling: ${missingAssets.join(', ')}`
      );
    }

    fs.rmSync(distDir, { recursive: true, force: true });
    fs.renameSync(distStagingDir, distDir);

    // 3. Prune dependencies down to SERVER_EXTERNAL's own packages —
    //    everything else is now inlined into dist/ by esbuild and would
    //    otherwise be npm-installed (and shipped) for nothing.
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const externalDeps = {};
    for (const name of SERVER_EXTERNAL) {
      if (name === 'cpu-features' || name === 'nan') continue; // ssh2's own optional deps, not ours
      const spec = pkg.dependencies?.[name];
      if (!spec) {
        throw new Error(
          `SERVER_EXTERNAL lists "${name}" but it isn't a dependency of ${packageJsonPath}`
        );
      }
      externalDeps[name] = spec;
    }
    pkg.dependencies = externalDeps;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));

    // 4. Rewrite the file: tgz dependency (zowex) in-place (workspace deps
    //    like zowe-mcp-common no longer apply — see the file-header comment).
    prepareFileDepsForBundle({
      targetDir: serverPkgDir,
      targetPackageJsonPath: packageJsonPath,
      fileDepDirs,
    });

    // 5. Create an isolated temp directory and copy the rewritten
    //    package.json plus the .unpack/ directory into it. This is outside
    //    the monorepo so npm install doesn't hoist deps to the workspace
    //    root.
    const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-mcp-pack-'));
    fs.cpSync(packageJsonPath, path.join(isoDir, 'package.json'));
    const unpackDir = path.join(serverPkgDir, '.unpack');
    if (fs.existsSync(unpackDir)) {
      fs.cpSync(unpackDir, path.join(isoDir, '.unpack'), { recursive: true });
    }

    // 6. Run npm install in the isolated directory. --omit=optional drops
    //    russh (see the file-header comment and npmInstallProduction's own
    //    doc comment for why that's safe today).
    console.log('Installing production dependencies (externals only) in isolated directory...');
    npmInstallProduction(isoDir, { omitOptional: true });

    // 7. Dereference symlinks created by the file: dep.
    dereferenceSymlinks(path.join(isoDir, 'node_modules'));

    // 8. Prune dead weight from the isolated node_modules before it's
    //    copied into the package: @napi-rs/cli and runtime-dead files,
    //    including .mjs — this tree backs a BUNDLED server now (see the
    //    file-header comment), so pruneEsmVariants: true is correct here,
    //    unlike before this refactor.
    console.log('Pruning @napi-rs/cli and runtime-dead files from isolated node_modules...');
    pruneNapiRsCli(path.join(isoDir, 'node_modules'));
    const deadFilesPruned = pruneRuntimeDeadFiles(path.join(isoDir, 'node_modules'), {
      pruneEsmVariants: true,
    });
    console.log(`Pruned ${deadFilesPruned} runtime-dead files.`);

    // 9. Copy the node_modules tree into the server package directory.
    const targetNodeModules = path.join(serverPkgDir, 'node_modules');
    if (fs.existsSync(targetNodeModules)) {
      fs.rmSync(targetNodeModules, { recursive: true, force: true });
    }
    fs.cpSync(path.join(isoDir, 'node_modules'), targetNodeModules, { recursive: true });

    // Clean up the temp directory.
    fs.rmSync(isoDir, { recursive: true, force: true });

    // 10. Add bundledDependencies: true so npm pack includes the
    //     node_modules/ tree. This flag is NOT in the committed
    //     package.json (it would cause npm install to skip deps during
    //     development). We add it here only for the pack phase.
    const finalPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    finalPkg.bundledDependencies = true;
    fs.writeFileSync(packageJsonPath, JSON.stringify(finalPkg, null, 2));
    console.log(
      'Prepack complete — bundledDependencies will include node_modules/ in the tarball.'
    );
  } catch (err) {
    // Restore the original package.json and remove scratch dirs so a failed
    // prepack doesn't leave the working tree broken (which then breaks npm
    // ci). dist/ is intentionally left alone here even if the swap already
    // happened — restore-after-pack.cjs (postpack) removes it unconditionally
    // so the next `npm run build` produces a clean tsc output either way.
    if (fs.existsSync(backupPath)) {
      fs.writeFileSync(packageJsonPath, fs.readFileSync(backupPath, 'utf-8'));
      fs.unlinkSync(backupPath);
    }
    for (const dir of ['.local', '.unpack', '.extract-tmp', distStagingDir]) {
      fs.rmSync(path.isAbsolute(dir) ? dir : path.join(serverPkgDir, dir), {
        recursive: true,
        force: true,
      });
    }
    throw err;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
