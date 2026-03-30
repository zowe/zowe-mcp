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
 * Shared helpers for bundling production dependencies into a self-contained
 * directory tree that can be installed offline (no registry access needed).
 *
 * Used by:
 *   - packages/zowe-mcp-vscode/scripts/bundle-server.js  (VSIX packaging)
 *   - packages/zowe-mcp-server/scripts/bundle-for-pack.cjs (npm pack)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** Safe directory name for .unpack/ (scoped names become filesystem-safe). */
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
 * Bundle a workspace package into <targetDir>/.local/<depName> and rewrite the
 * dependency in the target package.json to point to the local copy.
 *
 * @param {object} opts
 * @param {string} opts.targetDir       Directory that will contain .local/
 * @param {string} opts.targetPackageJsonPath  package.json to rewrite
 * @param {string} opts.depName         Dependency name (e.g. "zowe-mcp-common")
 * @param {string} opts.depSourceDir    Source package directory (must have dist/)
 */
function bundleWorkspaceDep({ targetDir, targetPackageJsonPath, depName, depSourceDir }) {
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

/**
 * Expand file:../../{bin,deps,resources}/*.tgz dependencies into <targetDir>/.unpack/<name>/,
 * strip integrity from embedded npm-shrinkwrap.json (avoids EINTEGRITY vs registry tarballs),
 * and rewrite package.json deps to file:.unpack/<name> so "npm install" resolves them locally.
 *
 * @param {object} opts
 * @param {string} opts.targetDir       Directory that will contain .unpack/
 * @param {string} opts.targetPackageJsonPath  package.json to rewrite
 * @param {Array<{prefix: string, absDir: string}>} opts.fileDepDirs  Prefix-to-directory mappings
 */
function prepareFileDepsForBundle({ targetDir, targetPackageJsonPath, fileDepDirs }) {
  const pkg = JSON.parse(fs.readFileSync(targetPackageJsonPath, 'utf-8'));
  const deps = pkg.dependencies || {};
  let changed = false;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== 'string' || !spec.endsWith('.tgz')) continue;
    const matched = fileDepDirs.find((d) => spec.startsWith(d.prefix));
    if (!matched) continue;
    const tgzName = path.basename(spec.replace(/^file:/, ''));
    const srcTgz = path.join(matched.absDir, tgzName);
    if (!fs.existsSync(srcTgz)) {
      throw new Error(`Dependency ${name} points to ${spec} but ${srcTgz} does not exist.`);
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

    // Strip devDependencies so npm install --omit=dev doesn't install them
    // (npm treats file: deps' devDependencies as regular deps in some cases)
    const unpackPkgJsonPath = path.join(unpackDir, 'package.json');
    if (fs.existsSync(unpackPkgJsonPath)) {
      const unpackPkg = JSON.parse(fs.readFileSync(unpackPkgJsonPath, 'utf-8'));
      if (unpackPkg.devDependencies) {
        delete unpackPkg.devDependencies;
        fs.writeFileSync(unpackPkgJsonPath, JSON.stringify(unpackPkg, null, 2));
      }
    }

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
 * Recursively dereference all symlinks in a directory tree so tools that
 * cannot follow symlinks (vsce/yazl, npm pack with explicit files) include
 * the actual content.
 *
 * npm creates symlinks for file: dependencies at the top level, for scoped
 * packages, and for `.bin` entries inside any nested `node_modules`. This
 * function walks the entire tree to ensure every symlink is replaced with
 * a real file or directory copy.
 *
 * Note: fs.cpSync's `dereference: true` option only resolves the top-level
 * source symlink, not symlinks nested inside copied subdirectories. We
 * therefore copy first (preserving internal symlinks) and then recurse into
 * the newly copied directory to fix them up.
 *
 * @param {string} dir  Directory to walk and dereference symlinks in
 */
function dereferenceSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      let realPath;
      try {
        realPath = fs.realpathSync(full);
      } catch {
        // Broken symlink — skip
        continue;
      }
      fs.rmSync(full, { force: true });
      const realStat = fs.statSync(realPath);
      if (realStat.isDirectory()) {
        fs.cpSync(realPath, full, { recursive: true });
        // The copied tree may itself contain symlinks; recurse to fix them.
        dereferenceSymlinks(full);
      } else {
        fs.copyFileSync(realPath, full);
      }
    } else if (stat.isDirectory()) {
      dereferenceSymlinks(full);
    }
  }
}

/**
 * Run npm install for production dependencies in the given directory.
 *
 * @param {string} cwd  Directory containing the package.json to install
 */
function npmInstallProduction(cwd) {
  execSync('npm install --omit=dev --ignore-scripts --force', {
    cwd,
    stdio: 'inherit',
  });
}

module.exports = {
  safeDepFolderName,
  stripIntegrityDeep,
  bundleWorkspaceDep,
  prepareFileDepsForBundle,
  dereferenceSymlinks,
  npmInstallProduction,
};
