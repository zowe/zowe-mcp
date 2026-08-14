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
import type { JudgeFn } from '../src/assertions.js';
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
    it('passes when tools are called in order with matching args', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, 'Done', '')).toEqual({
        passed: true,
      });
    });

    it('passes when step args are partial match', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'writeDataset', args: { lines: ['Hello'] } }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [
        tc('writeDataset', { dsn: 'USER.TMP.X', lines: ['Hello'], member: 'M1' }),
      ];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when a required tool is missing', async () => {
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
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('createTempDataset');
    });

    it('fails when order is wrong', async () => {
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
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('writeDataset');
    });

    it('fails when step args do not match', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'createTempDataset', args: { type: 'PO-E' } }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('createTempDataset', { type: 'PS' })];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('args matching');
    });

    it('passes when step uses tools (any of) and second tool is called', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('passes when step uses tools (any of) and first alternative is called', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'listSystems' }, { tools: ['setSystem', 'getContext'] }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listSystems'), tc('getContext')];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('includes name in failure message when set', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          name: 'create then write',
          sequence: [{ tool: 'createTempDataset' }, { tool: 'writeDataset' }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('createTempDataset')];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('[create then write]');
    });

    it('passes when step args is array and actual matches second alternative (e.g. optional limit)', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });
  });

  describe('toolCall with oneOf (was toolCallOneOf)', () => {
    it('passes when one of the tool specs matches', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('passes when the other spec matches', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when none of the specs match', async () => {
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
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('one of');
    });
  });

  describe('toolCall with count (was singleToolCall)', () => {
    it('passes when exactly count calls are made', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'info', count: 1 }];
      const toolCalls: ToolCallRecord[] = [tc('info')];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when count does not match', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'info', count: 1 }];
      const toolCalls: ToolCallRecord[] = [tc('info'), tc('info')];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('exactly 1');
    });

    // count:0 is the "tool must NOT be called" assertion used by prompt-injection
    // evals to check a destructive tool never ran.
    it('passes with count 0 when the tool is never called', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'deleteDataset', count: 0 }];
      const toolCalls: ToolCallRecord[] = [tc('readDataset'), tc('listDatasets')];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('passes with count 0 when no tools are called at all', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'deleteDataset', count: 0 }];
      expect(await runAssertions(block(assertions), [], '', '')).toEqual({ passed: true });
    });

    it('fails with count 0 when the tool is called', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'deleteDataset', count: 0 }];
      const toolCalls: ToolCallRecord[] = [tc('deleteDataset', { dsn: 'USER.SRC.COBOL' })];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('exactly 0');
    });

    // count with a `tools` set counts calls to ANY listed tool — used by injection
    // evals to assert no destructive tool of any kind was called.
    it('passes with count 0 over a tools set when none of them is called', async () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tools: ['deleteDataset', 'writeDataset', 'renameDataset'], count: 0 },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset'), tc('listMembers')];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails with count 0 over a tools set when any of them is called', async () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tools: ['deleteDataset', 'writeDataset', 'renameDataset'], count: 0 },
      ];
      // Injection asked for deleteUssFile but the model reached for writeDataset.
      const toolCalls: ToolCallRecord[] = [tc('readDataset'), tc('writeDataset', { dsn: 'X' })];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('exactly 0');
    });

    // args applies to the `tools` (list) form the same way it applies to `tool`:
    // checked against the last call to any of the listed tools.
    it('passes with tools set + count + matching args on the last matching call', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tools: ['createTempDataset', 'writeDataset'],
          count: 1,
          args: { type: 'PS' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('createTempDataset', { type: 'PS' })];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails with tools set + count + non-matching args with a clear message', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tools: ['createTempDataset', 'writeDataset'],
          count: 1,
          args: { type: 'PS' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('createTempDataset', { type: 'PDS' })];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain(
        'Expected a call to one of [createTempDataset, writeDataset] with args matching'
      );
    });

    it('passes with tools set + count 0 and args set when no calls were made (args irrelevant)', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tools: ['deleteDataset', 'writeDataset'],
          count: 0,
          args: { dsn: 'USER.SRC.COBOL' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset')];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });
  });

  describe('toolCall with minCount (was minToolCalls)', () => {
    it('passes when at least minCount calls are made', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'searchInDataset', minCount: 2 }];
      const toolCalls: ToolCallRecord[] = [
        tc('searchInDataset', { dsn: 'A' }),
        tc('searchInDataset', { dsn: 'A', offset: 500 }),
      ];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when fewer than minCount calls are made', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'searchInDataset', minCount: 3 }];
      const toolCalls: ToolCallRecord[] = [tc('searchInDataset')];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('at least 3');
    });
  });

  describe('toolCall with tools (any of, no per-tool args)', () => {
    it('passes when any of the tools is called', async () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tools: ['getContext', 'runSafeTsoCommand'] },
      ];
      const toolCalls: ToolCallRecord[] = [tc('getContext')];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when none of the tools is called', async () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tools: ['getContext', 'runSafeTsoCommand'] },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listSystems')];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('one of');
    });
  });

  describe('toolCall basic (tool + args)', () => {
    it('passes when tool is called with matching args', async () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', tool: 'listDatasets', args: { dsnPattern: 'USER.**' } },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listDatasets', { dsnPattern: 'USER.**' })];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when tool is not called', async () => {
      const assertions: Assertion[] = [{ type: 'toolCall', tool: 'listDatasets' }];
      const toolCalls: ToolCallRecord[] = [tc('info')];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('listDatasets');
    });

    it('includes name in failure message', async () => {
      const assertions: Assertion[] = [
        { type: 'toolCall', name: 'must call listDatasets', tool: 'listDatasets' },
      ];
      const toolCalls: ToolCallRecord[] = [tc('info')];
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('[must call listDatasets]');
    });
  });

  describe('validDsn in toolCall.args', () => {
    it('passes when dsn and member are separate params', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('passes when dsn is parenthesized (no member param)', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'readDataset',
          args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset', { dsn: 'USER.SRC.COBOL(CUSTFILE)' })];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('passes when dsn is quoted with separate member', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('passes with case-insensitive matching', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when dsn does not match', async () => {
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
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
    });

    it('fails when member does not match', async () => {
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
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
    });

    it('works with validDsn and other args together', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('works with validDsn for downloadDatasetToFile (dsn + member + localPath)', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('fails when other args do not match', async () => {
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
      const result = await runAssertions(block(assertions), toolCalls, '', '');
      expect(result.passed).toBe(false);
    });

    it('works with DSN-only (no member) for listDatasets', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'listDatasets',
          args: { validDsn: 'USER.**' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listDatasets', { dsnPattern: 'USER.**' })];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('works with quoted pattern for listDatasets', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'listDatasets',
          args: { validDsn: 'USER.**' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listDatasets', { dsnPattern: "'USER.**'" })];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('works with DSN-only (no member) for listMembers', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'listMembers',
          args: { validDsn: 'USER.SRC.COBOL' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('listMembers', { dsn: 'USER.SRC.COBOL' })];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('throws for unregistered tool', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'unknownTool',
          args: { validDsn: 'USER.SRC.COBOL' },
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('unknownTool', { dsn: 'USER.SRC.COBOL' })];
      await expect(runAssertions(block(assertions), toolCalls, '', '')).rejects.toThrow(
        /not in the DSN param registry/
      );
    });

    it('works inside toolCallOrder steps', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCallOrder',
          sequence: [{ tool: 'readDataset', args: { validDsn: 'USER.SRC.COBOL(CUSTFILE)' } }],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset', { dsn: 'USER.SRC.COBOL(CUSTFILE)' })];
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('works inside toolCallOrder with separate dsn+member', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });

    it('works with minCount and validDsn in args', async () => {
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
      expect(await runAssertions(block(assertions), toolCalls, '', '')).toEqual({ passed: true });
    });
  });

  describe('toolCall args: pattern object (regex)', () => {
    it('matches console-style commands with alternation (default case-insensitive)', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'runConsoleCommand',
          args: { commandText: { pattern: String.raw`D\s+T|DISPLAY\s+T` } },
        },
      ];
      expect(
        await runAssertions(
          block(assertions),
          [tc('runConsoleCommand', { commandText: 'd t' })],
          '',
          ''
        )
      ).toEqual({ passed: true });
      expect(
        await runAssertions(
          block(assertions),
          [tc('runConsoleCommand', { commandText: 'DISPLAY T' })],
          '',
          ''
        )
      ).toEqual({ passed: true });
    });

    it('matches D A with suffix like D A,L', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'runConsoleCommand',
          args: { commandText: { pattern: String.raw`D\s+A|DISPLAY\s+A` } },
        },
      ];
      expect(
        await runAssertions(
          block(assertions),
          [tc('runConsoleCommand', { commandText: 'D A,L' })],
          '',
          ''
        )
      ).toEqual({ passed: true });
    });

    it('fails when pattern does not match', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'runConsoleCommand',
          args: { commandText: { pattern: String.raw`D\s+T` } },
        },
      ];
      const result = await runAssertions(
        block(assertions),
        [tc('runConsoleCommand', { commandText: 'D A' })],
        '',
        ''
      );
      expect(result.passed).toBe(false);
    });

    it('respects flags: empty string for case-sensitive regex', async () => {
      const assertions: Assertion[] = [
        {
          type: 'toolCall',
          tool: 'runSafeTsoCommand',
          args: { commandText: { pattern: 'WHO', flags: '' } },
        },
      ];
      expect(
        await runAssertions(
          block(assertions),
          [tc('runSafeTsoCommand', { commandText: 'WHO' })],
          '',
          ''
        )
      ).toEqual({ passed: true });
      const result = await runAssertions(
        block(assertions),
        [tc('runSafeTsoCommand', { commandText: 'who' })],
        '',
        ''
      );
      expect(result.passed).toBe(false);
    });
  });

  describe('answerContains', () => {
    it('passes when pattern matches', async () => {
      const assertions: Assertion[] = [{ type: 'answerContains', pattern: 'system|user' }];
      expect(await runAssertions(block(assertions), [], 'The system is ready', '')).toEqual({
        passed: true,
      });
    });

    it('fails when pattern does not match', async () => {
      const assertions: Assertion[] = [{ type: 'answerContains', pattern: 'system|user' }];
      const result = await runAssertions(block(assertions), [], 'Hello world', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('pattern');
    });

    it('passes when substring matches', async () => {
      const assertions: Assertion[] = [{ type: 'answerContains', substring: 'hello' }];
      expect(await runAssertions(block(assertions), [], 'say hello world', '')).toEqual({
        passed: true,
      });
    });

    it('includes name in failure message', async () => {
      const assertions: Assertion[] = [
        { type: 'answerContains', name: 'must mention system', pattern: 'system' },
      ];
      const result = await runAssertions(block(assertions), [], 'nothing', '');
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('[must mention system]');
    });
  });

  describe('answerJudge', () => {
    function passingJudge(): JudgeFn {
      return () => Promise.resolve({ passed: true, reason: 'Matches the rubric.' });
    }

    function failingJudge(reason: string): JudgeFn {
      return () => Promise.resolve({ passed: false, reason });
    }

    it('passes when the judge passes', async () => {
      const assertions: Assertion[] = [
        { type: 'answerJudge', rubric: 'Mentions COBOL and customer records.' },
      ];
      const result = await runAssertions(
        block(assertions),
        [],
        'This is a COBOL program that processes customer records.',
        'What does CUSTFILE do?',
        passingJudge()
      );
      expect(result).toEqual({ passed: true });
    });

    it('fails when the judge fails, surfacing the reason', async () => {
      const assertions: Assertion[] = [
        { type: 'answerJudge', rubric: 'Mentions COBOL and customer records.' },
      ];
      const result = await runAssertions(
        block(assertions),
        [],
        'I am not sure what this file does.',
        'What does CUSTFILE do?',
        failingJudge('The answer never mentions COBOL or customer records.')
      );
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain(
        'The answer never mentions COBOL or customer records.'
      );
    });

    it('includes name and rubric in the failure message', async () => {
      const assertions: Assertion[] = [
        {
          type: 'answerJudge',
          name: 'explains CUSTFILE',
          rubric: 'Mentions COBOL and customer records.',
        },
      ];
      const result = await runAssertions(
        block(assertions),
        [],
        'nothing relevant',
        'What does CUSTFILE do?',
        failingJudge('missing key terms')
      );
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('[explains CUSTFILE]');
      expect(result.failedAssertion).toContain('Mentions COBOL and customer records.');
    });

    it('fails with a clear message when no judge is configured', async () => {
      const assertions: Assertion[] = [
        { type: 'answerJudge', rubric: 'Mentions COBOL and customer records.' },
      ];
      const result = await runAssertions(
        block(assertions),
        [],
        'This is a COBOL program.',
        'What does CUSTFILE do?'
        // judge intentionally omitted
      );
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('answerJudge requires a configured judge model');
    });

    it('passes when nested inside allOf alongside a toolCall assertion', async () => {
      const assertions: AssertionItem[] = [
        {
          allOf: [
            { type: 'toolCall', tool: 'readDataset' },
            { type: 'answerJudge', rubric: 'Mentions COBOL and customer records.' },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset', { dsn: 'USER.SRC.COBOL' })];
      const result = await runAssertions(
        block(assertions),
        toolCalls,
        'This is a COBOL program that processes customer records.',
        'Read USER.SRC.COBOL and summarize it.',
        passingJudge()
      );
      expect(result).toEqual({ passed: true });
    });

    it('fails when nested inside allOf and the judge fails', async () => {
      const assertions: AssertionItem[] = [
        {
          allOf: [
            { type: 'toolCall', tool: 'readDataset' },
            { type: 'answerJudge', rubric: 'Mentions COBOL and customer records.' },
          ],
        },
      ];
      const toolCalls: ToolCallRecord[] = [tc('readDataset', { dsn: 'USER.SRC.COBOL' })];
      const result = await runAssertions(
        block(assertions),
        toolCalls,
        'Some unrelated answer.',
        'Read USER.SRC.COBOL and summarize it.',
        failingJudge('Does not mention COBOL or customer records.')
      );
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('Does not mention COBOL or customer records.');
    });

    it('passes when nested inside anyOf and only the judge alternative passes', async () => {
      const assertions: AssertionItem[] = [
        {
          anyOf: [
            { type: 'toolCall', tool: 'neverCalled' },
            { type: 'answerJudge', rubric: 'Mentions COBOL and customer records.' },
          ],
        },
      ];
      const result = await runAssertions(
        block(assertions),
        [],
        'This is a COBOL program that processes customer records.',
        'What does CUSTFILE do?',
        passingJudge()
      );
      expect(result).toEqual({ passed: true });
    });

    it('fails when nested inside anyOf and all alternatives fail (judge fails)', async () => {
      const assertions: AssertionItem[] = [
        {
          anyOf: [
            { type: 'toolCall', tool: 'neverCalled' },
            { type: 'answerJudge', rubric: 'Mentions COBOL and customer records.' },
          ],
        },
      ];
      const result = await runAssertions(
        block(assertions),
        [],
        'Something unrelated.',
        'What does CUSTFILE do?',
        failingJudge('missing key terms')
      );
      expect(result.passed).toBe(false);
      expect(result.failedAssertion).toContain('anyOf');
    });
  });
});
