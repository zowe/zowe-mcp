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

/** Pricing keyed by the eval model id string (evals.config.json / EvalsConfig.serverModel). */
export const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-5': {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheWriteMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  },
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
