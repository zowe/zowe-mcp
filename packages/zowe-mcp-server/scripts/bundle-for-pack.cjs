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
 * Prepares a self-contained node_modules tree before npm pack so the resulting
 * tarball can be installed offline without requiring the monorepo, a registry,
 * or external file: dependencies.
 *
 * Strategy (mirrors the working VSIX bundle-server.js):
 *   1. Backup package.json
 *   2. Rewrite workspace deps and file: tgz deps in-place
 *   3. Copy the rewritten package.json to an isolated temp directory (outside
 *      the monorepo so npm install doesn't hoist deps to root)
 *   4. Run `npm install --omit=dev` in the isolated dir
 *   5. Dereference symlinks
 *   6. Prune dead weight (@napi-rs/cli, runtime-dead files — but keep .mjs,
 *      since this tree is consumed as real ESM; see the CJS-vs-ESM note at
 *      that step below)
 *   7. Copy the resulting node_modules back
 *   8. Add bundledDependencies: true for npm pack
 *
 * Runs as a prepack script (before npm pack).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  bundleWorkspaceDep,
  prepareFileDepsForBundle,
  dereferenceSymlinks,
  npmInstallProduction,
  pruneNapiRsCli,
  pruneRuntimeDeadFiles,
} = require('../../../scripts/bundle-production-deps.cjs');

const serverPkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverPkgDir, '..', '..');
const commonPkgDir = path.join(repoRoot, 'packages', 'zowe-mcp-common');
const packageJsonPath = path.join(serverPkgDir, 'package.json');
const backupPath = path.join(serverPkgDir, '.package.json.backup');

const fileDepDirs = [
  { prefix: 'file:../../bin/', absDir: path.join(repoRoot, 'bin') },
  { prefix: 'file:../../deps/', absDir: path.join(repoRoot, 'deps') },
  { prefix: 'file:../../resources/', absDir: path.join(repoRoot, 'resources') },
];

// 1. Backup original package.json verbatim (byte-exact, so postpack can restore
//    it without changing formatting — e.g. the trailing newline).
fs.copyFileSync(packageJsonPath, backupPath);

// Everything after the backup is wrapped so a failure restores the original
// package.json and removes scratch dirs — otherwise a crash here leaves the repo
// half-rewritten (postpack, which restores, only runs after a *successful* pack).
try {
  // 2. Rewrite deps in-place (workspace → .local/, file: tgz → .unpack/)
  bundleWorkspaceDep({
    targetDir: serverPkgDir,
    targetPackageJsonPath: packageJsonPath,
    depName: 'zowe-mcp-common',
    depSourceDir: commonPkgDir,
  });

  prepareFileDepsForBundle({
    targetDir: serverPkgDir,
    targetPackageJsonPath: packageJsonPath,
    fileDepDirs,
  });

  // 3. Create an isolated temp directory and copy the rewritten package.json
  //    plus the .local/ and .unpack/ directories into it. This is outside the
  //    monorepo so npm install doesn't hoist deps to the workspace root.
  const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-mcp-pack-'));
  fs.cpSync(packageJsonPath, path.join(isoDir, 'package.json'));
  for (const dir of ['.local', '.unpack']) {
    const src = path.join(serverPkgDir, dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(isoDir, dir), { recursive: true });
    }
  }

  // 4. Run npm install in the isolated directory
  console.log('Installing production dependencies in isolated directory...');
  npmInstallProduction(isoDir);

  // 5. Dereference symlinks created by file: deps
  dereferenceSymlinks(path.join(isoDir, 'node_modules'));

  // 6. Prune dead weight from the isolated node_modules before it's copied
  //    into the package: @napi-rs/cli (a russh devDependency npm installs
  //    anyway, never needed at runtime) and dead runtime files. The packed
  //    server runs UNBUNDLED as ESM (tsc build, "type": "module", real
  //    `import` statements) — those `import`s resolve into dependencies
  //    through the dependencies' own package.json "exports"/"import"
  //    conditions, which often point at a .mjs file for the ESM entry
  //    point, so .mjs MUST be kept here (pruneEsmVariants: false). See
  //    scripts/bundle-production-deps.cjs for the full CJS-vs-ESM
  //    reasoning (bundle-server.js, the VSIX's pure-CJS require tree,
  //    prunes .mjs; this unbundled ESM tree must not).
  console.log('Pruning @napi-rs/cli and runtime-dead files from isolated node_modules...');
  pruneNapiRsCli(path.join(isoDir, 'node_modules'));
  const deadFilesPruned = pruneRuntimeDeadFiles(path.join(isoDir, 'node_modules'), {
    pruneEsmVariants: false,
  });
  console.log(`Pruned ${deadFilesPruned} runtime-dead files.`);

  // 7. Copy the node_modules tree into the server package directory
  const targetNodeModules = path.join(serverPkgDir, 'node_modules');
  if (fs.existsSync(targetNodeModules)) {
    fs.rmSync(targetNodeModules, { recursive: true, force: true });
  }
  fs.cpSync(path.join(isoDir, 'node_modules'), targetNodeModules, { recursive: true });

  // Clean up the temp directory
  fs.rmSync(isoDir, { recursive: true, force: true });

  // 8. Add bundledDependencies: true so npm pack includes the node_modules/ tree.
  //    This flag is NOT in the committed package.json (it would cause npm install
  //    to skip deps during development). We add it here only for the pack phase.
  const modifiedPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  modifiedPkg.bundledDependencies = true;
  fs.writeFileSync(packageJsonPath, JSON.stringify(modifiedPkg, null, 2));
  console.log('Prepack complete — bundledDependencies will include node_modules/ in the tarball.');
} catch (err) {
  // Restore the original package.json and remove scratch dirs so a failed
  // prepack doesn't leave the working tree broken (which then breaks npm ci).
  if (fs.existsSync(backupPath)) {
    fs.writeFileSync(packageJsonPath, fs.readFileSync(backupPath, 'utf-8'));
    fs.unlinkSync(backupPath);
  }
  for (const dir of ['.local', '.unpack', '.extract-tmp']) {
    fs.rmSync(path.join(serverPkgDir, dir), { recursive: true, force: true });
  }
  throw err;
}
