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
 * Set the same version in all package.json files (root and workspace packages),
 * in the extension's dependency on @zowe/mcp-server, and in the MCP registry
 * manifest (packages/zowe-mcp-server/server.json).
 *
 * Usage: node scripts/set-version.js <version>
 * Example: node scripts/set-version.js 0.2.0
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/set-version.js <version>');
  console.error('Example: node scripts/set-version.js 0.2.0');
  process.exit(1);
}

const packagePaths = [
  path.join(repoRoot, 'package.json'),
  path.join(repoRoot, 'packages', 'zowe-mcp-common', 'package.json'),
  path.join(repoRoot, 'packages', 'zowe-mcp-server', 'package.json'),
  path.join(repoRoot, 'packages', 'zowe-mcp-vscode', 'package.json'),
  path.join(repoRoot, 'packages', 'zowe-mcp-evals', 'package.json'),
  path.join(repoRoot, 'packages', 'zowe-mcp-e2e', 'package.json'),
];

const vscodePath = path.join(repoRoot, 'packages', 'zowe-mcp-vscode', 'package.json');

for (const p of packagePaths) {
  if (!fs.existsSync(p)) continue;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (data.version !== undefined) {
    data.version = version;
    if (
      p === vscodePath &&
      data.dependencies &&
      data.dependencies['@zowe/mcp-server'] !== undefined
    ) {
      data.dependencies['@zowe/mcp-server'] = version;
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('Updated version to %s: %s', version, path.relative(repoRoot, p));
    if (
      p === vscodePath &&
      data.dependencies &&
      data.dependencies['@zowe/mcp-server'] === version
    ) {
      console.log(
        'Updated @zowe/mcp-server dependency to %s in packages/zowe-mcp-vscode/package.json',
        version
      );
    }
  }
}

// MCP registry manifest: top-level version and every packages[].version.
// Read directly (rather than existsSync + readFileSync) to avoid a
// check-then-use race between the existence check and the read.
const serverJsonPath = path.join(repoRoot, 'packages', 'zowe-mcp-server', 'server.json');
let serverJsonRaw;
try {
  serverJsonRaw = fs.readFileSync(serverJsonPath, 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
if (serverJsonRaw !== undefined) {
  const serverJson = JSON.parse(serverJsonRaw);
  let changed = false;
  if (serverJson.version !== undefined) {
    serverJson.version = version;
    changed = true;
  }
  if (Array.isArray(serverJson.packages)) {
    for (const pkg of serverJson.packages) {
      if (pkg.version !== undefined) {
        pkg.version = version;
        changed = true;
      }
    }
  }
  if (changed) {
    fs.writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n', 'utf8');
    console.log('Updated version to %s: %s', version, path.relative(repoRoot, serverJsonPath));
  }
}
