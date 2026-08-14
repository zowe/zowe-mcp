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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entryToConfig, validateProvider, type EvalsModelEntry } from '../src/config.js';

describe('validateProvider', () => {
  it('accepts all known providers', () => {
    expect(validateProvider('vllm')).toBe('vllm');
    expect(validateProvider('gemini')).toBe('gemini');
    expect(validateProvider('lmstudio')).toBe('lmstudio');
    expect(validateProvider('anthropic')).toBe('anthropic');
    expect(validateProvider('openai')).toBe('openai');
  });

  it('throws on an unknown provider', () => {
    expect(() => validateProvider('bogus')).toThrow(/provider must be/);
  });
});

describe('entryToConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('anthropic', () => {
    it('validates and maps a config entry with an inline apiKey', () => {
      const entry: EvalsModelEntry = {
        id: 'claude',
        provider: 'anthropic',
        serverModel: 'claude-opus-4-8',
        apiKey: 'sk-ant-inline',
      };
      const config = entryToConfig(entry);
      expect(config.provider).toBe('anthropic');
      expect(config.serverModel).toBe('claude-opus-4-8');
      expect(config.apiKey).toBe('sk-ant-inline');
      expect(config.modelId).toBe('claude');
      expect(config.baseUrl).toBeUndefined();
    });

    it('falls back to ANTHROPIC_API_KEY when apiKey is not set on the entry', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env';
      const entry: EvalsModelEntry = {
        id: 'claude',
        provider: 'anthropic',
        serverModel: 'claude-opus-4-8',
      };
      const config = entryToConfig(entry);
      expect(config.apiKey).toBe('sk-ant-from-env');
    });

    it('prefers an inline apiKey over the environment variable', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env';
      const entry: EvalsModelEntry = {
        id: 'claude',
        provider: 'anthropic',
        serverModel: 'claude-opus-4-8',
        apiKey: 'sk-ant-inline',
      };
      const config = entryToConfig(entry);
      expect(config.apiKey).toBe('sk-ant-inline');
    });

    it('throws a clear error when no apiKey or ANTHROPIC_API_KEY is available', () => {
      const entry: EvalsModelEntry = {
        id: 'claude',
        provider: 'anthropic',
        serverModel: 'claude-opus-4-8',
      };
      expect(() => entryToConfig(entry)).toThrow(/needs apiKey or ANTHROPIC_API_KEY/);
    });
  });

  describe('openai', () => {
    it('validates and maps a config entry with an inline apiKey', () => {
      const entry: EvalsModelEntry = {
        id: 'gpt',
        provider: 'openai',
        serverModel: 'gpt-5',
        apiKey: 'sk-inline',
      };
      const config = entryToConfig(entry);
      expect(config.provider).toBe('openai');
      expect(config.serverModel).toBe('gpt-5');
      expect(config.apiKey).toBe('sk-inline');
      expect(config.modelId).toBe('gpt');
      expect(config.baseUrl).toBeUndefined();
    });

    it('falls back to OPENAI_API_KEY when apiKey is not set on the entry', () => {
      process.env.OPENAI_API_KEY = 'sk-from-env';
      const entry: EvalsModelEntry = {
        id: 'gpt',
        provider: 'openai',
        serverModel: 'gpt-5',
      };
      const config = entryToConfig(entry);
      expect(config.apiKey).toBe('sk-from-env');
    });

    it('falls back to AZURE_OPENAI_API_KEY when neither apiKey nor OPENAI_API_KEY is set', () => {
      process.env.AZURE_OPENAI_API_KEY = 'sk-azure-from-env';
      const entry: EvalsModelEntry = {
        id: 'gpt-azure',
        provider: 'openai',
        serverModel: 'my-azure-deployment',
        baseUrl: 'https://my-resource.openai.azure.com/openai/deployments/my-azure-deployment',
      };
      const config = entryToConfig(entry);
      expect(config.apiKey).toBe('sk-azure-from-env');
    });

    it('passes through a configured baseUrl (e.g. for an Azure OpenAI deployment)', () => {
      const entry: EvalsModelEntry = {
        id: 'gpt-azure',
        provider: 'openai',
        serverModel: 'my-azure-deployment',
        apiKey: 'sk-azure',
        baseUrl: 'https://my-resource.openai.azure.com/openai/deployments/my-azure-deployment',
      };
      const config = entryToConfig(entry);
      expect(config.baseUrl).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/my-azure-deployment'
      );
    });

    it('throws a clear error when no apiKey or env fallback is available', () => {
      const entry: EvalsModelEntry = {
        id: 'gpt',
        provider: 'openai',
        serverModel: 'gpt-5',
      };
      expect(() => entryToConfig(entry)).toThrow(
        /needs apiKey or OPENAI_API_KEY \/ AZURE_OPENAI_API_KEY/
      );
    });
  });

  describe('existing providers still validate (regression)', () => {
    it('gemini still resolves apiKey from GEMINI_API_KEY', () => {
      process.env.GEMINI_API_KEY = 'gem-key';
      const entry: EvalsModelEntry = {
        id: 'gemini-model',
        provider: 'gemini',
        serverModel: 'gemini-2.5-flash',
      };
      const config = entryToConfig(entry);
      expect(config.apiKey).toBe('gem-key');
    });

    it('vllm still defaults baseUrl', () => {
      const entry: EvalsModelEntry = {
        id: 'local',
        provider: 'vllm',
        serverModel: 'some-model',
      };
      const config = entryToConfig(entry);
      expect(config.baseUrl).toBe('http://localhost:8000/v1');
    });
  });
});
