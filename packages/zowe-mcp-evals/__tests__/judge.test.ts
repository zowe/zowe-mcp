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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvalsConfig } from '../src/config.js';
import { buildJudge } from '../src/judge.js';

const generateObjectMock = vi.fn();
const buildModelMock = vi.fn();

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateObject: (...args: Parameters<typeof actual.generateObject>) =>
      generateObjectMock(...args) as ReturnType<typeof actual.generateObject>,
  };
});

vi.mock('../src/harness.js', () => ({
  buildModel: (...args: unknown[]) => buildModelMock(...args) as unknown,
}));

function evalsConfig(): EvalsConfig {
  return { provider: 'anthropic', serverModel: 'claude-haiku-4-5', apiKey: 'test-key' };
}

const MOCK_MODEL = { modelId: 'mock-judge-model' };

describe('buildJudge', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    buildModelMock.mockReset();
    buildModelMock.mockReturnValue(MOCK_MODEL);
  });

  it('sends a prompt containing the question, answer, and rubric, plus a system prompt', async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { pass: true, reason: 'Matches.' } });

    const judge = buildJudge(evalsConfig());
    await judge({
      question: 'What does CUSTFILE do?',
      answer: 'It processes customer records.',
      rubric: 'Mentions COBOL and customer records.',
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const call = generateObjectMock.mock.calls[0][0] as {
      model: unknown;
      system: string;
      prompt: string;
    };
    expect(call.model).toBe(MOCK_MODEL);
    expect(typeof call.system).toBe('string');
    expect(call.system.length).toBeGreaterThan(0);
    expect(call.prompt).toContain('What does CUSTFILE do?');
    expect(call.prompt).toContain('It processes customer records.');
    expect(call.prompt).toContain('Mentions COBOL and customer records.');
  });

  it('maps {pass: true, reason} to {passed: true, reason}', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { pass: true, reason: 'Satisfies the rubric.' },
    });

    const judge = buildJudge(evalsConfig());
    const result = await judge({ question: 'q', answer: 'a', rubric: 'r' });

    expect(result).toEqual({ passed: true, reason: 'Satisfies the rubric.' });
  });

  it('maps {pass: false, reason} to {passed: false, reason}', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { pass: false, reason: 'Missing key terms.' },
    });

    const judge = buildJudge(evalsConfig());
    const result = await judge({ question: 'q', answer: 'a', rubric: 'r' });

    expect(result).toEqual({ passed: false, reason: 'Missing key terms.' });
  });

  it('propagates a generateObject rejection to the caller', async () => {
    generateObjectMock.mockRejectedValueOnce(new Error('model unavailable'));

    const judge = buildJudge(evalsConfig());

    await expect(judge({ question: 'q', answer: 'a', rubric: 'r' })).rejects.toThrow(
      'model unavailable'
    );
  });
});
