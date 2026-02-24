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

import { plural } from './plural.js';
import type { Assertion, AssertionBlock, AssertionItem, ToolCallRecord } from './types.js';

/**
 * Check if actual value matches expected. Supports:
 * - Array: actual must match any element (anyOf semantics).
 * - Object with anyOf key (array): actual must match any element.
 * - Otherwise: direct match (string uses case-insensitive includes or exact).
 */
function valueMatches(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some(alt => valueMatches(alt, actual));
  }
  if (
    expected &&
    typeof expected === 'object' &&
    Array.isArray((expected as Record<string, unknown>).anyOf)
  ) {
    const arr = (expected as { anyOf: unknown[] }).anyOf;
    return arr.some(alt => valueMatches(alt, actual));
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

/**
 * Run a single assertion item (leaf or composite). Composites recurse.
 */
function runAssertionItem(
  item: AssertionItem,
  toolCalls: ToolCallRecord[],
  finalText: string
): { passed: boolean; failedAssertion?: string } {
  if ('allOf' in item && Array.isArray(item.allOf)) {
    for (const sub of item.allOf) {
      const result = runAssertionItem(sub, toolCalls, finalText);
      if (!result.passed) return result;
    }
    return { passed: true };
  }
  if ('anyOf' in item && Array.isArray(item.anyOf)) {
    for (const sub of item.anyOf) {
      const result = runAssertionItem(sub, toolCalls, finalText);
      if (result.passed) return { passed: true };
    }
    return {
      passed: false,
      failedAssertion: 'anyOf: none of the alternatives passed',
    };
  }
  return runLeafAssertion(item as Assertion, toolCalls, finalText);
}

/**
 * Run leaf assertions only (no allOf/anyOf).
 */
function runLeafAssertion(
  a: Assertion,
  toolCalls: ToolCallRecord[],
  finalText: string
): { passed: boolean; failedAssertion?: string } {
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
          failedAssertion: `Expected at least ${expected.minCount} ${plural(expected.minCount, 'call', 'calls')} to "${expected.tool}", got ${count} ${plural(count, 'call', 'calls')}`,
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
          failedAssertion: `Expected at least ${expected.sequence.length} ${plural(expected.sequence.length, 'call', 'calls')} to "${expected.tool}", got ${calls.length} ${plural(calls.length, 'call', 'calls')}`,
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
    case 'toolCallOrder': {
      const expected = a;
      let lastIndex = -1;
      for (let i = 0; i < expected.sequence.length; i++) {
        const step = expected.sequence[i];
        const stepMatches = (tc: ToolCallRecord) => {
          const name = tc.name.trim();
          const toolMatch =
            step.tool !== undefined
              ? name === step.tool.trim()
              : (step.tools?.some((t: string) => t.trim() === name) ?? false);
          return toolMatch && argsMatch(step.args, tc.arguments);
        };
        const idx = toolCalls.findIndex((tc, pos) => pos > lastIndex && stepMatches(tc));
        if (idx === -1) {
          const label =
            step.tool !== undefined
              ? `"${step.tool}"`
              : `one of [${(step.tools ?? []).join(', ')}]`;
          return {
            passed: false,
            failedAssertion: `Expected a call to ${label} (step ${i + 1}) after index ${lastIndex}, with args matching ${JSON.stringify(step.args ?? {})}`,
          };
        }
        lastIndex = idx;
      }
      break;
    }
    case 'toolCallOneOf': {
      const expected = a;
      const anyMatch = expected.oneOf.some(spec =>
        findMatchingToolCall(toolCalls, spec.tool, spec.args)
      );
      if (!anyMatch) {
        const labels = expected.oneOf.map(
          spec => `${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''}`
        );
        return {
          passed: false,
          failedAssertion: `Expected one of these tool calls: ${labels.join(' OR ')}`,
        };
      }
      break;
    }
    default:
      return {
        passed: false,
        failedAssertion: `Unknown assertion type: ${String((a as { type: string }).type)}`,
      };
  }
  return { passed: true };
}

/**
 * Run an assertion block (mode all: every item must pass; mode any: at least one must pass).
 */
function runAssertionBlock(
  block: AssertionBlock,
  toolCalls: ToolCallRecord[],
  finalText: string
): { passed: boolean; failedAssertion?: string } {
  if (block.mode === 'all') {
    for (const item of block.items) {
      const result = runAssertionItem(item, toolCalls, finalText);
      if (!result.passed) return result;
    }
    return { passed: true };
  }
  for (const item of block.items) {
    const result = runAssertionItem(item, toolCalls, finalText);
    if (result.passed) return { passed: true };
  }
  return {
    passed: false,
    failedAssertion: 'anyOf (block): none of the alternatives passed',
  };
}

/**
 * Run the question's assertion block. Returns passed and optional failure message.
 */
export function runAssertions(
  block: AssertionBlock,
  toolCalls: ToolCallRecord[],
  finalText: string
): { passed: boolean; failedAssertion?: string } {
  return runAssertionBlock(block, toolCalls, finalText);
}
