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

export type EvalsProvider = 'vllm' | 'gemini' | 'lmstudio';

export interface EvalsConfig {
  provider: EvalsProvider;
  baseUrl?: string;
  serverModel: string;
  apiKey?: string;
  /** Set when using multi-model config; used for cache key and logging. */
  modelId?: string;
  /** LM Studio: context length to use when loading the model (default 65536). */
  contextLength?: number;
}

/** Single model entry in evals.config.json "models" array. */
export interface EvalsModelEntry {
  id: string;
  provider: EvalsProvider;
  serverModel: string;
  baseUrl?: string;
  apiKey?: string;
  /** LM Studio: context length to use when loading the model. */
  contextLength?: number;
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
  if (p !== 'vllm' && p !== 'gemini' && p !== 'lmstudio') {
    throw new Error(
      `evals.config.json: provider must be "vllm", "gemini", or "lmstudio", got "${p}"`
    );
  }
  return p as EvalsProvider;
}

/** Default OpenAI-compat base URL for vLLM-style eval entries. */
export const VLLM_DEFAULT_BASE_URL = 'http://localhost:8000/v1';

export const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const LMSTUDIO_DEFAULT_CONTEXT_LENGTH = 32768;

function entryToConfig(entry: EvalsModelEntry): EvalsConfig {
  const provider = validateProvider(entry.provider);
  if (!entry.serverModel || typeof entry.serverModel !== 'string') {
    throw new Error(`evals.config.json: model "${entry.id}" has no serverModel`);
  }
  let apiKey = entry.apiKey;
  if (provider === 'gemini' && !apiKey && process.env.GEMINI_API_KEY) {
    apiKey = process.env.GEMINI_API_KEY;
  }
  if (provider === 'gemini' && !apiKey && process.env.GOOGLE_API_KEY) {
    apiKey = process.env.GOOGLE_API_KEY;
  }
  if (provider === 'gemini' && !apiKey) {
    throw new Error(
      `evals.config.json: model "${entry.id}" needs apiKey or GEMINI_API_KEY / GOOGLE_API_KEY env for Gemini`
    );
  }
  const config: EvalsConfig = {
    provider,
    serverModel: entry.serverModel,
    apiKey,
    modelId: entry.id,
  };
  if (provider === 'vllm') {
    config.baseUrl = entry.baseUrl ?? VLLM_DEFAULT_BASE_URL;
  }
  if (provider === 'lmstudio') {
    config.baseUrl = entry.baseUrl ?? LMSTUDIO_DEFAULT_BASE_URL;
    config.contextLength = entry.contextLength ?? LMSTUDIO_DEFAULT_CONTEXT_LENGTH;
  }
  return config;
}

/**
 * Derive the LM Studio API base (e.g. http://localhost:1234) from the OpenAI-compat
 * base URL (e.g. http://localhost:1234/v1).
 */
function lmStudioApiBase(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

/**
 * Check whether a model is already loaded in LM Studio with the required context length.
 * Uses GET /api/v1/models and inspects `loaded_instances`.
 */
async function isModelAlreadyLoaded(
  apiBase: string,
  model: string,
  contextLength: number
): Promise<boolean> {
  const url = `${apiBase}/api/v1/models`;
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch {
    return false;
  }
  if (!resp.ok) return false;
  const body = (await resp.json()) as {
    models?: {
      key?: string;
      loaded_instances?: { id?: string; config?: { context_length?: number } }[];
    }[];
  };
  for (const m of body.models ?? []) {
    if (m.key !== model) continue;
    for (const inst of m.loaded_instances ?? []) {
      if (inst.config?.context_length != null && inst.config.context_length >= contextLength) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Ensure a model is loaded in LM Studio with the specified context length.
 * Skips the load request when the model is already loaded with sufficient context.
 * Uses POST /api/v1/models/load when loading is needed.
 */
export async function ensureLmStudioModel(
  baseUrl: string,
  model: string,
  contextLength: number
): Promise<void> {
  const apiBase = lmStudioApiBase(baseUrl);

  if (await isModelAlreadyLoaded(apiBase, model, contextLength)) {
    process.stderr.write(
      `LM Studio: model "${model}" already loaded (context_length>=${contextLength.toString()}), skipping load\n`
    );
    return;
  }

  const url = `${apiBase}/api/v1/models/load`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        context_length: contextLength,
      }),
    });
  } catch {
    throw new Error(
      `Could not reach LM Studio at ${apiBase}. Is it running?\n  Tried: POST ${url}`
    );
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `LM Studio failed to load model "${model}" (HTTP ${resp.status.toString()}).\n` +
        `  URL: POST ${url}\n` +
        `  Body: ${body.slice(0, 2000)}`
    );
  }
  const result = (await resp.json()) as { load_time_seconds?: number; status?: string };
  process.stderr.write(
    `LM Studio: model "${model}" loaded (context_length=${contextLength.toString()}` +
      (result.load_time_seconds != null ? `, ${result.load_time_seconds.toFixed(1)}s` : '') +
      ')\n'
  );
}

/**
 * Query the OpenAI-compatible GET /v1/models endpoint to list available model ids.
 * Works with LM Studio (and any OpenAI-compat server).
 */
export async function fetchAvailableModelIds(
  baseUrl: string,
  options?: { textLlmOnly?: boolean }
): Promise<string[]> {
  const url = baseUrl.replace(/\/+$/, '') + '/models';
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch {
    throw new Error(
      `Could not reach OpenAI-compat server at ${baseUrl}. Is it running?\n` +
        `  Tried: GET ${url}`
    );
  }
  if (!resp.ok) {
    throw new Error(
      `OpenAI-compat server returned HTTP ${resp.status.toString()} from GET ${url}. Is the server running?`
    );
  }
  const body = (await resp.json()) as { data?: { id?: string }[] };
  let ids = (body.data ?? []).map(m => m.id).filter((id): id is string => typeof id === 'string');
  if (options?.textLlmOnly) {
    ids = ids.filter(isLikelyOpenAiCompatTextLlmId);
  }
  return ids;
}

/** One row from Gemini `models.list` (fields used for filtering). */
export interface GeminiModelRecord {
  id: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/**
 * True for models that look like text chat / completion LLMs (excludes image, TTS, video, music,
 * embeddings, etc.) among entries that support `generateContent`. Heuristic: id + displayName
 * substring checks — not a formal API modality field.
 */
export function isLikelyGeminiTextLlmChatModel(m: GeminiModelRecord): boolean {
  if (!m.supportedGenerationMethods?.includes('generateContent')) return false;
  const id = m.id.toLowerCase();
  const dn = (m.displayName ?? '').toLowerCase();
  const hay = `${id} ${dn}`;
  const badSubstrings = [
    'embedding',
    'text-embedding',
    'embed-',
    '-embed',
    'tts',
    'text-to-speech',
    'image',
    'imagen',
    'lyria',
    'veo',
    'nano-banana',
    'native-audio',
    'robotics-er',
    'computer-use',
    'flash-image',
    'preview-tts',
  ];
  for (const b of badSubstrings) {
    if (hay.includes(b)) return false;
  }
  return true;
}

/**
 * Full Gemini model list (all modalities). Use {@link isLikelyGeminiTextLlmChatModel} to narrow.
 */
export async function fetchGeminiModelRecords(apiKey: string): Promise<GeminiModelRecord[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not reach Gemini API: ${msg}\n  Tried: GET ${url.split('?')[0]}?key=***`
    );
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Gemini API returned HTTP ${resp.status.toString()}: ${body.slice(0, 500)}`);
  }
  const body = (await resp.json()) as {
    models?: {
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }[];
  };
  return (body.models ?? [])
    .map(m => ({
      id: (m.name ?? '').replace(/^models\//, ''),
      displayName: m.displayName,
      supportedGenerationMethods: m.supportedGenerationMethods,
    }))
    .filter(m => m.id.length > 0);
}

/**
 * List Gemini model ids that support generateContent (Google AI Studio / Generative Language API).
 * @param options.textLlmOnly — If true, drop image/TTS/video/music-style models that still list
 *   `generateContent` (heuristic on id/displayName). Embeddings are already omitted (they use
 *   `embedContent`, not `generateContent`).
 */
export async function fetchGeminiModelIds(
  apiKey: string,
  options?: { textLlmOnly?: boolean }
): Promise<string[]> {
  const records = await fetchGeminiModelRecords(apiKey);
  const picked = options?.textLlmOnly
    ? records.filter(isLikelyGeminiTextLlmChatModel)
    : records.filter(m => m.supportedGenerationMethods?.includes('generateContent'));
  return picked.map(m => m.id).sort((a, b) => a.localeCompare(b));
}

/**
 * OpenAI-compat `id` heuristic: exclude embedding and obvious non-text models (ids only; no modality metadata).
 */
export function isLikelyOpenAiCompatTextLlmId(id: string): boolean {
  const s = id.toLowerCase();
  if (s.includes('text-embedding')) return false;
  if (s.includes('nomic-embed') || s.includes('-embed-') || s.endsWith('-embed')) return false;
  if (/\b(embed|embedding|whisper|tts|voice|speech)\b/.test(s)) return false;
  return true;
}

/**
 * Parse evals.config.json content into model entries (multi-model array or legacy single-model shape).
 */
export function parseEvalsConfigRaw(raw: Record<string, unknown>): EvalsModelEntry[] {
  const modelsRaw = raw.models;
  if (Array.isArray(modelsRaw) && modelsRaw.length > 0) {
    const ids = new Set<string>();
    return modelsRaw.map((m: unknown, idx: number) => {
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
        contextLength: typeof o.contextLength === 'number' ? o.contextLength : undefined,
      };
    });
  }
  const provider = (raw.provider as string) ?? 'vllm';
  const serverModel = (raw.serverModel as string) ?? '';
  if (!serverModel) {
    throw new Error('evals.config.json: serverModel is required');
  }
  let apiKey = raw.apiKey as string | undefined;
  if (provider === 'gemini' && !apiKey && process.env.GEMINI_API_KEY) {
    apiKey = process.env.GEMINI_API_KEY;
  }
  if (provider === 'gemini' && !apiKey && process.env.GOOGLE_API_KEY) {
    apiKey = process.env.GOOGLE_API_KEY;
  }
  if (provider === 'gemini' && !apiKey) {
    throw new Error(
      'evals.config.json: apiKey or GEMINI_API_KEY / GOOGLE_API_KEY env is required for Gemini'
    );
  }
  return [
    {
      id: 'default',
      provider: validateProvider(provider),
      serverModel,
      baseUrl: raw.baseUrl as string | undefined,
      apiKey,
    },
  ];
}

/**
 * Read evals.config.json (or evals.config.local.json) and return all model entries without resolving a default.
 */
export function loadEvalsModelEntries(): EvalsModelEntry[] {
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
      `Evals config not found. Create evals.config.json (or evals.config.local.json) in the repo root. See evals.config.example.json.`
    );
  }
  return parseEvalsConfigRaw(JSON.parse(content) as Record<string, unknown>);
}

/**
 * Load evals config and optionally select a model by id.
 * With multi-model config, the first model is the default when modelId is omitted.
 *
 * For the lmstudio provider, validates serverModel against the running LM Studio instance
 * and lists available models when serverModel is missing or not found.
 *
 * @param modelId - Optional model id (from --model). If omitted, the first model is used.
 */
export async function loadEvalsConfig(modelId?: string): Promise<EvalsConfig> {
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
  const entries = parseEvalsConfigRaw(raw);

  const chosen = modelId !== undefined ? entries.find(e => e.id === modelId) : entries[0];
  if (!chosen) {
    const available = entries.map(e => e.id).join(', ');
    throw new Error(`evals.config.json: unknown model "${modelId}". Available: ${available}`);
  }

  if (chosen.provider === 'lmstudio') {
    const baseUrl = chosen.baseUrl ?? LMSTUDIO_DEFAULT_BASE_URL;
    const contextLength = chosen.contextLength ?? LMSTUDIO_DEFAULT_CONTEXT_LENGTH;

    if (!chosen.serverModel?.trim()) {
      const availableModels = await fetchAvailableModelIds(baseUrl);
      const modelList =
        availableModels.length > 0
          ? `Available models:\n${availableModels.map(id => `  - ${id}`).join('\n')}`
          : 'No models found. Load a model in LM Studio first.';
      throw new Error(
        `evals.config.json: serverModel is required for provider "lmstudio".\n${modelList}`
      );
    }

    await ensureLmStudioModel(baseUrl, chosen.serverModel, contextLength);
  }

  return entryToConfig(chosen);
}
