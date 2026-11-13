/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 */

/**
 * Restores the original package.json after npm pack completes and cleans up
 * the temporary directories created by the prepack script.
 *
 * Runs as a postpack script (after npm pack).
 */

const path = require('path');
const { restoreAfterPack } = require('../../../scripts/bundle-production-deps.cjs');

const serverPkgDir = path.resolve(__dirname, '..');
restoreAfterPack({
  pkgDir: serverPkgDir,
  repoRoot: path.resolve(serverPkgDir, '..', '..'),
  scratchDirs: ['.local', '.unpack', '.extract-tmp', '.tgz', '.temp-extract'],
});
