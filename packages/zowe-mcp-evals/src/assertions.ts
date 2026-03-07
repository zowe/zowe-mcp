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

import { plural } from 'zowe-mcp-common';
import type { Assertion, AssertionBlock, AssertionItem, ToolCallRecord } from './types.js';

/**
 * Check if actual value matches expected. Supports:
 * - Array: actual must match any element (anyOf semantics).
 * - Object with anyOf key (array): actual must match any element.
 * - Otherwise: direct match (string uses case-insensitive includes or exact).
 */
function valueMatches(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    if (Array.isArray(actual) && JSON.stringify(expected) === JSON.stringify(actual)) return true;
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

function withName(name: string | undefined, msg: string): string {
  return name ? `[${name}] ${msg}` : msg;
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

function fail(name: string | undefined, msg: string): { passed: false; failedAssertion: string } {
  return { passed: false, failedAssertion: withName(name, msg) };
}

/**
 * Run leaf assertions (3 consolidated types).
 */
function runLeafAssertion(
  a: Assertion,
  toolCalls: ToolCallRecord[],
  finalText: string
): { passed: boolean; failedAssertion?: string } {
  switch (a.type) {
    case 'toolCall': {
      if (a.count !== undefined) {
        const toolName = a.tool?.trim();
        const actual = toolName
          ? toolCalls.filter(tc => tc.name === toolName).length
          : toolCalls.length;
        if (actual !== a.count) {
          const label = toolName ? ` to "${toolName}"` : '';
          return fail(
            a.name,
            `Expected exactly ${a.count} ${plural(a.count, 'call', 'calls')}${label}, got ${actual}`
          );
        }
        if (toolName && a.args) {
          const matching = toolCalls.filter(tc => tc.name === toolName);
          const last = matching[matching.length - 1];
          if (last && !argsMatch(a.args, last.arguments)) {
            return fail(
              a.name,
              `Expected tool "${toolName}" with args matching ${JSON.stringify(a.args)}, got ${JSON.stringify(last.arguments)}`
            );
          }
        }
        break;
      }

      if (a.minCount !== undefined) {
        const toolName = a.tool?.trim();
        if (!toolName) return fail(a.name, 'minCount requires tool');
        const actual = toolCalls.filter(tc => tc.name === toolName).length;
        if (actual < a.minCount) {
          return fail(
            a.name,
            `Expected at least ${a.minCount} ${plural(a.minCount, 'call', 'calls')} to "${toolName}", got ${actual} ${plural(actual, 'call', 'calls')}`
          );
        }
        break;
      }

      if (a.oneOf) {
        const anyMatch = a.oneOf.some(spec =>
          findMatchingToolCall(toolCalls, spec.tool, spec.args)
        );
        if (!anyMatch) {
          const labels = a.oneOf.map(
            spec => `${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''}`
          );
          return fail(a.name, `Expected one of these tool calls: ${labels.join(' OR ')}`);
        }
        break;
      }

      if (a.tools) {
        const anyMatch = a.tools.some(t => findMatchingToolCall(toolCalls, t, a.args));
        if (!anyMatch) {
          return fail(
            a.name,
            `Expected a call to one of [${a.tools.join(', ')}]${a.args ? ` with args matching ${JSON.stringify(a.args)}` : ''}`
          );
        }
        break;
      }

      if (a.tool) {
        const lastRelevant = [...toolCalls].reverse().find(tc => tc.name === a.tool);
        if (!lastRelevant) {
          return fail(a.name, `Expected tool "${a.tool}" to be called`);
        }
        if (!argsMatch(a.args, lastRelevant.arguments)) {
          return fail(
            a.name,
            `Expected tool "${a.tool}" with args matching ${JSON.stringify(a.args)}, got ${JSON.stringify(lastRelevant.arguments)}`
          );
        }
        break;
      }

      return fail(a.name, 'toolCall must have tool, tools, or oneOf');
    }

    case 'toolCallOrder': {
      let lastIndex = -1;
      for (let i = 0; i < a.sequence.length; i++) {
        const step = a.sequence[i];
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
          return fail(
            a.name,
            `Expected a call to ${label} (step ${i + 1}) after index ${lastIndex}, with args matching ${JSON.stringify(step.args ?? {})}`
          );
        }
        lastIndex = idx;
      }
      break;
    }

    case 'answerContains': {
      if (a.pattern !== undefined) {
        try {
          const re = new RegExp(a.pattern);
          if (!re.test(finalText)) {
            return fail(a.name, `Expected answer to match pattern /${a.pattern}/`);
          }
        } catch {
          return fail(a.name, `Invalid answerContains pattern: ${a.pattern}`);
        }
      } else if (a.substring !== undefined) {
        if (!finalText.includes(a.substring)) {
          return fail(a.name, `Expected answer to contain "${a.substring}"`);
        }
      } else {
        return fail(a.name, 'answerContains requires substring or pattern');
      }
      break;
    }

    default:
      return fail(undefined, `Unknown assertion type: ${String((a as { type: string }).type)}`);
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
