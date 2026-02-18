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
  base_url?: string;
  server_model: string;
  api_key?: string;
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

export function loadEvalsConfig(): EvalsConfig {
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
  const provider = (raw.provider as string) ?? 'vllm';
  if (provider !== 'vllm' && provider !== 'gemini') {
    throw new Error(`evals.config.json: provider must be "vllm" or "gemini", got "${provider}"`);
  }
  const server_model = (raw.server_model as string) ?? '';
  if (!server_model) {
    throw new Error('evals.config.json: server_model is required');
  }
  let api_key = raw.api_key as string | undefined;
  if (provider === 'gemini' && !api_key && process.env.GEMINI_API_KEY) {
    api_key = process.env.GEMINI_API_KEY;
  }
  if (provider === 'gemini' && !api_key) {
    throw new Error('evals.config.json: api_key or GEMINI_API_KEY env is required for Gemini');
  }
  const config: EvalsConfig = {
    provider: provider as EvalsProvider,
    server_model,
    api_key,
  };
  if (provider === 'vllm') {
    config.base_url = (raw.base_url as string) ?? 'http://localhost:8000/v1';
  }
  return config;
}
