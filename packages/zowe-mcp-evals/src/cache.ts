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

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Assertion, ToolCallRecord } from './types.js';

/** Result shape stored in cache and returned by harness.runOne(). */
export interface CachedRunResult {
  finalText: string;
  toolCalls: ToolCallRecord[];
}

/** Payload used to build a stable cache key. */
export interface CacheKeyPayload {
  systemPrompt: string;
  prompt: string;
  toolDefs: Record<string, { description?: string; inputSchema?: unknown }>;
}

const KEY_LENGTH = 16;
const CACHE_FILE_SUFFIX = '.json';

/**
 * Returns unique tool names from assertions that reference a tool
 * (all assertion types except answerContains).
 */
export function getToolsUnderTest(assertions: Assertion[]): string[] {
  const names = new Set<string>();
  for (const a of assertions) {
    if (a.type === 'toolCallOrder') {
      for (const step of a.sequence) {
        if (step.tool) names.add(step.tool.trim());
      }
    } else if ('tool' in a && typeof (a as { tool?: string }).tool === 'string') {
      names.add((a as { tool: string }).tool.trim());
    }
  }
  return [...names].sort();
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    k => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k])
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Builds a short hex cache key from system prompt, question prompt, and tool definitions.
 * Same inputs always produce the same key; different prompt/systemPrompt/toolDefs produce different keys.
 */
export function buildCacheKey(payload: CacheKeyPayload): string {
  const json = canonicalJson({
    systemPrompt: payload.systemPrompt,
    prompt: payload.prompt,
    tools: payload.toolDefs,
  });
  const hash = createHash('sha256').update(json).digest('hex');
  return hash.slice(0, KEY_LENGTH);
}

/**
 * Reads a cached run result by key. Returns null if the file does not exist or is invalid.
 */
export async function get(cacheDir: string, key: string): Promise<CachedRunResult | null> {
  const path = join(cacheDir, key + CACHE_FILE_SUFFIX);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (
      !data ||
      typeof data !== 'object' ||
      typeof (data as CachedRunResult).finalText !== 'string' ||
      !Array.isArray((data as CachedRunResult).toolCalls)
    ) {
      return null;
    }
    const parsed = data as CachedRunResult;
    return {
      finalText: parsed.finalText,
      toolCalls: parsed.toolCalls,
    };
  } catch {
    return null;
  }
}

/**
 * Writes a run result to the cache. Creates cacheDir if it does not exist.
 */
export async function set(cacheDir: string, key: string, value: CachedRunResult): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, key + CACHE_FILE_SUFFIX);
  await writeFile(path, JSON.stringify(value), 'utf-8');
}
