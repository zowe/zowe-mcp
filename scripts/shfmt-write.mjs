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
 * Format shell scripts using @wasm-fmt/shfmt (WebAssembly build of mvdan/shfmt).
 *
 * Usage:
 *   node scripts/shfmt-write.mjs [--check] [file ...]
 * With no file arguments: all git-tracked *.sh and *.bash under the repo root.
 */

import { format } from '@wasm-fmt/shfmt';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = process.argv.slice(2).filter(a => a !== '--check');
const check = process.argv.includes('--check');

/** @type {import('@wasm-fmt/shfmt').FormatOptions} */
const fmtOptions = {
  indent: 2,
  binaryNextLine: true,
  spaceRedirects: true,
};

/**
 * @param {string} filePath Absolute or repo-relative path
 * @returns {boolean} true if content changed (check mode) or was written
 */
function formatOne(filePath) {
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(repoRoot, filePath);
  const src = readFileSync(abs, 'utf8');
  const out = format(src, abs, fmtOptions);
  if (check) {
    return src !== out;
  }
  if (src !== out) {
    writeFileSync(abs, out);
  }
  return src !== out;
}

function listTrackedShellFiles() {
  try {
    const stdout = execSync('git ls-files', {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    return stdout
      .trim()
      .split('\n')
      .filter(p => p.length > 0 && /\.(sh|bash)$/.test(p));
  } catch {
    return [];
  }
}

function main() {
  const paths = args.length > 0 ? args : listTrackedShellFiles();
  let failed = false;
  for (const p of paths) {
    if (formatOne(p)) {
      failed = true;
      if (check) {
        console.error(`shfmt: would reformat ${p}`);
      }
    }
  }
  process.exit(failed && check ? 1 : 0);
}

main();
