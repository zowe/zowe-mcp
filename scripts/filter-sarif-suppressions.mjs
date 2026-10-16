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
 * Drops suppressed results from an ESLint SARIF report before it is uploaded to code scanning.
 *
 * `@microsoft/eslint-formatter-sarif` writes rules that were silenced by an inline
 * `eslint-disable` comment into the report as ordinary `level: "error"` results, tagging them
 * with `suppressions: [{ kind: "inSource" }]`. GitHub does not honour that tag on upload, so
 * every deliberate, reviewed suppression became a permanently open high-severity alert in the
 * Security tab — 26 of them, none of which `npm run lint` (which gates CI at --max-warnings 0)
 * considers a problem. A standing backlog that size hides genuinely new findings.
 *
 * Removing them keeps the Security tab agreeing with the lint gate. The suppressions stay
 * visible where they are actually reviewed: the `eslint-disable` comment in the source.
 *
 * Only results are filtered. `runs[].tool.driver.rules` is left untouched so the `ruleIndex`
 * on every surviving result stays valid.
 *
 * Usage: node scripts/filter-sarif-suppressions.mjs [path-to-sarif]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'eslint-results.sarif';

const sarif = JSON.parse(readFileSync(file, 'utf-8'));

let removed = 0;
let kept = 0;

for (const run of sarif.runs ?? []) {
  if (!Array.isArray(run.results)) continue;
  const before = run.results.length;
  run.results = run.results.filter(
    r => !(Array.isArray(r.suppressions) && r.suppressions.length > 0)
  );
  removed += before - run.results.length;
  kept += run.results.length;
}

writeFileSync(file, JSON.stringify(sarif));

console.log(`Filtered ${file}: removed ${removed} suppressed result(s), kept ${kept}.`);
