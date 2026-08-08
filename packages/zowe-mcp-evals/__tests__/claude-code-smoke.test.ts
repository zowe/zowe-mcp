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
import { parseClaudeStreamJson } from '../src/claude-code-smoke.js';

describe('parseClaudeStreamJson', () => {
  it('extracts an mcp__zowe__ tool_use item with the prefix stripped', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'mcp__zowe__listDatasets',
            input: { pattern: 'USER.**' },
          },
        ],
      },
    });
    const { toolCalls } = parseClaudeStreamJson(line);
    expect(toolCalls).toEqual([{ name: 'listDatasets', arguments: { pattern: 'USER.**' } }]);
  });

  it('ignores tool_use items that are not mcp__zowe__ tools', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/x' } },
          { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });
    const { toolCalls } = parseClaudeStreamJson(line);
    expect(toolCalls).toEqual([]);
  });

  it('sets finalText, costUsd, and isError from a successful result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0159,
      result: 'Here are your data sets: USER.SRC.COBOL, USER.JCL',
    });
    const parsed = parseClaudeStreamJson(line);
    expect(parsed.finalText).toBe('Here are your data sets: USER.SRC.COBOL, USER.JCL');
    expect(parsed.costUsd).toBe(0.0159);
    expect(parsed.isError).toBe(false);
    expect(parsed.resultSubtype).toBe('success');
  });

  it('handles an error-subtype result (e.g. error_max_turns) with no result field', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      total_cost_usd: 0.05,
    });
    const parsed = parseClaudeStreamJson(line);
    expect(parsed.isError).toBe(true);
    expect(parsed.resultSubtype).toBe('error_max_turns');
    expect(parsed.finalText).toBe('');
  });

  it('silently ignores garbage/unparseable lines without throwing', () => {
    const goodAssistant = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'mcp__zowe__listDatasets', input: { pattern: 'A.*' } },
        ],
      },
    });
    const goodResult = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.01,
      result: 'done',
    });
    const stdout = ['', '{', goodAssistant, '   ', 'not json at all', goodResult, ''].join('\n');
    expect(() => parseClaudeStreamJson(stdout)).not.toThrow();
    const parsed = parseClaudeStreamJson(stdout);
    expect(parsed.toolCalls).toEqual([{ name: 'listDatasets', arguments: { pattern: 'A.*' } }]);
    expect(parsed.finalText).toBe('done');
    expect(parsed.isError).toBe(false);
  });

  it('treats stdout with no result event at all as an error', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'mcp__zowe__listDatasets', input: {} }],
      },
    });
    const parsed = parseClaudeStreamJson(line);
    expect(parsed.isError).toBe(true);
    expect(parsed.finalText).toBe('');
    expect(parsed.resultSubtype).toBeUndefined();
    expect(parsed.costUsd).toBeUndefined();
  });
});
