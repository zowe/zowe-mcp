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
 * Opt-in automated smoke: the real **Claude Code CLI** (`claude -p --output-format
 * stream-json`) + **Zowe MCP server** over stdio with **mock** data.
 *
 * Unlike the AI-SDK-based harness (`src/harness.ts`, used by `npm run evals`), this
 * drives the actual `claude` CLI client — its real system prompt, its real
 * tool-orchestration loop, its real MCP client implementation — for end-to-end
 * fidelity. Intended for pre-release/nightly runs, not per-commit (hits the real
 * Anthropic API and costs real money).
 *
 * Requires: `claude` CLI installed and authenticated, built `@zowe/mcp-server`
 * (`dist/index.js`).
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAndRecord } from './evals-utils.js';
import { initMockData } from './harness.js';
import { loadSet } from './load-questions.js';
import type {
  AssertionBlock,
  AssertionItem,
  Question,
  QuestionSet,
  ToolCallRecord,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_PATH = resolve(__dirname, '..', '..', 'zowe-mcp-server', 'dist', 'index.js');

const PER_CASE_TIMEOUT_MS = 240_000;
const MCP_TOOL_PREFIX = 'mcp__zowe__';

/** The exactly-13-case suite. `set:id` must match a real question in the referenced set. */
const SMOKE_CASES: { set: string; id: string }[] = [
  { set: 'datasets', id: 'list-datasets-user' },
  { set: 'datasets', id: 'list-members-src-cobol' },
  { set: 'datasets', id: 'read-member-summarize' },
  { set: 'search', id: 'search-in-pds' },
  { set: 'context', id: 'get-context-after-list' },
  { set: 'uss', id: 'uss-list-home' },
  { set: 'tso', id: 'tso-who' },
  { set: 'system', id: 'list-apf-authorized' },
  { set: 'natural-language', id: 'nl-what-do-i-have' },
  { set: 'mutations', id: 'write-temp-then-read' },
  { set: 'safety', id: 'refuse-change-password' },
  { set: 'safety', id: 'refuse-mass-delete-prefix' },
  { set: 'prompt-injection', id: 'dataset-member-delete-instruction' },
];

interface LoadedCase {
  set: string;
  id: string;
  question: Question;
  setConfig: QuestionSet['config'];
}

/** Recursively walk an AssertionItem tree (leaf | allOf | anyOf) and check every leaf's type. */
function assertionBlockHasAnswerJudge(block: AssertionBlock): boolean {
  return block.items.some(itemHasAnswerJudge);
}

function itemHasAnswerJudge(item: AssertionItem): boolean {
  if ('allOf' in item) return item.allOf.some(itemHasAnswerJudge);
  if ('anyOf' in item) return item.anyOf.some(itemHasAnswerJudge);
  return item.type === 'answerJudge';
}

/**
 * Load and validate every referenced set/question once. Collects ALL problems (does
 * not stop at the first) so a YAML rename or removed case breaks loudly with full
 * detail. Exits the process with code 1 on any problem.
 */
function loadAndValidateCases(cases: { set: string; id: string }[]): LoadedCase[] {
  const setNames = [...new Set(cases.map(c => c.set))];
  const loadedSets = new Map<string, QuestionSet | Error>();
  for (const name of setNames) {
    try {
      loadedSets.set(name, loadSet(name));
    } catch (e) {
      loadedSets.set(name, e instanceof Error ? e : new Error(String(e)));
    }
  }

  const problems: string[] = [];
  const result: LoadedCase[] = [];
  for (const c of cases) {
    const label = `${c.set}:${c.id}`;
    const loaded = loadedSets.get(c.set);
    if (loaded === undefined) {
      problems.push(`${label}: set "${c.set}" was not loaded`);
      continue;
    }
    if (loaded instanceof Error) {
      problems.push(`${label}: set "${c.set}" failed to load: ${loaded.message}`);
      continue;
    }
    const question = loaded.questions.find(q => q.id === c.id);
    if (!question) {
      problems.push(`${label}: question id "${c.id}" not found in set "${c.set}"`);
      continue;
    }
    if (question.turns) {
      problems.push(`${label}: question has "turns" (multi-turn) — unsupported in v1`);
      continue;
    }
    if (question.skip) {
      problems.push(`${label}: question has "skip" set (${question.skip})`);
      continue;
    }
    if (assertionBlockHasAnswerJudge(question.assertionBlock)) {
      problems.push(`${label}: question's assertionBlock contains an answerJudge assertion`);
      continue;
    }
    result.push({ set: c.set, id: c.id, question, setConfig: loaded.config });
  }

  if (problems.length > 0) {
    console.error(
      `${problems.length} smoke case ${problems.length === 1 ? 'problem' : 'problems'} found:\n\n` +
        problems.map(p => `  - ${p}`).join('\n')
    );
    process.exit(1);
  }
  return result;
}

function runClaudeVersion() {
  return spawnSync('claude', ['--version'], { encoding: 'utf-8' });
}

/** Preflight: `claude` CLI resolvable and authenticated-enough to at least print a version. */
function preflightClaudeCli(): void {
  let result: ReturnType<typeof runClaudeVersion>;
  try {
    result = runClaudeVersion();
  } catch (e) {
    console.error(
      `Could not spawn the "claude" CLI: ${e instanceof Error ? e.message : String(e)}\n` +
        'Install and authenticate the Claude Code CLI: https://docs.claude.com/en/docs/claude-code'
    );
    process.exit(1);
  }
  if (result.error || result.status !== 0 || !(result.stdout ?? '').trim()) {
    console.error(
      `"claude --version" did not succeed (status=${String(result.status)}).\n` +
        'Install and authenticate the Claude Code CLI: https://docs.claude.com/en/docs/claude-code'
    );
    process.exit(1);
  }
  console.error(`claude CLI: ${result.stdout.trim()}`);
}

function preflightServerBuilt(): void {
  if (!existsSync(SERVER_PATH)) {
    console.error(`MCP server not built: ${SERVER_PATH}\nRun: npm run build -w @zowe/mcp-server`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// stream-json parsing
// ---------------------------------------------------------------------------

/** Minimal shape of an `assistant` event line from `claude --output-format stream-json`. */
interface ClaudeAssistantEvent {
  type: 'assistant';
  message?: {
    content?: {
      type: string;
      name?: string;
      input?: Record<string, unknown>;
    }[];
  };
}

/** Minimal shape of a `result` event line from `claude --output-format stream-json`. */
interface ClaudeResultEvent {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
}

type ClaudeStreamEvent = ClaudeAssistantEvent | ClaudeResultEvent | { type: string };

export interface ParsedClaudeStream {
  toolCalls: ToolCallRecord[];
  finalText: string;
  costUsd?: number;
  isError: boolean;
  resultSubtype?: string;
}

/**
 * Parse `claude -p --output-format stream-json` stdout into tool calls + final result.
 * Pure function (no I/O) so it is unit-testable. Unparseable lines are skipped silently.
 * When no `result` event is present, `isError` defaults to `true` (a run that never
 * completed is not a normal success).
 */
export function parseClaudeStreamJson(stdout: string): ParsedClaudeStream {
  const toolCalls: ToolCallRecord[] = [];
  let finalText = '';
  let costUsd: number | undefined;
  let isError = true;
  let resultSubtype: string | undefined;
  let sawResult = false;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: ClaudeStreamEvent;
    try {
      obj = JSON.parse(trimmed) as ClaudeStreamEvent;
    } catch {
      continue;
    }

    if (obj.type === 'assistant') {
      const content = (obj as ClaudeAssistantEvent).message?.content ?? [];
      for (const item of content) {
        if (item.type !== 'tool_use') continue;
        const name = item.name ?? '';
        if (!name.startsWith(MCP_TOOL_PREFIX)) continue;
        toolCalls.push({
          name: name.slice(MCP_TOOL_PREFIX.length),
          arguments: item.input ?? {},
        });
      }
    } else if (obj.type === 'result') {
      const r = obj as ClaudeResultEvent;
      sawResult = true;
      finalText = r.result ?? '';
      costUsd = r.total_cost_usd;
      isError = r.is_error === true;
      resultSubtype = r.subtype;
    }
  }

  if (!sawResult) {
    return { toolCalls, finalText: '', isError: true };
  }
  return { toolCalls, finalText, costUsd, isError, resultSubtype };
}

// ---------------------------------------------------------------------------
// Per-case run
// ---------------------------------------------------------------------------

interface SpawnClaudeResult {
  stdout: string;
  stderr: string;
  spawnError?: string;
  timedOut: boolean;
}

/** Spawn `claude -p ...` for one case, capturing stdout/stderr, enforcing a hard timeout. */
async function spawnClaudeCase(options: {
  prompt: string;
  mcpConfigPath: string;
  cwd: string;
  model: string;
}): Promise<SpawnClaudeResult> {
  const args = [
    '-p',
    options.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    options.mcpConfigPath,
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--allowedTools',
    'mcp__zowe',
    '--model',
    options.model,
  ];

  return new Promise<SpawnClaudeResult>(promiseResolve => {
    let child: ChildProcess;
    try {
      child = spawn('claude', args, {
        cwd: options.cwd,
        env: process.env,
        detached: process.platform !== 'win32',
      });
    } catch (e) {
      promiseResolve({
        stdout: '',
        stderr: '',
        spawnError: e instanceof Error ? e.message : String(e),
        timedOut: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
      promiseResolve({ stdout, stderr, timedOut: true });
    }, PER_CASE_TIMEOUT_MS);

    child.on('error', e => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      promiseResolve({ stdout, stderr, spawnError: e.message, timedOut: false });
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      promiseResolve({ stdout, stderr, timedOut: false });
    });
  });
}

interface AttemptOutcome {
  passed: boolean;
  reason?: string;
  toolCalls: ToolCallRecord[];
  finalText: string;
  costUsd?: number;
}

async function runOneAttempt(options: {
  loaded: LoadedCase;
  mcpConfigPath: string;
  model: string;
}): Promise<AttemptOutcome> {
  const cwd = mkdtempSync(resolve(tmpdir(), 'zowe-mcp-claude-smoke-cwd-'));
  try {
    const { question } = options.loaded;
    const spawnResult = await spawnClaudeCase({
      prompt: question.prompt,
      mcpConfigPath: options.mcpConfigPath,
      cwd,
      model: options.model,
    });

    if (spawnResult.spawnError) {
      return {
        passed: false,
        reason: `spawn error: ${spawnResult.spawnError}`,
        toolCalls: [],
        finalText: '',
      };
    }
    if (spawnResult.timedOut) {
      return {
        passed: false,
        reason: `timed out after ${String(PER_CASE_TIMEOUT_MS)}ms`,
        toolCalls: [],
        finalText: '',
      };
    }

    const parsed = parseClaudeStreamJson(spawnResult.stdout);
    if (parsed.isError) {
      const stderrExcerpt = spawnResult.stderr.trim().slice(0, 500);
      return {
        passed: false,
        reason: `claude reported an error (subtype=${parsed.resultSubtype ?? 'unknown'})${
          stderrExcerpt ? `: ${stderrExcerpt}` : ''
        }`,
        toolCalls: parsed.toolCalls,
        finalText: parsed.finalText,
        costUsd: parsed.costUsd,
      };
    }

    const runResult = await assertAndRecord({
      questionId: question.id,
      prompt: question.prompt,
      runIndex: 0,
      finalText: parsed.finalText,
      toolCalls: parsed.toolCalls,
      assertionBlock: question.assertionBlock,
    });

    return {
      passed: runResult.passed,
      reason: runResult.assertionFailed,
      toolCalls: parsed.toolCalls,
      finalText: parsed.finalText,
      costUsd: parsed.costUsd,
    };
  } finally {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

interface CaseResult {
  set: string;
  id: string;
  passed: boolean;
  attempts: { attemptNumber: number; passed: boolean; reason?: string }[];
  totalCostUsd: number;
}

function excerpt(text: string, max = 200): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function runCase(options: {
  loaded: LoadedCase;
  mcpConfigPath: string;
  model: string;
  extraRetries: number;
}): Promise<CaseResult> {
  const label = `${options.loaded.set}:${options.loaded.id}`;
  const totalAttempts = 1 + options.extraRetries;
  const attempts: CaseResult['attempts'] = [];
  let totalCostUsd = 0;
  let passed = false;

  for (let attemptNumber = 1; attemptNumber <= totalAttempts; attemptNumber++) {
    console.error(`[${label}] attempt ${String(attemptNumber)}/${String(totalAttempts)}…`);
    const outcome = await runOneAttempt({
      loaded: options.loaded,
      mcpConfigPath: options.mcpConfigPath,
      model: options.model,
    });
    totalCostUsd += outcome.costUsd ?? 0;
    attempts.push({ attemptNumber, passed: outcome.passed, reason: outcome.reason });

    const toolNames = outcome.toolCalls.map(t => t.name).join(', ') || '(none)';
    console.error(
      `[${label}] attempt ${String(attemptNumber)}: ${outcome.passed ? 'PASS' : 'FAIL'}` +
        (outcome.reason ? ` — ${outcome.reason}` : '') +
        `\n  tool calls: ${toolNames}\n  answer: ${excerpt(outcome.finalText)}`
    );

    if (outcome.passed) {
      passed = true;
      break;
    }
  }

  return { set: options.loaded.set, id: options.loaded.id, passed, attempts, totalCostUsd };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/** Same pattern as gemini-zowe-mcp-smoke.ts: empty/unset env var falls back to `defaultValue`. */
function envStringOrDefault(key: string, defaultValue: string): string {
  const v = process.env[key]?.trim();
  if (v === undefined || v === '') return defaultValue;
  return v;
}

function parseCaseFilter(): { set: string; id: string }[] | undefined {
  const raw = process.env.ZOWE_CLAUDE_SMOKE_CASES?.trim();
  if (!raw) return undefined;
  const wanted = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const idx = entry.indexOf(':');
      if (idx === -1) {
        console.error(`ZOWE_CLAUDE_SMOKE_CASES entry "${entry}" is not in "set:id" form.`);
        process.exit(1);
      }
      return { set: entry.slice(0, idx), id: entry.slice(idx + 1) };
    });
  for (const w of wanted) {
    if (!SMOKE_CASES.some(c => c.set === w.set && c.id === w.id)) {
      console.error(
        `ZOWE_CLAUDE_SMOKE_CASES entry "${w.set}:${w.id}" does not match any known SMOKE_CASES entry.`
      );
      process.exit(1);
    }
  }
  return wanted;
}

async function main(): Promise<void> {
  console.error(
    'smoke:claude-code — real `claude` CLI + Zowe MCP (stdio, mock). Pre-release/nightly, not per-commit.\n'
  );

  preflightClaudeCli();
  preflightServerBuilt();

  const filter = parseCaseFilter();
  const casesToLoad = filter ?? SMOKE_CASES;
  const loadedCases = loadAndValidateCases(casesToLoad);
  const casesToRun = filter
    ? loadedCases
    : loadedCases.filter(c => SMOKE_CASES.some(sc => sc.set === c.set && sc.id === c.id));

  const model = envStringOrDefault('ZOWE_CLAUDE_SMOKE_MODEL', 'sonnet');
  const extraRetries = (() => {
    const raw = process.env.ZOWE_CLAUDE_SMOKE_RETRIES?.trim();
    if (raw === undefined || raw === '') return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  })();

  console.error(
    `Running ${String(casesToRun.length)} case(s), model=${model}, extra retries=${String(extraRetries)}`
  );

  const mockDirs: string[] = [];
  const mcpConfigPaths: string[] = [];
  const results: CaseResult[] = [];
  const wallStart = Date.now();

  try {
    // Group by set: one mock init + one mcp-config file per distinct set.
    const bySet = new Map<string, LoadedCase[]>();
    for (const c of casesToRun) {
      const arr = bySet.get(c.set) ?? [];
      arr.push(c);
      bySet.set(c.set, arr);
    }

    for (const [setName, casesInSet] of bySet) {
      const mockConfig = casesInSet[0].setConfig.mock;
      if (!mockConfig) {
        console.error(`Set "${setName}" has no config.mock — cannot init mock data. Aborting.`);
        process.exit(1);
      }
      console.error(`[${setName}] initializing mock data (${mockConfig.initArgs})…`);
      const mockDir = initMockData(SERVER_PATH, mockConfig.initArgs);
      mockDirs.push(mockDir);

      const capabilityTier = mockConfig.capabilityTier ?? 'full';
      const mcpConfig = {
        mcpServers: {
          zowe: {
            type: 'stdio',
            command: process.execPath,
            args: [SERVER_PATH, '--stdio', '--mock', mockDir, '--capability-tier', capabilityTier],
          },
        },
      };
      const mcpConfigPath = resolve(
        mkdtempSync(resolve(tmpdir(), 'zowe-mcp-claude-smoke-cfg-')),
        'mcp-config.json'
      );
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      mcpConfigPaths.push(mcpConfigPath);

      for (const loaded of casesInSet) {
        const result = await runCase({ loaded, mcpConfigPath, model, extraRetries });
        results.push(result);
      }
    }
  } finally {
    for (const dir of mockDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    for (const cfgPath of mcpConfigPaths) {
      try {
        rmSync(dirname(cfgPath), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  const wallMs = Date.now() - wallStart;
  const totalCostUsd = results.reduce((sum, r) => sum + r.totalCostUsd, 0);
  const passedCount = results.filter(r => r.passed).length;

  console.error('\n--- Summary ---');
  for (const r of results) {
    const label = `${r.set}:${r.id}`;
    if (r.passed) {
      console.error(`  PASS  ${label}`);
    } else {
      const failedAttempts = r.attempts
        .filter(a => !a.passed)
        .map(a => `attempt ${String(a.attemptNumber)}: ${a.reason ?? 'unknown failure'}`)
        .join('; ');
      console.error(`  FAIL  ${label} — ${failedAttempts}`);
    }
  }
  console.error(
    `\n${String(passedCount)}/${String(results.length)} cases passed. ` +
      `Total cost: $${totalCostUsd.toFixed(4)}. Wall time: ${(wallMs / 1000).toFixed(1)}s.`
  );

  process.exit(passedCount === results.length ? 0 : 2);
}

// Only run the live suite when this file is executed directly (e.g. `node dist/claude-code-smoke.js`),
// never as a side effect of another module importing it — notably the vitest unit tests import
// `parseClaudeStreamJson` from this file and must NOT trigger preflight/mock-init/real-`claude`-CLI
// execution merely by doing so.
const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === `file://${resolve(entry)}`;
})();

if (isMainModule) {
  main().catch(e => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  });
}
