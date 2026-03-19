#!/usr/bin/env node
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
 * Switch the zowe-native-proto-sdk dependency between multiple sources.
 *
 * Usage:
 *   node scripts/sdk-switch.js release [version]
 *     Latest (or specific) release from Zowe Artifactory npm registry.
 *     Without version: queries the registry for the latest published version.
 *     With version: sets dependency to "^<version>".
 *
 *   node scripts/sdk-switch.js nightly
 *     Latest nightly SDK from Artifactory libs-snapshot-local.
 *     Falls back to the latest successful Build workflow on main if no snapshot exists.
 *
 *   node scripts/sdk-switch.js pr <pr-number>
 *     Downloads the SDK artifact from the PR's Build workflow run.
 *
 *   node scripts/sdk-switch.js branch <branch-name>
 *     Downloads the SDK artifact from the latest successful Build workflow run for a branch.
 *
 *   node scripts/sdk-switch.js local <path>
 *     Uses a local .tgz file or a zowe-native-proto repo directory.
 *     If a directory is given, looks for a pre-built .tgz in dist/ (run "npm run package" in the SDK repo first).
 *
 *   node scripts/sdk-switch.js fallback
 *     Uses the in-repo fallback resource (resources/znp-sdk-fallback.tgz). For CI and when nightly is unavailable.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const serverPkgPath = path.join(repoRoot, 'packages', 'zowe-mcp-server', 'package.json');
const depsDir = path.join(repoRoot, 'deps');
const ZNP_REPO = 'zowe/zowe-native-proto';
const PKG_NAME = 'zowe-native-proto-sdk';
const DEFAULT_VERSION = '0.3.0';
const ARTIFACTORY_NPM = 'https://zowe.jfrog.io/artifactory/api/npm/npm-release/';
const ARTIFACTORY_SNAPSHOT_BASE =
  'https://zowe.jfrog.io/artifactory/libs-snapshot-local/org/zowe/zowe-native-proto/SDK/Nightly';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function readServerPkg() {
  return JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
}

function writeServerPkg(data) {
  fs.writeFileSync(serverPkgPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function run(cmd, opts) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: repoRoot,
    shell: true,
    ...opts,
  }).trim();
}

function setDependency(value) {
  const pkg = readServerPkg();
  pkg.dependencies[PKG_NAME] = value;
  writeServerPkg(pkg);
  console.log('Set packages/zowe-mcp-server dependencies.%s = %s', PKG_NAME, value);
}

function removeRootOverrides() {
  const rootPkgPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  if (pkg.overrides) {
    delete pkg.overrides;
    fs.writeFileSync(rootPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log('Removed leftover overrides from root package.json');
  }
}

function removeSdkIntegrityFromLockfile() {
  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return;

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  let changed = false;

  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (key.endsWith(`/${PKG_NAME}`) || entry.name === PKG_NAME) {
      if (entry.integrity) {
        delete entry.integrity;
        changed = true;
        console.log('Removed integrity hash for %s from package-lock.json (%s)', PKG_NAME, key);
      }
    }
  }

  if (changed) {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  }
}

function removeInstalledSdk() {
  const installed = path.join(repoRoot, 'node_modules', PKG_NAME);
  if (fs.existsSync(installed)) {
    fs.rmSync(installed, { recursive: true });
    console.log('Removed cached %s from node_modules', PKG_NAME);
  }
}

function npmInstall() {
  removeInstalledSdk();
  console.log('Running npm install...');
  execSync('npm install', {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
}

function prepareDepsDir() {
  if (fs.existsSync(depsDir)) {
    fs.rmSync(depsDir, { recursive: true });
  }
  fs.mkdirSync(depsDir, { recursive: true });
}

/**
 * Find the SDK artifact ID from a GitHub Actions workflow run.
 */
function findSdkArtifactFromRun(runId) {
  const artifactsJson = run(
    `gh api repos/${ZNP_REPO}/actions/runs/${runId}/artifacts --jq '.artifacts[] | select(.name == "${PKG_NAME}") | .id'`
  );
  if (!artifactsJson) {
    return null;
  }
  return artifactsJson.split('\n')[0];
}

/**
 * Download a GitHub Actions artifact by ID, extract the tgz, set the dependency, and install.
 * Returns the tgz filename.
 */
function downloadAndInstallGhArtifact(artifactId, label) {
  prepareDepsDir();

  const zipPath = path.join(depsDir, 'artifact.zip');
  console.log('Downloading artifact %s...', artifactId);
  run(`gh api repos/${ZNP_REPO}/actions/artifacts/${artifactId}/zip > "${zipPath}"`);

  run(`unzip -o "${zipPath}" -d "${depsDir}"`);
  fs.unlinkSync(zipPath);

  const tgz = findTgzInDir(depsDir);

  const relPath = `file:../../deps/${tgz}`;
  const tgzFullPath = path.join(depsDir, tgz);
  console.log('Extracted SDK tarball: %s', tgzFullPath);

  removeRootOverrides();
  setDependency(relPath);
  npmInstall();
  removeSdkIntegrityFromLockfile();
  console.log('\nSDK switched to %s: %s', label, tgzFullPath);
  return tgz;
}

/**
 * Install an SDK from a local tgz file path. Copies to deps/ and sets the file: dependency.
 */
function installFromLocalTgz(tgzPath, label) {
  prepareDepsDir();

  const tgzName = path.basename(tgzPath);
  const dest = path.join(depsDir, tgzName);
  fs.copyFileSync(tgzPath, dest);
  console.log('Copied SDK tarball to %s', dest);

  const relPath = `file:../../deps/${tgzName}`;

  removeRootOverrides();
  setDependency(relPath);
  npmInstall();
  removeSdkIntegrityFromLockfile();
  console.log('\nSDK switched to %s: %s', label, dest);
}

function findTgzInDir(dir) {
  const files = fs.readdirSync(dir);
  const tgz = files.find(f => f.endsWith('.tgz'));
  if (!tgz) {
    console.error('No .tgz file found in %s. Contents: %s', dir, files.join(', '));
    process.exit(1);
  }
  return tgz;
}

/**
 * Find the latest successful Build workflow run for a branch and event type.
 * Returns { id, sha, date, event } or null.
 */
function findSuccessfulBuildRun(branch, event) {
  const json = run(
    `gh api "repos/${ZNP_REPO}/actions/workflows/build.yml/runs?branch=${branch}&event=${event}&status=success&per_page=1" --jq '.workflow_runs[0] | [.id, .head_sha, .created_at] | @tsv'`
  );
  if (!json || json === 'null') return null;
  const parts = json.split('\t');
  if (!parts[0] || parts[0] === 'null') return null;
  return { id: parts[0], sha: parts[1], date: parts[2], event };
}

// ---------------------------------------------------------------------------
// Mode: release [version]
// ---------------------------------------------------------------------------

function handleRelease(version) {
  let v = version;
  if (!v) {
    console.log('Querying latest SDK version from Artifactory...');
    try {
      v = run(`npm view ${PKG_NAME} version --registry ${ARTIFACTORY_NPM}`);
      console.log('Latest published version: %s', v);
    } catch (err) {
      console.error(
        'Failed to query latest version from Artifactory. Using default: %s',
        DEFAULT_VERSION
      );
      v = DEFAULT_VERSION;
    }
  }
  const spec = `^${v}`;
  removeRootOverrides();
  setDependency(spec);
  npmInstall();
  removeSdkIntegrityFromLockfile();
  console.log('\nSDK switched to Artifactory release: %s', spec);
}

// ---------------------------------------------------------------------------
// Mode: nightly
// ---------------------------------------------------------------------------

function handleNightly() {
  console.log('Looking for latest nightly SDK on Artifactory...');

  if (tryArtifactoryNightly()) return;

  // Fallback: latest successful Build workflow run on main
  console.log('No nightly SDK found on Artifactory, falling back to GitHub Actions (main)...');
  handleBranch('main');
}

function tryArtifactoryNightly() {
  try {
    const listJson = run(
      `curl -sf "${ARTIFACTORY_SNAPSHOT_BASE}/" 2>/dev/null | grep -oE 'href="(zowe-native-proto-sdk-[^"]+\\.tgz)"' | sed 's/href="//;s/"//' | sort | tail -1`
    );

    if (!listJson) return false;

    const tgzName = listJson.trim();
    if (!tgzName.endsWith('.tgz')) return false;

    console.log('Found nightly SDK: %s', tgzName);
    const url = `${ARTIFACTORY_SNAPSHOT_BASE}/${tgzName}`;

    prepareDepsDir();
    const dest = path.join(depsDir, tgzName);
    console.log('Downloading %s...', url);
    run(`curl -sfL -o "${dest}" "${url}"`);

    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
      console.log('Download failed or empty file.');
      return false;
    }

    const relPath = `file:../../deps/${tgzName}`;
    removeRootOverrides();
    setDependency(relPath);
    npmInstall();
    removeSdkIntegrityFromLockfile();

    const datestamp = tgzName.match(/(\d{4}-\d{2}-\d{2}-\d{6})/);
    console.log(
      '\nSDK switched to nightly (Artifactory): %s%s',
      dest,
      datestamp ? ` (built ${datestamp[1]})` : ''
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mode: pr <number>
// ---------------------------------------------------------------------------

function handlePr(prNumber) {
  if (!prNumber || !/^\d+$/.test(prNumber)) {
    console.error('Usage: node scripts/sdk-switch.js pr <pr-number>');
    process.exit(1);
  }

  console.log('Looking up PR #%s in %s...', prNumber, ZNP_REPO);

  // Strategy 1: Parse the artifact URL from PR comments
  let artifactId;
  try {
    const comments = run(`gh api repos/${ZNP_REPO}/issues/${prNumber}/comments --jq '.[].body'`);
    const sdkMatch = comments.match(
      /SDK:\s*https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+\/artifacts\/(\d+)/
    );
    if (sdkMatch) {
      artifactId = sdkMatch[1];
      console.log('Found SDK artifact ID %s from PR comment.', artifactId);
    }
  } catch {
    // fall through to strategy 2
  }

  // Strategy 2: Find the Build workflow run for the PR head SHA
  if (!artifactId) {
    console.log('No SDK link in PR comments, looking up Build workflow run...');
    const headSha = run(
      `gh pr view ${prNumber} --repo ${ZNP_REPO} --json headRefOid --jq .headRefOid`
    );
    console.log('PR head SHA: %s', headSha);

    const runsJson = run(
      `gh api "repos/${ZNP_REPO}/actions/runs?head_sha=${headSha}&event=pull_request" --jq '.workflow_runs[] | select(.name == "Build") | .id'`
    );
    const runIds = runsJson.split('\n').filter(Boolean);
    if (runIds.length === 0) {
      console.error('No Build workflow run found for PR #%s (SHA %s).', prNumber, headSha);
      process.exit(1);
    }
    const runId = runIds[0];
    console.log('Found Build workflow run: %s', runId);

    artifactId = findSdkArtifactFromRun(runId);
    if (!artifactId) {
      console.error("No '%s' artifact in workflow run %s.", PKG_NAME, runId);
      process.exit(1);
    }
    console.log('Found artifact ID: %s', artifactId);
  }

  downloadAndInstallGhArtifact(artifactId, `PR #${prNumber}`);
}

// ---------------------------------------------------------------------------
// Mode: branch <name>
// ---------------------------------------------------------------------------

function handleBranch(branchName) {
  if (!branchName) {
    throw new Error('Usage: node scripts/sdk-switch.js branch <branch-name>');
  }

  console.log("Looking for latest successful Build run on branch '%s'...", branchName);

  let runId;
  let runInfo;

  // Try push events first (works for main and branches with direct pushes)
  try {
    runInfo = findSuccessfulBuildRun(branchName, 'push');
    if (runInfo) runId = runInfo.id;
  } catch {
    // fall through
  }

  // Try pull_request events (works for feature branches with open PRs)
  if (!runId) {
    try {
      runInfo = findSuccessfulBuildRun(branchName, 'pull_request');
      if (runInfo) runId = runInfo.id;
    } catch {
      // fall through
    }
  }

  if (!runId) {
    throw new Error(
      `No successful Build workflow run found for branch '${branchName}'.\nCheck: https://github.com/${ZNP_REPO}/actions/workflows/build.yml`
    );
  }

  console.log(
    'Found Build run %s (event: %s, SHA: %s, date: %s)',
    runId,
    runInfo.event,
    runInfo.sha?.substring(0, 8),
    runInfo.date
  );

  const artifactId = findSdkArtifactFromRun(runId);
  if (!artifactId) {
    throw new Error(
      `No '${PKG_NAME}' artifact in workflow run ${runId}.\nCheck: https://github.com/${ZNP_REPO}/actions/runs/${runId}`
    );
  }

  downloadAndInstallGhArtifact(artifactId, `branch '${branchName}' (${runInfo.date})`);
}

// ---------------------------------------------------------------------------
// Mode: fallback
// ---------------------------------------------------------------------------

const FALLBACK_PATH = path.join(repoRoot, 'resources', 'znp-sdk-fallback.tgz');

function handleFallback() {
  if (!fs.existsSync(FALLBACK_PATH)) {
    console.log('Fallback SDK not found, running git lfs pull...');
    try {
      run('git lfs pull');
    } catch (err) {
      console.error('git lfs pull failed: %s', err.message);
      process.exit(1);
    }
  }
  if (!fs.existsSync(FALLBACK_PATH)) {
    console.error(
      'Fallback SDK not found. Run "git lfs pull" or add resources/znp-sdk-fallback.tgz.'
    );
    console.error('Expected path: %s', FALLBACK_PATH);
    process.exit(1);
  }
  const relPath = 'file:../../resources/znp-sdk-fallback.tgz';
  removeRootOverrides();
  setDependency(relPath);
  npmInstall();
  removeSdkIntegrityFromLockfile();
  console.log('\nSDK switched to fallback: %s', FALLBACK_PATH);
}

// ---------------------------------------------------------------------------
// Mode: local <path>
// ---------------------------------------------------------------------------

function handleLocal(inputPath) {
  if (!inputPath) {
    console.error('Usage: node scripts/sdk-switch.js local <path-to-tgz-or-repo>');
    process.exit(1);
  }

  const resolved = path.resolve(inputPath);

  if (!fs.existsSync(resolved)) {
    console.error('Path does not exist: %s', resolved);
    process.exit(1);
  }

  const stat = fs.statSync(resolved);

  if (stat.isFile() && resolved.endsWith('.tgz')) {
    console.log('Using local SDK tgz: %s', resolved);
    installFromLocalTgz(resolved, 'local tgz');
    return;
  }

  if (stat.isDirectory()) {
    const sdkPkgDir = path.join(resolved, 'packages', 'sdk');
    if (!fs.existsSync(path.join(sdkPkgDir, 'package.json'))) {
      console.error(
        'Directory does not appear to be a zowe-native-proto repo (no packages/sdk/package.json): %s',
        resolved
      );
      process.exit(1);
    }

    const distDir = path.join(resolved, 'dist');
    if (!fs.existsSync(distDir)) {
      console.error(
        'No dist/ directory found in %s. Run "npm run package" in the SDK repo first.',
        resolved
      );
      process.exit(1);
    }

    const tgzName = fs.readdirSync(distDir).find(f => f.endsWith('.tgz'));
    if (!tgzName) {
      console.error(
        'No .tgz file found in %s. Run "npm run package" in the SDK repo first.',
        distDir
      );
      process.exit(1);
    }

    const tgzPath = path.join(distDir, tgzName);
    console.log('Using pre-built SDK tgz: %s', tgzPath);
    installFromLocalTgz(tgzPath, `local repo (${resolved})`);
    return;
  }

  console.error('Path must be a .tgz file or a zowe-native-proto repo directory: %s', resolved);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [, , mode, ...rest] = process.argv;

function main() {
  switch (mode) {
    case 'release':
      handleRelease(rest[0]);
      break;
    case 'nightly':
      handleNightly();
      break;
    case 'pr':
      handlePr(rest[0]);
      break;
    case 'branch':
      handleBranch(rest[0]);
      break;
    case 'fallback':
      handleFallback();
      break;
    case 'local':
      handleLocal(rest[0]);
      break;
    default:
      console.error('Usage:');
      console.error(
        '  node scripts/sdk-switch.js release [version]    Latest (or specific) release from Artifactory'
      );
      console.error('  node scripts/sdk-switch.js nightly              Latest nightly build');
      console.error(
        '  node scripts/sdk-switch.js pr <pr-number>       SDK from a specific PR build'
      );
      console.error(
        '  node scripts/sdk-switch.js branch <branch>      Latest successful build for a branch'
      );
      console.error(
        '  node scripts/sdk-switch.js fallback             In-repo fallback resource (for CI)'
      );
      console.error(
        '  node scripts/sdk-switch.js local <path>         Local .tgz file or ZNP repo directory'
      );
      process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
