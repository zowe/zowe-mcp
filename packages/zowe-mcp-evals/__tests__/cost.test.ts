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
import { estimateCostUsd } from '../src/cost.js';
import type { TokenUsage } from '../src/types.js';

function usage(overrides: Partial<TokenUsage> & { input: number; output: number }): TokenUsage {
  return { total: overrides.input + overrides.output, ...overrides };
}

describe('estimateCostUsd', () => {
  it('computes exact cost for a cache-heavy usage vector on claude-sonnet-5', () => {
    // claude-sonnet-5: input $3/MTok, output $15/MTok, cache-write 1.25x input,
    // cache-read 0.1x input.
    //   input:  5,000    tokens -> (5,000   / 1e6) * 3.0          = 0.015
    //   output: 1,200    tokens -> (1,200   / 1e6) * 15.0         = 0.018
    //   cache write: 100,000 tokens -> (100,000 / 1e6) * 3.0 * 1.25 = 0.375
    //   cache read:  400,000 tokens -> (400,000 / 1e6) * 3.0 * 0.1  = 0.12
    // total = 0.015 + 0.018 + 0.375 + 0.12 = 0.528
    const tokenUsage = usage({
      input: 5000,
      output: 1200,
      cacheCreationInputTokens: 100000,
      cacheReadInputTokens: 400000,
    });
    expect(estimateCostUsd(tokenUsage, 'claude-sonnet-5')).toBeCloseTo(0.528, 10);
  });

  it('returns undefined for an unknown model id', () => {
    const tokenUsage = usage({ input: 1000, output: 500 });
    expect(estimateCostUsd(tokenUsage, 'not-a-real-model')).toBeUndefined();
  });

  it('returns undefined when modelId is undefined', () => {
    const tokenUsage = usage({ input: 1000, output: 500 });
    expect(estimateCostUsd(tokenUsage, undefined)).toBeUndefined();
  });

  it('applies a write multiplier of 1 for a model with cacheReadMultiplier but no cacheWriteMultiplier', () => {
    // gpt-5.4: inputPerMTok 2.5, cacheReadMultiplier 0.1, no cacheWriteMultiplier
    // (defaults to 1x input, i.e. no cache-write discount/premium modeled).
    //   input: 1,000 tokens -> (1,000 / 1e6) * 2.5          = 0.0025
    //   cache write: 200,000 tokens -> (200,000 / 1e6) * 2.5 * 1 = 0.5
    // total = 0.0025 + 0.5 = 0.5025
    const tokenUsage = usage({ input: 1000, output: 0, cacheCreationInputTokens: 200000 });
    expect(estimateCostUsd(tokenUsage, 'gpt-5.4')).toBeCloseTo(0.5025, 10);
  });

  it('treats undefined cache fields as 0', () => {
    const tokenUsage = usage({ input: 1_000_000, output: 1_000_000 });
    // No cacheCreationInputTokens / cacheReadInputTokens on the object at all.
    expect(tokenUsage.cacheCreationInputTokens).toBeUndefined();
    expect(tokenUsage.cacheReadInputTokens).toBeUndefined();
    // input: 1 MTok * 3.0 = 3.0; output: 1 MTok * 15.0 = 15.0; no cache contribution.
    expect(estimateCostUsd(tokenUsage, 'claude-sonnet-5')).toBeCloseTo(18.0, 10);
  });
});
