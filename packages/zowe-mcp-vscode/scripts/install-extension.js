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
const { execSync } = require('child_process');

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
const profile = process.env.VSCODE_PROFILE ? `--profile ${process.env.VSCODE_PROFILE}` : '';
const editorCommand = process.env.VSCODE_CLONE || 'code';

console.log(`Found VSIX: ${vsix.name}`);
console.log(`Editor: ${editorCommand}`);
if (profile) {
  console.log(`Profile: ${process.env.VSCODE_PROFILE}`);
}

// Uninstall existing extension (ignore errors if not installed)
try {
  console.log('Uninstalling existing extension...');
  execSync(`${editorCommand} --uninstall-extension ${vsix.path} ${profile}`, {
    stdio: 'inherit',
  });
} catch {
  console.log('Extension not currently installed (or uninstall failed, continuing)');
}

// Install the extension
console.log(`Installing ${vsix.name}...`);
execSync(`${editorCommand} --install-extension ${vsix.path} ${profile}`, {
  stdio: 'inherit',
});
console.log('Extension installed successfully!');
