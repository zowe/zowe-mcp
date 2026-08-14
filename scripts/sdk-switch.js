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
 * Switch the zowex-sdk dependency (Zowe Remote SSH SDK; formerly zowe-native-proto-sdk).
 *
 * All modes download/copy the SDK tarball into resources/ with a versioned
 * filename (e.g. resources/zowe-zowex-for-zowe-sdk-0.6.0.tgz) and set the
 * server's package.json dependency to file:../../resources/<filename>.
 *
 * Usage:
 *   node scripts/sdk-switch.js release [version]
 *     Latest (or specific) release from Zowe Artifactory npm registry.
 *
 *   node scripts/sdk-switch.js nightly [--write-pin]
 *     Latest nightly SDK from Artifactory libs-snapshot-local.
 *     Falls back to the latest successful Build workflow on main.
 *     With --write-pin, records what it resolved into resources/zowex-pin.json so the
 *     result can be committed as the new CI pin.
 *
 *   node scripts/sdk-switch.js pin [--no-install]
 *     Downloads the exact build named by resources/zowex-pin.json and verifies its SHA-256.
 *     This is what regular CI uses: the tarball is staged into resources/ (gitignored) rather
 *     than committed. --no-install stages without running npm install, for callers that
 *     follow up with `npm ci`.
 *
 *   node scripts/sdk-switch.js pr <pr-number>
 *     Downloads the SDK artifact from the PR's Build workflow run.
 *
 *   node scripts/sdk-switch.js branch <branch-name>
 *     Downloads the SDK artifact from the latest successful Build workflow run.
 *
 *   node scripts/sdk-switch.js local <path>
 *     Uses a local .tgz file or a zowex repo directory (clone of https://github.com/zowe/zowex).
 *     If a directory is given, looks for a pre-built .tgz in dist/.
 *
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const serverPkgPath = path.join(repoRoot, 'packages', 'zowe-mcp-server', 'package.json');
const resourcesDir = path.join(repoRoot, 'resources');
/** GitHub repo for Zowe Remote SSH (zowex); formerly zowe/zowe-native-proto. */
const ZOWEX_REPO = 'zowe/zowex';
/** npm package name of the SDK (renamed from `zowex-sdk` in 0.6.0). */
const PKG_NAME = '@zowe/zowex-for-zowe-sdk';
/**
 * Name of the SDK artifact produced by the upstream zowe/zowex Build workflow
 * and the Artifactory snapshot tarball prefix. This is controlled by the
 * upstream repo and is independent of the npm package name above.
 */
const ARTIFACT_NAME = 'zowex-sdk';
const ARTIFACTORY_NPM = 'https://zowe.jfrog.io/artifactory/api/npm/npm-release/';
/** Nightly SDK snapshots (repo path renamed from zowe-native-proto to zowex). */
const ARTIFACTORY_SNAPSHOT_BASE =
  'https://zowe.jfrog.io/artifactory/libs-snapshot-local/org/zowe/zowex/SDK/Nightly';

/**
 * Committed pin describing the exact nightly regular CI builds against. The tarball it names is
 * staged into resources/ on demand and is gitignored, so the pin (not a 3 MB blob) is what travels
 * in git. See resources/zowex-pin.json for the field documentation.
 */
const PIN_PATH = path.join(repoRoot, 'resources', 'zowex-pin.json');

/** Canonical filename for the SDK tarball in resources/. */
function sdkTgzFilename(version) {
  return `zowe-zowex-for-zowe-sdk-${version}.tgz`;
}

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

/** Lockfile path prefix for deps bundled inside the file-based SDK tarball. */
const NESTED_SDK_NODE_MODULES_PREFIX =
  'packages/zowe-mcp-server/node_modules/@zowe/zowex-for-zowe-sdk/node_modules/';

function removeSdkIntegrityFromLockfile() {
  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return;

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  let changed = false;
  let nestedRemoved = 0;

  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (!entry || typeof entry !== 'object') continue;

    if (key.endsWith(`/${PKG_NAME}`) || entry.name === PKG_NAME) {
      if (entry.integrity) {
        delete entry.integrity;
        changed = true;
        console.log('Removed integrity hash for %s from package-lock.json (%s)', PKG_NAME, key);
      }
    } else if (key.startsWith(NESTED_SDK_NODE_MODULES_PREFIX)) {
      if (entry.integrity) {
        delete entry.integrity;
        changed = true;
        nestedRemoved += 1;
      }
    }
  }

  if (nestedRemoved > 0) {
    console.log(
      'Removed integrity hash for %d nested package(s) under %s',
      nestedRemoved,
      NESTED_SDK_NODE_MODULES_PREFIX
    );
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
  execSync('npm install --ignore-scripts', {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
}

/**
 * Read the version from a tarball by extracting its package.json.
 * Returns the version string or the provided fallback.
 */
function readVersionFromTgz(tgzPath, fallback) {
  const tmpDir = path.join(repoRoot, '.sdk-version-tmp');
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    execSync(`tar -xzf "${tgzPath}" -C "${tmpDir}" --include='package/package.json'`, {
      stdio: 'ignore',
    });
    const pkgJson = path.join(tmpDir, 'package', 'package.json');
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      return pkg.version || fallback;
    }
  } catch {
    // fall through
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return fallback;
}

/**
 * Copy a tarball into resources/ and point the server dependency at it.
 *
 * @param {object} [opts]
 * @param {string} [opts.filename] Exact destination filename (defaults to the version-derived name).
 *   Used by `pin` mode, where the filename is dictated by the committed pin rather than the version.
 * @param {boolean} [opts.skipInstall] Stage the tarball and rewrite package.json but do not run
 *   `npm install`. Used by CI, which stages the pinned tarball and then runs `npm ci` itself.
 * @param {boolean} [opts.preserveIntegrity] Keep the SDK's integrity hash in package-lock.json.
 *   The other modes strip it because their tarball contents move under a reused filename, which
 *   would make `npm ci` fail on a stale hash. `pin` mode is the opposite case: the pin fixes the
 *   bytes by SHA-256, so keeping the hash lets npm verify them too, and stops a local `pin` run
 *   from showing up as a spurious package-lock.json diff.
 */
function installSdkToResources(srcTgzPath, version, label, opts = {}) {
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  const filename = opts.filename ?? sdkTgzFilename(version);
  const dest = path.join(resourcesDir, filename);

  if (path.resolve(srcTgzPath) !== path.resolve(dest)) {
    fs.copyFileSync(srcTgzPath, dest);
  }
  console.log('SDK tarball: %s', dest);

  const relPath = `file:../../resources/${filename}`;
  removeRootOverrides();
  setDependency(relPath);
  if (opts.skipInstall) {
    console.log('\nSDK staged from %s (install skipped): %s', label, dest);
    return dest;
  }
  npmInstall();
  if (!opts.preserveIntegrity) {
    removeSdkIntegrityFromLockfile();
  }
  console.log('\nSDK switched to %s: %s', label, dest);
  return dest;
}

/**
 * Find the SDK artifact ID from a GitHub Actions workflow run.
 */
function findSdkArtifactFromRun(runId) {
  const artifactsJson = run(
    `gh api repos/${ZOWEX_REPO}/actions/runs/${runId}/artifacts --jq '.artifacts[] | select(.name == "${ARTIFACT_NAME}") | .id'`
  );
  if (!artifactsJson) {
    return null;
  }
  return artifactsJson.split('\n')[0];
}

/**
 * Download a GitHub Actions artifact by ID, extract the tgz, install to resources/.
 */
function downloadAndInstallGhArtifact(artifactId, label) {
  const tmpDir = path.join(repoRoot, '.sdk-download-tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const zipPath = path.join(tmpDir, 'artifact.zip');
  console.log('Downloading artifact %s...', artifactId);
  run(`gh api repos/${ZOWEX_REPO}/actions/artifacts/${artifactId}/zip > "${zipPath}"`);

  run(`unzip -o "${zipPath}" -d "${tmpDir}"`);
  fs.unlinkSync(zipPath);

  const tgz = findTgzInDir(tmpDir);
  const tgzPath = path.join(tmpDir, tgz);
  const version = readVersionFromTgz(
    tgzPath,
    tgz
      .replace(/^(zowe-zowex-for-zowe-sdk|zowex-sdk|zowe-native-proto-sdk)-/, '')
      .replace(/\.tgz$/, '')
  );

  installSdkToResources(tgzPath, version, label);
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
 */
function findSuccessfulBuildRun(branch, event) {
  const json = run(
    `gh api "repos/${ZOWEX_REPO}/actions/workflows/build.yml/runs?branch=${branch}&event=${event}&status=success&per_page=1" --jq '.workflow_runs[0] | [.id, .head_sha, .created_at] | @tsv'`
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
    console.log('Querying latest SDK version from Artifactory npm-release...');
    try {
      v = run(`npm view ${PKG_NAME} version --registry ${ARTIFACTORY_NPM}`);
      console.log('Latest published version: %s', v);
    } catch {
      console.error(
        '%s is not published to npm-release yet, or the registry is unreachable.',
        PKG_NAME
      );
      console.error(
        'Use: npm run sdk:nightly   (latest snapshot under org/zowe/zowex/SDK/Nightly)'
      );
      process.exit(1);
    }
  }

  console.log('Downloading %s@%s from Artifactory...', PKG_NAME, v);
  const tmpDir = path.join(repoRoot, '.sdk-download-tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  run(`npm pack ${PKG_NAME}@${v} --registry ${ARTIFACTORY_NPM} --pack-destination "${tmpDir}"`);
  const tgz = findTgzInDir(tmpDir);
  const tgzPath = path.join(tmpDir, tgz);

  installSdkToResources(tgzPath, v, `Artifactory release ${v}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Mode: nightly
// ---------------------------------------------------------------------------

function handleNightly({ writePin: shouldWritePin } = {}) {
  console.log('Looking for latest nightly SDK on Artifactory...');

  if (tryArtifactoryNightly({ shouldWritePin })) return;

  if (shouldWritePin) {
    console.error(
      'Could not resolve a nightly from Artifactory, so there is nothing to pin.\n' +
        'Re-run without --write-pin to fall back to the latest main build artifact.'
    );
    process.exit(1);
  }
  console.log('No nightly SDK found on Artifactory, falling back to GitHub Actions (main)...');
  handleBranch('main');
}

function tryArtifactoryNightly({ shouldWritePin } = {}) {
  try {
    const listJson = run(
      `curl -sf "${ARTIFACTORY_SNAPSHOT_BASE}/" 2>/dev/null | grep -oE 'href="((zowe-zowex-for-zowe-sdk|zowex-sdk)-[^"]+\\.tgz)"' | sed 's/href="//;s/"//' | sort | tail -1`
    );

    if (!listJson) return false;

    const tgzName = listJson.trim();
    if (!tgzName.endsWith('.tgz')) return false;

    console.log('Found nightly SDK: %s', tgzName);
    const url = `${ARTIFACTORY_SNAPSHOT_BASE}/${tgzName}`;

    const tmpDir = path.join(repoRoot, '.sdk-download-tmp');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const tmpDest = path.join(tmpDir, tgzName);
    console.log('Downloading %s...', url);
    run(`curl -sfL -o "${tmpDest}" "${url}"`);

    if (!fs.existsSync(tmpDest) || fs.statSync(tmpDest).size === 0) {
      console.log('Download failed or empty file.');
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return false;
    }

    const version = readVersionFromTgz(tmpDest, 'nightly');
    const datestamp = tgzName.match(/(\d{4}-\d{2}-\d{2}-\d{6})/);
    const versionLabel = datestamp ? `${version}-nightly-${datestamp[1]}` : version;
    const filename = sdkTgzFilename(versionLabel);

    installSdkToResources(tmpDest, versionLabel, `nightly (Artifactory)`);
    if (shouldWritePin) {
      writePin({
        tgzPath: path.join(resourcesDir, filename),
        filename,
        url,
        version,
        datestamp: datestamp ? datestamp[1] : null,
      });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  console.log('Looking up PR #%s in %s...', prNumber, ZOWEX_REPO);

  let artifactId;
  try {
    const comments = run(`gh api repos/${ZOWEX_REPO}/issues/${prNumber}/comments --jq '.[].body'`);
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

  if (!artifactId) {
    console.log('No SDK link in PR comments, looking up Build workflow run...');
    const headSha = run(
      `gh pr view ${prNumber} --repo ${ZOWEX_REPO} --json headRefOid --jq .headRefOid`
    );
    console.log('PR head SHA: %s', headSha);

    const runsJson = run(
      `gh api "repos/${ZOWEX_REPO}/actions/runs?head_sha=${headSha}&event=pull_request" --jq '.workflow_runs[] | select(.name == "Build") | .id'`
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

  try {
    runInfo = findSuccessfulBuildRun(branchName, 'push');
    if (runInfo) runId = runInfo.id;
  } catch {
    // fall through
  }

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
      `No successful Build workflow run found for branch '${branchName}'.\nCheck: https://github.com/${ZOWEX_REPO}/actions/workflows/build.yml`
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
      `No '${PKG_NAME}' artifact in workflow run ${runId}.\nCheck: https://github.com/${ZOWEX_REPO}/actions/runs/${runId}`
    );
  }

  downloadAndInstallGhArtifact(artifactId, `branch '${branchName}' (${runInfo.date})`);
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
    const version = readVersionFromTgz(resolved, 'local');
    installSdkToResources(resolved, version, 'local tgz');
    return;
  }

  if (stat.isDirectory()) {
    const sdkPkgDir = path.join(resolved, 'packages', 'sdk');
    if (!fs.existsSync(path.join(sdkPkgDir, 'package.json'))) {
      console.error(
        'Directory does not appear to be a zowex SDK repo (no packages/sdk/package.json): %s',
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
    const version = readVersionFromTgz(tgzPath, 'local');
    installSdkToResources(tgzPath, version, `local repo (${resolved})`);
    return;
  }

  console.error('Path must be a .tgz file or a zowex SDK repo directory: %s', resolved);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Mode: pin  (and --write-pin support for nightly)
// ---------------------------------------------------------------------------

/** SHA-256 of a buffer, lowercase hex. */
function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** SHA-256 of a file, lowercase hex. */
function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

/**
 * Read a file, returning `undefined` when it does not exist.
 *
 * Read-and-catch rather than `existsSync` followed by `readFileSync`: the two-step form is a
 * check-then-use race (CodeQL js/file-system-race), and this repo has already had to fix one
 * of those — see the server.json version update in the release scripts.
 */
function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

function readPin() {
  const raw = readFileIfExists(PIN_PATH);
  if (raw === undefined) {
    console.error(
      'No pin file at %s. Create one with: sdk-switch.js nightly --write-pin',
      PIN_PATH
    );
    process.exit(1);
  }
  return JSON.parse(raw.toString('utf8'));
}

/**
 * Stage the exact tarball named by resources/zowex-pin.json.
 *
 * Reuses an already-staged copy when its SHA-256 matches, so repeat local runs do not re-download.
 * A checksum mismatch is fatal rather than a silent re-fetch: the pin names immutable bytes, so a
 * mismatch means either local tampering or an upstream artifact that was replaced in place.
 */
function handlePin({ skipInstall } = {}) {
  const pin = readPin();
  const dest = path.join(resourcesDir, pin.filename);

  const stagedBytes = readFileIfExists(dest);
  if (stagedBytes !== undefined) {
    if (sha256Buffer(stagedBytes) === pin.sha256) {
      console.log('Pinned SDK already staged: %s', dest);
      installSdkToResources(dest, pin.version, `pin ${pin.datestamp}`, {
        filename: pin.filename,
        skipInstall,
        preserveIntegrity: true,
      });
      return;
    }
    console.log('Staged copy has unexpected checksum, re-downloading...');
  }

  // mkdir -p is idempotent, so no existence check (and no check-then-use race).
  fs.mkdirSync(resourcesDir, { recursive: true });

  console.log('Downloading pinned SDK %s...', pin.filename);
  const tmpDir = path.join(repoRoot, '.sdk-download-tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDest = path.join(tmpDir, pin.filename);

  try {
    run(`curl -sfL -o "${tmpDest}" "${pin.url}"`);
  } catch {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error(
      'Failed to download the pinned SDK:\n  %s\n' +
        'Nightly snapshots are pruned upstream after roughly six weeks. If this pin has aged out, ' +
        'refresh it with: node scripts/sdk-switch.js nightly --write-pin',
      pin.url
    );
    process.exit(1);
  }

  const actual = sha256File(tmpDest);
  if (actual !== pin.sha256) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error(
      'Checksum mismatch for %s\n  expected %s\n  actual   %s',
      pin.filename,
      pin.sha256,
      actual
    );
    process.exit(1);
  }
  console.log('Checksum verified: %s', actual);

  installSdkToResources(tmpDest, pin.version, `pin ${pin.datestamp}`, {
    filename: pin.filename,
    skipInstall,
    preserveIntegrity: true,
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Record a just-resolved nightly as the new pin. Called by `nightly --write-pin`; the resulting
 * file is meant to be committed alongside the package.json/package-lock.json changes.
 */
function writePin({ tgzPath, filename, url, version, datestamp }) {
  const existingRaw = readFileIfExists(PIN_PATH);
  const existing = existingRaw === undefined ? {} : JSON.parse(existingRaw.toString('utf8'));
  const pin = {
    ...existing,
    package: PKG_NAME,
    version,
    train: 'Nightly',
    datestamp: datestamp ?? null,
    filename,
    url,
    sha256: sha256File(tgzPath),
    pinnedAt: new Date().toISOString().slice(0, 10),
  };

  // The upstream commit cannot be derived from the tarball, so it is carried in explicitly.
  // The nightly workflow resolves it from zowe/zowex and passes it through the environment;
  // an interactive run without these set gets a placeholder rather than a stale inherited value.
  pin.upstream = resolveUpstream();

  fs.writeFileSync(PIN_PATH, JSON.stringify(pin, null, 2) + '\n', 'utf8');
  console.log('\nWrote pin: %s', PIN_PATH);
  console.log('  sha256 %s', pin.sha256);
  if (!pin.upstream.commit) {
    console.log(
      '  NOTE: no upstream commit recorded (set ZOWEX_UPSTREAM_COMMIT, or fill in the\n' +
        '  "upstream" block by hand before committing).'
    );
  }
}

/**
 * Build the pin's `upstream` provenance block. Prefers explicit environment values (set by CI);
 * otherwise tries the zowe/zowex main HEAD via `gh`, which is the commit the nightly is built
 * from. Returns nulls rather than guessing when neither is available.
 */
function resolveUpstream() {
  const fromEnv = process.env.ZOWEX_UPSTREAM_COMMIT;
  if (fromEnv) {
    return {
      repo: ZOWEX_REPO,
      commit: fromEnv,
      releaseRunId: process.env.ZOWEX_UPSTREAM_RUN_ID ?? null,
    };
  }
  try {
    const sha = run(`gh api repos/${ZOWEX_REPO}/commits/main --jq .sha`);
    if (/^[0-9a-f]{40}$/.test(sha)) {
      return {
        repo: ZOWEX_REPO,
        commit: sha,
        releaseRunId: null,
        note: 'Resolved from zowe/zowex main HEAD at pin time, not from the build itself — treat as approximate.',
      };
    }
  } catch {
    // gh unavailable or unauthenticated — fall through.
  }
  return { repo: ZOWEX_REPO, commit: null, releaseRunId: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [, , mode, ...rest] = process.argv;
const flags = new Set(rest.filter(a => a.startsWith('--')));
const positional = rest.filter(a => !a.startsWith('--'));

function main() {
  switch (mode) {
    case 'release':
      handleRelease(positional[0]);
      break;
    case 'nightly':
      handleNightly({ writePin: flags.has('--write-pin') });
      break;
    case 'pin':
      handlePin({ skipInstall: flags.has('--no-install') });
      break;
    case 'pr':
      handlePr(positional[0]);
      break;
    case 'branch':
      handleBranch(positional[0]);
      break;
    case 'local':
      handleLocal(positional[0]);
      break;
    default:
      console.error('Usage:');
      console.error(
        '  node scripts/sdk-switch.js release [version]    Latest (or specific) release from Artifactory'
      );
      console.error(
        '  node scripts/sdk-switch.js nightly [--write-pin]  Latest nightly build (optionally re-pin)'
      );
      console.error(
        '  node scripts/sdk-switch.js pin [--no-install]  Exact build from resources/zowex-pin.json'
      );
      console.error(
        '  node scripts/sdk-switch.js pr <pr-number>       SDK from a specific PR build'
      );
      console.error(
        '  node scripts/sdk-switch.js branch <branch>      Latest successful build for a branch'
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
