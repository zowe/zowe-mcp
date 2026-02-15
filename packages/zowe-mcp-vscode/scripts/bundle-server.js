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
 * Bundles the zowe-mcp-server dist and its production dependencies
 * into the extension's server/ directory for VSIX packaging.
 *
 * Caches production node_modules to avoid slow npm installs on every build.
 * The cache is invalidated when the server's dependencies change.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const extDir = path.resolve(__dirname, '..');
const serverPkg = path.resolve(extDir, '..', 'zowe-mcp-server');
const targetDir = path.join(extDir, 'server');
const cacheDir = path.join(extDir, '.server-deps-cache');
const cacheHashFile = path.join(cacheDir, '.deps-hash');

/**
 * Compute a hash of the server's production dependencies
 * so we know when to invalidate the cache.
 */
function computeDepsHash() {
  const pkg = JSON.parse(fs.readFileSync(path.join(serverPkg, 'package.json'), 'utf-8'));
  const deps = JSON.stringify(pkg.dependencies || {});
  return crypto.createHash('sha256').update(deps).digest('hex');
}

/**
 * Check if the cached node_modules are still valid.
 */
function isCacheValid(currentHash) {
  if (!fs.existsSync(cacheHashFile)) return false;
  if (!fs.existsSync(path.join(cacheDir, 'node_modules'))) return false;
  const cachedHash = fs.readFileSync(cacheHashFile, 'utf-8').trim();
  return cachedHash === currentHash;
}

// --- Main ---

const depsHash = computeDepsHash();
const cacheHit = isCacheValid(depsHash);

// Clean and recreate target (always — dist files may have changed)
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// Copy server dist
fs.cpSync(path.join(serverPkg, 'dist'), targetDir, { recursive: true });

// Copy server package.json (needed for version resolution at runtime)
fs.cpSync(path.join(serverPkg, 'package.json'), path.join(targetDir, 'package.json'));

if (cacheHit) {
  // Cache hit — copy cached node_modules
  console.log('Using cached server production dependencies.');
  fs.cpSync(path.join(cacheDir, 'node_modules'), path.join(targetDir, 'node_modules'), {
    recursive: true,
  });
} else {
  // Cache miss — install fresh and update cache
  console.log('Installing server production dependencies...');
  execSync('npm install --omit=dev --ignore-scripts', {
    cwd: targetDir,
    stdio: 'inherit',
  });

  // Update cache
  console.log('Caching dependencies for next build...');
  fs.mkdirSync(cacheDir, { recursive: true });
  if (fs.existsSync(path.join(cacheDir, 'node_modules'))) {
    fs.rmSync(path.join(cacheDir, 'node_modules'), { recursive: true });
  }
  fs.cpSync(path.join(targetDir, 'node_modules'), path.join(cacheDir, 'node_modules'), {
    recursive: true,
  });
  fs.writeFileSync(cacheHashFile, depsHash);
}

console.log('Server bundled successfully into server/');
