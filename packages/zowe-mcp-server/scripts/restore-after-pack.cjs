/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 */

/**
 * Restores the original package.json after npm pack completes and cleans up
 * the temporary directories created by the prepack script.
 *
 * Runs as a postpack script (after npm pack).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const serverPkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverPkgDir, '..', '..');
const packageJsonPath = path.join(serverPkgDir, 'package.json');
const backupPath = path.join(serverPkgDir, '.package.json.backup');

// Restore original package.json
if (fs.existsSync(backupPath)) {
  const originalPkg = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
  fs.writeFileSync(packageJsonPath, JSON.stringify(originalPkg, null, 2));
  fs.unlinkSync(backupPath);
  console.log('Restored original package.json');
} else {
  console.warn('Warning: No backup package.json found to restore');
}

// Clean up temporary directories created by prepack
const dirsToClean = ['.local', '.unpack', '.extract-tmp', '.tgz', '.temp-extract'];
for (const dir of dirsToClean) {
  const dirPath = path.join(serverPkgDir, dir);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`Cleaned up ${dir}/`);
  }
}

// Remove the production node_modules tree that prepack created and
// restore workspace state with a fresh npm install from the repo root.
const nodeModulesPath = path.join(serverPkgDir, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  fs.rmSync(nodeModulesPath, { recursive: true, force: true });
  console.log('Removed prepack node_modules/');
}

console.log('Restoring workspace dependencies...');
execSync('npm install --ignore-scripts', {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('Postpack cleanup complete.');
