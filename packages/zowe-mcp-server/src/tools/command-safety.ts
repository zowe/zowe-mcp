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
 * Shared command safety evaluation for pattern-based command validation.
 *
 * Used by TSO and console tools. Evaluation order:
 * 1. dangerous → BLOCK
 * 2. elicit → ELICIT (user approval required)
 * 3. safe → ALLOW
 * 4. unknown → ELICIT
 */

export interface SafetyPatternEntry {
  id: string;
  message?: string;
  pattern: string;
}

export interface CommandPatterns {
  dangerous: SafetyPatternEntry[];
  elicit: SafetyPatternEntry[];
  safe: SafetyPatternEntry[];
}

export interface CommandSafetyResult {
  action: 'block' | 'allow' | 'elicit';
  pattern?: { id: string; message?: string };
}

/**
 * Evaluate a command against a set of safety patterns.
 *
 * The command is normalized (trimmed, whitespace collapsed, uppercased) before matching.
 * Patterns are tested in order: dangerous → elicit → safe → fallback elicit.
 */
export function evaluateCommandSafety(
  commandText: string,
  patterns: CommandPatterns
): CommandSafetyResult {
  const normalized = commandText.trim().replace(/\s+/g, ' ').toUpperCase();

  for (const entry of patterns.dangerous) {
    if (new RegExp(entry.pattern, 'i').test(normalized)) {
      return { action: 'block', pattern: { id: entry.id, message: entry.message } };
    }
  }

  for (const entry of patterns.elicit) {
    if (new RegExp(entry.pattern, 'i').test(normalized)) {
      return { action: 'elicit', pattern: { id: entry.id, message: entry.message } };
    }
  }

  for (const entry of patterns.safe) {
    if (new RegExp(entry.pattern, 'i').test(normalized)) {
      return { action: 'allow' };
    }
  }

  return { action: 'elicit' };
}

/**
 * Formats the error returned to the model when a command is blocked.
 *
 * The per-pattern `message` only explains *why* a command is dangerous (e.g.
 * "ALTER changes VSAM or catalog entries."), which models tend to reinterpret as
 * a usage hint and then helpfully explain how to run the command. This wraps the
 * reason in an unambiguous statement that the command was refused and not run, so
 * the assistant communicates the block clearly to the user.
 *
 * @param kind - "TSO" or "console", used in the message.
 * @param reason - The per-pattern reason, if any.
 */
export function formatBlockedCommandMessage(kind: 'TSO' | 'console', reason?: string): string {
  const why = reason ?? 'It is classified as dangerous.';
  return (
    `This ${kind} command was BLOCKED by the z/OS MCP safety policy and was NOT run. ${why} ` +
    `Do not retry it or explain how to run it; if it is genuinely required, advise the user to run it ` +
    `through an authorized channel (such as a 3270 session) under their own authority.`
  );
}
