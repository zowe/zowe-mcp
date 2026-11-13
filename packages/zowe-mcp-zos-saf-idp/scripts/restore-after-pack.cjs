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
 * Restores the working tree after npm pack (see bundle-for-pack.cjs).
 * Runs as a postpack script.
 */

const path = require('path');
const { restoreAfterPack } = require('../../../scripts/bundle-production-deps.cjs');

const pkgDir = path.resolve(__dirname, '..');
restoreAfterPack({
  pkgDir,
  repoRoot: path.resolve(pkgDir, '..', '..'),
  // .local holds the bundled zos-attls workspace dep (see bundle-for-pack.cjs).
  scratchDirs: ['.local'],
});
