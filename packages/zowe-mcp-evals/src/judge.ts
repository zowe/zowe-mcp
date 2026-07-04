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

import type { JSONSchema7 } from 'ai';
import { generateObject, jsonSchema } from 'ai';
import type { JudgeFn } from './assertions.js';
import type { EvalsConfig } from './config.js';
import { buildModel } from './harness.js';
import { log } from './log.js';

/** JSON schema for the judge's structured verdict. */
const JUDGE_RESULT_SCHEMA: JSONSchema7 = {
  type: 'object',
  properties: {
    pass: {
      type: 'boolean',
      description: 'true if the answer satisfies the rubric, false otherwise.',
    },
    reason: {
      type: 'string',
      description: 'One or two sentence explanation of the verdict.',
    },
  },
  required: ['pass', 'reason'],
  additionalProperties: false,
};

const JUDGE_SYSTEM_PROMPT =
  'You are a strict grader for an AI evaluation harness. You are given a question, ' +
  "an AI assistant's answer, and a rubric. Decide whether the answer satisfies the " +
  'rubric. Grade only against the rubric — do not penalize style, verbosity, or ' +
  'anything the rubric does not mention. Respond with a JSON object matching the ' +
  'given schema.';

/**
 * Builds a {@link JudgeFn} that grades an answer against a rubric using the given
 * judge model (a separate, typically cheaper/faster model than the model under test).
 */
export function buildJudge(evalsConfig: EvalsConfig): JudgeFn {
  const model = buildModel(evalsConfig);
  return async ({ rubric, question, answer }) => {
    const prompt = [
      `Question asked of the AI assistant:\n${question}`,
      `AI assistant's answer:\n${answer}`,
      `Rubric:\n${rubric}`,
    ].join('\n\n');

    const result = await generateObject({
      model,
      system: JUDGE_SYSTEM_PROMPT,
      prompt,
      schema: jsonSchema(JUDGE_RESULT_SCHEMA),
    });

    const { pass, reason } = result.object as { pass: boolean; reason: string };
    log.debug('Judge verdict', { pass, reason });
    return { passed: pass, reason };
  };
}
