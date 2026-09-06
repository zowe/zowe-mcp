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
 * @param {object} [opts]
 * @param {boolean} [opts.omitOptional]  Also pass `--omit=optional`. Kept
 *   opt-in (default false, matching the previous unconditional behavior of
 *   this function) rather than baked in, because the two callers want
 *   different answers:
 *    - `bundle-for-pack.cjs` (npm pack) wants optional deps dropped: the
 *      biggest is `russh`, an optionalDependency of `@zowe/zowex-for-zowe-sdk`
 *      carrying ~33 MB across 7 platform-specific prebuilds. It backs
 *      `createClient(useNativeSsh)`, a code path nothing in this repo ever
 *      enables (the server always talks SSH through `ssh2`/`node-ssh`
 *      instead) — see `zos/native/ssh-client-cache.ts`. `cpu-features`/`nan`
 *      (ssh2's own optional native accelerator) go the same way; ssh2 falls
 *      back to a pure-JS implementation without them. If a future change
 *      turns `useNativeSsh` on by default, this flag must come back off (or
 *      `russh` must be pulled in some other way) or that path breaks.
 *    - `bundle-server.js` (VSIX) already avoids installing `cpu-features`/
 *      `nan`/`russh` a different way — it writes its own minimal
 *      `server/package.json` listing only `SERVER_EXTERNAL`'s own runtime
 *      dependencies, which doesn't include russh in the first place (it's
 *      zowex's optional dep, and zowex itself is already the thing being
 *      installed, not a fresh consumer of it) — so this flag would be a
 *      no-op there today; leaving the default off keeps that path's
 *      behavior unchanged and avoids two functions needing to agree on why.
 */
function npmInstallProduction(cwd, { omitOptional = false } = {}) {
  const omitFlags = omitOptional ? '--omit=dev --omit=optional' : '--omit=dev';
  // --install-strategy=hoisted is explicit, not the default, on purpose: this
  // repo's own .npmrc sets `install-strategy=nested` (to avoid version
  // conflicts like ajv@6 vs ajv@8 in the real dev node_modules), and npm
  // propagates that as an `npm_config_install_strategy=nested` environment
  // variable to every child process a lifecycle script spawns — including
  // this execSync call, since it inherits the parent's env by default. Under
  // "nested", npm's legacy (pre-v7-style) installer does NOT reliably honor
  // `--omit=dev`/`--omit=optional` for a `file:` dependency's OWN transitive
  // tree: verified empirically that installing the zowex tgz this way pulled
  // in `russh` (a `--omit=optional` target) plus `typescript`/`typedoc`/`rxjs`
  // (russh's own devDependencies, which `--omit=dev` should have excluded)
  // regardless of the flags passed here. This isolated install is a
  // throwaway tree entirely outside the repo (an mkdtemp'd directory), so
  // there's no reason for it to inherit the repo's nested-vs-hoisted
  // preference at all — forcing "hoisted" (npm's own modern default, where
  // `--omit` is correctly respected) sidesteps the inherited env variable
  // instead of relying on every caller to remember to strip it.
  execSync(`npm install ${omitFlags} --install-strategy=hoisted --ignore-scripts --force`, {
    cwd,
    stdio: 'inherit',
  });
}

/** Build-output extensions — never runtime assets, so never copied by copyRuntimeAssets. */
const RUNTIME_ASSET_SKIP_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.map', '.ts']);

/**
 * Recursively copies every file under `srcDir` into `destDir` at the same
 * relative path, skipping compiled JS/maps/declaration files (those come
 * from the esbuild bundle instead) and dotfiles.
 *
 * Both the VSIX (`bundle-server.js`) and the npm pack (`bundle-for-pack.cjs`)
 * bundle the same server code the same way (see
 * `scripts/esbuild-server-config.cjs`), so both need this same follow-up
 * step: copying whatever `packages/zowe-mcp-server/scripts/copy-resources.cjs`
 * put into `dist/` (resources/, tools/tso/*.json, tools/console/*.json, ...)
 * into the bundle's output directory, so the bundled entries' asset-
 * resolution fallback (see `packages/zowe-mcp-server/src/runtime/asset-root.ts`)
 * finds them at exactly `<bundle root>/<same relative path>`.
 *
 * @param {string} srcDir   The tsc + copy-resources `dist/` to copy assets from
 * @param {string} destDir  The bundle's output directory
 */
function copyRuntimeAssets(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyRuntimeAssets(srcPath, destPath);
    } else if (!RUNTIME_ASSET_SKIP_EXTENSIONS.has(path.extname(entry.name))) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
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
 *   depends entirely on how the tree being pruned is consumed. Both current
 *   callers pass `true`, for the same underlying reason: both
 *   `bundle-server.js` (VSIX) and `bundle-for-pack.cjs` (npm pack) install
 *   this node_modules tree to hold only `SERVER_EXTERNAL`'s packages and
 *   their own transitive dependencies, reached exclusively through those
 *   externals' own CommonJS `require()` calls (`@zowe/zowex-for-zowe-sdk`'s
 *   compiled JS `require`s `node-ssh`/`es-toolkit`/etc. — it has no `"type":
 *   "module"` and no dynamic `import(` — same for ssh2, hardstop-patterns,
 *   and each of the others). A CJS `require()` follows a package's
 *   `exports."require"` (or plain `"main"`) condition, never `"import"`, so
 *   the `.mjs` files some of these transitive deps ship purely for ESM
 *   consumers (e.g. `node-ssh`'s `lib/esm/index.mjs`, `es-toolkit`'s
 *   `dist/index.mjs`) are genuinely unreachable here and safe to delete —
 *   verified by checking each installed package's `package.json` `"main"`/
 *   `"exports"` before relying on this. If a future external ever needs its
 *   own `import()` of one of these deps, this reasoning would need
 *   rechecking for it specifically before passing `true`.
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
  copyRuntimeAssets,
};
