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

import dotenv from 'dotenv';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plural } from 'zowe-mcp-common';
import type { JudgeFn } from './assertions.js';
import { usesAnswerJudge } from './cache.js';
import { getConfigDir, loadEvalsConfig } from './config.js';
import { estimateCostUsd } from './cost.js';
import { errorMessage, FAIL, PASS, resolveNativeServerArgs } from './evals-utils.js';
import { getSystemPrompt, initMockData, McpEvalHarness, prepareEvalWorkspace } from './harness.js';
import { listSetNames, loadAndValidateAllSets } from './load-questions.js';
import { log } from './log.js';
import { maybeBuildJudge, runQuestion } from './question-runner.js';
import { writeReport } from './report.js';
import type { Question, QuestionSet, RunResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_PATH = resolve(__dirname, '..', '..', 'zowe-mcp-server', 'dist', 'index.js');

interface CliArgs {
  set: string[];
  model?: string;
  number?: string;
  id?: string[];
  filter?: string;
  noCache?: boolean;
  repetitions?: number;
}

interface CacheStats {
  hits: number;
  writes: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { set: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set' && i + 1 < args.length) {
      result.set = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--model' && i + 1 < args.length) {
      result.model = args[++i];
    } else if (args[i] === '--number' && i + 1 < args.length) {
      result.number = args[++i];
    } else if (args[i] === '--id' && i + 1 < args.length) {
      result.id = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--filter' && i + 1 < args.length) {
      result.filter = args[++i];
    } else if (args[i] === '--no-cache') {
      result.noCache = true;
    } else if ((args[i] === '--repetitions' || args[i] === '--reps') && i + 1 < args.length) {
      const reps = parseInt(args[++i], 10);
      if (!Number.isNaN(reps) && reps > 0) result.repetitions = reps;
    }
  }
  if (result.set.length === 0) result.set = ['all'];
  return result;
}

function filterQuestions(questions: Question[], cli: CliArgs): Question[] {
  let list = questions;
  if (cli.id && cli.id.length > 0) {
    const ids = new Set(cli.id);
    list = list.filter(q => ids.has(q.id));
  }
  if (cli.filter) {
    const sub = cli.filter.toLowerCase();
    list = list.filter(
      q => q.id.toLowerCase().includes(sub) || q.prompt.toLowerCase().includes(sub)
    );
  }
  if (cli.number) {
    const parts = cli.number.split('-').map(s => parseInt(s.trim(), 10));
    const start = (parts[0] ?? 1) - 1;
    const end = parts.length === 2 ? (parts[1] ?? start + 1) - 1 : start;
    list = list.slice(start, end + 1);
  }
  return list;
}

async function main(): Promise<void> {
  dotenv.config({ path: resolve(getConfigDir(), '.env') });
  const cli = parseArgs();
  log.info('Loading evals config');
  const evalsConfig = await loadEvalsConfig(cli.model);
  log.info('Evals config loaded', {
    modelId: evalsConfig.modelId ?? 'default',
    provider: evalsConfig.provider,
    model: evalsConfig.serverModel,
  });

  const setNames = cli.set.includes('all') ? listSetNames() : cli.set;
  if (setNames.length === 0) {
    log.error('No question sets found. Add YAML files to packages/zowe-mcp-evals/questions/');
    process.exit(1);
  }
  log.info(`Question ${plural(setNames.length, 'set', 'sets')}`, { sets: setNames.join(', ') });

  log.info('Validating all question sets');
  let loadedSets: Map<string, QuestionSet>;
  try {
    loadedSets = loadAndValidateAllSets(setNames);
  } catch (e) {
    log.error(errorMessage(e));
    process.exit(1);
  }
  log.info(`All ${setNames.length} ${plural(setNames.length, 'set', 'sets')} validated`);

  const serverPath = SERVER_PATH;
  if (!existsSync(serverPath)) {
    log.error('Server not built. Run: npm run build -w @zowe/mcp-server');
    process.exit(1);
  }

  const reportDir = resolve(process.cwd(), 'evals-report');
  if (existsSync(reportDir)) {
    log.info('Clearing existing reports');
    rmSync(reportDir, { recursive: true, force: true });
  }

  const allResults: RunResult[] = [];
  const allToolCalls: { name: string; arguments: Record<string, unknown> }[] = [];
  const useCache = !cli.noCache;
  const cacheDir = useCache ? resolve(process.cwd(), '.evals-cache') : '';
  const cacheStats: CacheStats = { hits: 0, writes: 0 };

  let totalQuestions = 0;
  let totalRuns = 0;
  for (const setName of setNames) {
    const qs = loadedSets.get(setName)!;
    if (qs.config.skip) continue;
    const count = filterQuestions(qs.questions, cli).filter(q => !q.skip).length;
    totalQuestions += count;
    totalRuns += count * (cli.repetitions ?? qs.config.repetitions ?? 5);
  }
  let questionIndex = 0;

  log.info(
    `Plan: ${totalQuestions} ${plural(totalQuestions, 'question', 'questions')}, ${totalRuns} total ${plural(totalRuns, 'run', 'runs')} across ${setNames.filter(s => !loadedSets.get(s)!.config.skip).length} ${plural(setNames.filter(s => !loadedSets.get(s)!.config.skip).length, 'set', 'sets')}`
  );

  // Build the judge lazily: only when some question in this run actually uses
  // answerJudge. Deterministic runs (no answerJudge) never need a judge model/key.
  const needsJudge = setNames.some(setName => {
    const qs = loadedSets.get(setName)!;
    if (qs.config.skip) return false;
    return filterQuestions(qs.questions, cli).some(
      q => !q.skip && usesAnswerJudge(q.assertionBlock)
    );
  });
  const judge: JudgeFn | undefined = await maybeBuildJudge(needsJudge);

  for (const setName of setNames) {
    const questionSet = loadedSets.get(setName)!;
    const config = questionSet.config;

    if (config.skip) {
      log.notice(`Skipping set "${setName}": ${config.skip}`);
      continue;
    }

    const questions = filterQuestions(questionSet.questions, cli);
    const repetitions = cli.repetitions ?? config.repetitions ?? 5;
    const minSuccessRate = config.minSuccessRate ?? 0.8;
    log.info('Set loaded', {
      setName,
      questionCount: questions.length,
      repetitions,
    });

    let mockDir: string | undefined;
    if (config.mock?.initArgs != null) {
      log.info('Initializing mock data');
      mockDir = initMockData(serverPath, config.mock.initArgs);
      log.info('Mock data ready');
    }
    const rawNativeArgs = config.native?.serverArgs;
    const nativeServerArgs =
      rawNativeArgs != null ? resolveNativeServerArgs(rawNativeArgs) : undefined;

    const workspaceDir = prepareEvalWorkspace();
    log.info('Eval workspace for local file tools', { workspaceDir });

    const harness = new McpEvalHarness({
      serverPath,
      evalsConfig,
      setConfig: config,
      mockDir,
      nativeServerArgs,
      workspaceDir,
    });

    try {
      log.info('Starting MCP server');
      await harness.start();
      log.info('MCP server ready');

      const serverInstructions = harness.getServerInstructions();
      let toolDefinitions: Awaited<ReturnType<McpEvalHarness['getToolDefinitions']>> | undefined;
      if (useCache) {
        toolDefinitions = await harness.getToolDefinitions();
      }

      for (const q of questions) {
        if (q.skip) {
          log.notice(`Skipping question "${q.id}": ${q.skip}`);
          continue;
        }
        const isMultiTurn = Array.isArray(q.turns) && q.turns.length > 0;

        questionIndex++;
        const progress = `[${questionIndex.toString()}/${totalQuestions.toString()}]`;
        log.info(`${progress} ${setName}/${q.id}:`);
        if (isMultiTurn) {
          q.turns!.forEach((t, i) => {
            log.info(`  turn ${i + 1}: ${t.prompt}`);
          });
        } else {
          for (const line of q.prompt.trim().split(/\n/)) log.info(`  ${line}`);
        }

        const questionResults = await runQuestion(q, {
          harness,
          judge,
          cache: { enabled: useCache, dir: cacheDir, stats: cacheStats },
          systemPrompt: getSystemPrompt(config, serverInstructions),
          toolDefinitions,
          modelId: evalsConfig.modelId,
          repetitions,
          minSuccessRate,
          runLabel: r => `Running ${setName}/${q.id} (${r + 1}/${repetitions})`,
          verboseAnswers: true,
          onToolCalls: toolCalls => {
            for (const tc of toolCalls)
              allToolCalls.push({ name: tc.name, arguments: tc.arguments });
          },
        });
        allResults.push(...questionResults);

        const qPassed = questionResults.filter(x => x.passed).length;
        const qTotal = questionResults.length;
        const icon = qPassed === qTotal ? PASS : FAIL;
        const summary = `${icon} ${setName}/${q.id} (${qPassed}/${qTotal}) ${progress}`;
        if (qPassed === qTotal) log.pass(summary);
        else log.fail(summary);
      }
    } finally {
      log.info('Stopping MCP server');
      await harness.stop();
      if (mockDir) rmSync(mockDir, { recursive: true, force: true });
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }

  const passed = allResults.filter(x => x.passed).length;
  const total = allResults.length;
  const success = passed === total;

  log.info('Writing report');
  writeReport(allResults, allToolCalls, process.cwd());

  const runsMsg = `Runs: ${passed}/${total} passed`;
  if (success) log.pass(runsMsg);
  else log.fail(runsMsg);

  const resultsWithTokens = allResults.filter(r => r.tokenUsage != null);
  if (resultsWithTokens.length > 0) {
    const tokenTotals = resultsWithTokens.reduce(
      (acc, r) => ({
        input: acc.input + (r.tokenUsage?.input ?? 0),
        output: acc.output + (r.tokenUsage?.output ?? 0),
        total: acc.total + (r.tokenUsage?.total ?? 0),
        cacheReadInputTokens: acc.cacheReadInputTokens + (r.tokenUsage?.cacheReadInputTokens ?? 0),
        cacheCreationInputTokens:
          acc.cacheCreationInputTokens + (r.tokenUsage?.cacheCreationInputTokens ?? 0),
      }),
      { input: 0, output: 0, total: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }
    );
    if (
      tokenTotals.input > 0 ||
      tokenTotals.output > 0 ||
      tokenTotals.cacheReadInputTokens > 0 ||
      tokenTotals.cacheCreationInputTokens > 0
    ) {
      const cacheClause =
        tokenTotals.cacheReadInputTokens > 0 || tokenTotals.cacheCreationInputTokens > 0
          ? `, ${tokenTotals.cacheReadInputTokens} cache-read, ${tokenTotals.cacheCreationInputTokens} cache-write`
          : '';
      const cost = estimateCostUsd(tokenTotals, evalsConfig.serverModel);
      const costClause = cost != null ? ` | Estimated cost: $${cost.toFixed(4)}` : '';
      log.notice(
        `Tokens: ${tokenTotals.input} in, ${tokenTotals.output} out${cacheClause}${costClause}`
      );
    }
  }

  if (useCache) {
    const llmCalls = total - cacheStats.hits;
    log.notice(
      `Cache: ${cacheStats.hits} hits, ${cacheStats.writes} writes, ${llmCalls} LLM calls (${total} runs)`
    );
  }
  if (success) {
    log.pass('SUCCESS');
  } else {
    log.fail('FAILED');
  }
  process.exit(success ? 0 : 1);
}

main().catch(err => {
  log.error(errorMessage(err));
  process.exit(1);
});
