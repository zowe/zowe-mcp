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

const {
  bundleWorkspaceDep,
  prepareFileDepsForBundle,
  dereferenceSymlinks,
  npmInstallProduction,
} = require('../../../scripts/bundle-production-deps.cjs');

const extDir = path.resolve(__dirname, '..');
const serverPkg = path.resolve(extDir, '..', 'zowe-mcp-server');
const commonPkg = path.resolve(extDir, '..', 'zowe-mcp-common');
const repoRoot = path.resolve(extDir, '..', '..');
const targetDir = path.join(extDir, 'server');
const cacheDir = path.join(extDir, '.server-deps-cache');
const cacheHashFile = path.join(cacheDir, '.deps-hash');

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

/**
 * Compute a hash of the server's production dependencies
 * so we know when to invalidate the cache.
 */
function computeDepsHash() {
  const pkg = JSON.parse(fs.readFileSync(path.join(serverPkg, 'package.json'), 'utf-8'));
  const deps = JSON.stringify(pkg.dependencies || {});
  const commonPkgJson = fs.readFileSync(path.join(commonPkg, 'package.json'), 'utf-8');
  const hash = crypto.createHash('sha256').update(deps).update(commonPkgJson);

  for (const spec of Object.values(pkg.dependencies || {})) {
    if (typeof spec !== 'string' || !spec.endsWith('.tgz')) continue;
    for (const d of fileDepDirs) {
      if (!spec.startsWith(d.prefix)) continue;
      const tgzPath = path.join(d.absDir, path.basename(spec.replace(/^file:/, '')));
      if (fs.existsSync(tgzPath)) {
        hash.update(fs.readFileSync(tgzPath));
      }
    }
  }

  return hash.digest('hex');
}

function isCacheValid(currentHash) {
  if (!fs.existsSync(cacheHashFile)) return false;
  if (!fs.existsSync(path.join(cacheDir, 'node_modules'))) return false;
  const cachedHash = fs.readFileSync(cacheHashFile, 'utf-8').trim();
  return cachedHash === currentHash;
}

// --- Main ---

const depsHash = computeDepsHash();
const cacheHit = isCacheValid(depsHash);

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, maxRetries: 3, retryDelay: 100 });
}
fs.mkdirSync(targetDir, { recursive: true });

// Copy server dist
fs.cpSync(path.join(serverPkg, 'dist'), targetDir, { recursive: true });

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
    console.log(`Bundled vendor CLI plugins from vendor/${vendorEntry.name}/cli-bridge-plugins/`);
  }
}

// Copy server package.json (needed for version resolution at runtime)
const targetPackageJson = path.join(targetDir, 'package.json');
fs.cpSync(path.join(serverPkg, 'package.json'), targetPackageJson);

// Bundle workspace dependency
bundleWorkspaceDep({
  targetDir,
  targetPackageJsonPath: targetPackageJson,
  depName: 'zowe-mcp-common',
  depSourceDir: commonPkg,
});

// Rewrite file: tgz deps to .unpack/ local paths
prepareFileDepsForBundle({ targetDir, targetPackageJsonPath: targetPackageJson, fileDepDirs });

if (cacheHit) {
  console.log(`Using cached server production dependencies (${cacheDir}).`);
  fs.cpSync(path.join(cacheDir, 'node_modules'), path.join(targetDir, 'node_modules'), {
    recursive: true,
  });
} else {
  console.log('Installing server production dependencies...');
  npmInstallProduction(targetDir);

  dereferenceSymlinks(path.join(targetDir, 'node_modules'));

  console.log('Caching dependencies for next build...');
  fs.mkdirSync(cacheDir, { recursive: true });
  if (fs.existsSync(path.join(cacheDir, 'node_modules'))) {
    fs.rmSync(path.join(cacheDir, 'node_modules'), {
      recursive: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
  fs.cpSync(path.join(targetDir, 'node_modules'), path.join(cacheDir, 'node_modules'), {
    recursive: true,
  });
  fs.writeFileSync(cacheHashFile, depsHash);
}

// Install zowe-mcp-common into out/node_modules/ so the extension code
// (out/extension.js) can resolve `require("zowe-mcp-common")` at runtime.
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
