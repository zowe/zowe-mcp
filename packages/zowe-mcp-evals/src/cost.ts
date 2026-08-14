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

import type { TokenUsage } from './types.js';

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cache write multiplier on inputPerMTok, 5-minute TTL. Anthropic-specific; omit for providers without caching. */
  cacheWriteMultiplier?: number;
  /** Cache read multiplier on inputPerMTok. Anthropic-specific; omit for providers without caching. */
  cacheReadMultiplier?: number;
}

/**
 * Pricing keyed by the eval model id string (the provider's model id, i.e.
 * evals.config.json `serverModel`). Rates are per 1M tokens, standard tier.
 * Anthropic list price (intro discounts not modeled — see cacheWriteMultiplier).
 * OpenAI: prompt caching is automatic server-side (we send no cache_control), so
 * cached input is billed at a discount and reported as cacheReadInputTokens —
 * only cacheReadMultiplier applies; there is no cache-write premium.
 */
export const PRICING: Record<string, ModelPricing> = {
  // Anthropic (list price; caching 5-minute TTL: write 1.25x, read 0.1x)
  'claude-sonnet-5': {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheWriteMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  },
  // OpenAI — developers.openai.com/api/docs/pricing (GPT-5.x cached input = 0.1x input).
  'gpt-5.6-sol': { inputPerMTok: 5.0, outputPerMTok: 30.0, cacheReadMultiplier: 0.1 },
  'gpt-5.6-terra': { inputPerMTok: 2.5, outputPerMTok: 15.0, cacheReadMultiplier: 0.1 },
  'gpt-5.6-luna': { inputPerMTok: 1.0, outputPerMTok: 6.0, cacheReadMultiplier: 0.1 },
  'gpt-5.5': { inputPerMTok: 5.0, outputPerMTok: 30.0, cacheReadMultiplier: 0.1 },
  'gpt-5.4': { inputPerMTok: 2.5, outputPerMTok: 15.0, cacheReadMultiplier: 0.1 },
  'gpt-5.4-mini': { inputPerMTok: 0.75, outputPerMTok: 4.5, cacheReadMultiplier: 0.1 },
  'gpt-5.4-nano': { inputPerMTok: 0.2, outputPerMTok: 1.25, cacheReadMultiplier: 0.1 },
  // gpt-4o-mini: legacy model (still API-served), historical 0.5x cached-input rate.
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6, cacheReadMultiplier: 0.5 },
};

/** Estimate USD cost for a TokenUsage, or undefined when the model id has no pricing entry. */
export function estimateCostUsd(
  usage: TokenUsage,
  modelId: string | undefined
): number | undefined {
  if (modelId === undefined) return undefined;
  const pricing = PRICING[modelId];
  if (!pricing) return undefined;
  return (
    (usage.input / 1e6) * pricing.inputPerMTok +
    (usage.output / 1e6) * pricing.outputPerMTok +
    ((usage.cacheCreationInputTokens ?? 0) / 1e6) *
      pricing.inputPerMTok *
      (pricing.cacheWriteMultiplier ?? 1) +
    ((usage.cacheReadInputTokens ?? 0) / 1e6) *
      pricing.inputPerMTok *
      (pricing.cacheReadMultiplier ?? 1)
  );
}
