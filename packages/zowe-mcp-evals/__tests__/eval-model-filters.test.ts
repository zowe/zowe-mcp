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
import { isLikelyGeminiTextLlmChatModel, isLikelyOpenAiCompatTextLlmId } from '../src/config.js';

describe('isLikelyGeminiTextLlmChatModel', () => {
  it('keeps typical Gemini chat models', () => {
    expect(
      isLikelyGeminiTextLlmChatModel({
        id: 'gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      })
    ).toBe(true);
    expect(
      isLikelyGeminiTextLlmChatModel({
        id: 'gemma-3-12b-it',
        supportedGenerationMethods: ['generateContent'],
      })
    ).toBe(true);
  });

  it('drops when generateContent is absent', () => {
    expect(
      isLikelyGeminiTextLlmChatModel({
        id: 'gemini-embedding-001',
        supportedGenerationMethods: ['embedContent', 'countTokens'],
      })
    ).toBe(false);
  });

  it('drops image / TTS / video / music style ids', () => {
    expect(
      isLikelyGeminiTextLlmChatModel({
        id: 'gemini-2.5-flash-image',
        supportedGenerationMethods: ['generateContent'],
      })
    ).toBe(false);
    expect(
      isLikelyGeminiTextLlmChatModel({
        id: 'gemini-2.5-flash-preview-tts',
        displayName: 'TTS',
        supportedGenerationMethods: ['generateContent'],
      })
    ).toBe(false);
    expect(
      isLikelyGeminiTextLlmChatModel({
        id: 'lyria-3-pro-preview',
        supportedGenerationMethods: ['generateContent'],
      })
    ).toBe(false);
  });
});

describe('isLikelyOpenAiCompatTextLlmId', () => {
  it('keeps normal LM / vLLM ids', () => {
    expect(isLikelyOpenAiCompatTextLlmId('Qwen3-30B-A3B-Thinking-2507-FP8')).toBe(true);
    expect(isLikelyOpenAiCompatTextLlmId('broadcom/qwen3-8b')).toBe(true);
  });

  it('drops embedding-style ids', () => {
    expect(isLikelyOpenAiCompatTextLlmId('text-embedding-nomic-embed-text-v1.5')).toBe(false);
    expect(isLikelyOpenAiCompatTextLlmId('text-embedding-3-small')).toBe(false);
  });
});
