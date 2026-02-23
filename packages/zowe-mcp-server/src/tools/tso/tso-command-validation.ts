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
 * 1. dangerous → BLOCK (no question; e.g. system dataset DELETE/RENAME, PASSWORD, CALL)
 * 2. elicit → ELICIT (user approval required; e.g. DELETE/RENAME own dataset, SUBMIT)
 * 3. safe → ALLOW
 * 4. unknown → ELICIT
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

interface PatternEntry {
  id: string;
  message?: string;
  pattern: string;
}

interface TsoPatternsSchema {
  dangerous: PatternEntry[];
  /** Commands that require user approval (e.g. DELETE own dataset) but are not blocked. */
  elicit: PatternEntry[];
  safe: Omit<PatternEntry, 'message'>[];
}

function loadPatterns(): TsoPatternsSchema {
  const path = join(__dirname, 'tso-command-patterns.json');
  return require(path) as TsoPatternsSchema;
}

let cachedPatterns: TsoPatternsSchema | undefined;

function getPatterns(): TsoPatternsSchema {
  cachedPatterns ??= loadPatterns();
  return cachedPatterns;
}

/** Normalize command for matching: trim, collapse spaces, uppercase. */
function normalizeCommand(commandText: string): string {
  return commandText.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Result of validating a TSO command. */
export interface TsoCommandValidationResult {
  /** Action: block (no question), allow (known safe), or elicit (user approval required). */
  action: 'block' | 'allow' | 'elicit';
  /** When action is 'block' or 'elicit', the matched pattern (id, message). */
  pattern?: { id: string; message?: string };
}

/**
 * Validate a TSO command using pattern evaluation order.
 * 1. dangerous → BLOCK
 * 2. elicit → ELICIT
 * 3. safe → ALLOW
 * 4. unknown → ELICIT
 */
export function validateTsoCommand(commandText: string): TsoCommandValidationResult {
  const normalized = normalizeCommand(commandText);
  const { dangerous, elicit, safe } = getPatterns();

  for (const entry of dangerous) {
    const re = new RegExp(entry.pattern, 'i');
    if (re.test(normalized)) {
      return {
        action: 'block',
        pattern: { id: entry.id, message: entry.message },
      };
    }
  }

  for (const entry of elicit ?? []) {
    const re = new RegExp(entry.pattern, 'i');
    if (re.test(normalized)) {
      return {
        action: 'elicit',
        pattern: { id: entry.id, message: entry.message },
      };
    }
  }

  for (const entry of safe) {
    const re = new RegExp(entry.pattern, 'i');
    if (re.test(normalized)) {
      return { action: 'allow' };
    }
  }

  return { action: 'elicit' };
}
