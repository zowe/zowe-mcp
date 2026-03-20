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
 * Bundles workspace and file: dependencies into the package before npm pack.
 * This allows the packed tarball to be installed standalone without requiring
 * the monorepo or external file dependencies.
 *
 * Also ensures all dependencies are installed so bundledDependencies can include
 * their node_modules in the tarball for airgapped installations.
 *
 * Runs as a prepack script (before npm pack).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const serverPkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverPkgDir, '..', '..');
const commonPkgDir = path.join(repoRoot, 'packages', 'zowe-mcp-common');
const packageJsonPath = path.join(serverPkgDir, 'package.json');

/**
 * Bundle a workspace package into node_modules/<name>.
 * The node_modules/ copy ensures it's bundled and resolvable after installation.
 * Changes dependency spec from workspace reference to version number.
 */
function bundleWorkspaceDep(pkg, depName, depSourceDir) {
  const deps = pkg.dependencies || {};
  if (!(depName in deps)) return;

  const depPkg = JSON.parse(fs.readFileSync(path.join(depSourceDir, 'package.json'), 'utf-8'));
  const distDir = path.join(depSourceDir, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error(`Workspace dependency ${depName} has no dist/ — run "npm run build" first.`);
  }

  // Copy to node_modules/ so it's bundled and resolvable after installation
  const nodeModulesPath = path.join(serverPkgDir, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    fs.mkdirSync(nodeModulesPath, { recursive: true });
  }
  const nodeModulesDepPath = path.join(nodeModulesPath, depName);
  if (fs.existsSync(nodeModulesDepPath)) {
    fs.rmSync(nodeModulesDepPath, { recursive: true, force: true });
  }
  fs.cpSync(distDir, path.join(nodeModulesDepPath, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(nodeModulesDepPath, 'package.json'),
    JSON.stringify(
      { name: depPkg.name, version: depPkg.version, main: depPkg.main, types: depPkg.types },
      null,
      2
    )
  );

  // Change dependency to use version (npm will resolve from node_modules/ when bundled)
  deps[depName] = depPkg.version;
}

/**
 * Extract file: tgz dependencies and install to node_modules/.
 * The node_modules/ copy ensures it's bundled and resolvable after installation.
 * Changes dependency spec from file: path to version number.
 */
function bundleFileTgzDep(pkg, depName, spec) {
  if (typeof spec !== 'string' || !spec.endsWith('.tgz')) return;

  const fileDepDirs = [
    { prefix: 'file:../../deps/', absDir: path.join(repoRoot, 'deps') },
    { prefix: 'file:../../resources/', absDir: path.join(repoRoot, 'resources') },
  ];

  for (const d of fileDepDirs) {
    if (!spec.startsWith(d.prefix)) continue;
    const tgzName = path.basename(spec.replace(/^file:/, ''));
    const srcTgz = path.join(d.absDir, tgzName);
    if (!fs.existsSync(srcTgz)) {
      throw new Error(`Dependency ${depName} points to ${spec} but ${srcTgz} does not exist.`);
    }

    // Extract and install to node_modules/ so it's bundled and resolvable
    const nodeModulesPath = path.join(serverPkgDir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      fs.mkdirSync(nodeModulesPath, { recursive: true });
    }

    // Extract the tgz to a temp directory (npm pack creates package/ directory inside)
    const tempExtractDir = path.join(serverPkgDir, '.temp-extract');
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractDir, { recursive: true });

    // Extract the tgz (npm pack format has package/ directory)
    execSync(`tar -xzf "${srcTgz}" -C "${tempExtractDir}"`, {
      stdio: 'ignore',
    });

    const extractTarget = path.join(tempExtractDir, 'package');
    if (!fs.existsSync(extractTarget)) {
      throw new Error(`Extracted ${tgzName} does not contain package/ directory`);
    }

    // Read the package.json to get the actual package name (might be different from depName)
    const extractedPkgJson = path.join(extractTarget, 'package.json');
    if (!fs.existsSync(extractedPkgJson)) {
      throw new Error(`Extracted package from ${tgzName} has no package.json`);
    }
    const extractedPkg = JSON.parse(fs.readFileSync(extractedPkgJson, 'utf-8'));
    const actualPkgName = extractedPkg.name || depName;

    // Copy to node_modules/<actualPkgName>
    const nodeModulesDepPath = path.join(nodeModulesPath, actualPkgName);
    if (fs.existsSync(nodeModulesDepPath)) {
      fs.rmSync(nodeModulesDepPath, { recursive: true, force: true });
    }
    fs.cpSync(extractTarget, nodeModulesDepPath, { recursive: true });

    // Clean up temp directory
    fs.rmSync(tempExtractDir, { recursive: true, force: true });

    // Change dependency to use version from extracted package (npm will resolve from node_modules/ when bundled)
    pkg.dependencies[depName] = extractedPkg.version || '*';
    return;
  }
}

// Read package.json and save a backup (for postpack to restore dependencies only)
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const backupPath = path.join(serverPkgDir, '.package.json.backup');
fs.writeFileSync(backupPath, JSON.stringify(pkg, null, 2));

// Save original dependency names before modification (needed for bundledDependencies: true)
const originalDepNames = Object.keys(pkg.dependencies || {});

// Bundle zowe-mcp-common
bundleWorkspaceDep(pkg, 'zowe-mcp-common', commonPkgDir);

// Bundle file: tgz dependencies (e.g. zowe-native-proto-sdk)
for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
  bundleFileTgzDep(pkg, name, spec);
}

// Write modified package.json (dependencies now use version numbers, not file: paths)
fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));

console.log('Bundled workspace/file dependencies for npm pack:');
const backupPkg = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
if (pkg.dependencies['zowe-mcp-common']) {
  console.log(`  - zowe-mcp-common → node_modules/zowe-mcp-common (version: ${pkg.dependencies['zowe-mcp-common']})`);
}
for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
  // Check if this was originally a file: tgz dependency
  const originalSpec = backupPkg.dependencies?.[name];
  if (originalSpec && typeof originalSpec === 'string' && originalSpec.endsWith('.tgz')) {
    console.log(`  - ${name} → node_modules/${name} (version: ${spec}, was: ${originalSpec})`);
  }
}

// Ensure all dependencies are installed so bundledDependencies can include them.
// In a workspace, dependencies are hoisted to root node_modules, so we copy them locally.
console.log('Preparing node_modules for bundling...');
const nodeModulesPath = path.join(serverPkgDir, 'node_modules');
const rootNodeModulesPath = path.join(repoRoot, 'node_modules');

// Handle bundledDependencies: true (bundle all) vs array (bundle specific)
// Use original dependency names (before file: modifications)
let bundledDeps;
if (pkg.bundledDependencies === true) {
  // Bundle all production dependencies (use original names before file: modifications)
  bundledDeps = originalDepNames;
  console.log(`  bundledDependencies is true - will bundle all ${bundledDeps.length} production dependencies`);
} else {
  bundledDeps = Array.isArray(pkg.bundledDependencies) ? pkg.bundledDependencies : [];
}

// Create local node_modules if it doesn't exist
if (!fs.existsSync(nodeModulesPath)) {
  fs.mkdirSync(nodeModulesPath, { recursive: true });
}

/**
 * Copy a dependency from root node_modules to local node_modules, including transitive deps
 */
function copyDepWithTransitives(depName, copiedSet) {
  if (copiedSet.has(depName)) {
    return; // Already copied
  }

  // Skip workspace/file deps - they're handled separately via .local/ and .tgz/
  // They're not in bundledDependencies, but check anyway for safety
  if (depName === 'zowe-mcp-common' || depName === 'zowe-native-proto-sdk') {
    return;
  }

  const rootDepPath = path.join(rootNodeModulesPath, depName);
  const localDepPath = path.join(nodeModulesPath, depName);

  // Find the package in root (handle scoped packages)
  let actualRootPath = rootDepPath;
  const scopedMatch = depName.match(/^(@[^/]+)\/(.+)$/);
  if (scopedMatch && !fs.existsSync(rootDepPath)) {
    const scopeDir = path.join(rootNodeModulesPath, scopedMatch[1]);
    actualRootPath = path.join(scopeDir, scopedMatch[2]);
  }

  if (!fs.existsSync(actualRootPath)) {
    return; // Not found in root
  }

  // Copy the package
  try {
    const stat = fs.lstatSync(actualRootPath);
    const realPath = stat.isSymbolicLink() ? fs.realpathSync(actualRootPath) : actualRootPath;

    // Determine local path (handle scoped)
    let actualLocalPath = localDepPath;
    if (scopedMatch) {
      const localScopeDir = path.join(nodeModulesPath, scopedMatch[1]);
      if (!fs.existsSync(localScopeDir)) {
        fs.mkdirSync(localScopeDir, { recursive: true });
      }
      actualLocalPath = path.join(localScopeDir, scopedMatch[2]);
    }

    // Skip if already exists as real directory
    if (fs.existsSync(actualLocalPath)) {
      try {
        const localStat = fs.lstatSync(actualLocalPath);
        if (!localStat.isSymbolicLink()) {
          copiedSet.add(depName);
          return; // Already copied
        }
        fs.rmSync(actualLocalPath, { recursive: true, force: true });
      } catch {
        // Continue to copy
      }
    }

    fs.cpSync(realPath, actualLocalPath, { recursive: true });
    copiedSet.add(depName);

    // Read package.json to find transitive dependencies
    const depPkgJsonPath = path.join(actualLocalPath, 'package.json');
    if (fs.existsSync(depPkgJsonPath)) {
      try {
        const depPkg = JSON.parse(fs.readFileSync(depPkgJsonPath, 'utf-8'));
        const deps = { ...depPkg.dependencies, ...depPkg.optionalDependencies };
        for (const transDepName of Object.keys(deps)) {
          // Only copy if it's not already in our bundled list (we'll handle those separately)
          // and if it exists in root node_modules (hoisted)
          if (!bundledDeps.includes(transDepName)) {
            const transRootPath = path.join(rootNodeModulesPath, transDepName);
            if (fs.existsSync(transRootPath) || (transDepName.match(/^@[^/]+\//) && fs.existsSync(path.join(rootNodeModulesPath, transDepName.split('/')[0])))) {
              copyDepWithTransitives(transDepName, copiedSet);
            }
          }
        }
      } catch (err) {
        // Ignore errors reading package.json
      }
    }
  } catch (err) {
    console.warn(`  Warning: Could not copy ${depName}: ${err.message}`);
  }
}

// Copy bundled dependencies and their transitive dependencies
const copiedSet = new Set();
console.log(`  Copying ${bundledDeps.length} bundled dependencies and their transitive deps...`);
for (const depName of bundledDeps) {
  copyDepWithTransitives(depName, copiedSet);
}

if (copiedSet.size > 0) {
  console.log(`  Copied ${copiedSet.size} packages (${bundledDeps.length} bundled + transitive deps)`);
} else {
  console.log('  All dependencies already present locally');
}
