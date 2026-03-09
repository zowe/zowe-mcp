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
 * Unit tests for TSO command validation (block → elicit → safe → unknown elicit).
 */

import { describe, expect, it } from 'vitest';
import { validateTsoCommand } from '../src/tools/tso/tso-command-validation.js';

describe('validateTsoCommand', () => {
  it('returns block for system dataset DELETE (SYS1, SYSL, SYS2)', () => {
    const r = validateTsoCommand('DELETE SYS1.PARMLIB');
    expect(r.action).toBe('block');
    expect(r.pattern?.id).toBe('tso-delete-system');
    expect(r.pattern?.message).toMatch(/system|SYS1/);
    expect(validateTsoCommand('DEL SYS1.X').action).toBe('block');
    expect(validateTsoCommand('DELETE SYSL.whatever').action).toBe('block');
    expect(validateTsoCommand('DELETE SYS2.DATA').action).toBe('block');
  });

  it('returns block for system dataset RENAME', () => {
    const r = validateTsoCommand('RENAME SYS1.OLD NEW.DSN');
    expect(r.action).toBe('block');
    expect(r.pattern?.id).toBe('tso-rename-system');
    expect(validateTsoCommand('REN SYS2.X Y').action).toBe('block');
  });

  it('returns elicit for user dataset DELETE (approval required)', () => {
    const r = validateTsoCommand('DELETE USER.DATA');
    expect(r.action).toBe('elicit');
    expect(r.pattern?.id).toBe('tso-delete');
    expect(validateTsoCommand('DEL USER.DATA').action).toBe('elicit');
  });

  it('returns elicit for user dataset RENAME and for SUBMIT', () => {
    expect(validateTsoCommand('RENAME OLD.DSN NEW.DSN').action).toBe('elicit');
    expect(validateTsoCommand('REN USER.A USER.B').action).toBe('elicit');
    expect(validateTsoCommand('SUBMIT USER.JCL(JOBCARD)').action).toBe('elicit');
  });

  it('returns block for always-dangerous commands (PASSWORD, CALL, ALTER, OSHELL non-pwd)', () => {
    expect(validateTsoCommand('CALL LIB.LOAD(MEMBER)').action).toBe('block');
    expect(validateTsoCommand('PASSWORD').action).toBe('block');
    expect(validateTsoCommand('PROFILE').action).toBe('block');
    expect(validateTsoCommand('ALTER ...').action).toBe('block');
    expect(validateTsoCommand('OSHELL ls').action).toBe('block');
  });

  it('returns allow for safe commands', () => {
    expect(validateTsoCommand('LISTDS USER.DATA').action).toBe('allow');
    expect(validateTsoCommand('LISTD USER.DATA').action).toBe('allow');
    expect(validateTsoCommand('LISTALC').action).toBe('allow');
    expect(validateTsoCommand('LISTA').action).toBe('allow');
    expect(validateTsoCommand('LISTCAT').action).toBe('allow');
    expect(validateTsoCommand('LISTC').action).toBe('allow');
    expect(validateTsoCommand('STATUS').action).toBe('allow');
    expect(validateTsoCommand('HELP').action).toBe('allow');
    expect(validateTsoCommand('WHO').action).toBe('allow');
    expect(validateTsoCommand('TIME').action).toBe('allow');
    expect(validateTsoCommand('SYSTEM').action).toBe('allow');
  });

  it('returns block for all OSHELL commands', () => {
    for (const cmd of [
      'OSHELL pwd',
      "OSHELL 'pwd'",
      'OSHELL "pwd"',
      'OSHELL ls',
      'OSHELL whoami',
    ]) {
      const r = validateTsoCommand(cmd);
      expect(r.action).toBe('block');
      expect(r.pattern?.id).toBe('tso-oshell');
    }
  });

  it('normalizes command (trim, collapse spaces, case) before matching', () => {
    expect(validateTsoCommand('  listds   user.data  ').action).toBe('allow');
    expect(validateTsoCommand('delete  user.data').action).toBe('elicit');
  });

  it('returns elicit for unknown commands', () => {
    const r = validateTsoCommand('CUSTOMCMD PARM');
    expect(r.action).toBe('elicit');
    expect(r.pattern).toBeUndefined();
  });
});
