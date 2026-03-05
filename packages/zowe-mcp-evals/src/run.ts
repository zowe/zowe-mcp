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
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAssertions } from './assertions.js';
import { buildCacheKey, get as cacheGet, set as cacheSet, getToolsUnderTest } from './cache.js';
import { getConfigDir, loadEvalsConfig } from './config.js';
import { getSystemPrompt, initMockData, McpEvalHarness } from './harness.js';
import { listSetNames, loadAndValidateAllSets } from './load-questions.js';
import { log } from './log.js';
import { plural } from './plural.js';
import { writeReport } from './report.js';
import type { Question, QuestionSet, RunResult } from './types.js';

const PASS = '\u2713'; // ✓
const FAIL = '\u2717'; // ✗

/**
 * Resolve relative --config <path> in native serverArgs against the config directory (repo root).
 * So jobs set with `--native --config native-config.json` finds the file at repo root.
 */
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
  if (typeof apiErr.url === 'string') parts.push(`url: ${apiErr.url}`);
  if (typeof apiErr.responseBody === 'string' && apiErr.responseBody.length > 0) {
    parts.push(`responseBody: ${apiErr.responseBody.slice(0, 2000)}`);
  }
  if (apiErr.cause instanceof Error) parts.push(`cause: ${apiErr.cause.message}`);
  return parts.join('\n  ');
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_PATH = resolve(__dirname, '..', '..', 'zowe-mcp-server', 'dist', 'index.js');

interface CliArgs {
  set: string[];
  model?: string;
  number?: string;
  id?: string[];
  filter?: string;
  noCache?: boolean;
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
    log.error('Server not built. Run: npm run build -w packages/zowe-mcp-server');
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
    totalRuns += count * (qs.config.repetitions ?? 5);
  }
  let questionIndex = 0;

  log.info(
    `Plan: ${totalQuestions} ${plural(totalQuestions, 'question', 'questions')}, ${totalRuns} total ${plural(totalRuns, 'run', 'runs')} across ${setNames.filter(s => !loadedSets.get(s)!.config.skip).length} ${plural(setNames.filter(s => !loadedSets.get(s)!.config.skip).length, 'set', 'sets')}`
  );

  for (const setName of setNames) {
    const questionSet = loadedSets.get(setName)!;
    const config = questionSet.config;

    if (config.skip) {
      log.notice(`Skipping set "${setName}": ${config.skip}`);
      continue;
    }

    const questions = filterQuestions(questionSet.questions, cli);
    const repetitions = config.repetitions ?? 5;
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

    const harness = new McpEvalHarness({
      serverPath,
      evalsConfig,
      setConfig: config,
      mockDir,
      nativeServerArgs,
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
        const questionResults: RunResult[] = [];
        const toolNames = getToolsUnderTest(q.assertionBlock);
        const toolDefs: Record<string, { description?: string; inputSchema?: unknown }> = {};
        if (toolDefinitions) {
          for (const name of toolNames) {
            const t = toolDefinitions.find(td => td.name === name);
            if (t) toolDefs[name] = { description: t.description, inputSchema: t.inputSchema };
          }
        }
        const cacheKey = useCache
          ? buildCacheKey({
              systemPrompt: getSystemPrompt(config, serverInstructions),
              prompt: q.prompt,
              toolDefs,
              modelId: evalsConfig.modelId,
            })
          : '';

        const cached = useCache ? await cacheGet(cacheDir, cacheKey) : null;

        questionIndex++;
        const progress = `[${questionIndex.toString()}/${totalQuestions.toString()}]`;
        log.info(`${progress} ${setName}/${q.id}:`);
        for (const line of q.prompt.trim().split(/\n/)) log.info(`  ${line}`);

        if (cached) {
          for (let r = 0; r < repetitions; r++) {
            const { finalText, toolCalls } = cached;
            for (const tc of toolCalls)
              allToolCalls.push({ name: tc.name, arguments: tc.arguments });
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
            questionResults.push(result);
            allResults.push(result);
            cacheStats.hits++;
            const icon = passed ? PASS : FAIL;
            const detail = passed ? ' cache hit' : ` ${failedAssertion ?? 'assertion failed'}`;
            const msg = `Running ${setName}/${q.id} (${r + 1}/${repetitions}) ${icon}${detail}`;
            if (passed) log.pass(msg);
            else log.fail(msg);
            const answerPreview =
              finalText.length > 300 ? finalText.slice(0, 300) + '…' : finalText;
            log.info('  Answer:');
            for (const line of answerPreview.trim().split(/\n/)) log.info(`    ${line}`);
          }
        } else {
          for (let r = 0; r < repetitions; r++) {
            try {
              const runResult = await harness.runOne(q.prompt);
              const { finalText, toolCalls } = runResult;
              for (const tc of toolCalls)
                allToolCalls.push({ name: tc.name, arguments: tc.arguments });
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
              questionResults.push(result);
              allResults.push(result);
              const icon = passed ? PASS : FAIL;
              const detail = passed ? '' : ` ${failedAssertion ?? 'assertion failed'}`;
              const msg = `Running ${setName}/${q.id} (${r + 1}/${repetitions}) ${icon}${detail}`;
              if (passed) log.pass(msg);
              else log.fail(msg);
              const answerPreview =
                finalText.length > 300 ? finalText.slice(0, 300) + '…' : finalText;
              log.info('  Answer:');
              for (const line of answerPreview.trim().split(/\n/)) log.info(`    ${line}`);
            } catch (err) {
              const msg = errorMessage(err);
              const failedResult: RunResult = {
                questionId: q.id,
                prompt: q.prompt,
                runIndex: r,
                passed: false,
                toolCalls: [],
                finalText: '',
                error: msg,
              };
              allResults.push(failedResult);
              questionResults.push(failedResult);
              log.fail(`Running ${setName}/${q.id} (${r + 1}/${repetitions}) ${FAIL} ${msg}`);
              log.info('  Answer: (error)');
              for (const line of msg.trim().split(/\n/)) log.info(`    ${line}`);
              log.info(`    ${msg}`);
            }
          }
          const qPassed = questionResults.filter(x => x.passed).length;
          const qTotal = questionResults.length;
          const questionPassRate = qTotal > 0 ? qPassed / qTotal : 0;
          if (useCache && questionPassRate >= minSuccessRate) {
            const firstPassing = questionResults.find(x => x.passed);
            if (firstPassing) {
              await cacheSet(cacheDir, cacheKey, {
                finalText: firstPassing.finalText,
                toolCalls: firstPassing.toolCalls,
              });
              cacheStats.writes++;
            }
          }
        }

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
