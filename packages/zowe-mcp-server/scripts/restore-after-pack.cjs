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
const { restoreDist, restoreNodeModules } = require('./pack-state.cjs');

const serverPkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverPkgDir, '..', '..');
const packageJsonPath = path.join(serverPkgDir, 'package.json');
const backupPath = path.join(serverPkgDir, '.package.json.backup');

// Restore original package.json verbatim (byte-exact — preserves formatting,
// e.g. the trailing newline, so packing leaves the working tree clean).
if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, packageJsonPath);
  fs.unlinkSync(backupPath);
  console.log('Restored original package.json');
} else {
  console.warn('Warning: No backup package.json found to restore');
}

// Clean up temporary directories created by prepack
const dirsToClean = ['.unpack', '.extract-tmp', '.tgz', '.temp-extract', '.dist-esbuild-staging'];
for (const dir of dirsToClean) {
  const dirPath = path.join(serverPkgDir, dir);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`Cleaned up ${dir}/`);
  }
}

// Put the development node_modules (moved aside by prepack) back, discarding
// the production-only tree prepack created, and the tsc dist/ likewise —
// packing must not leave the esbuild bundle behind as dist/ (it would break
// `npm run inspector`, the e2e suites, ... until the next build).
if (restoreNodeModules({ prepackCreatedIt: true })) {
  console.log('Restored development node_modules/');
} else {
  console.log('Removed prepack node_modules/');
}
if (restoreDist()) {
  console.log('Restored tsc-built dist/');
}

console.log('Restoring workspace dependencies...');
execSync('npm install --ignore-scripts', {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('Postpack cleanup complete.');
