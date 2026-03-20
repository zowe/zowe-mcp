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
 * Restores the original package.json after npm pack completes.
 * Cleans up bundled directories (.local/, .tgz/, and local node_modules/).
 *
 * Runs as a postpack script (after npm pack).
 */

const fs = require('fs');
const path = require('path');

const serverPkgDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(serverPkgDir, 'package.json');
const backupPath = path.join(serverPkgDir, '.package.json.backup');

// Restore original package.json (this restores the original files array too)
if (fs.existsSync(backupPath)) {
  const originalPkg = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
  fs.writeFileSync(packageJsonPath, JSON.stringify(originalPkg, null, 2));
  fs.unlinkSync(backupPath);
  console.log('Restored original package.json (including files array)');
} else {
  console.warn('Warning: No backup package.json found to restore');
}

// Clean up any temporary directories (if they exist)
// Note: .local/ and .tgz/ are no longer created, but clean up if they exist from old runs
const dirsToClean = ['.local', '.tgz', '.temp-extract'];
for (const dir of dirsToClean) {
  const dirPath = path.join(serverPkgDir, dir);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`Cleaned up ${dir}/`);
  }
}

// Clean up local node_modules (only the production deps we copied, keep dev deps)
// We only remove packages that were copied during prepack, not all of node_modules
const nodeModulesPath = path.join(serverPkgDir, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  // Read the current package.json to see what dependencies should be removed
  const currentPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const prodDeps = Object.keys(currentPkg.dependencies || {});
  
  // Remove production dependencies that were copied (but keep dev deps like vitest)
  for (const depName of prodDeps) {
    // Skip workspace/file deps - they're not in node_modules
    if (depName === 'zowe-mcp-common' || depName === 'zowe-native-proto-sdk') {
      continue;
    }
    
    const depPath = path.join(nodeModulesPath, depName);
    const scopedMatch = depName.match(/^(@[^/]+)\/(.+)$/);
    if (scopedMatch) {
      const scopeDepPath = path.join(nodeModulesPath, scopedMatch[1], scopedMatch[2]);
      if (fs.existsSync(scopeDepPath)) {
        fs.rmSync(scopeDepPath, { recursive: true, force: true });
      }
      // Remove scope directory if empty
      const scopeDir = path.join(nodeModulesPath, scopedMatch[1]);
      try {
        const scopeContents = fs.readdirSync(scopeDir);
        if (scopeContents.length === 0) {
          fs.rmdirSync(scopeDir);
        }
      } catch {
        // Ignore errors
      }
    } else if (fs.existsSync(depPath)) {
      fs.rmSync(depPath, { recursive: true, force: true });
    }
  }
  
  console.log('Cleaned up copied production dependencies from node_modules/');
}
