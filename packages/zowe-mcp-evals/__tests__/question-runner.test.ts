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

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JudgeFn } from '../src/assertions.js';
import { buildCacheKey, get as cacheGet, set as cacheSet } from '../src/cache.js';
import type { AgentRunResult, ConversationRunResult } from '../src/harness.js';
import {
  runQuestion,
  type QuestionRunContext,
  type QuestionRunHarness,
} from '../src/question-runner.js';
import type { Assertion, AssertionBlock, Question } from '../src/types.js';

function block(items: Assertion[]): AssertionBlock {
  return { mode: 'all', items };
}

function fakeAgentRunResult(finalText: string): AgentRunResult {
  return { finalText, toolCalls: [], durationMs: 1, stepCount: 1 };
}

/** Minimal harness: both methods default to throwing so unused stubs surface accidental calls. */
function fakeHarness(overrides: Partial<QuestionRunHarness> = {}): QuestionRunHarness {
  return {
    runOne: vi.fn(() => Promise.reject(new Error('runOne should not be called in this test'))),
    runConversation: vi.fn(() =>
      Promise.reject(new Error('runConversation should not be called in this test'))
    ),
    ...overrides,
  };
}

describe('runQuestion', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'evals-question-runner-test-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  function baseCtx(overrides: Partial<QuestionRunContext> = {}): QuestionRunContext {
    return {
      harness: fakeHarness(),
      cache: { enabled: false, dir: cacheDir, stats: { hits: 0, writes: 0 } },
      systemPrompt: 'You are a helper.',
      repetitions: 1,
      minSuccessRate: 0.8,
      runLabel: r => `run ${r}`,
      verboseAnswers: false,
      ...overrides,
    };
  }

  it('multi-turn: calls runConversation with all turn prompts and fails on a turn-2 assertion failure', async () => {
    const q: Question = {
      id: 'multi-1',
      prompt: 'turn1 prompt',
      assertionBlock: block([]),
      turns: [
        {
          prompt: 'turn1 prompt',
          assertionBlock: block([{ type: 'answerContains', substring: 'ok1' }]),
        },
        {
          prompt: 'turn2 prompt',
          assertionBlock: block([{ type: 'answerContains', substring: 'ok2' }]),
        },
      ],
    };
    const runConversation = vi.fn((): Promise<ConversationRunResult> =>
      Promise.resolve({
        finalText: 'no match here',
        toolCalls: [],
        durationMs: 2,
        stepCount: 2,
        turns: [fakeAgentRunResult('ok1 here'), fakeAgentRunResult('no match here')],
      })
    );
    const harness = fakeHarness({ runOne: vi.fn(), runConversation });

    const results = await runQuestion(q, baseCtx({ harness }));

    expect(runConversation).toHaveBeenCalledWith(['turn1 prompt', 'turn2 prompt']);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].assertionFailed).toMatch(/^turn 2:/);
  });

  it('multi-turn: passes when every turn satisfies its own assertions', async () => {
    const q: Question = {
      id: 'multi-2',
      prompt: 'turn1 prompt',
      assertionBlock: block([]),
      turns: [
        {
          prompt: 'turn1 prompt',
          assertionBlock: block([{ type: 'answerContains', substring: 'ok1' }]),
        },
        {
          prompt: 'turn2 prompt',
          assertionBlock: block([{ type: 'answerContains', substring: 'ok2' }]),
        },
      ],
    };
    const runConversation = vi.fn((): Promise<ConversationRunResult> =>
      Promise.resolve({
        finalText: 'ok2 done',
        toolCalls: [],
        durationMs: 2,
        stepCount: 2,
        turns: [fakeAgentRunResult('ok1 here'), fakeAgentRunResult('ok2 done')],
      })
    );
    const harness = fakeHarness({ runConversation });

    const results = await runQuestion(q, baseCtx({ harness }));

    expect(runConversation).toHaveBeenCalledWith(['turn1 prompt', 'turn2 prompt']);
    expect(results[0].passed).toBe(true);
  });

  it('single-turn: passes the judge through to answerJudge assertions', async () => {
    const q: Question = {
      id: 'judge-1',
      prompt: 'question prompt',
      assertionBlock: block([{ type: 'answerJudge', rubric: 'be nice' }]),
    };
    const judge: JudgeFn = vi.fn(({ rubric, question, answer }) => {
      expect(rubric).toBe('be nice');
      expect(question).toBe('question prompt');
      expect(answer).toBe('nice answer');
      return Promise.resolve({ passed: true, reason: 'friendly enough' });
    });
    const runOne = vi.fn(() => Promise.resolve(fakeAgentRunResult('nice answer')));
    const harness = fakeHarness({ runOne });

    const results = await runQuestion(q, baseCtx({ harness, judge }));

    expect(judge).toHaveBeenCalledTimes(1);
    expect(results[0].passed).toBe(true);
  });

  it('single-turn: fails cleanly when answerJudge has no configured judge', async () => {
    const q: Question = {
      id: 'judge-2',
      prompt: 'question prompt',
      assertionBlock: block([{ type: 'answerJudge', rubric: 'be nice' }]),
    };
    const runOne = vi.fn(() => Promise.resolve(fakeAgentRunResult('nice answer')));
    const harness = fakeHarness({ runOne });

    const results = await runQuestion(q, baseCtx({ harness }));

    expect(results[0].passed).toBe(false);
    expect(results[0].assertionFailed).toMatch(/requires a configured judge model/);
  });

  it('single-turn cache hit replays the cached result without calling the harness', async () => {
    const q: Question = {
      id: 'cache-1',
      prompt: 'cached prompt',
      assertionBlock: block([{ type: 'answerContains', substring: 'cached' }]),
    };
    const key = buildCacheKey({
      systemPrompt: 'You are a helper.',
      prompt: 'cached prompt',
      toolDefs: {},
    });
    await cacheSet(cacheDir, key, { finalText: 'a cached answer', toolCalls: [] });
    const runOne = vi.fn();
    const harness = fakeHarness({ runOne });
    const stats = { hits: 0, writes: 0 };

    const results = await runQuestion(
      q,
      baseCtx({
        harness,
        cache: { enabled: true, dir: cacheDir, stats },
        repetitions: 2,
      })
    );

    expect(runOne).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results.every(r => r.passed)).toBe(true);
    expect(stats.hits).toBe(2);
  });

  it('multi-turn cache hit replays cached.turns through per-turn assertions', async () => {
    const q: Question = {
      id: 'cache-2',
      prompt: 'turn1',
      assertionBlock: block([]),
      turns: [
        { prompt: 'turn1', assertionBlock: block([{ type: 'answerContains', substring: 'a' }]) },
        { prompt: 'turn2', assertionBlock: block([{ type: 'answerContains', substring: 'b' }]) },
      ],
    };
    const cachePrompt = q.turns!.map(t => t.prompt).join('\n<<turn>>\n');
    const key = buildCacheKey({
      systemPrompt: 'You are a helper.',
      prompt: cachePrompt,
      toolDefs: {},
    });
    await cacheSet(cacheDir, key, {
      finalText: 'b here',
      toolCalls: [],
      turns: [
        { finalText: 'a here', toolCalls: [] },
        { finalText: 'b here', toolCalls: [] },
      ],
    });
    const runConversation = vi.fn();
    const harness = fakeHarness({ runConversation });
    const stats = { hits: 0, writes: 0 };

    const results = await runQuestion(
      q,
      baseCtx({ harness, cache: { enabled: true, dir: cacheDir, stats } })
    );

    expect(runConversation).not.toHaveBeenCalled();
    expect(results[0].passed).toBe(true);
    expect(stats.hits).toBe(1);
  });

  it('multi-turn cache hit fails when a cached turn fails its assertion', async () => {
    const q: Question = {
      id: 'cache-3',
      prompt: 'turn1',
      assertionBlock: block([]),
      turns: [
        { prompt: 'turn1', assertionBlock: block([{ type: 'answerContains', substring: 'a' }]) },
        { prompt: 'turn2', assertionBlock: block([{ type: 'answerContains', substring: 'b' }]) },
      ],
    };
    const cachePrompt = q.turns!.map(t => t.prompt).join('\n<<turn>>\n');
    const key = buildCacheKey({
      systemPrompt: 'You are a helper.',
      prompt: cachePrompt,
      toolDefs: {},
    });
    await cacheSet(cacheDir, key, {
      finalText: 'nope',
      toolCalls: [],
      turns: [
        { finalText: 'a here', toolCalls: [] },
        { finalText: 'nope', toolCalls: [] },
      ],
    });
    const harness = fakeHarness();
    const stats = { hits: 0, writes: 0 };

    const results = await runQuestion(
      q,
      baseCtx({ harness, cache: { enabled: true, dir: cacheDir, stats } })
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].assertionFailed).toMatch(/^turn 2:/);
  });

  it('does not write to cache when the pass rate is below minSuccessRate', async () => {
    const q: Question = {
      id: 'write-1',
      prompt: 'flaky prompt',
      assertionBlock: block([{ type: 'answerContains', substring: 'ok' }]),
    };
    let call = 0;
    const runOne = vi.fn(() => {
      call++;
      return Promise.resolve(fakeAgentRunResult(call === 1 ? 'ok' : 'nope'));
    });
    const harness = fakeHarness({ runOne });
    const stats = { hits: 0, writes: 0 };

    await runQuestion(
      q,
      baseCtx({
        harness,
        cache: { enabled: true, dir: cacheDir, stats },
        repetitions: 2,
        minSuccessRate: 0.8, // 1/2 = 0.5 < 0.8
      })
    );

    expect(stats.writes).toBe(0);
    const key = buildCacheKey({
      systemPrompt: 'You are a helper.',
      prompt: 'flaky prompt',
      toolDefs: {},
    });
    expect(await cacheGet(cacheDir, key)).toBeNull();
  });

  it('writes to cache once the pass rate reaches minSuccessRate', async () => {
    const q: Question = {
      id: 'write-2',
      prompt: 'reliable prompt',
      assertionBlock: block([{ type: 'answerContains', substring: 'ok' }]),
    };
    const runOne = vi.fn(() => Promise.resolve(fakeAgentRunResult('ok')));
    const harness = fakeHarness({ runOne });
    const stats = { hits: 0, writes: 0 };

    await runQuestion(
      q,
      baseCtx({
        harness,
        cache: { enabled: true, dir: cacheDir, stats },
        repetitions: 1,
        minSuccessRate: 0.8,
      })
    );

    expect(stats.writes).toBe(1);
    const key = buildCacheKey({
      systemPrompt: 'You are a helper.',
      prompt: 'reliable prompt',
      toolDefs: {},
    });
    const cached = await cacheGet(cacheDir, key);
    expect(cached?.finalText).toBe('ok');
  });

  it('produces a failed RunResult instead of throwing when the harness errors', async () => {
    const q: Question = {
      id: 'error-1',
      prompt: 'boom prompt',
      assertionBlock: block([]),
    };
    const runOne = vi.fn(() => Promise.reject(new Error('boom')));
    const harness = fakeHarness({ runOne });

    const results = await runQuestion(q, baseCtx({ harness }));

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].error).toContain('boom');
  });

  it('calls onToolCalls with the tool calls from a live single-turn run', async () => {
    const q: Question = {
      id: 'tools-1',
      prompt: 'do something',
      assertionBlock: block([]),
    };
    const runOne = vi.fn(() =>
      Promise.resolve({
        finalText: 'done',
        toolCalls: [{ name: 'listDatasets', arguments: { dsnPattern: 'USER.*' } }],
        durationMs: 1,
        stepCount: 1,
      })
    );
    const harness = fakeHarness({ runOne });
    const onToolCalls = vi.fn();

    await runQuestion(q, baseCtx({ harness, onToolCalls }));

    expect(onToolCalls).toHaveBeenCalledWith([
      { name: 'listDatasets', arguments: { dsnPattern: 'USER.*' } },
    ]);
  });
});
