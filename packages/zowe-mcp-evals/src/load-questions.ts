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

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import yaml from 'js-yaml';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Assertion,
  AssertionBlock,
  AssertionItem,
  Question,
  QuestionSet,
  SetConfig,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const QUESTIONS_DIR = resolve(__dirname, '..', 'questions');
const SCHEMA_PATH = resolve(__dirname, '..', 'schemas', 'evals-question-set.schema.json');

let cachedValidator: ValidateFunction | undefined;

function getSchemaValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  const schemaJson = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as Record<string, unknown>;
  const ajv = new Ajv.default({ allErrors: true });
  cachedValidator = ajv.compile(schemaJson);
  return cachedValidator;
}

function formatAjvErrors(errors: ErrorObject[]): string {
  return errors
    .map((e: ErrorObject) => {
      const path = e.instancePath || '/';
      const msg = e.message ?? 'unknown error';
      const extra = e.params ? ` (${JSON.stringify(e.params)})` : '';
      return `  ${path}: ${msg}${extra}`;
    })
    .join('\n');
}

/**
 * Parse assertions block: array (treated as allOf), or { allOf: [...] }, or { anyOf: [...] }.
 */
function parseAssertionBlock(raw: unknown): AssertionBlock {
  if (Array.isArray(raw)) {
    return { mode: 'all', items: raw.map(parseAssertionItem) };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.allOf) && o.allOf.length > 0) {
      return { mode: 'all', items: o.allOf.map(parseAssertionItem) };
    }
    if (Array.isArray(o.anyOf) && o.anyOf.length > 0) {
      return { mode: 'any', items: o.anyOf.map(parseAssertionItem) };
    }
  }
  throw new Error(
    'assertions must be an array or an object with allOf or anyOf (non-empty array)'
  );
}

/**
 * Parse one assertion item: leaf assertion (key-based) or composite { allOf/anyOf: [...] }.
 */
function parseAssertionItem(raw: unknown): AssertionItem {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid assertion item');
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.allOf) && o.allOf.length > 0) {
    return { allOf: o.allOf.map(parseAssertionItem) };
  }
  if (Array.isArray(o.anyOf) && o.anyOf.length > 0) {
    return { anyOf: o.anyOf.map(parseAssertionItem) };
  }
  return parseAssertion(raw);
}

function parseToolCallOrderStep(s: unknown): {
  tool?: string;
  tools?: string[];
  args?: Record<string, unknown> | Record<string, unknown>[];
} {
  if (!s || typeof s !== 'object') throw new Error('toolCallOrder step must be an object');
  const step = s as Record<string, unknown>;
  const tool = step.tool as string | undefined;
  const tools = step.tools as string[] | undefined;
  const args = step.args;
  const argsOut =
    args === undefined
      ? undefined
      : Array.isArray(args)
        ? (args as Record<string, unknown>[])
        : (args as Record<string, unknown>);
  if (tool !== undefined && typeof tool === 'string' && tool.trim())
    return { tool: tool.trim(), args: argsOut };
  if (Array.isArray(tools) && tools.length > 0)
    return { tools: tools.map((t: unknown) => String(t).trim()), args: argsOut };
  throw new Error('toolCallOrder step must have tool (string) or tools (non-empty array)');
}

function parseOneOfSpec(spec: unknown): { tool: string; args?: Record<string, unknown> } {
  if (!spec || typeof spec !== 'object') throw new Error('toolCall oneOf entry must be an object');
  const s = spec as Record<string, unknown>;
  const tool = s.tool as string;
  if (!tool || typeof tool !== 'string')
    throw new Error('toolCall oneOf entry must have tool string');
  return {
    tool: tool.trim(),
    args: s.args as Record<string, unknown> | undefined,
  };
}

/**
 * Ansible-style assertion parser. The assertion type is determined by the key
 * (toolCall, toolCallOrder, answerContains). Optional `name` is a sibling key.
 */
function parseAssertion(raw: unknown): Assertion {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid assertion');
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : undefined;

  if (o.toolCall !== undefined) {
    const body = o.toolCall as Record<string, unknown>;
    if (!body || typeof body !== 'object') throw new Error('toolCall value must be an object');

    const tool = typeof body.tool === 'string' ? body.tool : undefined;
    const tools = Array.isArray(body.tools)
      ? (body.tools as unknown[]).map((t: unknown) => String(t).trim())
      : undefined;
    const oneOf = Array.isArray(body.oneOf)
      ? (body.oneOf as unknown[]).map(parseOneOfSpec)
      : undefined;
    const args = body.args as Record<string, unknown> | undefined;
    const count = typeof body.count === 'number' ? body.count : undefined;
    const minCount = typeof body.minCount === 'number' ? body.minCount : undefined;

    if (!tool && !tools && !oneOf) throw new Error('toolCall must have tool, tools, or oneOf');

    return { type: 'toolCall', name, tool, tools, oneOf, args, count, minCount };
  }

  if (o.toolCallOrder !== undefined) {
    const seq = o.toolCallOrder;
    if (!Array.isArray(seq) || seq.length === 0)
      throw new Error('toolCallOrder value must be a non-empty array');
    return {
      type: 'toolCallOrder',
      name,
      sequence: seq.map(parseToolCallOrderStep),
    };
  }

  if (o.answerContains !== undefined) {
    const body = o.answerContains as Record<string, unknown>;
    if (!body || typeof body !== 'object')
      throw new Error('answerContains value must be an object');
    const substring = body.substring as string | undefined;
    const pattern = body.pattern as string | undefined;
    if (substring === undefined && pattern === undefined)
      throw new Error('answerContains requires substring or pattern');
    return { type: 'answerContains', name, substring, pattern };
  }

  const keys = Object.keys(o).filter(k => k !== 'name');
  throw new Error(
    `Unknown assertion key(s): ${keys.join(', ')}. Expected toolCall, toolCallOrder, or answerContains.`
  );
}

function parseQuestion(raw: unknown): Question {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid question');
  const o = raw as Record<string, unknown>;
  const id = o.id as string;
  const prompt = o.prompt as string;
  const assertionsRaw = o.assertions;
  if (!id || !prompt) throw new Error('Question must have id, prompt');
  if (assertionsRaw === undefined || assertionsRaw === null)
    throw new Error('Question must have assertions (array or allOf/anyOf object)');
  const assertionBlock = parseAssertionBlock(assertionsRaw);
  return {
    id,
    prompt,
    preset: o.preset as 'default' | 'inventory' | undefined,
    assertionBlock,
    skip: typeof o.skip === 'string' ? o.skip : undefined,
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
  if (o.endevorMockEws && typeof o.endevorMockEws === 'object') {
    const e = o.endevorMockEws as Record<string, unknown>;
    if (typeof e.cliScript === 'string' && typeof e.configPath === 'string') {
      config.endevorMockEws = {
        cliScript: e.cliScript,
        configPath: e.configPath,
        port: typeof e.port === 'number' ? e.port : undefined,
        mcpServerScript: typeof e.mcpServerScript === 'string' ? e.mcpServerScript : undefined,
        mcpServerArgs: typeof e.mcpServerArgs === 'string' ? e.mcpServerArgs : undefined,
        toolAliases:
          e.toolAliases && typeof e.toolAliases === 'object'
            ? (e.toolAliases as Record<string, string>)
            : undefined,
      };
    }
  }
  if (typeof o.systemPrompt === 'string') config.systemPrompt = o.systemPrompt;
  if (typeof o.systemPromptAddition === 'string')
    config.systemPromptAddition = o.systemPromptAddition;
  if (typeof o.skip === 'string') config.skip = o.skip;
  if (typeof o.questionsFrom === 'string') config.questionsFrom = o.questionsFrom;
  return config;
}

export function loadSetYaml(path: string): QuestionSet {
  const content = readFileSync(path, 'utf-8');
  const data = yaml.load(content) as Record<string, unknown>;

  const validate = getSchemaValidator();
  if (!validate(data)) {
    const errText = validate.errors ? formatAjvErrors(validate.errors) : 'unknown';
    throw new Error(`${path}: JSON Schema validation failed:\n${errText}`);
  }

  const config = parseSetConfig(data.config ?? data);
  const questionsRaw = data.questions;
  if (!Array.isArray(questionsRaw) && !config.questionsFrom)
    throw new Error(`${path}: missing or invalid "questions" array (or set config.questionsFrom)`);

  let questions: Question[];
  if (config.questionsFrom) {
    questions = loadSet(config.questionsFrom).questions;
  } else {
    if (!Array.isArray(questionsRaw))
      throw new Error(`${path}: missing or invalid "questions" array`);
    questions = (questionsRaw as unknown[]).map(parseQuestion);
  }
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

/**
 * Validate and load all requested sets upfront. Returns loaded sets or throws
 * with all validation errors collected so the user sees every problem at once.
 */
export function loadAndValidateAllSets(setNames: string[]): Map<string, QuestionSet> {
  const results = new Map<string, QuestionSet>();
  const errors: string[] = [];
  for (const name of setNames) {
    try {
      results.set(name, loadSet(name));
    } catch (e) {
      errors.push(`[${name}] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `${errors.length} question ${errors.length === 1 ? 'set' : 'sets'} failed validation:\n\n${errors.join('\n\n')}`
    );
  }
  return results;
}

export function getQuestionsDir(): string {
  return QUESTIONS_DIR;
}
