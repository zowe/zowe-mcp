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
          sequence: [{ tool: 'writeDataset', args: { lines: ['Hello'] } }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('writeDataset', { dsn: 'USER.TMP.X', lines: ['Hello'], member: 'M1' }),
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
            { tool: 'writeDataset', args: { lines: ['x'] } },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('writeDataset', { dsn: 'X', lines: ['x'] }),
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

    it('includes name in failure message when set', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          name: 'create then write',
          sequence: [{ tool: 'createTempDataset' }, { tool: 'writeDataset' }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('createTempDataset')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('[create then write]');
    });

    it('passes when step args is array and actual matches second alternative (e.g. optional limit)', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [
            { tool: 'listMembers', args: { dsn: 'USER.INVNTORY' } },
            {
              tool: 'listMembers',
              args: [
                { dsn: 'USER.INVNTORY', offset: 500, limit: 500 },
                { dsn: 'USER.INVNTORY', offset: 500 },
              ],
            },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('listMembers', { dsn: 'USER.INVNTORY' }),
        tc('listMembers', { dsn: 'USER.INVNTORY', offset: 500 }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });
  });

  describe('toolCall with oneOf (was toolCallOneOf)', () => {
    it('passes when one of the tool specs matches', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
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
          type: 'toolCall',
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
          type: 'toolCall',
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

  describe('toolCall with count (was singleToolCall)', () => {
    it('passes when exactly count calls are made', () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'info', count: 1 }];
      const toolCalls: ToolCallRecord[] = [tc('info')];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when count does not match', () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'info', count: 1 }];
      const toolCalls: ToolCallRecord[] = [tc('info'), tc('info')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('exactly 1');
    });
  });

  describe('toolCall with minCount (was minToolCalls)', () => {
    it('passes when at least minCount calls are made', () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'searchInDataset', minCount: 2 }];
      const toolCalls: ToolCallRecord[] = [
        tc('searchInDataset', { dsn: 'A' }),
        tc('searchInDataset', { dsn: 'A', offset: 500 }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when fewer than minCount calls are made', () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'searchInDataset', minCount: 3 }];
      const toolCalls: ToolCallRecord[] = [tc('searchInDataset')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('at least 3');
    });
  });

  describe('toolCall with tools (any of, no per-tool args)', () => {
    it('passes when any of the tools is called', () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tools: ['getContext', 'runSafeTsoCommand'] },
      ];
      const toolCalls: ToolCallRecord[] = [tc('getContext')];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when none of the tools is called', () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tools: ['getContext', 'runSafeTsoCommand'] },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listSystems')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('one of');
    });
  });

  describe('toolCall basic (tool + args)', () => {
    it('passes when tool is called with matching args', () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tool: 'listDatasets', args: { dsnPattern: 'USER.**' } },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listDatasets', { dsnPattern: 'USER.**' })];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when tool is not called', () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'listDatasets' }];
      const toolCalls: ToolCallRecord[] = [tc('info')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('listDatasets');
    });

    it('includes name in failure message', () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', name: 'must call listDatasets', tool: 'listDatasets' },
      ];
      const toolCalls: ToolCallRecord[] = [tc('info')];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('[must call listDatasets]');
    });
  });

  describe('validDsn in toolCall.args', () => {
    it('passes when dsn and member are separate params', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'readDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('readDataset', { dsn: 'USER.SRC.COBOL', member: 'CUSTFILE' }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('passes when dsn is parenthesized (no member param)', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'readDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset', { dsn: 'USER.SRC.COBOL(CUSTFILE)' })];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('passes when dsn is quoted with separate member', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'readDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('readDataset', { dsn: "'USER.SRC.COBOL'", member: 'CUSTFILE' }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('passes with case-insensitive matching', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'readDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('readDataset', { dsn: 'user.src.cobol', member: 'custfile' }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when dsn does not match', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'readDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('readDataset', { dsn: 'USER.OTHER.LIB', member: 'CUSTFILE' }),
      ];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
    });

    it('fails when member does not match', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'readDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('readDataset', { dsn: 'USER.SRC.COBOL', member: 'OTHER' }),
      ];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
    });

    it('works with validDsn and other args together', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'searchInDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)', string: 'PROCEDURE' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('searchInDataset', {
          dsn: 'USER.SRC.COBOL(CUSTFILE)',
          string: 'PROCEDURE',
        }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('works with validDsn for downloadDatasetToFile (dsn + member + localPath)', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'downloadDatasetToFile',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)', localPath: 'out/x.cbl' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('downloadDatasetToFile', {
          dsn: 'USER.SRC.COBOL',
          member: 'CUSTFILE',
          localPath: 'out/x.cbl',
        }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('fails when other args do not match', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'searchInDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)', string: 'PROCEDURE' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('searchInDataset', {
          dsn: 'USER.SRC.COBOL',
          member: 'CUSTFILE',
          string: 'DIVISION',
        }),
      ];
      const result = runAssertions(block(assertions), toolCalls, '');
      expect(result.passed).toBe(false);
    });

    it('works with DSN-only (no member) for listDatasets', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'listDatasets',
          args: { validDsn: 'USER.**' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listDatasets', { dsnPattern: 'USER.**' })];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('works with quoted pattern for listDatasets', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'listDatasets',
          args: { validDsn: 'USER.**' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listDatasets', { dsnPattern: "'USER.**'" })];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('works with DSN-only (no member) for listMembers', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'listMembers',
          args: { validDsn: 'USER.SRC.COBOL' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listMembers', { dsn: 'USER.SRC.COBOL' })];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('throws for unregistered tool', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'unknownTool',
          args: { validDsn: 'USER.SRC.COBOL' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('unknownTool', { dsn: 'USER.SRC.COBOL' })];
      expect(() => runAssertions(block(assertions), toolCalls, '')).toThrow(
        /not in the DSN param registry/
      );
    });

    it('works inside toolCallOrder steps', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'readDataset', args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' } }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset', { dsn: 'USER.SRC.COBOL(CUSTFILE)' })];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('works inside toolCallOrder with separate dsn+member', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [
            {
              tool: 'searchInDataset',
              args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)', string: 'PERFORM' },
            },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('searchInDataset', { dsn: "'USER.SRC.COBOL'", member: 'CUSTFILE', string: 'PERFORM' }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });

    it('works with minCount and validDsn in args', () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'searchInDataset',
          minCount: 2,
        },
        {
          type: 'toolCall',
          tool: 'searchInDataset',
          args: { validDsn: 'USER.INVNTORY', string: 'name' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('searchInDataset', { dsn: 'USER.INVNTORY', string: 'name' }),
        tc('searchInDataset', { dsn: "'USER.INVNTORY'", string: 'name', offset: 500 }),
      ];
      expect(runAssertions(block(assertions), toolCalls, '')).toEqual({ passed: true });
    });
  });

  describe('answerContains', () => {
    it('passes when pattern matches', () => {
      const assertions: Assertion[] = [{ type: 'answerContains', pattern: 'system|user' }];
      expect(runAssertions(block(assertions), [], 'The system is ready')).toEqual({
        passed: true,
      });
    });

    it('fails when pattern does not match', () => {
      const assertions: Assertion[] = [{ type: 'answerContains', pattern: 'system|user' }];
      const result = runAssertions(block(assertions), [], 'Hello world');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('pattern');
    });

    it('passes when substring matches', () => {
      const assertions: Assertion[] = [{ type: 'answerContains', substring: 'hello' }];
      expect(runAssertions(block(assertions), [], 'say hello world')).toEqual({
        passed: true,
      });
    });

    it('includes name in failure message', () => {
      const assertions: Assertion[] = [
        { type: 'answerContains', name: 'must mention system', pattern: 'system' },
      ];
      const result = runAssertions(block(assertions), [], 'nothing');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('[must mention system]');
    });
  });
});
