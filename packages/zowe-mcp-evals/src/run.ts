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

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAssertions } from './assertions.js';
import { loadEvalsConfig } from './config.js';
import { McpEvalHarness, initMockData } from './harness.js';
import { listSetNames, loadSet } from './load-questions.js';
import { log } from './log.js';
import { writeReport } from './report.js';
import type { Question, RunResult } from './types.js';

const PASS = '\u2713'; // ✓
const FAIL = '\u2717'; // ✗

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_PATH = resolve(__dirname, '..', '..', 'zowe-mcp-server', 'dist', 'index.js');

interface CliArgs {
  set: string[];
  number?: string;
  id?: string[];
  filter?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { set: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set' && i + 1 < args.length) {
      result.set = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--number' && i + 1 < args.length) {
      result.number = args[++i];
    } else if (args[i] === '--id' && i + 1 < args.length) {
      result.id = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--filter' && i + 1 < args.length) {
      result.filter = args[++i];
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

function runMarkdownlint(reportDir: string): void {
  const reportPath = resolve(reportDir, 'report.md');
  const failuresPath = resolve(reportDir, 'failures.md');
  const files: string[] = [];
  if (existsSync(reportPath)) files.push(reportPath);
  if (existsSync(failuresPath)) files.push(failuresPath);
  if (files.length === 0) return;
  const configPath = resolve(__dirname, '..', 'evals.markdownlint-cli2.jsonc');
  const args = ['markdownlint-cli2', '--fix'];
  if (existsSync(configPath)) args.push('--config', configPath);
  args.push(...files);
  const r = spawnSync('npx', args, {
    cwd: process.cwd(),
    shell: true,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    log.debug('markdownlint reported issues', { stderr: r.stderr, stdout: r.stdout });
  }
}

async function main(): Promise<void> {
  const cli = parseArgs();
  log.info('Loading evals config');
  const evalsConfig = loadEvalsConfig();
  log.info('Evals config loaded', {
    provider: evalsConfig.provider,
    model: evalsConfig.server_model,
  });

  const setNames = cli.set.includes('all') ? listSetNames() : cli.set;
  if (setNames.length === 0) {
    log.error('No question sets found. Add YAML files to packages/zowe-mcp-evals/questions/');
    process.exit(1);
  }
  log.info('Question set(s)', { sets: setNames.join(', ') });

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

  for (const setName of setNames) {
    let questionSet;
    try {
      questionSet = loadSet(setName);
    } catch (e) {
      log.error(errorMessage(e));
      process.exit(1);
    }

    const questions = filterQuestions(questionSet.questions, cli);
    const config = questionSet.config;
    const repetitions = config.repetitions ?? 5;
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
    const nativeServerArgs = config.native?.serverArgs;

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

      for (const q of questions) {
        const questionResults: RunResult[] = [];
        for (let r = 0; r < repetitions; r++) {
          try {
            const { finalText, toolCalls } = await harness.runOne(q.prompt);
            for (const tc of toolCalls)
              allToolCalls.push({ name: tc.name, arguments: tc.arguments });
            const { passed, failedAssertion } = runAssertions(q.assertions, toolCalls, finalText);
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
            log.info(`Running ${q.id} (${r + 1}/${repetitions}) ${icon}${detail}`);
            log.info('  Question:');
            for (const line of q.prompt.trim().split(/\n/)) log.info(`    ${line}`);
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
            log.info(`Running ${q.id} (${r + 1}/${repetitions}) ${FAIL} ${msg}`);
            log.info('  Question:');
            for (const line of q.prompt.trim().split(/\n/)) log.info(`    ${line}`);
            log.info('  Answer: (error)');
            for (const line of msg.trim().split(/\n/)) log.info(`    ${line}`);
            log.info(`    ${msg}`);
          }
        }
        const qPassed = questionResults.filter(x => x.passed).length;
        const qTotal = questionResults.length;
        const icon = qPassed === qTotal ? PASS : FAIL;
        log.notice(`${icon} ${q.id} (${qPassed}/${qTotal})`);
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
  runMarkdownlint(reportDir);

  log.notice(`Runs: ${passed}/${total} passed`);
  if (success) {
    log.notice('SUCCESS');
  } else {
    log.error('FAILED');
  }
  process.exit(success ? 0 : 1);
}

main().catch(err => {
  log.error(errorMessage(err));
  process.exit(1);
});
