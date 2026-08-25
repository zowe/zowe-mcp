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
 * directory tree that can be installed offline (no registry access needed),
 * plus post-install pruning helpers that strip dead weight (a devDependency
 * that leaks in transitively, and file types Node never loads at runtime)
 * out of the resulting node_modules.
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
    const matched = fileDepDirs.find(d => spec.startsWith(d.prefix));
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
      // Remove the symlink itself (not its target). `recursive: true` is
      // required for symlinks pointing at a directory — without it, newer Node
      // throws ERR_FS_EISDIR ("Path is a directory") on macOS. rmSync does not
      // traverse the link, so the target tree is untouched and is copied below.
      fs.rmSync(full, { recursive: true, force: true });
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

/**
 * Recursively deletes every `@napi-rs/cli` directory (and its `.bin/napi`
 * entry) found anywhere under `dir`. It's a devDependency of `russh`
 * (bundled inside the `@zowe/zowex-for-zowe-sdk` tgz) that npm installs
 * anyway because russh declares it as a regular dependency; nothing at
 * runtime needs it; it's ~5.6 MB per copy and can appear more than once in
 * the installed tree.
 */
function pruneNapiRsCli(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === '@napi-rs') {
      const cliDir = path.join(full, 'cli');
      if (fs.existsSync(cliDir)) {
        fs.rmSync(cliDir, { recursive: true, force: true });
      }
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      continue;
    }
    if (entry.name === '.bin') {
      const napiBin = path.join(full, 'napi');
      fs.rmSync(napiBin, { force: true });
      continue;
    }
    if (entry.name === 'node_modules') {
      pruneNapiRsCli(full);
    } else if (entry.name.startsWith('@')) {
      // Scoped package directory (e.g. @zowe) — its entries are packages,
      // not a node_modules dir; recurse into it directly rather than
      // looking for `<scope>/node_modules`, which never exists.
      pruneNapiRsCli(full);
    } else {
      // Descend into nested node_modules of regular packages too.
      const nested = path.join(full, 'node_modules');
      if (fs.existsSync(nested)) pruneNapiRsCli(nested);
    }
  }
}

/**
 * Basename suffixes that Node will never load at runtime from a pruned
 * node_modules tree, regardless of which consumer (VSIX or npm tarball) is
 * doing the pruning:
 *
 *  - `.ts`/`.mts`/`.cts` (this also catches their `.d.ts`/`.d.mts`/`.d.cts`
 *    declaration-file variants, since they share the suffix) are
 *    TypeScript source/types — Node can't execute them at all.
 *  - `.map` sourcemaps are only consulted by a debugger or stack-trace
 *    symbolicator attached to the process, never by module resolution
 *    itself.
 *  - `.md`/`.markdown` are documentation, not executable.
 *
 * `.cjs` is deliberately NOT in this list even though `.cts` is — `.cjs` is
 * real CommonJS and is exactly what `require` loads, so it must survive.
 *
 * `.mjs` is NOT in this unconditional list — whether it's dead weight
 * depends entirely on how the *consumer* of the pruned tree loads its
 * dependencies, which is why `pruneRuntimeDeadFiles` takes a
 * `pruneEsmVariants` option instead of hardcoding an answer here. See that
 * function's doc comment for the two very different answers its two
 * callers need.
 */
const DEAD_RUNTIME_SUFFIXES = ['.ts', '.mts', '.cts', '.map', '.md', '.markdown'];

/** Basename matching this are kept regardless of extension (e.g. `LICENSE`,
 * `LICENSE.md`, `NOTICE`, `COPYING`) — license text ships under all sorts of
 * extensions (or none), and removing it would strip the license a bundled
 * dependency requires us to keep, even though it's not code.
 */
const LICENSE_RE = /license|notice|copying/i;

/**
 * Recursively deletes files under `dir` whose basename ends with one of
 * `DEAD_RUNTIME_SUFFIXES` (see above for why each is safe to delete),
 * skipping anything that looks like a license/notice file. Never touches
 * `.js`, `.cjs`, `.json`, `.node`, or extensionless files. Removes
 * directories left empty by the deletions, bottom-up. Returns the number of
 * files deleted.
 *
 * @param {string} dir  Directory to prune (a node_modules tree)
 * @param {object} opts
 * @param {boolean} opts.pruneEsmVariants  Whether `.mjs` files are also dead
 *   weight here. This is NOT a general "mjs is safe to delete" rule — it
 *   depends entirely on how the tree being pruned is consumed:
 *
 *    - The VSIX's `server/node_modules` (bundle-server.js) is reached
 *      exclusively via CJS `require` — verified: no dynamic `import(` in
 *      that tree — so `require` can't load ESM and a `.mjs` file with no
 *      `require`-able sibling is unreachable. Pass `true`.
 *    - The npm tarball's `node_modules` (bundle-for-pack.cjs) backs an
 *      UNBUNDLED server running as real ESM (`"type": "module"`, actual
 *      `import` statements). Those `import` statements resolve dependencies
 *      through the dependency packages' own package.json `"exports"`/
 *      `"import"` conditions, which frequently point at `.mjs` files
 *      specifically for the ESM entry point. Deleting `.mjs` there would
 *      break `import` resolution at runtime. Pass `false` — `.mjs` MUST be
 *      kept.
 */
function pruneRuntimeDeadFiles(dir, { pruneEsmVariants }) {
  if (!fs.existsSync(dir)) return 0;
  const suffixes = pruneEsmVariants ? [...DEAD_RUNTIME_SUFFIXES, '.mjs'] : DEAD_RUNTIME_SUFFIXES;
  let pruned = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruned += pruneRuntimeDeadFiles(full, { pruneEsmVariants });
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      continue;
    }
    if (LICENSE_RE.test(entry.name)) continue;
    if (suffixes.some(suffix => entry.name.endsWith(suffix))) {
      fs.rmSync(full, { force: true });
      pruned++;
    }
  }
  return pruned;
}

module.exports = {
  safeDepFolderName,
  stripIntegrityDeep,
  bundleWorkspaceDep,
  prepareFileDepsForBundle,
  dereferenceSymlinks,
  npmInstallProduction,
  pruneNapiRsCli,
  pruneRuntimeDeadFiles,
};
