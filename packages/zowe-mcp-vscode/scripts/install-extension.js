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
 * Installs the most recently built VSIX into VS Code (or a clone).
 *
 * Environment variables:
 *   VSCODE_CLONE    - Editor CLI command (default: "code")
 *                     Examples: "code", "code-insiders", "cursor", "codium"
 *   VSCODE_PROFILE  - VS Code profile name to install into (optional)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Find the most recently created VSIX file in the extension directory
const extDir = path.resolve(__dirname, '..');
const files = fs
  .readdirSync(extDir)
  .filter(f => f.endsWith('.vsix'))
  .map(f => ({
    name: f,
    path: path.join(extDir, f),
    time: fs.statSync(path.join(extDir, f)).mtime,
  }))
  .sort((a, b) => b.time - a.time);

if (files.length === 0) {
  console.error("No VSIX file found. Run 'npm run package' first.");
  process.exit(1);
}

const vsix = files[0];
const editorCommand = process.env.VSCODE_CLONE || 'code';

/** @returns {string[]} */
function profileArgs() {
  const name = process.env.VSCODE_PROFILE;
  return name ? ['--profile', name] : [];
}

console.log(`Found VSIX: ${vsix.name}`);
console.log(`Editor: ${editorCommand}`);
if (process.env.VSCODE_PROFILE) {
  console.log(`Profile: ${process.env.VSCODE_PROFILE}`);
}

// Uninstall existing extension (ignore errors if not installed)
try {
  console.log('Uninstalling existing extension...');
  const uninstallResult = spawnSync(
    editorCommand,
    ['--uninstall-extension', vsix.path, ...profileArgs()],
    { stdio: 'inherit', shell: false, env: process.env }
  );
  if (uninstallResult.error) {
    throw uninstallResult.error;
  }
  if (uninstallResult.status !== 0) {
    throw new Error(`uninstall exited with code ${uninstallResult.status}`);
  }
} catch {
  console.log('Extension not currently installed (or uninstall failed, continuing)');
}

// Install the extension
console.log(`Installing ${vsix.name}...`);
const installResult = spawnSync(
  editorCommand,
  ['--install-extension', vsix.path, ...profileArgs()],
  { stdio: 'inherit', shell: false, env: process.env }
);
if (installResult.error) {
  throw installResult.error;
}
if (installResult.status !== 0) {
  process.exit(installResult.status ?? 1);
}
console.log('Extension installed successfully!');
