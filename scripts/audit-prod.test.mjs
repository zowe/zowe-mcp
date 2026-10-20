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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAuditResult } from './audit-prod.mjs';

const TODAY = '2026-10-19';
const BRACES_ADVISORY = 'GHSA-vfj7-8cjw-p6xm';

function advisory(name, ghsa, severity = 'high') {
  return { name, severity, via: [{ name, url: `https://github.com/advisories/${ghsa}` }] };
}

function auditResult(vulnerabilities, status = Object.keys(vulnerabilities).length ? 1 : 0) {
  return {
    status,
    signal: null,
    stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities }),
  };
}

function bracesChain() {
  const vulnerabilities = { braces: advisory('braces', BRACES_ADVISORY) };
  let dependency = 'braces';
  for (const name of [
    'micromatch',
    'fast-glob',
    '@zowe/imperative',
    '@zowe/zos-uss-for-zowe-sdk',
    '@zowe/zowex-for-zowe-sdk',
  ]) {
    vulnerabilities[name] = { name, severity: 'high', via: [dependency] };
    dependency = name;
  }
  return vulnerabilities;
}

test('a clean completed audit passes', () => {
  assert.deepEqual(checkAuditResult(auditResult({}), TODAY), { allowed: [], blocked: [] });
});

test('the reviewed advisory covers its complete transitive dependency chain', () => {
  const { allowed, blocked } = checkAuditResult(auditResult(bracesChain()), TODAY);
  assert.equal(allowed.length, 6);
  assert.deepEqual(blocked, []);
});

test('the exception expires after its final UTC date', () => {
  const report = auditResult(bracesChain());
  assert.equal(checkAuditResult(report, '2026-12-10').blocked.length, 0);
  assert.equal(checkAuditResult(report, '2026-12-11').blocked.length, 6);
});

test('a new moderate advisory still fails beside the excepted chain', () => {
  const vulnerabilities = {
    ...bracesChain(),
    hono: advisory('hono', 'GHSA-1111-2222-3333', 'moderate'),
  };
  assert.deepEqual(checkAuditResult(auditResult(vulnerabilities), TODAY).blocked, [
    'hono (moderate)',
  ]);
});

test('a different advisory for braces also blocks every dependent finding', () => {
  const vulnerabilities = bracesChain();
  vulnerabilities.braces.via.push({
    name: 'braces',
    url: 'https://github.com/advisories/GHSA-new',
  });
  assert.equal(checkAuditResult(auditResult(vulnerabilities), TODAY).blocked.length, 6);
});

test('a dependent with both covered and uncovered advisories remains blocked', () => {
  const vulnerabilities = bracesChain();
  vulnerabilities['fast-glob'].via.push({
    name: 'fast-glob',
    url: 'https://github.com/advisories/GHSA-new',
  });
  const result = checkAuditResult(auditResult(vulnerabilities), TODAY);
  assert.equal(result.allowed.length, 2);
  assert.equal(result.blocked.length, 4);
});

test('the advisory URL cannot exempt a different package', () => {
  const vulnerabilities = { other: advisory('other', BRACES_ADVISORY) };
  assert.deepEqual(checkAuditResult(auditResult(vulnerabilities), TODAY).blocked, [
    'other (high)',
  ]);
});

test('low findings retain the existing moderate-or-higher threshold', () => {
  const vulnerabilities = { other: advisory('other', 'GHSA-new', 'low') };
  assert.deepEqual(checkAuditResult(auditResult(vulnerabilities, 0), TODAY), {
    allowed: [],
    blocked: [],
  });
});

test('missing transitive references cannot be treated as covered', () => {
  const vulnerabilities = { other: { name: 'other', severity: 'high', via: ['missing'] } };
  assert.deepEqual(checkAuditResult(auditResult(vulnerabilities), TODAY).blocked, [
    'other (high)',
  ]);
});

test('cyclic references fail closed instead of looping or accepting an empty advisory set', () => {
  const vulnerabilities = {
    a: { name: 'a', severity: 'high', via: ['b'] },
    b: { name: 'b', severity: 'high', via: ['a'] },
  };
  assert.equal(checkAuditResult(auditResult(vulnerabilities), TODAY).blocked.length, 2);
});

for (const [description, overrides] of [
  ['failed spawn', { status: null, error: new Error('npm not found') }],
  ['terminated process', { status: null, signal: 'SIGTERM' }],
  ['unexpected exit code', { status: 2 }],
  ['malformed JSON', { stdout: '{' }],
  ['missing report', { stdout: '{}' }],
  ['registry error', { status: 1, stdout: JSON.stringify({ error: { code: 'ENOTFOUND' } }) }],
  ['failure with empty findings', { status: 1 }],
]) {
  test(`${description} cannot pass as a clean audit`, () => {
    assert.throws(() => checkAuditResult({ ...auditResult({}), ...overrides }, TODAY));
  });
}

for (const [description, finding] of [
  ['missing finding', null],
  ['mismatched name', { name: 'different', severity: 'high', via: ['braces'] }],
  ['unknown severity', { name: 'bad', severity: 'unexpected', via: ['braces'] }],
  ['missing advisories', { name: 'bad', severity: 'high', via: [] }],
]) {
  test(`${description} cannot pass as a valid finding`, () => {
    assert.throws(() => checkAuditResult(auditResult({ bad: finding }), TODAY));
  });
}
