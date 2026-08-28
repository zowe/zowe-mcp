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
 * Unit tests for console command safety patterns (block → elicit → allow → fallback elicit).
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { evaluateCommandSafety, type CommandPatterns } from '../src/tools/command-safety.js';

const require = createRequire(import.meta.url);
const patterns =
  require('../src/tools/console/console-command-patterns.json') as unknown as CommandPatterns;

const evalCmd = (text: string) => evaluateCommandSafety(text, patterns);

describe('console command patterns', () => {
  it('blocks system-stopping commands', () => {
    expect(evalCmd('QUIESCE').action).toBe('block');
    expect(evalCmd('HALT EOD').action).toBe('block');
    expect(evalCmd('Z EOD').action).toBe('block');
    expect(evalCmd('SHUTDOWN').action).toBe('block');
  });

  it('blocks system-stopping commands smuggled through ROUTE', () => {
    expect(evalCmd('RO SYS1,Z EOD').action).toBe('block');
    expect(evalCmd('ROUTE SYS1,HALT EOD').action).toBe('block');
    expect(evalCmd('ro *all, shutdown').action).toBe('block');
    expect(evalCmd('RO SYS1 , Z EOD').action).toBe('block');
    expect(evalCmd('RO SYS1,QUIESCE').pattern?.id).toBe('console-route-dangerous');
  });

  it('blocks sysplex partitioning', () => {
    expect(evalCmd('V XCF,SY02,OFFLINE').action).toBe('block');
    expect(evalCmd('VARY XCF,SY02,OFFLINE,RETAIN=YES').action).toBe('block');
    expect(evalCmd('v xcf,sy02,offline').pattern?.id).toBe('console-vary-xcf-offline');
  });

  it('elicits for ROUTE carrying non-dangerous commands', () => {
    expect(evalCmd('RO SYS1,D T').action).toBe('elicit');
    expect(evalCmd('ROUTE SYS2,D IPLINFO').action).toBe('elicit');
  });

  it('elicits for state-changing commands and their abbreviations', () => {
    expect(evalCmd('VARY CN(TEST),ONLINE').action).toBe('elicit');
    expect(evalCmd('V 0A80,OFFLINE').action).toBe('elicit');
    expect(evalCmd('CANCEL MYJOB').action).toBe('elicit');
    expect(evalCmd('C MYJOB').action).toBe('elicit');
    expect(evalCmd('E MYJOB,SRVCLASS=BATLOW').action).toBe('elicit');
    expect(evalCmd('P MYTASK').action).toBe('elicit');
    expect(evalCmd('F MYTASK,APPL=STOP').action).toBe('elicit');
    expect(evalCmd('S MYTASK').action).toBe('elicit');
    expect(evalCmd('SET SMF=00').action).toBe('elicit');
  });

  it('elicits for WTOR replies in both spellings', () => {
    expect(evalCmd('REPLY 01,CANCEL').action).toBe('elicit');
    const short = evalCmd('R 01,U');
    expect(short.action).toBe('elicit');
    expect(short.pattern?.id).toBe('console-r-reply');
  });

  it('elicits for the SET family including SETxxx and the T abbreviation', () => {
    expect(evalCmd('SET SMF=00').pattern?.id).toBe('console-set');
    expect(evalCmd('SETPROG APF,ADD,DSNAME=MY.APF,SMS').pattern?.id).toBe('console-set');
    expect(evalCmd('SETXCF START,POLICY,TYPE=SFM').action).toBe('elicit');
    expect(evalCmd('T CLOCK=12.00.00').pattern?.id).toBe('console-t-set');
  });

  it('elicits for device and recording commands and their abbreviations', () => {
    expect(evalCmd('MOUNT 0A80,VOL=(SL,WORK01)').action).toBe('elicit');
    expect(evalCmd('M 0A80,VOL=(SL,WORK01)').action).toBe('elicit');
    expect(evalCmd('U 0A80').action).toBe('elicit');
    expect(evalCmd('G 0A80,0A90').action).toBe('elicit');
    expect(evalCmd('I SMF').action).toBe('elicit');
    expect(evalCmd('CD SET,SDUMP=(ALLNUC,SQA)').action).toBe('elicit');
    expect(evalCmd('PD DELETE,DSN=PAGE.LOCAL1').action).toBe('elicit');
    expect(evalCmd('DD ADD,VOL=DUMP01').action).toBe('elicit');
    expect(evalCmd('IO STOP,DEV=0A80').action).toBe('elicit');
  });

  it('elicits for DUMP, SLIP, CONFIG/CF, and K', () => {
    expect(evalCmd('DUMP COMM=(TEST)').action).toBe('elicit');
    expect(evalCmd('SLIP SET,IF,A=TRACE,END').action).toBe('elicit');
    expect(evalCmd('CONFIG CPU(1),OFFLINE').action).toBe('elicit');
    expect(evalCmd('CF CHP(80),OFFLINE').action).toBe('elicit');
    expect(evalCmd('K E,D').action).toBe('elicit');
  });

  it('allows informational displays', () => {
    expect(evalCmd('D T').action).toBe('allow');
    expect(evalCmd('DISPLAY A,L').action).toBe('allow');
    expect(evalCmd('D IPLINFO').action).toBe('allow');
    expect(evalCmd('D SMF').action).toBe('allow');
    expect(evalCmd('D PARMLIB').action).toBe('allow');
  });

  it('does not confuse display-of-replies with a reply', () => {
    // D R,L lists outstanding WTORs (safe); R 01,... answers one (elicit)
    expect(evalCmd('D R,L').action).toBe('allow');
    expect(evalCmd('R 01,YES').action).toBe('elicit');
  });

  it('normalizes case and whitespace before matching', () => {
    expect(evalCmd('  d    t  ').action).toBe('allow');
    expect(evalCmd('quiesce').action).toBe('block');
    expect(evalCmd('v 0a80,offline').action).toBe('elicit');
  });

  it('falls back to elicit for unknown commands', () => {
    const r = evalCmd('TRACE ST,ON');
    expect(r.action).toBe('elicit');
    expect(r.pattern).toBeUndefined();
  });
});
