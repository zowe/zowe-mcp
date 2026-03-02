#!/usr/bin/env node
/**
 * Switch the zowe-native-proto-sdk dependency between Zowe Artifactory and a PR build.
 *
 * Usage:
 *   node scripts/sdk-switch.js zowe-artifactory [version]
 *     Sets server package.json dependency to "^<version>" (default: 0.2.4).
 *     Runs npm install.
 *
 *   node scripts/sdk-switch.js pr <pr-number>
 *     Downloads the SDK artifact from the PR's Build workflow run,
 *     extracts the tarball into sdk-pr/, sets server dependency to "file:../../sdk-pr/<tgz>",
 *     and runs npm install.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const serverPkgPath = path.join(repoRoot, 'packages', 'zowe-mcp-server', 'package.json');
const sdkPrDir = path.join(repoRoot, 'sdk-pr');
const ZNP_REPO = 'zowe/zowe-native-proto';
const PKG_NAME = 'zowe-native-proto-sdk';
const DEFAULT_VERSION = '0.2.4';

const NVM_PREFIX = '. $NVM_DIR/nvm.sh && nvm use && ';

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
    shell: '/bin/zsh',
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

function npmInstall() {
  console.log('Running npm install...');
  execSync(NVM_PREFIX + 'npm install', {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: '/bin/zsh',
  });
}

function handleArtifactory(version) {
  const v = version || DEFAULT_VERSION;
  const spec = `^${v}`;
  removeRootOverrides();
  setDependency(spec);
  npmInstall();
  console.log('\nSDK switched to Zowe Artifactory: %s', spec);
}

function handlePr(prNumber) {
  if (!prNumber || !/^\d+$/.test(prNumber)) {
    console.error('Usage: node scripts/sdk-switch.js pr <pr-number>');
    process.exit(1);
  }

  console.log('Looking up PR #%s in %s...', prNumber, ZNP_REPO);

  // Strategy 1: Parse the artifact URL from PR comments (bot posts "Client artifacts:" with SDK link)
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

  // Strategy 2: Find the Build workflow run for the PR head SHA and locate the artifact
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

    const artifactsJson = run(
      `gh api repos/${ZNP_REPO}/actions/runs/${runId}/artifacts --jq '.artifacts[] | select(.name == "${PKG_NAME}") | .id'`
    );
    if (!artifactsJson) {
      console.error("No '%s' artifact in workflow run %s.", PKG_NAME, runId);
      process.exit(1);
    }
    artifactId = artifactsJson.split('\n')[0];
    console.log('Found artifact ID: %s', artifactId);
  }

  // Prepare sdk-pr/ directory
  if (fs.existsSync(sdkPrDir)) {
    fs.rmSync(sdkPrDir, { recursive: true });
  }
  fs.mkdirSync(sdkPrDir, { recursive: true });

  // Download the artifact zip
  const zipPath = path.join(sdkPrDir, 'artifact.zip');
  console.log('Downloading artifact %s...', artifactId);
  run(`gh api repos/${ZNP_REPO}/actions/artifacts/${artifactId}/zip > "${zipPath}"`);

  // Extract the zip (contains one or more .tgz files)
  run(`unzip -o "${zipPath}" -d "${sdkPrDir}"`);
  fs.unlinkSync(zipPath);

  // Find the .tgz file
  const files = fs.readdirSync(sdkPrDir);
  const tgz = files.find(f => f.endsWith('.tgz'));
  if (!tgz) {
    console.error('No .tgz file found in downloaded artifact. Contents: %s', files.join(', '));
    process.exit(1);
  }

  // Path relative to server package.json (../../sdk-pr/<tgz>)
  const relPath = `file:../../sdk-pr/${tgz}`;
  console.log('Extracted SDK tarball: sdk-pr/%s', tgz);

  removeRootOverrides();
  setDependency(relPath);
  npmInstall();
  console.log('\nSDK switched to PR #%s build: sdk-pr/%s', prNumber, tgz);
}

// --- main ---
const [, , mode, ...rest] = process.argv;

switch (mode) {
  case 'zowe-artifactory':
    handleArtifactory(rest[0]);
    break;
  case 'pr':
    handlePr(rest[0]);
    break;
  default:
    console.error('Usage:');
    console.error('  node scripts/sdk-switch.js zowe-artifactory [version]');
    console.error('  node scripts/sdk-switch.js pr <pr-number>');
    process.exit(1);
}
