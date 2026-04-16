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

/**
 * CLI: list remote models for each provider/baseUrl/API key referenced in evals.config.json.
 */

import {
  fetchAvailableModelIds,
  fetchGeminiModelIds,
  LMSTUDIO_DEFAULT_BASE_URL,
  loadEvalsModelEntries,
  VLLM_DEFAULT_BASE_URL,
  type EvalsModelEntry,
} from './config.js';

function resolveGeminiApiKey(entry: EvalsModelEntry): string | undefined {
  const fromEntry = entry.apiKey?.trim();
  if (fromEntry) return fromEntry;
  const fromGeminiEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromGeminiEnv) return fromGeminiEnv;
  return process.env.GOOGLE_API_KEY?.trim();
}

function openAiBaseForEntry(entry: EvalsModelEntry): string {
  if (entry.provider === 'lmstudio') {
    return entry.baseUrl ?? LMSTUDIO_DEFAULT_BASE_URL;
  }
  return entry.baseUrl ?? VLLM_DEFAULT_BASE_URL;
}

async function main(): Promise<void> {
  const showAllModelTypes = process.argv.includes('--all-model-types');
  const textLlmOnly = !showAllModelTypes;

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(
      `Usage: list-eval-models [--all-model-types]\n\n` +
        `  Default: list text/chat LLM candidates only (Gemini: generateContent + heuristic to drop\n` +
        `           image/TTS/video/music-style ids; OpenAI-compat: drop embedding-style ids).\n` +
        `  --all-model-types   List everything the APIs return (all generateContent Gemini models;\n` +
        `                      all ids from OpenAI-compat /v1/models).\n` +
        `  Legacy: --text-llm is accepted but ignored (same as default).\n`
    );
    return;
  }

  const entries = loadEvalsModelEntries();
  const byGeminiKey = new Map<string, string[]>();
  const byOpenAiBase = new Map<
    string,
    { providers: Set<'vllm' | 'lmstudio'>; entryIds: string[] }
  >();

  for (const e of entries) {
    if (e.provider === 'gemini') {
      const key = resolveGeminiApiKey(e);
      if (!key) {
        process.stderr.write(
          `[list-eval-models] Skipping gemini entry "${e.id}": set apiKey in config or GEMINI_API_KEY / GOOGLE_API_KEY in the environment.\n`
        );
        continue;
      }
      const ids = byGeminiKey.get(key) ?? [];
      ids.push(e.id);
      byGeminiKey.set(key, ids);
    } else if (e.provider === 'vllm' || e.provider === 'lmstudio') {
      const base = openAiBaseForEntry(e);
      const prev = byOpenAiBase.get(base) ?? {
        providers: new Set<'vllm' | 'lmstudio'>(),
        entryIds: [],
      };
      prev.providers.add(e.provider);
      prev.entryIds.push(e.id);
      byOpenAiBase.set(base, prev);
    }
  }

  let anyError = false;

  if (textLlmOnly) {
    process.stderr.write(
      '[list-eval-models] text/chat LLMs only by default (heuristic; see packages/zowe-mcp-evals/src/config.ts). Use --all-model-types for embeddings, image/TTS-style Gemini ids, etc.\n'
    );
  } else {
    process.stderr.write(
      '[list-eval-models] --all-model-types: listing all model ids from each API.\n'
    );
  }

  for (const [apiKey, entryIds] of byGeminiKey) {
    const label = entryIds.sort().join(', ');
    process.stdout.write(`\n=== gemini (eval entries: ${label}) ===\n`);
    try {
      const ids = await fetchGeminiModelIds(apiKey, { textLlmOnly });
      if (ids.length === 0) {
        process.stdout.write(
          textLlmOnly
            ? '(no text/chat LLM candidates matched)\n'
            : '(no models with generateContent)\n'
        );
      } else {
        for (const id of ids) {
          process.stdout.write(`${id}\n`);
        }
      }
    } catch (e) {
      anyError = true;
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Error: ${msg}\n`);
    }
  }

  for (const [baseUrl, meta] of [...byOpenAiBase.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const label = meta.entryIds.sort().join(', ');
    const provLabel = [...meta.providers].sort().join(' + ');
    process.stdout.write(
      `\n=== ${provLabel} — GET ${baseUrl.replace(/\/+$/, '')}/models (eval entries: ${label}) ===\n`
    );
    try {
      const ids = await fetchAvailableModelIds(baseUrl, { textLlmOnly });
      if (ids.length === 0) {
        process.stdout.write(
          textLlmOnly ? '(no text/chat LLM candidates matched)\n' : '(no models returned)\n'
        );
      } else {
        for (const id of ids.sort((a, b) => a.localeCompare(b))) {
          process.stdout.write(`${id}\n`);
        }
      }
    } catch (e) {
      anyError = true;
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Error: ${msg}\n`);
    }
  }

  if (entries.length === 0) {
    process.stderr.write('[list-eval-models] No model entries in evals config.\n');
    process.exitCode = 1;
    return;
  }

  if (byGeminiKey.size === 0 && byOpenAiBase.size === 0) {
    process.stderr.write(
      '[list-eval-models] No listable providers (add gemini with apiKey/env, or vllm/lmstudio with baseUrl).\n'
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\n');
  if (anyError) {
    process.exitCode = 1;
  }
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
