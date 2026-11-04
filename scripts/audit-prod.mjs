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

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Each exception needs code-owner review. Match the advisory and affected package,
// including transitive findings only when all of their advisories are covered.
export const AUDIT_EXCEPTIONS = [
  {
    ghsa: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    expires: '2026-12-10',
    reason:
      'No patched braces version is available. The production dependency chain is ' +
      '@zowe/imperative > fast-glob > micromatch > braces, used for configuration and ' +
      'plug-in discovery. Revisit when an upstream fix is available.',
  },
];

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

/** Evaluate both npm's process result and its v2 audit report; errors must fail closed. */
export function checkAuditResult(result, today = new Date().toISOString().slice(0, 10)) {
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(
      `npm audit did not complete: ${result.error?.message ?? result.signal ?? String(result.status)}`
    );
  }

  const report = JSON.parse(result.stdout);
  if (
    report?.error ||
    report?.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities)
  ) {
    throw new Error('npm audit returned an error or an unsupported report');
  }

  const vulnerabilities = new Map(Object.entries(report.vulnerabilities));
  for (const [name, finding] of vulnerabilities) {
    if (
      finding?.name !== name ||
      !SEVERITIES.includes(finding.severity) ||
      !Array.isArray(finding.via) ||
      finding.via.length === 0
    ) {
      throw new Error(`npm audit returned an invalid finding for ${name}`);
    }
  }
  if (result.status === 1 && vulnerabilities.size === 0) {
    throw new Error('npm audit failed without reporting any vulnerabilities');
  }

  const exceptions = AUDIT_EXCEPTIONS.filter(entry => today <= entry.expires);
  function coveredByException(name, ancestors = new Set()) {
    const finding = vulnerabilities.get(name);
    if (!finding || ancestors.has(name)) return false;
    const nextAncestors = new Set([...ancestors, name]);
    return finding.via.every(via => {
      if (typeof via === 'string') return coveredByException(via, nextAncestors);
      return exceptions.some(
        entry =>
          name === entry.package &&
          via?.name === entry.package &&
          via?.url === `https://github.com/advisories/${entry.ghsa}`
      );
    });
  }

  const allowed = [];
  const blocked = [];
  for (const [name, finding] of vulnerabilities) {
    if (SEVERITIES.indexOf(finding.severity) < SEVERITIES.indexOf('moderate')) continue;
    (coveredByException(name) ? allowed : blocked).push(`${name} (${finding.severity})`);
  }
  return { allowed, blocked };
}

function main() {
  try {
    const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=moderate', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    const { allowed, blocked } = checkAuditResult(result);
    if (allowed.length > 0) {
      for (const entry of AUDIT_EXCEPTIONS) {
        console.log(`Temporary exception ${entry.ghsa} until ${entry.expires}: ${entry.reason}`);
      }
      console.log(`Covered dependency findings: ${allowed.join(', ')}`);
    }
    if (blocked.length > 0) {
      console.error(`Production audit failed: ${blocked.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('Production audit passed: no unexcepted moderate-or-higher vulnerabilities');
  } catch (error) {
    console.error(
      `Production audit failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
