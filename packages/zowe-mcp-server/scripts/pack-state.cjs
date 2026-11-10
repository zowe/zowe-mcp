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
 * Shared state for the prepack (`bundle-for-pack.cjs`) and postpack
 * (`restore-after-pack.cjs`) scripts.
 *
 * Prepack swaps the tsc `dist/` for the esbuild bundle and replaces
 * `node_modules` with a production-only tree. To keep packing free of side
 * effects on the working tree, it moves the originals aside to the backup
 * directories below; these helpers move them back. Postpack calls them after
 * a successful pack; prepack's own catch block calls them after a failure
 * (postpack does not run then).
 */

const fs = require('fs');
const path = require('path');

const serverPkgDir = path.resolve(__dirname, '..');

const distDir = path.join(serverPkgDir, 'dist');
const distBackupDir = path.join(serverPkgDir, '.dist-tsc-backup');
const nodeModulesDir = path.join(serverPkgDir, 'node_modules');
const nodeModulesBackupDir = path.join(serverPkgDir, '.node_modules-dev-backup');

/**
 * Restores the tsc build output as `dist/`. No-op when prepack never moved it
 * aside; in that case `dist/` is untouched and stays as it is.
 * @returns {boolean} true when a backup was restored
 */
function restoreDist() {
  if (!fs.existsSync(distBackupDir)) return false;
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.renameSync(distBackupDir, distDir);
  return true;
}

/**
 * Puts back the development `node_modules` prepack moved aside, replacing
 * whatever is there now. When there is no backup, removes `node_modules` only
 * if `prepackCreatedIt` — a failure before prepack touched it must leave the
 * developer's tree alone.
 * @param {{ prepackCreatedIt: boolean }} opts
 * @returns {boolean} true when a backup was restored
 */
function restoreNodeModules({ prepackCreatedIt }) {
  if (fs.existsSync(nodeModulesBackupDir)) {
    fs.rmSync(nodeModulesDir, { recursive: true, force: true });
    fs.renameSync(nodeModulesBackupDir, nodeModulesDir);
    return true;
  }
  if (prepackCreatedIt) fs.rmSync(nodeModulesDir, { recursive: true, force: true });
  return false;
}

module.exports = {
  distBackupDir,
  nodeModulesBackupDir,
  restoreDist,
  restoreNodeModules,
};
