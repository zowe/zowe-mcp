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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCacheKey,
  get,
  getToolsUnderTest,
  set,
  type CacheKeyPayload,
  type CachedRunResult,
} from '../src/cache.js';
import type { Assertion } from '../src/types.js';

describe('getToolsUnderTest', () => {
  it('returns empty array for empty assertions', () => {
    expect(getToolsUnderTest([])).toEqual([]);
  });

  it('returns empty array when only answerContains assertions', () => {
    const assertions: Assertion[] = [
      { type: 'answerContains', substring: 'foo' },
      { type: 'answerContains', pattern: 'bar' },
    ];
    expect(getToolsUnderTest(assertions)).toEqual([]);
  });

  it('returns tool name for toolCall assertion', () => {
    expect(getToolsUnderTest([{ type: 'toolCall', tool: 'listDatasets' }])).toEqual([
      'listDatasets',
    ]);
  });

  it('returns tool name for singleToolCall assertion', () => {
    expect(getToolsUnderTest([{ type: 'singleToolCall', tool: 'listSystems' }])).toEqual([
      'listSystems',
    ]);
  });

  it('returns tool name for toolOnly assertion', () => {
    expect(getToolsUnderTest([{ type: 'toolOnly', tool: 'getContext' }])).toEqual(['getContext']);
  });

  it('returns tool name for minToolCalls assertion', () => {
    expect(
      getToolsUnderTest([{ type: 'minToolCalls', tool: 'listMembers', minCount: 2 }])
    ).toEqual(['listMembers']);
  });

  it('returns tool name for toolCallSequence assertion', () => {
    expect(
      getToolsUnderTest([
        { type: 'toolCallSequence', tool: 'listDatasets', sequence: [{ dsn: 'USER.*' }] },
      ])
    ).toEqual(['listDatasets']);
  });

  it('deduplicates when same tool appears in multiple assertions', () => {
    const assertions: Assertion[] = [
      { type: 'toolCall', tool: 'listDatasets', args: { dsnPattern: 'USER.*' } },
      { type: 'answerContains', substring: 'SRC' },
      { type: 'toolCall', tool: 'listDatasets' },
    ];
    expect(getToolsUnderTest(assertions)).toEqual(['listDatasets']);
  });

  it('returns all unique tool names for multiple different tools', () => {
    const assertions: Assertion[] = [
      { type: 'toolCall', tool: 'listDatasets' },
      { type: 'toolCall', tool: 'listMembers' },
      { type: 'answerContains', substring: 'x' },
      { type: 'minToolCalls', tool: 'listDatasets', minCount: 1 },
    ];
    expect(getToolsUnderTest(assertions)).toEqual(['listDatasets', 'listMembers']);
  });

  it('trims tool names', () => {
    expect(getToolsUnderTest([{ type: 'toolCall', tool: '  listDatasets  ' }])).toEqual([
      'listDatasets',
    ]);
  });
});

describe('buildCacheKey', () => {
  const basePayload: CacheKeyPayload = {
    systemPrompt: 'You are a helper.',
    prompt: 'List datasets.',
    toolDefs: {
      listDatasets: {
        description: 'List datasets',
        inputSchema: { type: 'object', properties: { dsnPattern: { type: 'string' } } },
      },
    },
  };

  it('returns same key for same payload', () => {
    const key1 = buildCacheKey(basePayload);
    const key2 = buildCacheKey(basePayload);
    expect(key1).toBe(key2);
  });

  it('returns deterministic key', () => {
    const key1 = buildCacheKey(basePayload);
    const key2 = buildCacheKey({ ...basePayload });
    expect(key1).toBe(key2);
  });

  it('returns different key for different prompt', () => {
    const key1 = buildCacheKey(basePayload);
    const key2 = buildCacheKey({ ...basePayload, prompt: 'List members.' });
    expect(key1).not.toBe(key2);
  });

  it('returns different key for different systemPrompt', () => {
    const key1 = buildCacheKey(basePayload);
    const key2 = buildCacheKey({
      ...basePayload,
      systemPrompt: 'You are another helper.',
    });
    expect(key1).not.toBe(key2);
  });

  it('returns different key for different toolDefs', () => {
    const key1 = buildCacheKey(basePayload);
    const key2 = buildCacheKey({
      ...basePayload,
      toolDefs: {
        listDatasets: {
          description: 'Different description',
          inputSchema: basePayload.toolDefs.listDatasets.inputSchema,
        },
      },
    });
    expect(key1).not.toBe(key2);
  });

  it('returns short hex string', () => {
    const key = buildCacheKey(basePayload);
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('cache get/set', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'evals-cache-test-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns equivalent value after set', async () => {
    const key = 'abc123def4567890';
    const value: CachedRunResult = {
      finalText: 'Here are the datasets.',
      toolCalls: [{ name: 'listDatasets', arguments: { dsnPattern: 'USER.*' }, result: '[]' }],
    };
    await set(cacheDir, key, value);
    const got = await get(cacheDir, key);
    expect(got).not.toBeNull();
    expect(got!.finalText).toBe(value.finalText);
    expect(got!.toolCalls).toHaveLength(value.toolCalls.length);
    expect(got!.toolCalls[0].name).toBe(value.toolCalls[0].name);
    expect(got!.toolCalls[0].arguments).toEqual(value.toolCalls[0].arguments);
  });

  it('returns null for missing key', async () => {
    const got = await get(cacheDir, 'nonexistent');
    expect(got).toBeNull();
  });

  it('returns null for invalid JSON file', async () => {
    const key = 'badfile';
    const path = join(cacheDir, key + '.json');
    writeFileSync(path, 'not json', 'utf-8');
    const got = await get(cacheDir, key);
    expect(got).toBeNull();
  });

  it('returns null for file with wrong shape', async () => {
    const key = 'wrongshape';
    const path = join(cacheDir, key + '.json');
    writeFileSync(path, '{"foo":1}', 'utf-8');
    const got = await get(cacheDir, key);
    expect(got).toBeNull();
  });
});
