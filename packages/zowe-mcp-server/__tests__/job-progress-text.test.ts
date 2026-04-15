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

import { describe, expect, it } from 'vitest';
import {
  appendCompactRetcodeForProgress,
  formatJobStatusProgressLine,
} from '../src/tools/jobs/job-progress-text.js';
import { EN_DASH } from '../src/tools/progress.js';

describe('job-progress-text', () => {
  describe('appendCompactRetcodeForProgress', () => {
    it('returns base unchanged when retcode is undefined', () => {
      expect(
        appendCompactRetcodeForProgress(
          'Returned 1 job file for job JOB62313 (3 total)',
          undefined
        )
      ).toBe('Returned 1 job file for job JOB62313 (3 total)');
    });

    it('appends en dash and ZNP/JES retcode when set', () => {
      expect(
        appendCompactRetcodeForProgress(
          'Returned 1 job file for job JOB62313 (3 total)',
          'CC 0000'
        )
      ).toBe(`Returned 1 job file for job JOB62313 (3 total) ${EN_DASH} CC 0000`);
    });

    it('supports non-zero condition codes and abend text', () => {
      expect(appendCompactRetcodeForProgress('base', 'CC 0012')).toBe(`base ${EN_DASH} CC 0012`);
      expect(appendCompactRetcodeForProgress('base', 'ABEND 0C7')).toBe(
        `base ${EN_DASH} ABEND 0C7`
      );
    });
  });

  describe('formatJobStatusProgressLine', () => {
    it('omits retcode when undefined', () => {
      expect(
        formatJobStatusProgressLine({
          name: 'PLAPE03A',
          id: 'JOB62313',
          status: 'ACTIVE',
        })
      ).toBe('Job PLAPE03A (JOB62313): ACTIVE');
    });

    it('appends compact retcode when present', () => {
      expect(
        formatJobStatusProgressLine({
          name: 'PLAPE03A',
          id: 'JOB62313',
          status: 'OUTPUT',
          retcode: 'CC 0000',
        })
      ).toBe(`Job PLAPE03A (JOB62313): OUTPUT ${EN_DASH} CC 0000`);
    });
  });
});
