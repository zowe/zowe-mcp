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
 *   5. Copy the resulting node_modules back, dereference symlinks
 *   6. Add bundledDependencies: true for npm pack
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

// 1. Backup original package.json
const originalPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
fs.writeFileSync(backupPath, JSON.stringify(originalPkg, null, 2));

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

// 6. Copy the node_modules tree into the server package directory
const targetNodeModules = path.join(serverPkgDir, 'node_modules');
if (fs.existsSync(targetNodeModules)) {
  fs.rmSync(targetNodeModules, { recursive: true, force: true });
}
fs.cpSync(path.join(isoDir, 'node_modules'), targetNodeModules, { recursive: true });

// Clean up the temp directory
fs.rmSync(isoDir, { recursive: true, force: true });

// 7. Add bundledDependencies: true so npm pack includes the node_modules/ tree.
//    This flag is NOT in the committed package.json (it would cause npm install
//    to skip deps during development). We add it here only for the pack phase.
const modifiedPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
modifiedPkg.bundledDependencies = true;
fs.writeFileSync(packageJsonPath, JSON.stringify(modifiedPkg, null, 2));
console.log('Prepack complete — bundledDependencies will include node_modules/ in the tarball.');
