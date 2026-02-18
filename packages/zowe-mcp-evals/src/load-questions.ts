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

import yaml from 'js-yaml';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Assertion, Question, QuestionSet, SetConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const QUESTIONS_DIR = resolve(__dirname, '..', 'questions');

function parseAssertion(raw: unknown): Assertion {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid assertion');
  const o = raw as Record<string, unknown>;
  const type = o.type as string;
  if (!type) throw new Error('Assertion missing type');
  if (type === 'toolCall') {
    return {
      type: 'toolCall',
      tool: o.tool as string,
      args: o.args as Record<string, unknown> | undefined,
    };
  }
  if (type === 'answerContains') {
    return { type: 'answerContains', substring: o.substring as string };
  }
  if (type === 'singleToolCall') {
    return {
      type: 'singleToolCall',
      tool: o.tool as string,
      args: o.args as Record<string, unknown> | undefined,
    };
  }
  if (type === 'toolOnly') {
    return {
      type: 'toolOnly',
      tool: o.tool as string,
      args: o.args as Record<string, unknown> | undefined,
    };
  }
  throw new Error(`Unknown assertion type: ${type}`);
}

function parseQuestion(raw: unknown): Question {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid question');
  const o = raw as Record<string, unknown>;
  const id = o.id as string;
  const prompt = o.prompt as string;
  const assertions = o.assertions as unknown[];
  if (!id || !prompt || !Array.isArray(assertions))
    throw new Error('Question must have id, prompt, assertions');
  return {
    id,
    prompt,
    preset: o.preset as 'default' | 'inventory' | undefined,
    assertions: assertions.map(parseAssertion),
  };
}

function parseSetConfig(raw: unknown): SetConfig {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const config: SetConfig = {};
  if (typeof o.name === 'string') config.name = o.name;
  if (typeof o.description === 'string') config.description = o.description;
  if (typeof o.repetitions === 'number') config.repetitions = o.repetitions;
  if (typeof o.minSuccessRate === 'number') config.minSuccessRate = o.minSuccessRate;
  if (o.mock && typeof o.mock === 'object') {
    const m = o.mock as Record<string, unknown>;
    if (typeof m.initArgs === 'string') config.mock = { initArgs: m.initArgs };
  }
  if (o.native && typeof o.native === 'object') {
    const n = o.native as Record<string, unknown>;
    if (typeof n.serverArgs === 'string') config.native = { serverArgs: n.serverArgs };
  }
  if (typeof o.systemPrompt === 'string') config.systemPrompt = o.systemPrompt;
  if (typeof o.systemPromptAddition === 'string')
    config.systemPromptAddition = o.systemPromptAddition;
  return config;
}

export function loadSetYaml(path: string): QuestionSet {
  const content = readFileSync(path, 'utf-8');
  const data = yaml.load(content) as Record<string, unknown>;
  const config = parseSetConfig(data.config ?? data);
  const questionsRaw = data.questions;
  if (!Array.isArray(questionsRaw))
    throw new Error(`${path}: missing or invalid "questions" array`);
  const questions = questionsRaw.map(parseQuestion);
  return { config, questions };
}

export function listSetNames(): string[] {
  if (!existsSync(QUESTIONS_DIR)) return [];
  return readdirSync(QUESTIONS_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''));
}

export function getSetPath(setName: string): string {
  const yamlPath = resolve(QUESTIONS_DIR, `${setName}.yaml`);
  const ymlPath = resolve(QUESTIONS_DIR, `${setName}.yml`);
  if (existsSync(yamlPath)) return yamlPath;
  if (existsSync(ymlPath)) return ymlPath;
  throw new Error(`Question set "${setName}" not found in ${QUESTIONS_DIR}`);
}

export function loadSet(setName: string): QuestionSet {
  return loadSetYaml(getSetPath(setName));
}

export function getQuestionsDir(): string {
  return QUESTIONS_DIR;
}
