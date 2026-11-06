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
import {
  buildTsoQueryCommand,
  validateTsoCommand,
} from '../src/tools/tso/tso-command-validation.js';

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

  it('returns allow for read-only RACF queries (LISTGRP, LISTDSD, RLIST, SEARCH)', () => {
    expect(validateTsoCommand('LISTGRP SYS1').action).toBe('allow');
    expect(validateTsoCommand('LG SYS1').action).toBe('allow');
    expect(validateTsoCommand("LISTDSD DATASET('USER.DATA') ALL").action).toBe('allow');
    expect(validateTsoCommand('RLIST FACILITY BPX.SUPERUSER').action).toBe('allow');
    expect(validateTsoCommand('SEARCH CLASS(USER)').action).toBe('allow');
  });

  it('returns elicit for SEARCH ... CLIST, which writes a data set', () => {
    // TSO accepts any unambiguous keyword abbreviation; CLI and CLIS are unique
    // among SEARCH's operands (CL alone is ambiguous with CLASS).
    for (const cmd of [
      'SEARCH CLASS(USER) CLIST',
      "SR CLASS(FACILITY) CLIST('RLIST FACILITY ')",
      "SEARCH CLI('LISTUSER ')",
      'search clis',
    ]) {
      const r = validateTsoCommand(cmd);
      expect({ cmd, action: r.action, id: r.pattern?.id }).toEqual({
        cmd,
        action: 'elicit',
        id: 'tso-search-clist',
      });
    }
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

describe('buildTsoQueryCommand', () => {
  it('trims and collapses spaces, preserving the command', () => {
    expect(buildTsoQueryCommand('  LISTUSER   USER01   TSO ')).toBe('LISTUSER USER01 TSO');
    expect(buildTsoQueryCommand('LISTUSER * OMVS NORACF')).toBe('LISTUSER * OMVS NORACF');
    expect(buildTsoQueryCommand("listdsd dataset('USER.DATA') all")).toBe(
      "listdsd dataset('USER.DATA') all"
    );
    expect(buildTsoQueryCommand('LISTALC')).toBe('LISTALC');
  });

  it.each([
    'LISTUSER A;DELETE X',
    'LISTUSER A\nDELETE X',
    'LISTUSER A|B',
    'LISTUSER A&B',
    'LISTUSER `x`',
    'LISTUSER <x',
    'LISTUSER >x',
    '',
  ])('rejects characters that could chain commands: %j', commandText => {
    expect(() => buildTsoQueryCommand(commandText)).toThrow('Invalid TSO query command');
  });

  it.each([
    'DELETE USER.DATA',
    'ALTUSER X SPECIAL',
    'PERMIT A.B ID(X)',
    'SUBMIT USER.JCL',
    'EXEC X',
  ])('rejects non-query verb %j', commandText => {
    expect(() => buildTsoQueryCommand(commandText)).toThrow('not a read-only TSO query command');
  });

  it('rejects a query verb whose arguments need approval under the safety policy', () => {
    expect(() => buildTsoQueryCommand('SEARCH CLASS(USER) CLIST')).toThrow('needs user approval');
    expect(() => buildTsoQueryCommand("SEARCH CLI('LISTUSER ')")).toThrow('needs user approval');
  });
});

describe('RACF command direction, SEARCH CLIST and LISTCAT OUTFILE patterns', () => {
  const cases: [string, 'allow' | 'elicit', string | undefined][] = [
    ['LISTUSER U1 AT(.U2)', 'elicit', 'tso-racf-command-direction'],
    ['LG SYS1 ONLYAT(NODEB.U2)', 'elicit', 'tso-racf-command-direction'],
    ['SR CLASS(USER) O(.U2)', 'elicit', 'tso-racf-command-direction'],
    ['RLIST FACILITY X.Y ON(NODE.U)', 'elicit', 'tso-racf-command-direction'],
    ['LISTDSD DATASET(A.B) ONLYA(.U2)', 'elicit', 'tso-racf-command-direction'],
    ['LISTDSD DATASET(A.B) ALL', 'allow', undefined],
    ['SEARCH MASK(SYS1.AT)', 'allow', undefined],
    ["LISTDSD DATASET('X.AT(Y)')", 'allow', undefined],
    ['SEARCH CLIST', 'elicit', 'tso-search-clist'],
    ["SEARCH CLASS(USER) CLI('LISTUSER ')", 'elicit', 'tso-search-clist'],
    ['SR CLASS(USER),CLIS', 'elicit', 'tso-search-clist'],
    ['SEARCH CLASS(USER)CLIST', 'elicit', 'tso-search-clist'],
    ['SEARCH MASK(SYS1.CLIST)', 'allow', undefined],
    ['SEARCH FILTER(USER.**.CLIST)', 'allow', undefined],
    ['LISTCAT OUTFILE(DD1)', 'elicit', 'tso-listcat-outfile'],
    ['LISTC ENTRIES(A.B) OFILE(DD1)', 'elicit', 'tso-listcat-outfile'],
    ['LISTCAT ENT(A.B) OU (DD1)', 'elicit', 'tso-listcat-outfile'],
    ["LISTCAT ENTRIES('A.OFILE(B)')", 'allow', undefined],
    ['LISTCAT ENTRIES(A.B) ALL', 'allow', undefined],
    ['ST', 'allow', undefined],
    ['LISTB', 'allow', undefined],
  ];

  it.each(cases)('%s', (cmd, action, id) => {
    const r = validateTsoCommand(cmd);
    expect({ cmd, action: r.action, id: r.pattern?.id }).toEqual({
      cmd,
      action,
      id,
    });
  });
});

describe('buildTsoQueryCommand hardening', () => {
  it.each([
    'WHO',
    'SYSTEM',
    'LISTUSER U1 AT(.U2)',
    'LG SYS1 ONLYAT(NODEB.U2)',
    'SR CLASS(USER) O(.U2)',
    'LISTCAT OUTFILE(DD1)',
    'LISTC ENTRIES(A.B) OFILE(DD1)',
  ])('rejects %j', commandText => {
    expect(() => buildTsoQueryCommand(commandText)).toThrow();
  });

  it('includes the matched pattern message in the error', () => {
    expect(() => buildTsoQueryCommand('LISTUSER U1 AT(.U2)')).toThrow(/AT\/ONLYAT directs/);
    expect(() => buildTsoQueryCommand('LISTCAT OUTFILE(DD1)')).toThrow(/OUTFILE\/OFILE writes/);
  });

  it.each(['ST', 'LISTB', 'SEARCH MASK(SYS1.CLIST)', 'SEARCH FILTER(USER.**.CLIST)'])(
    'accepts %j',
    commandText => {
      expect(buildTsoQueryCommand(commandText)).toBe(commandText);
    }
  );
});
