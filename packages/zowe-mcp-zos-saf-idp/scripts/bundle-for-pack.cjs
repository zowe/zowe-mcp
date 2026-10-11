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
 * Prepares a self-contained node_modules tree before `npm pack` so the
 * resulting tarball installs offline — the z/OS deployment path is:
 * `npm pack -w zowe-mcp-zos-saf-idp`, scp the single .tgz (binary, no
 * conversion), then `npm install ./<file>.tgz --offline` on the LPAR (npm
 * decompresses with Node's own zlib, so the LPAR's missing `gzip` doesn't
 * matter — only shell-level `tar -xzf` is impossible there).
 *
 * Simpler than the server's variant: this package has only registry deps
 * (express, oidc-provider, ssh2 — no workspace or file: deps), so the steps
 * are: isolated `npm ci --omit=dev --ignore-scripts` against the committed
 * bundle lockfile, strip any native artifacts (ssh2's optional accelerators
 * are host-arch binaries; on z/OS ssh2 must fall back to pure JS), copy the
 * tree in, and flip bundledDependencies for the pack phase only.
 *
 * Supply-chain pinning: the bundled tree ships verbatim in the tarball that
 * is installed offline on the LPAR — inside the process that receives SAF
 * userids and passwords — so nothing in it may resolve fresh from the
 * registry at pack time. Every install here is `npm ci` against
 * scripts/bundle.package-lock.json (committed, integrity-pinned), and the
 * direct registry deps in package.json are exact-pinned (no ^/~ ranges).
 * After changing dependencies, regenerate the lock with:
 *
 *   node scripts/bundle-for-pack.cjs --update-lock
 *
 * and review + commit the resulting scripts/bundle.package-lock.json.
 *
 * Runs as a prepack script (before npm pack); restore-after-pack.cjs undoes it.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { execSync } = require('child_process');

const {
  bundleWorkspaceDep,
  dereferenceSymlinks,
  installBundledNodeModules,
  npmCiProduction,
} = require('../../../scripts/bundle-production-deps.cjs');

const pkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgDir, '..', '..');
const packageJsonPath = path.join(pkgDir, 'package.json');
const backupPath = path.join(pkgDir, '.package.json.backup');
// Committed, integrity-pinned lockfile for the isolated bundle install
// (scripts/ is not in package.json "files", so it never ships in the tarball).
const bundleLockPath = path.join(__dirname, 'bundle.package-lock.json');
const updateLock = process.argv.includes('--update-lock');

/** Removes every *.node binary plus ssh2's optional native-accelerator trees. */
function stripNativeArtifacts(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'cpu-features' || (entry.name === 'build' && /ssh2/.test(full))) {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
        continue;
      }
      removed += stripNativeArtifacts(full);
    } else if (entry.name.endsWith('.node')) {
      fs.rmSync(full, { force: true });
      removed++;
    }
  }
  return removed;
}

fs.copyFileSync(packageJsonPath, backupPath);

try {
  // Rewrite the zos-attls workspace dep to file:.local/zos-attls (dist + a
  // minimal package.json only — the native addon is built per-LPAR, never
  // packed), same mechanism as the server's zowe-mcp-common bundling.
  bundleWorkspaceDep({
    targetDir: pkgDir,
    targetPackageJsonPath: packageJsonPath,
    depName: 'zos-attls',
    depSourceDir: path.join(repoRoot, 'packages', 'zos-attls'),
  });

  // Isolated install outside the monorepo so npm doesn't hoist to the
  // workspace root; carry the repo .npmrc so the right registry (and
  // install-strategy=nested) applies regardless of the user's global config.
  const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-mcp-idp-pack-'));
  // Strip devDependencies from the isolated manifest: they are not installed
  // (--omit=dev) but npm still resolves them, and `@zowe/mcp-server` is a
  // workspace-only name no registry can satisfy.
  const isoPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  delete isoPkg.devDependencies;
  fs.writeFileSync(path.join(isoDir, 'package.json'), JSON.stringify(isoPkg, null, 2));
  const localDir = path.join(pkgDir, '.local');
  if (fs.existsSync(localDir)) {
    fs.cpSync(localDir, path.join(isoDir, '.local'), { recursive: true });
  }
  const repoNpmrc = path.join(repoRoot, '.npmrc');
  if (fs.existsSync(repoNpmrc)) {
    fs.cpSync(repoNpmrc, path.join(isoDir, '.npmrc'));
  }

  if (updateLock) {
    // Maintainer path: resolve the isolated manifest once, then commit the
    // result — the pack path below never resolves anything itself.
    console.log('Resolving bundle lockfile in isolated directory...');
    execSync('npm install --omit=dev --ignore-scripts --package-lock-only', {
      cwd: isoDir,
      stdio: 'inherit',
    });
    fs.copyFileSync(path.join(isoDir, 'package-lock.json'), bundleLockPath);
    fs.rmSync(isoDir, { recursive: true, force: true });
    console.log(`Updated ${path.relative(pkgDir, bundleLockPath)} — review and commit it.`);
  } else {
    if (!fs.existsSync(bundleLockPath)) {
      throw new Error(
        `${bundleLockPath} is missing — the bundled tree must install from a committed ` +
          'lockfile (never resolve floating versions at pack time). Regenerate it with ' +
          '"node scripts/bundle-for-pack.cjs --update-lock" and commit the result.'
      );
    }
    fs.copyFileSync(bundleLockPath, path.join(isoDir, 'package-lock.json'));
    console.log('Installing production dependencies from the committed bundle lockfile...');
    // npm ci fails when package.json and the lockfile disagree — the fix is
    // to rerun --update-lock, review the diff, and commit it.
    npmCiProduction(isoDir);
    // file: deps land as symlinks into .local — replace them with real copies
    // so the tree survives being moved into the package for npm pack.
    dereferenceSymlinks(path.join(isoDir, 'node_modules'));

    const isoNodeModules = path.join(isoDir, 'node_modules');
    const stripped = stripNativeArtifacts(isoNodeModules);
    console.log(`Stripped ${stripped} native artifact(s) (ssh2 falls back to pure JS).`);

    installBundledNodeModules({ pkgDir, isoNodeModules, packageJsonPath });
    fs.rmSync(isoDir, { recursive: true, force: true });
  }
} catch (err) {
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, packageJsonPath);
    fs.unlinkSync(backupPath);
  }
  throw err;
}

// --update-lock only prepares the isolated manifest; nothing was bundled, so
// the package.json rewrite and the .local/ scratch dir are undone right away
// (the pack path leaves both in place for npm pack — restore-after-pack.cjs
// undoes them).
if (updateLock) {
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, packageJsonPath);
    fs.unlinkSync(backupPath);
  }
  fs.rmSync(path.join(pkgDir, '.local'), { recursive: true, force: true });
}
