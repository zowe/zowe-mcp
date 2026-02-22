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

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './log.js';
import type { RunResult } from './types.js';

const REPORT_DIR = 'evals-report';

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const CODE_FENCE = '```';

/** Truncate text for preview; if truncated inside a code block, put … inside it and close the fence. */
function truncateForPreview(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const fenceCount = (truncated.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    return truncated + '\n…\n' + CODE_FENCE;
  }
  return truncated + '…';
}

/** Slug for markdown header anchor (matches GitHub-style heading IDs). */
function toHeaderAnchor(id: string): string {
  return id
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function writeReport(
  results: RunResult[],
  allToolCalls: { name: string; arguments: Record<string, unknown> }[],
  cwd: string
): void {
  const outDir = resolve(cwd, REPORT_DIR);
  mkdirSync(outDir, { recursive: true });

  const byQuestion = new Map<string, RunResult[]>();
  for (const r of results) {
    const list = byQuestion.get(r.questionId) ?? [];
    list.push(r);
    byQuestion.set(r.questionId, list);
  }

  const questionRows: string[] = [];
  questionRows.push('|Question ID|Pass rate|Status|');
  questionRows.push('|---|---|---|');
  for (const [qid, runs] of byQuestion) {
    const passed = runs.filter(x => x.passed).length;
    const total = runs.length;
    const rate = total > 0 ? (passed / total).toFixed(2) : '0';
    const status = passed === total ? 'PASS' : 'FAIL';
    const anchor = toHeaderAnchor(qid);
    questionRows.push(`|[${escapeMd(qid)}](#${anchor})|${passed}/${total} (${rate})|${status}|`);
  }

  const toolCounts = new Map<string, number>();
  const toolParams = new Map<string, Map<string, Set<string>>>();
  for (const tc of allToolCalls) {
    toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
    let params = toolParams.get(tc.name);
    if (!params) {
      params = new Map();
      toolParams.set(tc.name, params);
    }
    for (const [k, v] of Object.entries(tc.arguments)) {
      let set = params.get(k);
      if (!set) {
        set = new Set();
        params.set(k, set);
      }
      set.add(String(v));
    }
  }

  const toolRows: string[] = [];
  toolRows.push('|Tool|Evaluation count|Parameters / values covered|');
  toolRows.push('|---|---|---|');
  const sortedTools = [...toolCounts.keys()].sort();
  for (const name of sortedTools) {
    const count = toolCounts.get(name) ?? 0;
    const paramMap = toolParams.get(name);
    const paramStr = paramMap
      ? [...paramMap.entries()]
          .map(
            ([k, vals]) => `${k}: ${[...vals].slice(0, 5).join(', ')}${vals.size > 5 ? '…' : ''}`
          )
          .join('; ')
      : '-';
    toolRows.push(`|${escapeMd(name)}|${count}|${escapeMd(paramStr)}|`);
  }

  const totalRuns = results.length;
  const totalPassed = results.filter(x => x.passed).length;
  const overallRate = totalRuns > 0 ? ((totalPassed / totalRuns) * 100).toFixed(1) : '0';

  const qaSection: string[] = [];
  for (const [qid, runs] of byQuestion) {
    const first = runs[0];
    if (!first) continue;
    qaSection.push(`### ${qid}\n`);
    qaSection.push('**Question:**');
    qaSection.push((first.prompt ?? first.questionId).trim());
    qaSection.push('');
    const answer = (first.finalText ?? first.error ?? '(no answer)').trim();
    const answerPreview = truncateForPreview(answer, 500);
    qaSection.push('**Answer:**');
    qaSection.push('<!-- markdownlint-disable -->');
    qaSection.push(answerPreview);
    qaSection.push('<!-- markdownlint-disable -->');
  }

  const failures: string[] = [];
  for (const [qid, runs] of byQuestion) {
    const failed = runs.filter(x => !x.passed);
    if (failed.length === 0) continue;
    const totalRunsForQuestion = runs.length;
    failures.push(`### ${qid}`);
    failures.push(`- Prompt: ${failed[0].prompt ?? failed[0].questionId}`);
    failures.push(`- Failed runs: ${failed.length}/${totalRunsForQuestion}`);
    failures.push('');
    failed.forEach(run => {
      const runLabel = `Run ${run.runIndex + 1}/${totalRunsForQuestion}`;
      failures.push(`#### ${runLabel}`);
      failures.push('- Tool calls:');
      for (let i = 0; i < run.toolCalls.length; i++) {
        const tc = run.toolCalls[i];
        const argsJson = JSON.stringify(tc.arguments, null, 2);
        failures.push(`  ${i + 1}. **${tc.name}**`);
        failures.push(`     Args: \`${argsJson.replace(/\n/g, ' ')}\``);
        if (tc.result !== undefined) {
          const preview =
            tc.result.length > 800 ? tc.result.slice(0, 800) + '… [truncated]' : tc.result;
          failures.push(`     Result:`);
          failures.push('     ```');
          failures.push(preview);
          failures.push('     ```');
        }
      }
      failures.push(`- Error/assertion: ${run.assertionFailed ?? run.error ?? 'unknown'}`);
      failures.push('');
    });
  }

  const md = [
    '# Zowe MCP Evals Report',
    '',
    '## Summary',
    '',
    `- **Total runs**: ${totalRuns}`,
    `- **Passed**: ${totalPassed}`,
    `- **Overall pass rate**: ${overallRate}%`,
    '',
    '## Per question',
    '',
    ...questionRows,
    '',
    '## Questions and answers',
    '',
    ...qaSection,
    '',
    '## Per tool',
    '',
    ...toolRows,
    '',
    '## Failures',
    '',
    ...(failures.length > 0 ? failures : ['No failures.']),
    '',
  ].join('\n');

  const reportPath = resolve(outDir, 'report.md');
  writeFileSync(reportPath, md, 'utf-8');
  log.info(`Report written to ${reportPath}`);

  if (failures.length > 0) {
    const failuresPath = resolve(outDir, 'failures.md');
    writeFileSync(
      failuresPath,
      ['# Failures detail', '', '## By question', '', ...failures].join('\n'),
      'utf-8'
    );
    log.info(`Failures written to ${failuresPath}`);
  }
}
