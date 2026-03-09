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
 * Command and file-path validation using hardstop-patterns.
 *
 * Evaluation order is mandatory (see https://github.com/frmoretto/hardstop-patterns):
 * - Commands: checkBashDangerous first (BLOCK), then checkBashSafe (ALLOW), then unknown → elicit.
 * - Read path: checkReadDangerous (BLOCK), checkReadSensitive (WARN/elicit), checkReadSafe (ALLOW), then unknown → elicit.
 */

import {
  checkBashDangerous,
  checkBashSafe,
  checkReadDangerous,
  checkReadSafe,
  checkReadSensitive,
} from 'hardstop-patterns';

/** Result of validating a shell command. */
export interface CommandValidationResult {
  /** Action to take: block, allow (known safe), or elicit (unknown — need user confirmation). */
  action: 'block' | 'allow' | 'elicit';
  /** When action is 'block', the matched dangerous pattern (id, message). */
  pattern?: { id: string; message?: string };
}

/** Result of validating a file path for read access. */
export interface ReadPathValidationResult {
  /** Action: block, allow (known safe), warn (sensitive — elicit), or elicit (unknown). */
  action: 'block' | 'allow' | 'warn' | 'elicit';
  /** When action is 'block' or 'warn', the matched pattern (id, message). */
  pattern?: { id: string; message?: string };
}

/**
 * Validate a shell command using hardstop-patterns evaluation order.
 * 1. checkBashDangerous → BLOCK
 * 2. checkBashSafe → ALLOW
 * 3. Unknown → ELICIT (caller must prompt user; if elicitation unavailable, treat as deny).
 */
export function validateCommand(commandText: string): CommandValidationResult {
  const dangerous = checkBashDangerous(commandText);
  if (dangerous.matched && dangerous.pattern) {
    return {
      action: 'block',
      pattern: { id: dangerous.pattern.id, message: dangerous.pattern.message },
    };
  }
  const safe = checkBashSafe(commandText);
  if (safe.matched) {
    return { action: 'allow' };
  }
  return { action: 'elicit' };
}

/**
 * Validate a file path for read access using hardstop-patterns evaluation order.
 * 1. checkReadDangerous → BLOCK
 * 2. checkReadSensitive → WARN (caller should elicit)
 * 3. checkReadSafe → ALLOW
 * 4. If allowedPrefix (e.g. current user's USS home) is set and path is under it → ALLOW
 * 5. Unknown → ELICIT (caller should elicit; if unavailable, deny).
 */
export function validateReadPath(
  filePath: string,
  allowedPrefix?: string
): ReadPathValidationResult {
  const dangerous = checkReadDangerous(filePath);
  if (dangerous.matched && dangerous.pattern) {
    return {
      action: 'block',
      pattern: { id: dangerous.pattern.id, message: dangerous.pattern.message },
    };
  }
  const sensitive = checkReadSensitive(filePath);
  if (sensitive.matched && sensitive.pattern) {
    return {
      action: 'warn',
      pattern: { id: sensitive.pattern.id, message: sensitive.pattern.message },
    };
  }
  const safe = checkReadSafe(filePath);
  if (safe.matched) {
    return { action: 'allow' };
  }
  if (allowedPrefix) {
    const prefix = allowedPrefix.replace(/\/+$/, '');
    if (filePath === prefix || filePath.startsWith(prefix + '/')) {
      return { action: 'allow' };
    }
  }
  return { action: 'elicit' };
}
