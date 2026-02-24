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
import { runAssertions } from '../src/assertions.js';
import type { Assertion, AssertionBlock, AssertionItem, ToolCallRecord } from '../src/types.js';

function tc(name: string, args: Record<string, unknown> = {}): ToolCallRecord {
  return { name, arguments: args };
}

function block(items: AssertionItem[]): AssertionBlock {
  return { mode: 'all', items };
}

describe('runAssertions', () => {
  describe('toolCallOrder', () => {
    it('passes when tools are called in order with matching args', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [
            { tool: 'getTempDatasetPrefix' },
            { tool: 'createTempDataset', args: { type: 'PS' } },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('listSystems'),
        tc('getTempDatasetPrefix'),
        tc('createTempDataset', { type: 'PS', dsn: 'USER.TMP.ABC.DEF' }),
      ];
      expect(runAssertions(block(assertions), toolCalls, 'Done')).toEqual({ passed: true });
    });

    it('passes when step args are partial match', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'writeDataset', args: { content: 'Hello' } }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('writeDataset', { dsn: 'USER.TMP.X', content: 'Hello', member: 'M1' }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when a required tool is missing', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [
            { tool: 'getTempDatasetPrefix' },
            { tool: 'createTempDataset', args: { type: 'PS' } },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('getTempDatasetPrefix')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('createTempDataset');
    });

    it('fails when order is wrong', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [
            { tool: 'createTempDataset', args: { type: 'PS' } },
            { tool: 'writeDataset', args: { content: 'x' } },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('writeDataset', { dsn: 'X', content: 'x' }),
        tc('createTempDataset', { type: 'PS' }),
      ];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('writeDataset');
    });

    it('fails when step args do not match', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'createTempDataset', args: { type: 'PO-E' } }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('createTempDataset', { type: 'PS' })];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('args matching');
    });

    it('passes when step uses tools (any of) and second tool is called', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'listSystems' }, { tools: ['setSystem', 'getContext'] }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('listSystems'),
        tc('setSystem', { system: 'mainframe.example.com' }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('passes when step uses tools (any of) and first alternative is called', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'listSystems' }, { tools: ['setSystem', 'getContext'] }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listSystems'), tc('getContext')];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });
  });

  describe('toolCallOneOf', () => {
    it('passes when one of the tool specs matches', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOneOf',
          oneOf: [
            { tool: 'getContext' },
            { tool: 'runSafeTsoCommand', args: { commandText: 'WHO' } },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('getContext')];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('passes when the other spec matches', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOneOf',
          oneOf: [
            { tool: 'getContext' },
            { tool: 'runSafeTsoCommand', args: { commandText: 'WHO' } },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('runSafeTsoCommand', { commandText: 'WHO' })];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when none of the specs match', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOneOf',
          oneOf: [
            { tool: 'getContext' },
            { tool: 'runSafeTsoCommand', args: { commandText: 'WHO' } },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listSystems')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('one of');
    });
  });
});
