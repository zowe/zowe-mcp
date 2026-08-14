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
 * Shared per-question eval runner, used by both run.ts and eval-compare.ts so the two
 * CLIs can never diverge on how a question is executed (multi-turn handling, cache
 * read/write, judge wiring, per-rep error handling). Each CLI keeps its own console
 * output format via the logging hooks on {@link QuestionRunContext}.
 */

import type { JudgeFn } from './assertions.js';
import {
  buildCacheKey,
  get as cacheGet,
  set as cacheSet,
  getToolsUnderTest,
  type CachedRunResult,
} from './cache.js';
import { loadEvalsConfig } from './config.js';
import {
  assertAndRecord,
  assertConversation,
  buildToolDefsSubset,
  errorMessage,
  FAIL,
  makeFailedRunResult,
  PASS,
} from './evals-utils.js';
import type { AgentRunResult, ConversationRunResult, ToolDefinition } from './harness.js';
import { buildJudge } from './judge.js';
import { log } from './log.js';
import type { Question, RunResult } from './types.js';

/** Default judge model id (evals.config.json id), overridable via ZOWE_EVALS_JUDGE_MODEL. */
export const DEFAULT_JUDGE_MODEL_ID = 'gemini-3.5-flash';

/**
 * The subset of {@link McpEvalHarness} that {@link runQuestion} needs. Kept narrow (rather
 * than depending on the full harness class) so tests can pass a lightweight fake.
 */
export interface QuestionRunHarness {
  runOne(prompt: string): Promise<AgentRunResult>;
  runConversation(prompts: string[]): Promise<ConversationRunResult>;
}

export interface QuestionRunCacheOptions {
  enabled: boolean;
  dir: string;
  stats: { hits: number; writes: number };
}

export interface QuestionRunContext {
  harness: QuestionRunHarness;
  judge?: JudgeFn;
  cache: QuestionRunCacheOptions;
  /** System prompt used for cache-key computation (getSystemPrompt(effectiveConfig, serverInstructions)). */
  systemPrompt: string;
  /** Tool definitions from the server, used for cache-key computation. Only needed when cache.enabled. */
  toolDefinitions?: ToolDefinition[];
  /** evalsConfig.modelId, folded into the cache key so entries are per-model. */
  modelId?: string;
  repetitions: number;
  minSuccessRate: number;
  /** Label for the (r+1/repetitions) log line for a given zero-based rep index. */
  runLabel: (repIndex: number) => string;
  /** Whether to print the "  Answer:" preview block after each pass/fail log line (run.ts: yes; eval-compare: no). */
  verboseAnswers: boolean;
  /** Called with every tool call made during a run (live or cache-replayed), single- or multi-turn. */
  onToolCalls?: (toolCalls: { name: string; arguments: Record<string, unknown> }[]) => void;
}

function logRunOutcome(result: RunResult, label: string, suffix: string, verbose: boolean): void {
  const icon = result.passed ? PASS : FAIL;
  const detail = result.passed ? suffix : ` ${result.assertionFailed ?? 'assertion failed'}`;
  const msg = `${label} ${icon}${detail}`;
  if (result.passed) log.pass(msg);
  else log.fail(msg);
  if (!verbose) return;
  const answerPreview =
    result.finalText.length > 300 ? result.finalText.slice(0, 300) + '…' : result.finalText;
  log.info('  Answer:');
  for (const line of answerPreview.trim().split(/\n/)) log.info(`    ${line}`);
}

/**
 * Runs one question for `ctx.repetitions` repetitions: multi-turn questions are driven
 * via `harness.runConversation` and asserted per turn; single-turn questions via
 * `harness.runOne`. Cache hits (when `ctx.cache.enabled`) replay the cached result(s)
 * instead of calling the harness. On a live run, the first passing result is cached
 * once the question's overall pass rate reaches `ctx.minSuccessRate`.
 */
export async function runQuestion(q: Question, ctx: QuestionRunContext): Promise<RunResult[]> {
  const questionResults: RunResult[] = [];
  const isMultiTurn = Array.isArray(q.turns) && q.turns.length > 0;
  const toolNames = getToolsUnderTest(q.assertionBlock);
  const toolDefs = buildToolDefsSubset(ctx.toolDefinitions, toolNames);
  // Multi-turn questions key on all turn prompts joined, so two conversations that
  // share a first turn but differ later get distinct cache entries.
  const cachePrompt = isMultiTurn ? q.turns!.map(t => t.prompt).join('\n<<turn>>\n') : q.prompt;
  const cacheKey = ctx.cache.enabled
    ? buildCacheKey({
        systemPrompt: ctx.systemPrompt,
        prompt: cachePrompt,
        toolDefs,
        modelId: ctx.modelId,
      })
    : '';

  const cached = ctx.cache.enabled ? await cacheGet(ctx.cache.dir, cacheKey) : null;

  if (cached) {
    for (let r = 0; r < ctx.repetitions; r++) {
      let result: RunResult;
      if (isMultiTurn && cached.turns) {
        // Replay per-turn cached results through the multi-turn assertions.
        const conversation = {
          turns: cached.turns.map(t => ({
            finalText: t.finalText,
            toolCalls: t.toolCalls,
            durationMs: 0,
            stepCount: 0,
          })),
          finalText: cached.finalText,
          toolCalls: cached.toolCalls,
          durationMs: 0,
          stepCount: 0,
        };
        ctx.onToolCalls?.(conversation.toolCalls);
        result = await assertConversation(
          {
            questionId: q.id,
            displayPrompt: q.prompt,
            runIndex: r,
            questionTurns: q.turns!,
            conversation,
          },
          ctx.judge
        );
      } else {
        const { finalText, toolCalls } = cached;
        ctx.onToolCalls?.(toolCalls);
        result = await assertAndRecord(
          {
            questionId: q.id,
            prompt: q.prompt,
            runIndex: r,
            finalText,
            toolCalls,
            assertionBlock: q.assertionBlock,
          },
          ctx.judge
        );
      }
      questionResults.push(result);
      ctx.cache.stats.hits++;
      logRunOutcome(result, ctx.runLabel(r), ' cache hit', ctx.verboseAnswers);
    }
    return questionResults;
  }

  // First passing run's result, cached after the loop (per-turn for multi-turn).
  let cacheCandidate: CachedRunResult | undefined;
  for (let r = 0; r < ctx.repetitions; r++) {
    try {
      let result: RunResult;
      if (isMultiTurn) {
        const conversation = await ctx.harness.runConversation(q.turns!.map(t => t.prompt));
        ctx.onToolCalls?.(conversation.toolCalls);
        result = await assertConversation(
          {
            questionId: q.id,
            displayPrompt: q.prompt,
            runIndex: r,
            questionTurns: q.turns!,
            conversation,
          },
          ctx.judge
        );
        if (result.passed && !cacheCandidate) {
          cacheCandidate = {
            finalText: conversation.finalText,
            toolCalls: conversation.toolCalls,
            turns: conversation.turns.map(t => ({
              finalText: t.finalText,
              toolCalls: t.toolCalls,
            })),
          };
        }
      } else {
        const runResult = await ctx.harness.runOne(q.prompt);
        const { finalText, toolCalls } = runResult;
        ctx.onToolCalls?.(toolCalls);
        result = await assertAndRecord(
          {
            questionId: q.id,
            prompt: q.prompt,
            runIndex: r,
            finalText,
            toolCalls,
            assertionBlock: q.assertionBlock,
            durationMs: runResult.durationMs,
            tokenUsage: runResult.tokenUsage,
            stepCount: runResult.stepCount,
          },
          ctx.judge
        );
        if (result.passed && !cacheCandidate) {
          cacheCandidate = { finalText, toolCalls };
        }
      }
      questionResults.push(result);
      logRunOutcome(result, ctx.runLabel(r), '', ctx.verboseAnswers);
    } catch (err) {
      const msg = errorMessage(err);
      const failedResult = makeFailedRunResult(q.id, q.prompt, r, msg);
      questionResults.push(failedResult);
      log.fail(`${ctx.runLabel(r)} ${FAIL} ${msg}`);
      log.info('  Answer: (error)');
      for (const line of msg.trim().split(/\n/)) log.info(`    ${line}`);
    }
  }

  const qPassed = questionResults.filter(x => x.passed).length;
  const qTotal = questionResults.length;
  const questionPassRate = qTotal > 0 ? qPassed / qTotal : 0;
  if (ctx.cache.enabled && questionPassRate >= ctx.minSuccessRate && cacheCandidate) {
    await cacheSet(ctx.cache.dir, cacheKey, cacheCandidate);
    ctx.cache.stats.writes++;
  }

  return questionResults;
}

/**
 * Builds a judge lazily: only when `needsJudge` is true (some selected question uses
 * `answerJudge`). Deterministic runs never need a judge model/key. Reads
 * `ZOWE_EVALS_JUDGE_MODEL` (falling back to {@link DEFAULT_JUDGE_MODEL_ID}), logs
 * progress, and exits the process on failure to load the judge model (matching run.ts's
 * original fail-fast behavior).
 */
export async function maybeBuildJudge(needsJudge: boolean): Promise<JudgeFn | undefined> {
  if (!needsJudge) return undefined;
  const judgeModelId = process.env.ZOWE_EVALS_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL_ID;
  log.info('Loading judge model (answerJudge assertions present)', { judgeModelId });
  try {
    const judgeConfig = await loadEvalsConfig(judgeModelId);
    const judge = buildJudge(judgeConfig);
    log.info('Judge model ready', { judgeModelId });
    return judge;
  } catch (e) {
    log.error(`Failed to load judge model "${judgeModelId}": ${errorMessage(e)}`);
    process.exit(1);
  }
}
