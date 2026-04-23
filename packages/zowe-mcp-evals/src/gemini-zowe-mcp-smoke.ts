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
 * Opt-in automated smoke: **Google Gemini** (API) + **Zowe MCP server** over stdio with **mock** data.
 *
 * This exercises the same MCP tools and prompt style as manual Copilot Chat + Zowe ([manual QA 04/05](../../docs/manual-qa/04-copilot-tools-picker.md))
 * but does **not** launch VS Code or GitHub Copilot Chat (those require interactive sign-in and BYOK in Manage Models).
 *
 * Requires: `GEMINI_API_KEY`, built `@zowe/mcp-server` (`dist/index.js`), network to Google AI.
 */

import dotenv from 'dotenv';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalsConfig } from './config.js';
import { getConfigDir } from './config.js';
import { initMockData, McpEvalHarness } from './harness.js';
import type { SetConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_PATH = resolve(__dirname, '..', '..', 'zowe-mcp-server', 'dist', 'index.js');

/** Match `evals.config.example.json` gemini entry; preview IDs may be retired from generateContent. */
const DEFAULT_MODEL = 'gemini-2.5-flash';
/** Narrow pattern so the model does not ask for an HLQ; pairs with `activeTools: ['listDatasets']` in runOne. */
const DEFAULT_PROMPT = 'List data sets matching USER.**';

function loadEnv(): void {
  const dir = getConfigDir();
  for (const name of ['.env', '.env.local']) {
    const p = resolve(dir, name);
    if (existsSync(p)) {
      dotenv.config({ path: p });
    }
  }
}

function getApiKey(): string {
  const k = process.env.GEMINI_API_KEY?.trim() ?? process.env.GOOGLE_API_KEY?.trim();
  if (!k) {
    console.error(
      'Set GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment or in .env at the repo root.'
    );
    process.exit(1);
  }
  return k;
}

function envStringOrDefault(key: string, defaultValue: string): string {
  const v = process.env[key]?.trim();
  if (v === undefined || v === '') return defaultValue;
  return v;
}

async function main(): Promise<void> {
  console.error(
    'smoke:gemini-zowe-mcp — Gemini API + Zowe MCP (stdio, mock). Not VS Code Copilot Chat.\n'
  );
  loadEnv();
  const apiKey = getApiKey();

  if (!existsSync(SERVER_PATH)) {
    console.error(`MCP server not built: ${SERVER_PATH}\nRun: npm run build -w @zowe/mcp-server`);
    process.exit(1);
  }

  const serverModel = envStringOrDefault('GEMINI_ZOWE_MCP_SMOKE_MODEL', DEFAULT_MODEL);
  const prompt = envStringOrDefault('GEMINI_ZOWE_MCP_SMOKE_PROMPT', DEFAULT_PROMPT);

  const evalsConfig: EvalsConfig = {
    provider: 'gemini',
    serverModel,
    apiKey,
    modelId: 'gemini-zowe-mcp-smoke',
  };

  const setConfig: SetConfig = {
    name: 'gemini-zowe-mcp-smoke',
    mock: { initArgs: '--preset minimal' },
  };

  console.error('Initializing mock data (preset minimal)…');
  const mockDir = initMockData(SERVER_PATH, '--preset minimal');
  const harness = new McpEvalHarness({
    serverPath: SERVER_PATH,
    evalsConfig,
    setConfig,
    mockDir,
  });

  try {
    console.error('Connecting MCP client (stdio)…');
    await harness.start();
    console.error(`Prompt: ${JSON.stringify(prompt)}`);
    console.error(`Model: ${serverModel}`);
    const result = await harness.runOne(prompt, {
      activeTools: ['listDatasets'],
    });

    console.error('\n--- Tool calls ---');
    for (const tc of result.toolCalls) {
      console.error(`  ${tc.name} ${JSON.stringify(tc.arguments)}`);
    }
    console.error('\n--- Model answer (excerpt) ---');
    const text = result.finalText.trim();
    const excerpt = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
    console.log(excerpt);

    if (!result.toolCalls.some(t => t.name === 'listDatasets')) {
      console.error(
        '\nSmoke failed: expected a listDatasets tool call. Got:',
        result.toolCalls.map(t => t.name).join(', ') || '(none)'
      );
      process.exit(2);
    }
    console.error('\nSmoke OK (Gemini invoked listDatasets on Zowe MCP).');
  } finally {
    await harness.stop();
    try {
      rmSync(mockDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
