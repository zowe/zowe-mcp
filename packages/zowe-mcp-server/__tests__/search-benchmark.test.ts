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
 * Search performance benchmark: ZNP tool.search vs list+read+grep fallback.
 *
 * Gated by ZOWE_MCP_SEARCH_BENCHMARK=1. Requires native-config.json and password.
 * Customize DSN/string with ZOWE_MCP_SEARCH_BENCHMARK_DSN (default SYS1.PARMLIB)
 * and ZOWE_MCP_SEARCH_BENCHMARK_STRING (default SYSTEM).
 *
 * Run: ZOWE_MCP_SEARCH_BENCHMARK=1 npx vitest run search-benchmark --testTimeout=300000
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConnectionSpec, toPasswordEnvVarName } from '../src/zos/native/connection-spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    const value = trimmed.slice(eq + 1).trim();
    const unquoted = /^['"](.*)['"]$/.exec(value);
    process.env[key] = unquoted ? unquoted[1] : value;
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(__dirname, '..', '..', '..', '.env'));

interface ToolContent {
  type: string;
  text: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

interface SearchEnvelope {
  data: {
    dataset: string;
    members: { name: string; matches: { lineNumber: number; content: string }[] }[];
    summary: {
      linesFound: number;
      linesProcessed: number;
      membersWithLines: number;
      membersWithoutLines: number;
    };
  };
  _result: {
    count: number;
    totalAvailable: number;
    hasMore: boolean;
    offset: number;
  };
}

// ---------------------------------------------------------------------------
// Config and skip conditions
// ---------------------------------------------------------------------------

const benchmarkEnabled =
  process.env.ZOWE_MCP_SEARCH_BENCHMARK === '1' ||
  process.env.ZOWE_MCP_SEARCH_BENCHMARK === 'true';

const CONFIG_NAMES = ['native-config.json', '../../native-config.json'] as const;

function findConfigPath(): string | undefined {
  const cwd = process.cwd();
  for (const name of CONFIG_NAMES) {
    const p = resolve(cwd, name);
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

const configPath = findConfigPath();
const configSystems = configPath
  ? ((JSON.parse(readFileSync(configPath, 'utf-8')) as { systems?: string[] }).systems ?? [])
  : [];
const firstSpec = configSystems.length > 0 ? parseConnectionSpec(configSystems[0]) : undefined;
const passwordEnvVar = firstSpec ? toPasswordEnvVarName(firstSpec.user, firstSpec.host) : '';
const password =
  (passwordEnvVar && process.env[passwordEnvVar]) || process.env.ZOS_PASSWORD || undefined;

const SEARCH_DSN = process.env.ZOWE_MCP_SEARCH_BENCHMARK_DSN ?? 'SYS1.PARMLIB';
const SEARCH_STRING = process.env.ZOWE_MCP_SEARCH_BENCHMARK_STRING ?? 'SYSTEM';

const skipReason = !benchmarkEnabled
  ? 'ZOWE_MCP_SEARCH_BENCHMARK not set'
  : !configPath
    ? 'native-config.json not found'
    : !password
      ? 'password not found'
      : undefined;

// ---------------------------------------------------------------------------
// Benchmark helpers
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  path: string;
  wallClockMs: number;
  linesFound: number;
  linesProcessed: number;
  membersWithLines: number;
  membersWithoutLines: number;
  totalMembers: number;
  pages: number;
}

async function startServer(
  env: Record<string, string>
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath, '--native', '--config', configPath!, '--native-response-timeout', '180'],
    env: { ...process.env, ...env },
  });
  const client = new Client({ name: 'search-benchmark', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function runSearch(client: Client): Promise<BenchmarkResult & { path: string }> {
  const start = performance.now();
  let offset = 0;
  const limit = 500;
  let totalMembers = 0;
  let pages = 0;
  let summary: SearchEnvelope['data']['summary'] | undefined;

  while (true) {
    const result = await client.callTool(
      {
        name: 'searchInDataset',
        arguments: { dsn: SEARCH_DSN, string: SEARCH_STRING, offset, limit },
      },
      undefined,
      { timeout: 600_000 }
    );
    if (result.isError === true) {
      throw new Error(`searchInDataset returned error: ${getResultText(result)}`);
    }
    const envelope = JSON.parse(getResultText(result)) as SearchEnvelope;
    totalMembers += envelope.data.members.length;
    pages++;
    summary = envelope.data.summary;

    if (!envelope._result.hasMore) break;
    offset = envelope._result.offset + envelope._result.count;
  }

  const wallClockMs = Math.round(performance.now() - start);
  return {
    path: '',
    wallClockMs,
    linesFound: summary?.linesFound ?? 0,
    linesProcessed: summary?.linesProcessed ?? 0,
    membersWithLines: summary?.membersWithLines ?? 0,
    membersWithoutLines: summary?.membersWithoutLines ?? 0,
    totalMembers,
    pages,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skipReason !== undefined)('Search Benchmark', () => {
  if (skipReason) {
    it(`skipped: ${skipReason}`, () => {});
    return;
  }

  const results: BenchmarkResult[] = [];

  it('ZNP tool.search (default path)', async () => {
    const { client, transport } = await startServer({});
    try {
      const r = await runSearch(client);
      r.path = 'ZNP tool.search';
      results.push(r);
      expect(r.linesFound).toBeGreaterThan(0);
    } finally {
      await client.close();
      await transport.close();
    }
  }, 300_000);

  it('Fallback (list+read+grep)', async () => {
    const { client, transport } = await startServer({
      ZOWE_MCP_SEARCH_FORCE_FALLBACK: '1',
    });
    try {
      const r = await runSearch(client);
      r.path = 'Fallback (list+read+grep)';
      results.push(r);
      expect(r.linesFound).toBeGreaterThan(0);
    } finally {
      await client.close();
      await transport.close();
    }
  }, 300_000);

  afterAll(() => {
    if (results.length < 2) return;

    const [znp, fallback] = results;
    const speedup =
      fallback.wallClockMs > 0 ? (fallback.wallClockMs / znp.wallClockMs).toFixed(2) : 'N/A';

    const md = [
      '# Search Benchmark Results',
      '',
      `**Date**: ${new Date().toISOString().slice(0, 10)}`,
      `**DSN**: ${SEARCH_DSN}`,
      `**Search string**: "${SEARCH_STRING}"`,
      `**System**: ${firstSpec?.host ?? 'unknown'}`,
      '',
      '## Results',
      '',
      '| Metric | ZNP tool.search | Fallback (list+read+grep) |',
      '| --- | --- | --- |',
      `| Wall-clock time | ${znp.wallClockMs} ms | ${fallback.wallClockMs} ms |`,
      `| Lines found | ${znp.linesFound} | ${fallback.linesFound} |`,
      `| Lines processed | ${znp.linesProcessed} | ${fallback.linesProcessed} |`,
      `| Members with matches | ${znp.membersWithLines} | ${fallback.membersWithLines} |`,
      `| Members without matches | ${znp.membersWithoutLines} | ${fallback.membersWithoutLines} |`,
      `| Total members returned | ${znp.totalMembers} | ${fallback.totalMembers} |`,
      `| Pages fetched | ${znp.pages} | ${fallback.pages} |`,
      '',
      '## Summary',
      '',
      `ZNP tool.search completed in **${znp.wallClockMs} ms** vs fallback in **${fallback.wallClockMs} ms** (**${speedup}x** speedup).`,
      '',
      'ZNP tool.search runs SuperC on z/OS in a single RPC call, while the fallback lists all members, reads each one over SSH, and greps in-process.',
      '',
    ].join('\n');

    const docsDir = resolve(__dirname, '..', '..', '..', 'docs');
    const outPath = resolve(docsDir, 'search-benchmark-results.md');
    try {
      writeFileSync(outPath, md, 'utf-8');
      console.log(`Benchmark results written to ${outPath}`);
    } catch {
      console.log('Could not write benchmark results file; printing to console:');
      console.log(md);
    }
  });
});
