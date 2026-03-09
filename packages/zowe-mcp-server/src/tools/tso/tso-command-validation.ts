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

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateCommandSafety,
  type CommandPatterns,
  type CommandSafetyResult,
} from '../command-safety.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedPatterns: CommandPatterns | undefined;

function getPatterns(): CommandPatterns {
  cachedPatterns ??= require(join(__dirname, 'tso-command-patterns.json')) as CommandPatterns;
  return cachedPatterns;
}

export type TsoCommandValidationResult = CommandSafetyResult;

export function validateTsoCommand(commandText: string): TsoCommandValidationResult {
  return evaluateCommandSafety(commandText, getPatterns());
}
