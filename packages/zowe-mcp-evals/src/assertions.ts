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

import type { Assertion, ToolCallRecord } from './types.js';

/** Check if actual value matches expected, or (when expected is an array) any of the allowed values. */
function valueMatches(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some(alt => valueMatches(alt, actual));
  }
  if (actual === undefined) return false;
  if (typeof expected === 'string' && typeof actual === 'string') {
    return actual.toUpperCase().includes(expected.toUpperCase()) || actual === expected;
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function argsMatch(
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown>
): boolean {
  if (!expected || Object.keys(expected).length === 0) return true;
  for (const [k, v] of Object.entries(expected)) {
    const a = actual[k];
    if (!valueMatches(v, a)) return false;
  }
  return true;
}

function findMatchingToolCall(
  toolCalls: ToolCallRecord[],
  tool: string,
  args?: Record<string, unknown>
): boolean {
  const normalized = tool.trim();
  return toolCalls.some(tc => tc.name === normalized && argsMatch(args, tc.arguments));
}

export function runAssertions(
  assertions: Assertion[],
  toolCalls: ToolCallRecord[],
  finalText: string
): { passed: boolean; failedAssertion?: string } {
  for (const a of assertions) {
    switch (a.type) {
      case 'toolCall': {
        const expected = a;
        const lastRelevant = [...toolCalls].reverse().find(tc => tc.name === expected.tool);
        if (!lastRelevant) {
          return {
            passed: false,
            failedAssertion: `Expected tool "${expected.tool}" to be called`,
          };
        }
        if (!argsMatch(expected.args, lastRelevant.arguments)) {
          return {
            passed: false,
            failedAssertion: `Expected tool "${expected.tool}" with args matching ${JSON.stringify(expected.args)}, got ${JSON.stringify(lastRelevant.arguments)}`,
          };
        }
        break;
      }
      case 'answerContains': {
        const expected = a;
        if (expected.pattern !== undefined) {
          try {
            const re = new RegExp(expected.pattern);
            if (!re.test(finalText)) {
              return {
                passed: false,
                failedAssertion: `Expected answer to match pattern /${expected.pattern}/`,
              };
            }
          } catch {
            return {
              passed: false,
              failedAssertion: `Invalid answerContains pattern: ${expected.pattern}`,
            };
          }
        } else if (expected.substring !== undefined) {
          if (!finalText.includes(expected.substring)) {
            return {
              passed: false,
              failedAssertion: `Expected answer to contain "${expected.substring}"`,
            };
          }
        } else {
          return {
            passed: false,
            failedAssertion: 'answerContains requires substring or pattern',
          };
        }
        break;
      }
      case 'singleToolCall': {
        const expected = a;
        if (toolCalls.length !== 1) {
          return {
            passed: false,
            failedAssertion: `Expected exactly one tool call, got ${toolCalls.length}`,
          };
        }
        const tc = toolCalls[0];
        if (tc.name !== expected.tool || !argsMatch(expected.args, tc.arguments)) {
          return {
            passed: false,
            failedAssertion: `Expected single tool call "${expected.tool}" with matching args, got ${tc.name} ${JSON.stringify(tc.arguments)}`,
          };
        }
        break;
      }
      case 'toolOnly': {
        const expected = a;
        if (!findMatchingToolCall(toolCalls, expected.tool, expected.args)) {
          return {
            passed: false,
            failedAssertion: `Expected a tool call "${expected.tool}" with matching args`,
          };
        }
        break;
      }
      case 'minToolCalls': {
        const expected = a;
        const count = toolCalls.filter(tc => tc.name === expected.tool.trim()).length;
        if (count < expected.minCount) {
          return {
            passed: false,
            failedAssertion: `Expected at least ${expected.minCount} call(s) to "${expected.tool}", got ${count}`,
          };
        }
        break;
      }
      case 'toolCallSequence': {
        const expected = a;
        const normalized = expected.tool.trim();
        const calls = toolCalls.filter(tc => tc.name === normalized);
        if (calls.length < expected.sequence.length) {
          return {
            passed: false,
            failedAssertion: `Expected at least ${expected.sequence.length} call(s) to "${expected.tool}", got ${calls.length}`,
          };
        }
        for (let i = 0; i < expected.sequence.length; i++) {
          const expectedArgs = expected.sequence[i];
          const actualArgs = calls[i].arguments;
          if (!argsMatch(expectedArgs, actualArgs)) {
            return {
              passed: false,
              failedAssertion: `Expected "${expected.tool}" call ${i + 1} to have args matching ${JSON.stringify(expectedArgs)}, got ${JSON.stringify(actualArgs)}`,
            };
          }
        }
        break;
      }
      default:
        return {
          passed: false,
          failedAssertion: `Unknown assertion type: ${String((a as { type: string }).type)}`,
        };
    }
  }
  return { passed: true };
}
