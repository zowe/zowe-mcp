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
const dirsToClean = [
  '.local',
  '.unpack',
  '.extract-tmp',
  '.tgz',
  '.temp-extract',
  '.dist-esbuild-staging',
];
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

// Remove the esbuild-bundled dist/ prepack left behind. tsc's incremental
// output only ever adds/updates files for current source modules — it never
// deletes stray files (like the bundle's dist/chunks/*.js, which have no
// corresponding source module) that are no longer part of its output. Left
// in place, those would silently linger through the next `npm run build`
// instead of being cleaned up, so we remove dist/ entirely here and let the
// next build regenerate it from scratch.
const distPath = path.join(serverPkgDir, 'dist');
if (fs.existsSync(distPath)) {
  fs.rmSync(distPath, { recursive: true, force: true });
  console.log(
    'Removed prepack-bundled dist/ (run "npm run build -w @zowe/mcp-server" to rebuild)'
  );
}

console.log('Restoring workspace dependencies...');
execSync('npm install --ignore-scripts', {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('Postpack cleanup complete.');
