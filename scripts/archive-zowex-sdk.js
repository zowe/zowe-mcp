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
 * Archive the zowex SDK build used for this release into dist/, alongside a provenance record.
 *
 * Why archive the tarball and not just the metadata: nightly snapshots are pruned from
 * Artifactory after roughly six weeks, so a released version's exact SDK would otherwise become
 * unobtainable. Copying it into the release assets makes every published release
 * self-contained and rebuildable long after the upstream snapshot is gone.
 *
 * Writes into the directory given as argv[2] (defaults to <repo>/dist):
 *   - <pin.filename>            the SDK tarball itself (picked up by the `dist/*.tgz` release asset glob)
 *   - zowex-provenance.json     what it is and where it came from
 *
 * Usage: node scripts/archive-zowex-sdk.js [distDir]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const pinPath = path.join(repoRoot, 'resources', 'zowex-pin.json');
const distDir = path.resolve(process.argv[2] || path.join(repoRoot, 'dist'));

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Read a file, returning `undefined` when it does not exist.
 *
 * Read-and-catch rather than `existsSync` followed by `readFileSync`: the two-step form is a
 * check-then-use race (CodeQL js/file-system-race).
 */
function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

function fail(msg) {
  console.error(`archive-zowex-sdk: ${msg}`);
  process.exit(1);
}

/**
 * SHA-256 of the z/OS server binary bundled inside the SDK tarball. Recorded separately because
 * it is the artefact that actually runs on the mainframe, and it is what an operator would
 * compare against a deployed ~/.zowe-server/zowex.
 */
function serverPaxSha256(tgzPath) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'zowex-pax-'));
  try {
    execSync(`tar -xzf "${tgzPath}" -C "${tmpDir}" package/bin/server.pax.Z`, { stdio: 'ignore' });
    const pax = readFileIfExists(path.join(tmpDir, 'package', 'bin', 'server.pax.Z'));
    return pax === undefined ? null : sha256Buffer(pax);
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const pinRaw = readFileIfExists(pinPath);
if (pinRaw === undefined) fail(`no pin file at ${pinPath}`);
const pin = JSON.parse(pinRaw.toString('utf8'));

const staged = path.join(repoRoot, 'resources', pin.filename);
const stagedBytes = readFileIfExists(staged);
if (stagedBytes === undefined) {
  fail(
    `pinned SDK is not staged at ${staged}.\n` +
      '  Run `node scripts/sdk-switch.js pin` first (CI does this before installing).'
  );
}

// Re-verify rather than trust: this is the copy being published, and a release asset that does
// not match its own recorded sha256 would be worse than no asset at all. Hashing the bytes we
// already read (not re-reading the path) also means the check and the copy cannot disagree.
const actual = sha256Buffer(stagedBytes);
if (actual !== pin.sha256) {
  fail(
    `staged SDK checksum does not match the pin.\n  expected ${pin.sha256}\n  actual   ${actual}`
  );
}

// mkdir -p is idempotent, so no existence check (and no check-then-use race).
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, pin.filename), stagedBytes);

const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'packages', 'zowe-mcp-server', 'package.json'), 'utf8')
);

const provenance = {
  $comment:
    'The zowex SDK build this release was compiled and tested against. The tarball is archived ' +
    'next to this file because upstream nightly snapshots are pruned after roughly six weeks.',
  mcpServerVersion: serverPkg.version,
  gitCommit: gitCommit(),
  archivedAt: new Date().toISOString(),
  sdk: {
    package: pin.package,
    version: pin.version,
    train: pin.train,
    datestamp: pin.datestamp ?? null,
    filename: pin.filename,
    url: pin.url,
    sha256: pin.sha256,
    serverPaxSha256: serverPaxSha256(staged),
  },
  upstream: pin.upstream ?? null,
};

const provenancePath = path.join(distDir, 'zowex-provenance.json');
fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + '\n', 'utf8');

console.log(`Archived zowex SDK: ${path.join(distDir, pin.filename)}`);
console.log(`  sha256          ${pin.sha256}`);
console.log(`  server.pax.Z    ${provenance.sdk.serverPaxSha256 ?? '(not found in tarball)'}`);
console.log(`Wrote provenance:  ${provenancePath}`);
