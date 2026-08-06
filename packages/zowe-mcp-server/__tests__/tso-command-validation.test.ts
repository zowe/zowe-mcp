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

  it('returns block for always-dangerous commands (PASSWORD, ALTER, OSHELL non-pwd)', () => {
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
    expect(validateTsoCommand('LISTBC').action).toBe('allow');
    expect(validateTsoCommand('STATUS').action).toBe('allow');
    expect(validateTsoCommand('HELP').action).toBe('allow');
    expect(validateTsoCommand('WHO').action).toBe('allow');
    expect(validateTsoCommand('TIME').action).toBe('allow');
    expect(validateTsoCommand('SYSTEM').action).toBe('allow');
  });

  it('returns elicit for CALL, EXEC/EX, and implicit % execs (arbitrary execution)', () => {
    const call = validateTsoCommand('CALL LIB.LOAD(MEMBER)');
    expect(call.action).toBe('elicit');
    expect(call.pattern?.id).toBe('tso-call');
    for (const cmd of ["EXEC 'USER.REXX(MYEXEC)'", "EX 'USER.CLIST(MYCLIST)'", '%MYEXEC PARM']) {
      const r = validateTsoCommand(cmd);
      expect(r.action).toBe('elicit');
      expect(r.pattern?.id).toBe('tso-exec');
    }
  });

  it('does not allow safe keywords appearing as operands of other commands', () => {
    // EXEC with a safe word as member name must not match the safe list
    expect(validateTsoCommand("EXEC 'USER.REXX(STATUS)'").action).toBe('elicit');
    // Unknown verb with safe word operand falls through to elicit, not allow
    expect(validateTsoCommand("SEND 'HI' USER(TIME)").action).toBe('elicit');
    expect(validateTsoCommand('ALLOC DA(WHO.DATA) SHR').action).toBe('elicit');
  });

  it('returns allow for LISTUSER/LU (read-only RACF display)', () => {
    expect(validateTsoCommand('LISTUSER').action).toBe('allow');
    expect(validateTsoCommand('LU KELDA16 TSO').action).toBe('allow');
  });

  it('returns elicit with a specific warning for security administration commands', () => {
    for (const cmd of [
      // RACF
      'ALTUSER VICTIM SPECIAL',
      'ADDUSER NEWGUY NAME(TEMP)',
      'PERMIT DATASET.* ID(X) ACCESS(READ)',
      'RDEFINE FACILITY MY.RESOURCE',
      'SETROPTS RACLIST(FACILITY) REFRESH',
      'CONNECT USERX GROUP(SYS1)',
      // Top Secret
      'TSS ADDTO(USERX) DSNAME(A.B)',
      // ACF2
      'ACF',
    ]) {
      const r = validateTsoCommand(cmd);
      expect(r.action).toBe('elicit');
      expect(r.pattern?.id).toBe('tso-security-admin');
    }
  });

  it('returns elicit with a specific warning for ALLOC/FREE and SEND', () => {
    for (const cmd of ['ALLOC DA(X.Y) NEW', 'ALLOCATE DA(X.Y) SHR', 'FREE FILE(SYSUT1)']) {
      const r = validateTsoCommand(cmd);
      expect(r.action).toBe('elicit');
      expect(r.pattern?.id).toBe('tso-alloc-free');
    }
    const send = validateTsoCommand("SEND 'HELLO' USER(OPER)");
    expect(send.action).toBe('elicit');
    expect(send.pattern?.id).toBe('tso-send');
  });

  it('does not misclassify commands that merely start with similar letters', () => {
    // COPY starts with CO (CONNECT abbreviation) but has no word boundary — fallback elicit
    const r = validateTsoCommand('COPY A B');
    expect(r.action).toBe('elicit');
    expect(r.pattern?.id).toBeUndefined();
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
