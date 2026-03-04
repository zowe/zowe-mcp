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
 * eval-compare: Run evals across one or more models/settings, produce comparison
 * reports, and auto-update docs/eval-scoreboard.md.
 *
 * Usage:
 *   npm run eval-compare -- --set naming-stress --label "baseline"
 *   npm run eval-compare -- --set naming-stress --model vllm-local,gemini-2.5-flash --label "baseline"
 *   npm run eval-compare -- --set naming-stress --model all --label "after-rename"
 *   npm run eval-compare -- --set naming-stress --repetitions 20 --label "high-rep"
 *   npm run eval-compare -- --set naming-stress --system-prompt-addition "Prefer searchInDataset." --label "prompt-hint"
 */

import dotenv from 'dotenv';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAssertions } from './assertions.js';
import { getConfigDir, loadEvalsConfig, type EvalsConfig } from './config.js';
import { initMockData, McpEvalHarness } from './harness.js';
import { listSetNames, loadAndValidateAllSets } from './load-questions.js';
import { log } from './log.js';
import { plural } from './plural.js';
import { writeReport } from './report.js';
import type { QuestionSet, RunResult, SetConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '..', '..', 'zowe-mcp-server', 'dist', 'index.js');
const SCOREBOARD_PATH = resolve(__dirname, '..', '..', '..', 'docs', 'eval-scoreboard.md');

const PASS = '\u2713';
const FAIL = '\u2717';

interface CliArgs {
  set: string[];
  model: string[];
  label: string;
  repetitions?: number;
  systemPromptAddition?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { set: [], model: [], label: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set' && i + 1 < args.length) {
      result.set = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--model' && i + 1 < args.length) {
      result.model = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--label' && i + 1 < args.length) {
      result.label = args[++i];
    } else if (args[i] === '--repetitions' && i + 1 < args.length) {
      result.repetitions = parseInt(args[++i], 10);
    } else if (args[i] === '--system-prompt-addition' && i + 1 < args.length) {
      result.systemPromptAddition = args[++i];
    }
  }
  if (result.set.length === 0) result.set = ['all'];
  if (!result.label) {
    result.label = `run-${new Date().toISOString().slice(0, 10)}`;
  }
  return result;
}

function resolveNativeServerArgs(serverArgs: string): string {
  const tokens = serverArgs.trim().split(/\s+/).filter(Boolean);
  const idx = tokens.indexOf('--config');
  if (idx !== -1 && idx + 1 < tokens.length) {
    const configPath = tokens[idx + 1];
    if (!isAbsolute(configPath)) {
      tokens[idx + 1] = resolve(getConfigDir(), configPath);
    }
  }
  return tokens.join(' ');
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const apiErr = err as unknown as Record<string, unknown>;
  if (typeof apiErr.statusCode === 'number')
    parts.push(`statusCode: ${apiErr.statusCode.toString()}`);
  if (typeof apiErr.responseBody === 'string' && apiErr.responseBody.length > 0) {
    parts.push(`responseBody: ${apiErr.responseBody.slice(0, 2000)}`);
  }
  if (apiErr.cause instanceof Error) parts.push(`cause: ${apiErr.cause.message}`);
  return parts.join('\n  ');
}

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getDiffHash(): string {
  try {
    const diff = execSync('git diff HEAD', { encoding: 'utf-8' });
    if (!diff.trim()) return '';
    const hash = execSync('git diff HEAD | shasum -a 256 | cut -c1-8', {
      encoding: 'utf-8',
    }).trim();
    return hash;
  } catch {
    return '';
  }
}

function getAvailableModelIds(): string[] {
  const configDir = getConfigDir();
  const configNames = ['evals.config.json', 'evals.config.local.json'];
  for (const name of configNames) {
    const p = resolve(configDir, name);
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
      const models = raw.models;
      if (Array.isArray(models)) {
        return models.map((m: unknown, idx: number) => {
          const o = m as Record<string, unknown>;
          return (o.id as string) ?? `model-${idx}`;
        });
      }
      return ['default'];
    }
  }
  return ['default'];
}

interface SetRunResult {
  setName: string;
  modelId: string;
  serverModel: string;
  results: RunResult[];
  questionCount: number;
}

async function runSetForModel(
  setName: string,
  questionSet: QuestionSet,
  evalsConfig: EvalsConfig,
  cli: CliArgs
): Promise<SetRunResult> {
  const config = questionSet.config;
  const questions = questionSet.questions.filter(q => !q.skip);
  const repetitions = cli.repetitions ?? config.repetitions ?? 5;

  const effectiveConfig: SetConfig = { ...config };
  if (cli.systemPromptAddition) {
    const base = effectiveConfig.systemPromptAddition ?? '';
    effectiveConfig.systemPromptAddition = base
      ? base + '\n\n' + cli.systemPromptAddition
      : cli.systemPromptAddition;
  }

  let mockDir: string | undefined;
  if (config.mock?.initArgs != null) {
    mockDir = initMockData(SERVER_PATH, config.mock.initArgs);
  }
  const rawNativeArgs = config.native?.serverArgs;
  const nativeServerArgs =
    rawNativeArgs != null ? resolveNativeServerArgs(rawNativeArgs) : undefined;

  const harness = new McpEvalHarness({
    serverPath: SERVER_PATH,
    evalsConfig,
    setConfig: effectiveConfig,
    mockDir,
    nativeServerArgs,
  });

  const allResults: RunResult[] = [];

  try {
    await harness.start();

    for (const q of questions) {
      for (let r = 0; r < repetitions; r++) {
        try {
          const runResult = await harness.runOne(q.prompt);
          const { finalText, toolCalls } = runResult;
          const { passed, failedAssertion } = runAssertions(
            q.assertionBlock,
            toolCalls,
            finalText
          );
          const result: RunResult = {
            questionId: q.id,
            prompt: q.prompt,
            runIndex: r,
            passed,
            toolCalls,
            finalText,
            assertionFailed: failedAssertion,
          };
          allResults.push(result);
          const icon = passed ? PASS : FAIL;
          const detail = passed ? '' : ` ${failedAssertion ?? 'assertion failed'}`;
          const msg = `[${evalsConfig.modelId ?? 'default'}] ${q.id} (${r + 1}/${repetitions}) ${icon}${detail}`;
          if (passed) log.pass(msg);
          else log.fail(msg);
        } catch (err) {
          const msg = errorMessage(err);
          allResults.push({
            questionId: q.id,
            prompt: q.prompt,
            runIndex: r,
            passed: false,
            toolCalls: [],
            finalText: '',
            error: msg,
          });
          log.fail(
            `[${evalsConfig.modelId ?? 'default'}] ${q.id} (${r + 1}/${repetitions}) ${FAIL} ${msg}`
          );
        }
      }
    }
  } finally {
    await harness.stop();
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
  }

  return {
    setName,
    modelId: evalsConfig.modelId ?? 'default',
    serverModel: evalsConfig.serverModel,
    results: allResults,
    questionCount: questions.length,
  };
}

interface ScoreboardRow {
  date: string;
  label: string;
  model: string;
  serverModel: string;
  set: string;
  questions: number;
  passRate: string;
  passed: number;
  total: number;
  gitSha: string;
  diffHash: string;
  settings: string;
}

function parseScoreboard(content: string): ScoreboardRow[] {
  const rows: ScoreboardRow[] = [];
  const lines = content.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('| Date')) {
      inTable = true;
      continue;
    }
    if (line.startsWith('|---')) continue;
    if (inTable && line.startsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map(c => c.trim());
      if (cells.length >= 9) {
        rows.push({
          date: cells[0],
          label: cells[1],
          model: cells[2],
          serverModel: cells[3] ?? '',
          set: cells[4] ?? cells[3],
          questions: parseInt(cells[5] ?? cells[4], 10),
          passRate: cells[6] ?? cells[5],
          passed: parseInt(cells[7] ?? cells[6], 10),
          total: parseInt(cells[8] ?? cells[7], 10),
          gitSha: cells[9] ?? cells[8],
          diffHash: cells[10] ?? '',
          settings: cells[11] ?? '',
        });
      }
    } else if (inTable && !line.startsWith('|')) {
      inTable = false;
    }
  }
  return rows;
}

function formatScoreboard(rows: ScoreboardRow[]): string {
  const header = [
    '# Eval Scoreboard',
    '',
    'Automatically updated by `npm run eval-compare`.',
    '',
    '## Results',
    '',
    '| Date | Label | Model | Server Model | Set | Questions | Pass Rate | Passed | Total | Git SHA | Diff Hash | Settings |',
    '|------|-------|-------|--------------|-----|-----------|-----------|--------|-------|---------|-----------|----------|',
  ];
  const dataRows = rows.map(
    r =>
      `| ${r.date} | ${r.label} | ${r.model} | ${r.serverModel} | ${r.set} | ${r.questions.toString()} | ${r.passRate} | ${r.passed.toString()} | ${r.total.toString()} | ${r.gitSha} | ${r.diffHash} | ${r.settings} |`
  );
  return [...header, ...dataRows, ''].join('\n');
}

function updateScoreboard(newRows: ScoreboardRow[]): void {
  const dir = dirname(SCOREBOARD_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing: ScoreboardRow[] = [];
  if (existsSync(SCOREBOARD_PATH)) {
    existing = parseScoreboard(readFileSync(SCOREBOARD_PATH, 'utf-8'));
  }
  const all = [...existing, ...newRows];
  writeFileSync(SCOREBOARD_PATH, formatScoreboard(all), 'utf-8');
  log.info(
    `Scoreboard updated: ${SCOREBOARD_PATH} (${all.length} ${plural(all.length, 'row', 'rows')})`
  );
}

function writeComparisonReport(allSetResults: SetRunResult[], label: string, cwd: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir = resolve(cwd, 'evals-report', `${label}-${timestamp}`);
  mkdirSync(reportDir, { recursive: true });

  const models = [...new Set(allSetResults.map(r => r.modelId))];
  const sets = [...new Set(allSetResults.map(r => r.setName))];

  const lines: string[] = [
    `# Eval Compare Report: ${label}`,
    '',
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Git SHA:** ${getGitSha()}`,
    `**Models:** ${models.join(', ')}`,
    `**Sets:** ${sets.join(', ')}`,
    '',
  ];

  if (models.length > 1) {
    lines.push('## Model Comparison', '');

    for (const setName of sets) {
      lines.push(`### ${setName}`, '');
      const headerCols = ['Question', ...models];
      lines.push(`| ${headerCols.join(' | ')} |`);
      lines.push(`| ${headerCols.map(() => '---').join(' | ')} |`);

      const setResults = allSetResults.filter(r => r.setName === setName);
      const questionIds = [
        ...new Set(setResults.flatMap(r => r.results.map(rr => rr.questionId))),
      ];

      for (const qid of questionIds) {
        const cells = [qid];
        for (const modelId of models) {
          const mr = setResults.find(r => r.modelId === modelId);
          if (!mr) {
            cells.push('-');
            continue;
          }
          const qResults = mr.results.filter(r => r.questionId === qid);
          const passed = qResults.filter(r => r.passed).length;
          const total = qResults.length;
          const rate = total > 0 ? ((passed / total) * 100).toFixed(0) : '0';
          cells.push(`${passed}/${total} (${rate}%)`);
        }
        lines.push(`| ${cells.join(' | ')} |`);
      }
      lines.push('');
    }
  }

  lines.push('## Per-Model Summary', '');
  for (const sr of allSetResults) {
    const passed = sr.results.filter(r => r.passed).length;
    const total = sr.results.length;
    const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';
    lines.push(
      `- **${sr.modelId}** / ${sr.setName}: ${passed}/${total} (${rate}%) — ${sr.questionCount} questions`
    );
  }
  lines.push('');

  const allResults = allSetResults.flatMap(r => r.results);
  const allToolCalls = allResults.flatMap(r =>
    r.toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments }))
  );
  writeReport(allResults, allToolCalls, reportDir);

  const comparisonPath = resolve(reportDir, 'comparison.md');
  writeFileSync(comparisonPath, lines.join('\n'), 'utf-8');
  log.info(`Comparison report: ${comparisonPath}`);
}

async function main(): Promise<void> {
  dotenv.config({ path: resolve(getConfigDir(), '.env') });
  const cli = parseArgs();

  log.info('eval-compare starting', { label: cli.label, sets: cli.set, models: cli.model });

  if (!existsSync(SERVER_PATH)) {
    log.error('Server not built. Run: npm run build -w packages/zowe-mcp-server');
    process.exit(1);
  }

  const setNames = cli.set.includes('all') ? listSetNames() : cli.set;
  if (setNames.length === 0) {
    log.error('No question sets found.');
    process.exit(1);
  }

  const loadedSets = loadAndValidateAllSets(setNames);

  let modelIds = cli.model;
  if (modelIds.length === 0) {
    modelIds = [getAvailableModelIds()[0] ?? 'default'];
  } else if (modelIds.includes('all')) {
    modelIds = getAvailableModelIds();
  }

  log.info('Configuration', {
    label: cli.label,
    sets: setNames.join(', '),
    models: modelIds.join(', '),
    repetitions: cli.repetitions ?? 'set default',
  });

  const allSetResults: SetRunResult[] = [];
  const gitSha = getGitSha();
  const diffHash = getDiffHash();
  const date = new Date().toISOString().slice(0, 10);

  const nonDefaultSettings: string[] = [];
  if (cli.repetitions != null) nonDefaultSettings.push(`reps=${cli.repetitions.toString()}`);
  if (cli.systemPromptAddition) nonDefaultSettings.push('sysPrompt+');
  const settingsStr = nonDefaultSettings.join(', ');

  for (const modelId of modelIds) {
    log.info(`Loading model: ${modelId}`);
    let evalsConfig: EvalsConfig;
    try {
      evalsConfig = await loadEvalsConfig(modelId === 'default' ? undefined : modelId);
    } catch (err) {
      log.error(`Failed to load model "${modelId}": ${errorMessage(err)}`);
      continue;
    }

    for (const setName of setNames) {
      const questionSet = loadedSets.get(setName)!;
      if (questionSet.config.skip) {
        log.notice(`Skipping set "${setName}": ${questionSet.config.skip}`);
        continue;
      }

      log.info(`Running set "${setName}" with model "${modelId}"`);
      const result = await runSetForModel(setName, questionSet, evalsConfig, cli);
      allSetResults.push(result);

      const passed = result.results.filter(r => r.passed).length;
      const total = result.results.length;
      const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';
      const icon = passed === total ? PASS : FAIL;
      const summary = `${icon} [${modelId}] ${setName}: ${passed}/${total} (${rate}%)`;
      if (passed === total) log.pass(summary);
      else log.fail(summary);
    }
  }

  writeComparisonReport(allSetResults, cli.label, process.cwd());

  const scoreboardRows: ScoreboardRow[] = allSetResults.map(sr => {
    const passed = sr.results.filter(r => r.passed).length;
    const total = sr.results.length;
    const rate = total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : '0%';
    return {
      date,
      label: cli.label,
      model: sr.modelId,
      serverModel: sr.serverModel,
      set: sr.setName,
      questions: sr.questionCount,
      passRate: rate,
      passed,
      total,
      gitSha,
      diffHash,
      settings: settingsStr,
    };
  });
  updateScoreboard(scoreboardRows);

  const totalPassed = allSetResults.reduce(
    (sum, sr) => sum + sr.results.filter(r => r.passed).length,
    0
  );
  const totalRuns = allSetResults.reduce((sum, sr) => sum + sr.results.length, 0);
  const overallRate = totalRuns > 0 ? ((totalPassed / totalRuns) * 100).toFixed(1) : '0';

  log.info('');
  log.info(`Overall: ${totalPassed}/${totalRuns} (${overallRate}%)`);
  if (totalPassed === totalRuns) log.pass('ALL PASSED');
  else
    log.fail(
      `${totalRuns - totalPassed} ${plural(totalRuns - totalPassed, 'failure', 'failures')}`
    );
}

main().catch(err => {
  log.error(errorMessage(err));
  process.exit(1);
});
