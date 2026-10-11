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
 * `npm audit` for production dependencies (moderate+) with a small, expiring
 * allowlist of advisories that have no fix available. Anything not listed, or
 * listed but past its expiry, still fails the check.
 */
import { spawnSync } from 'node:child_process';

const ALLOWLIST = [
  {
    ghsa: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    expires: '2026-12-10',
    reason:
      'No patched version exists. Reached only via @zowe/imperative > fast-glob > micromatch with ' +
      'hard-coded glob patterns (no untrusted input). Revisit when braces publishes a fix.',
  },
];

const res = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=moderate', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
});
const report = JSON.parse(res.stdout || '{}');
const vulns = Object.values(report.vulnerabilities ?? {});

const today = new Date().toISOString().slice(0, 10);
const allowed = new Map();
for (const a of ALLOWLIST) {
  if (a.expires >= today) allowed.set(a.ghsa, a);
  else console.error(`Allowlist entry ${a.ghsa} expired on ${a.expires}; it no longer applies.`);
}

// A vulnerability is covered when every advisory behind it (directly, or via the
// packages it depends on) is allowlisted.
const byName = new Map(vulns.map(v => [v.name, v]));
const advisoryIds = (v, seen = new Set()) => {
  if (seen.has(v.name)) return [];
  seen.add(v.name);
  return v.via.flatMap(x =>
    typeof x === 'string'
      ? byName.has(x)
        ? advisoryIds(byName.get(x), seen)
        : []
      : [x.url.split('/').pop()]
  );
};
const uncovered = vulns.filter(v => {
  const ids = advisoryIds(v);
  return ids.length === 0 || ids.some(id => !allowed.has(id));
});

for (const a of allowed.values())
  console.log(`allowed ${a.ghsa} (${a.package}) until ${a.expires}: ${a.reason}`);
if (uncovered.length > 0) {
  console.error(
    'Unallowed vulnerabilities: ' + uncovered.map(v => `${v.name} (${v.severity})`).join(', ')
  );
  process.exit(1);
}
console.log('npm audit: no unallowed vulnerabilities');
