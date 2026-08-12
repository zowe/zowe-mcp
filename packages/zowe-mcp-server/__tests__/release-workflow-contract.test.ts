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
 * Contract tests for .github/workflows/release.yml.
 *
 * The publish pipeline only runs after a release PR merges to main, so a broken invariant
 * surfaces at the worst possible time — during a real release, after the approval decision.
 * These assertions pin the parts that have actually bitten:
 *
 * The v0.10.0-rc.1 rehearsal failed because Octorelease was left to infer the version via
 * `git describe` on v* tags. No release tag is an ancestor of main (the pre-#30 promoted
 * history holds them all), so it fell back to 0.0.0, created a draft tagged v0.0.0, and the
 * publish step failed with "release not found" for v0.10.0-rc.1. The fix is passing
 * `new-version` explicitly from the same source the rest of the workflow uses.
 */

import { load as yamlLoad } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(__dirname, '..', '..', '..', '.github', 'workflows', 'release.yml');

interface WorkflowStep {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

function loadReleaseSteps(): WorkflowStep[] {
  const doc = yamlLoad(readFileSync(workflowPath, 'utf-8')) as {
    jobs: Record<string, { steps: WorkflowStep[] }>;
  };
  const job = doc.jobs.release;
  expect(job, 'release.yml must define a `release` job').toBeDefined();
  return job.steps;
}

function findStep(steps: WorkflowStep[], name: string): WorkflowStep {
  const step = steps.find(s => s.name === name);
  expect(step, `release job must have a step named "${name}"`).toBeDefined();
  return step!;
}

describe('release workflow contract', () => {
  const steps = loadReleaseSteps();

  it('passes the workflow-determined version to Octorelease explicitly', () => {
    const octorelease = findStep(steps, 'Run Octorelease');

    // Without this input Octorelease falls back to `git describe`, which yields 0.0.0 on
    // this repo because no release tag is an ancestor of main.
    expect(octorelease.with?.['new-version']).toBe('${{ steps.version.outputs.version }}');
  });

  it('gates Octorelease on publish mode so dry runs never tag', () => {
    const octorelease = findStep(steps, 'Run Octorelease');

    expect(octorelease.if).toBe("steps.version.outputs.mode == 'publish'");
  });

  it('edits the same tag Octorelease creates (v + the same version output)', () => {
    // The rehearsal failure was precisely these two disagreeing: Octorelease created
    // v0.0.0 while this step edited v0.10.0-rc.1. Both must derive from
    // steps.version.outputs.version.
    const publish = findStep(steps, 'Publish release with notes');

    expect(publish.run).toContain('gh release edit "v${{ steps.version.outputs.version }}"');
  });

  it('stages the pinned zowex SDK before npm ci', () => {
    // The SDK tarball is not committed (#64); npm ci fails ENOENT on a cold cache when the
    // file: target is missing, so the staging step must come first.
    const names = steps.map(s => s.name);
    const stageIdx = names.indexOf('Stage pinned zowex SDK');
    const installIdx = names.indexOf('Install dependencies (npm ci)');

    expect(stageIdx).toBeGreaterThanOrEqual(0);
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(stageIdx).toBeLessThan(installIdx);
  });
});
