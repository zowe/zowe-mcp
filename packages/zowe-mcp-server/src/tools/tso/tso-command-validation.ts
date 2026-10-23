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
 * TSO command validation using tso-command-patterns.json.
 *
 * Evaluation order is mandatory:
 * 1. dangerous → BLOCK (no question; e.g. system data set DELETE/RENAME, PASSWORD, CALL)
 * 2. elicit → ELICIT (user approval required; e.g. DELETE/RENAME own data set, SUBMIT)
 * 3. safe → ALLOW
 * 4. unknown → ELICIT
 */

import { readFileSync } from 'node:fs';
import { resolveAsset } from '../../runtime/asset-root.js';
import {
  evaluateCommandSafety,
  type CommandPatterns,
  type CommandSafetyResult,
} from '../command-safety.js';

let cachedPatterns: CommandPatterns | undefined;

function getPatterns(): CommandPatterns {
  if (!cachedPatterns) {
    const patternsPath = resolveAsset(
      import.meta.url,
      ['tso-command-patterns.json'],
      ['tools', 'tso', 'tso-command-patterns.json']
    );
    cachedPatterns = JSON.parse(readFileSync(patternsPath, 'utf-8')) as CommandPatterns;
  }
  return cachedPatterns;
}

export type TsoCommandValidationResult = CommandSafetyResult;

export function validateTsoCommand(commandText: string): TsoCommandValidationResult {
  return evaluateCommandSafety(commandText, getPatterns());
}

/**
 * Verbs accepted by the read-only `queryTso` tool (including their TSO abbreviations).
 * Every entry only reports information; none changes the system, a data set, or the
 * security database. This is deliberately a subset of the `safe` patterns: it must never
 * contain a verb that can write.
 */
const TSO_QUERY_VERBS = new Set([
  'LISTUSER',
  'LU',
  'LISTGRP',
  'LG',
  'LISTDSD',
  'LD',
  'RLIST',
  'RL',
  'SEARCH',
  'SR',
  'LISTDS',
  'LISTD',
  'LISTALC',
  'LISTA',
  'LISTCAT',
  'LISTC',
  'LISTBC',
  'STATUS',
  'HELP',
  'H',
  'WHO',
  'TIME',
  'SYSTEM',
]);

/**
 * Characters permitted in a TSO query command. Only a literal space is allowed as
 * whitespace, so newlines, tabs, and other control characters are rejected, as is
 * anything that could chain or redirect a command (`;`, `|`, `&`, backtick, `<`, `>`).
 * Covers RACF operand syntax: names, `*`/`%` generics, parentheses, quotes and `/`.
 */
const TSO_QUERY_PATTERN = /^[A-Z0-9$#@.,=()*%:+_/'" -]+$/i;

/**
 * Validates a command for the read-only `queryTso` tool and returns it normalized.
 * Throws if the characters are outside the allowed set, the verb is not a read-only
 * query verb, or the shared TSO safety patterns would not run it without approval
 * (for example `SEARCH ... CLIST`, which writes a CLIST data set).
 */
export function buildTsoQueryCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!TSO_QUERY_PATTERN.test(trimmed)) {
    throw new Error(
      'Invalid TSO query command. Use only letters, digits, and the characters $ # @ . , = ( ) * % : + _ / \' " - and spaces.'
    );
  }
  const normalized = trimmed.replace(/ +/g, ' ');
  const verb = normalized.split(' ')[0]?.toUpperCase() ?? '';
  if (!TSO_QUERY_VERBS.has(verb)) {
    throw new Error(
      `"${verb}" is not a read-only TSO query command. Allowed: LISTUSER, LISTGRP, LISTDSD, RLIST, SEARCH, ` +
        'LISTDS, LISTALC, LISTCAT, LISTBC, STATUS, HELP, WHO, TIME, SYSTEM. Use runSafeTsoCommand for other commands.'
    );
  }
  if (validateTsoCommand(normalized).action !== 'allow') {
    throw new Error(
      'This command needs user approval or is blocked by the TSO safety policy, so queryTso will not run it. ' +
        'Use runSafeTsoCommand if it is genuinely required.'
    );
  }
  return normalized;
}
