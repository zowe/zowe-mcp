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
 * Extract the release-notes section for one version from the VS Code
 * extension changelog, for use as a GitHub Release body.
 *
 * Usage: node scripts/extract-release-notes.js <version>
 * Example: node scripts/extract-release-notes.js 0.9.0
 *
 * Reads packages/zowe-mcp-vscode/CHANGELOG.md, finds the heading line
 * `` ## `<version>` `` and prints everything after it up to (excluding) the
 * next `## ` heading, trimmed, to stdout. Exits 1 with a message on stderr
 * if the section is missing or empty (a release PR that forgot the
 * changelog rollover must not release).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/extract-release-notes.js <version>');
  console.error('Example: node scripts/extract-release-notes.js 0.9.0');
  process.exit(1);
}

const changelogPath = path.join(repoRoot, 'packages', 'zowe-mcp-vscode', 'CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');
const lines = changelog.split('\n');

const heading = `## \`${version}\``;
const startIndex = lines.findIndex(line => line.trim() === heading);

if (startIndex === -1) {
  console.error(
    `Error: no "${heading}" section found in ${path.relative(repoRoot, changelogPath)}.`
  );
  console.error('Add the release notes for this version before releasing.');
  process.exit(1);
}

let endIndex = lines.length;
for (let i = startIndex + 1; i < lines.length; i++) {
  if (lines[i].startsWith('## ')) {
    endIndex = i;
    break;
  }
}

const body = lines
  .slice(startIndex + 1, endIndex)
  .join('\n')
  .trim();

if (!body) {
  console.error(
    `Error: the "${heading}" section in ${path.relative(repoRoot, changelogPath)} is empty.`
  );
  process.exit(1);
}

console.log(body);
