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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EvalsProvider = 'vllm' | 'gemini';

export interface EvalsConfig {
  provider: EvalsProvider;
  baseUrl?: string;
  serverModel: string;
  apiKey?: string;
  /** Set when using multi-model config; used for cache key and logging. */
  modelId?: string;
}

/** Single model entry in evals.config.json "models" array. */
export interface EvalsModelEntry {
  id: string;
  provider: EvalsProvider;
  serverModel: string;
  baseUrl?: string;
  apiKey?: string;
}

const CONFIG_NAMES = ['evals.config.json', 'evals.config.local.json'];

function findConfigDir(): string {
  let dir = resolve(__dirname, '..');
  for (let i = 0; i < 5; i++) {
    for (const name of CONFIG_NAMES) {
      const p = resolve(dir, name);
      if (existsSync(p)) return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(__dirname, '..');
}

/** Directory containing evals.config.json (repo root when run from workspace). Use to resolve relative paths in native serverArgs (e.g. --config). */
export function getConfigDir(): string {
  return findConfigDir();
}

function validateProvider(p: string): EvalsProvider {
  if (p !== 'vllm' && p !== 'gemini') {
    throw new Error(`evals.config.json: provider must be "vllm" or "gemini", got "${p}"`);
  }
  return p as EvalsProvider;
}

function entryToConfig(entry: EvalsModelEntry): EvalsConfig {
  const provider = validateProvider(entry.provider);
  if (!entry.serverModel || typeof entry.serverModel !== 'string') {
    throw new Error(`evals.config.json: model "${entry.id}" has no serverModel`);
  }
  let apiKey = entry.apiKey;
  if (provider === 'gemini' && !apiKey && process.env.GEMINI_API_KEY) {
    apiKey = process.env.GEMINI_API_KEY;
  }
  if (provider === 'gemini' && !apiKey) {
    throw new Error(
      `evals.config.json: model "${entry.id}" needs apiKey or GEMINI_API_KEY env for Gemini`
    );
  }
  const config: EvalsConfig = {
    provider,
    serverModel: entry.serverModel,
    apiKey,
    modelId: entry.id,
  };
  if (provider === 'vllm') {
    config.baseUrl = entry.baseUrl ?? 'http://localhost:8000/v1';
  }
  return config;
}

/**
 * Load evals config and optionally select a model by id.
 * With multi-model config, the first model is the default when modelId is omitted.
 *
 * @param modelId - Optional model id (from --model). If omitted, the first model is used.
 */
export function loadEvalsConfig(modelId?: string): EvalsConfig {
  const configDir = findConfigDir();
  let content: string | undefined;
  for (const name of CONFIG_NAMES) {
    const p = resolve(configDir, name);
    if (existsSync(p)) {
      content = readFileSync(p, 'utf-8');
      break;
    }
  }
  if (!content) {
    throw new Error(
      `Evals config not found. Create evals.config.json (or evals.config.local.json) in the repo root or in packages/zowe-mcp-evals. See evals.config.example.json.`
    );
  }
  const raw = JSON.parse(content) as Record<string, unknown>;

  const modelsRaw = raw.models;
  let entries: EvalsModelEntry[];

  if (Array.isArray(modelsRaw) && modelsRaw.length > 0) {
    const ids = new Set<string>();
    entries = modelsRaw.map((m: unknown, idx: number) => {
      const o = m as Record<string, unknown>;
      const id = (o.id as string) ?? `model-${idx}`;
      if (ids.has(id)) {
        throw new Error(`evals.config.json: duplicate model id "${id}"`);
      }
      ids.add(id);
      const provider = (o.provider as string) ?? 'vllm';
      const serverModel = (o.serverModel as string) ?? '';
      return {
        id,
        provider: validateProvider(provider),
        serverModel,
        baseUrl: o.baseUrl as string | undefined,
        apiKey: o.apiKey as string | undefined,
      };
    });
  } else {
    // Legacy single-model shape
    const provider = (raw.provider as string) ?? 'vllm';
    const serverModel = (raw.serverModel as string) ?? '';
    if (!serverModel) {
      throw new Error('evals.config.json: serverModel is required');
    }
    let apiKey = raw.apiKey as string | undefined;
    if (provider === 'gemini' && !apiKey && process.env.GEMINI_API_KEY) {
      apiKey = process.env.GEMINI_API_KEY;
    }
    if (provider === 'gemini' && !apiKey) {
      throw new Error('evals.config.json: apiKey or GEMINI_API_KEY env is required for Gemini');
    }
    entries = [
      {
        id: 'default',
        provider: validateProvider(provider),
        serverModel,
        baseUrl: raw.baseUrl as string | undefined,
        apiKey,
      },
    ];
  }

  const chosen = modelId !== undefined ? entries.find(e => e.id === modelId) : entries[0];
  if (!chosen) {
    const available = entries.map(e => e.id).join(', ');
    throw new Error(`evals.config.json: unknown model "${modelId}". Available: ${available}`);
  }

  return entryToConfig(chosen);
}
