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

import { afterEach, describe, expect, it } from 'vitest';
import { DATA_TRUST_BOUNDARY_INSTRUCTIONS, isDataMarkingEnabled } from '../src/server.js';

describe('data-marking directive', () => {
  const prev = process.env.ZOWE_MCP_DATA_MARKING;

  afterEach(() => {
    if (prev === undefined) delete process.env.ZOWE_MCP_DATA_MARKING;
    else process.env.ZOWE_MCP_DATA_MARKING = prev;
  });

  it('is enabled by default (env unset)', () => {
    delete process.env.ZOWE_MCP_DATA_MARKING;
    expect(isDataMarkingEnabled()).toBe(true);
  });

  it('is disabled for 0/false/off/no (any case)', () => {
    for (const v of ['0', 'false', 'off', 'no', 'FALSE', 'Off']) {
      process.env.ZOWE_MCP_DATA_MARKING = v;
      expect(isDataMarkingEnabled()).toBe(false);
    }
  });

  it('stays enabled for other values', () => {
    for (const v of ['1', 'true', 'yes', '']) {
      process.env.ZOWE_MCP_DATA_MARKING = v;
      expect(isDataMarkingEnabled()).toBe(true);
    }
  });

  it('marks tool-result content as untrusted and forbids acting on embedded instructions', () => {
    const t = DATA_TRUST_BOUNDARY_INSTRUCTIONS.toLowerCase();
    expect(t).toContain('untrusted data');
    expect(t).toContain('ignore previous instructions');
    // Names the destructive actions an injection would request.
    expect(t).toMatch(/delete|overwrite|rename/);
    expect(t).toMatch(/mutating or destructive tool/);
  });
});
