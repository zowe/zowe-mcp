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
import { buildParmsFromOptions } from '../src/zos/search-options.js';

describe('buildParmsFromOptions', () => {
  it('should add ANYC when caseSensitive is false (default)', () => {
    expect(buildParmsFromOptions({})).toContain('ANYC');
    expect(buildParmsFromOptions({ caseSensitive: false })).toContain('ANYC');
  });

  it('should not add ANYC when caseSensitive is true', () => {
    const parms = buildParmsFromOptions({ caseSensitive: true });
    expect(parms).not.toContain('ANYC');
    expect(parms).toContain('SEQ');
  });

  it('should add COBOL when cobol is true', () => {
    expect(buildParmsFromOptions({ cobol: true })).toContain('COBOL');
    expect(buildParmsFromOptions({ cobol: false })).not.toContain('COBOL');
  });

  it('should add SEQ by default and NOSEQ when ignoreSequenceNumbers is false', () => {
    expect(buildParmsFromOptions({})).toContain('SEQ');
    expect(buildParmsFromOptions({ ignoreSequenceNumbers: true })).toContain('SEQ');
    expect(buildParmsFromOptions({ ignoreSequenceNumbers: false })).toContain('NOSEQ');
  });

  it('should add DPCBCMT when doNotProcessComments includes cobolComment', () => {
    expect(buildParmsFromOptions({ doNotProcessComments: ['cobolComment'] })).toContain('DPCBCMT');
  });

  it('should add multiple comment options in fixed order', () => {
    const parms = buildParmsFromOptions({
      doNotProcessComments: ['cobolComment', 'asterisk'],
    });
    expect(parms).toContain('DPCBCMT');
    expect(parms).toContain('DPACMT');
    const idxCobol = parms.indexOf('DPCBCMT');
    const idxAsterisk = parms.indexOf('DPACMT');
    expect(idxAsterisk).toBeLessThan(idxCobol); // asterisk before cobolComment in SEARCH_COMMENT_TYPES order
  });

  it('should produce stable combined options', () => {
    const parms = buildParmsFromOptions({
      caseSensitive: false,
      cobol: true,
      doNotProcessComments: ['cobolComment'],
    });
    expect(parms).toContain('ANYC');
    expect(parms).toContain('COBOL');
    expect(parms).toContain('SEQ');
    expect(parms).toContain('DPCBCMT');
  });
});
