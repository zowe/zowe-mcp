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
const commonPkg = path.resolve(extDir, '..', 'zowe-mcp-common');
const repoRoot = path.resolve(extDir, '..', '..');
const targetDir = path.join(extDir, 'server');
const cacheDir = path.join(extDir, '.server-deps-cache');
const cacheHashFile = path.join(cacheDir, '.deps-hash');
const binDir = path.join(repoRoot, 'bin');

/**
 * Directories (relative to repo root) that may contain file: tgz dependencies.
 * Each entry maps the prefix used in package.json (e.g. "file:../../bin/") to
 * the absolute directory where the tgz lives.
 */
const fileDepDirs = [
  { prefix: 'file:../../bin/', absDir: binDir },
  { prefix: 'file:../../deps/', absDir: path.join(repoRoot, 'deps') },
  { prefix: 'file:../../resources/', absDir: path.join(repoRoot, 'resources') },
];

/** Safe directory name under server/.unpack/ (scoped names become filesystem-safe). */
function safeDepFolderName(depName) {
  return depName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Remove integrity fields so npm does not fail with EINTEGRITY when shrinkwrap hashes disagree with the registry. */
function stripIntegrityDeep(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) stripIntegrityDeep(item);
    return;
  }
  delete obj.integrity;
  delete obj._integrity;
  for (const k of Object.keys(obj)) stripIntegrityDeep(obj[k]);
}

/**
 * Compute a hash of the server's production dependencies
 * so we know when to invalidate the cache.
 */
function computeDepsHash() {
  const pkg = JSON.parse(fs.readFileSync(path.join(serverPkg, 'package.json'), 'utf-8'));
  const deps = JSON.stringify(pkg.dependencies || {});
  const commonPkgJson = fs.readFileSync(path.join(commonPkg, 'package.json'), 'utf-8');
  const hash = crypto.createHash('sha256').update(deps).update(commonPkgJson);

  // Include the content hash of any file: tgz dependencies so the cache
  // invalidates when the tgz is replaced with a new build (same filename).
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

/**
 * Check if the cached node_modules are still valid.
 */
function isCacheValid(currentHash) {
  if (!fs.existsSync(cacheHashFile)) return false;
  if (!fs.existsSync(path.join(cacheDir, 'node_modules'))) return false;
  const cachedHash = fs.readFileSync(cacheHashFile, 'utf-8').trim();
  return cachedHash === currentHash;
}

/**
 * Expand file:../../{bin,deps,resources}/*.tgz dependencies into server/.unpack/<name>/,
 * strip integrity from embedded npm-shrinkwrap.json (avoids EINTEGRITY vs registry tarballs),
 * and rewrite package.json to file:.unpack/<name> so "npm install" from server/ resolves them.
 */
function prepareFileDepsForBundle(targetPackageJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(targetPackageJsonPath, 'utf-8'));
  const deps = pkg.dependencies || {};
  let changed = false;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== 'string' || !spec.endsWith('.tgz')) continue;
    const matched = fileDepDirs.find(d => spec.startsWith(d.prefix));
    if (!matched) continue;
    const tgzName = path.basename(spec.replace(/^file:/, ''));
    const srcTgz = path.join(matched.absDir, tgzName);
    if (!fs.existsSync(srcTgz)) {
      throw new Error(`Server dependency ${name} points to ${spec} but ${srcTgz} does not exist.`);
    }

    const tempExtract = path.join(targetDir, '.extract-tmp', safeDepFolderName(name));
    fs.rmSync(tempExtract, { recursive: true, force: true });
    fs.mkdirSync(tempExtract, { recursive: true });
    execSync(`tar -xzf "${srcTgz}" -C "${tempExtract}"`, { stdio: 'ignore' });

    const extractedPackage = path.join(tempExtract, 'package');
    if (!fs.existsSync(extractedPackage)) {
      throw new Error(
        `Extracted ${tgzName} does not contain a package/ directory (npm pack layout).`
      );
    }

    const unpackDir = path.join(targetDir, '.unpack', safeDepFolderName(name));
    fs.rmSync(unpackDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(unpackDir), { recursive: true });
    fs.cpSync(extractedPackage, unpackDir, { recursive: true });
    fs.rmSync(path.join(targetDir, '.extract-tmp'), { recursive: true, force: true });

    const shrinkwrapPath = path.join(unpackDir, 'npm-shrinkwrap.json');
    if (fs.existsSync(shrinkwrapPath)) {
      const sw = JSON.parse(fs.readFileSync(shrinkwrapPath, 'utf8'));
      stripIntegrityDeep(sw);
      fs.writeFileSync(shrinkwrapPath, JSON.stringify(sw, null, 2) + '\n', 'utf8');
    }

    deps[name] = `file:.unpack/${safeDepFolderName(name)}`;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(targetPackageJsonPath, JSON.stringify(pkg, null, 2));
  }
}

/**
 * npm creates symlinks for file: dependencies. vsce (yazl) cannot pack
 * symlinks into a VSIX, so replace them with real directory copies.
 */
function dereferenceLocalDepSymlinks() {
  const nmDir = path.join(targetDir, 'node_modules');
  if (!fs.existsSync(nmDir)) return;
  for (const entry of fs.readdirSync(nmDir)) {
    const full = path.join(nmDir, entry);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      const realPath = fs.realpathSync(full);
      fs.rmSync(full);
      fs.cpSync(realPath, full, { recursive: true });
    }
  }
}

/**
 * Bundle a workspace package into server/.local/<name> and rewrite the
 * dependency in the target package.json to point to the local copy.
 * This handles workspace-linked packages (e.g. zowe-mcp-common) that
 * are not published to any registry.
 */
function bundleWorkspaceDep(targetPackageJsonPath, depName, depSourceDir) {
  const pkg = JSON.parse(fs.readFileSync(targetPackageJsonPath, 'utf-8'));
  const deps = pkg.dependencies || {};
  if (!(depName in deps)) return;

  const localDir = path.join(targetDir, '.local', depName);
  fs.mkdirSync(localDir, { recursive: true });

  const depPkg = JSON.parse(fs.readFileSync(path.join(depSourceDir, 'package.json'), 'utf-8'));
  const distDir = path.join(depSourceDir, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error(`Workspace dependency ${depName} has no dist/ — run "npm run build" first.`);
  }

  fs.cpSync(distDir, path.join(localDir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'package.json'),
    JSON.stringify(
      { name: depPkg.name, version: depPkg.version, main: depPkg.main, types: depPkg.types },
      null,
      2
    )
  );

  deps[depName] = 'file:.local/' + depName;
  fs.writeFileSync(targetPackageJsonPath, JSON.stringify(pkg, null, 2));
}

// --- Main ---

const depsHash = computeDepsHash();
const cacheHit = isCacheValid(depsHash);

// Clean and recreate target (always — dist files may have changed)
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, maxRetries: 3, retryDelay: 100 });
}
fs.mkdirSync(targetDir, { recursive: true });

// Copy server dist
fs.cpSync(path.join(serverPkg, 'dist'), targetDir, { recursive: true });

// Copy server package.json (needed for version resolution at runtime)
const targetPackageJson = path.join(targetDir, 'package.json');
fs.cpSync(path.join(serverPkg, 'package.json'), targetPackageJson);

// Bundle workspace dependency zowe-mcp-common into server/.local/zowe-mcp-common
// and rewrite the dependency to a local file: path so npm install resolves it locally
bundleWorkspaceDep(targetPackageJson, 'zowe-mcp-common', commonPkg);

// Rewrite file:../../bin/*.tgz deps to file:.tgz/*.tgz and copy tgz into bundle
// so "npm install" from server/ can resolve them
prepareFileDepsForBundle(targetPackageJson);

if (cacheHit) {
  // Cache hit — copy cached node_modules
  console.log(`Using cached server production dependencies (${cacheDir}).`);
  fs.cpSync(path.join(cacheDir, 'node_modules'), path.join(targetDir, 'node_modules'), {
    recursive: true,
  });
} else {
  // Cache miss — install fresh and update cache.
  // When using a private registry (e.g. Artifactory), ensure npm is logged in so this install can authenticate.
  console.log('Installing server production dependencies...');
  execSync('npm install --omit=dev --ignore-scripts --force', {
    cwd: targetDir,
    stdio: 'inherit',
  });

  // Replace symlinks created by file: deps with real copies (vsce/yazl can't pack symlinks)
  dereferenceLocalDepSymlinks();

  // Update cache
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
// We use out/node_modules/ because out/ is included in the VSIX (via !out/**
// in .vscodeignore) while the root node_modules/ is excluded by .gitignore.
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
