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
 * Unit tests for USS command and read-path validation (hardstop-patterns order).
 */

import { describe, expect, it } from 'vitest';
import { validateCommand, validateReadPath } from '../src/tools/uss/command-validation.js';

describe('validateCommand', () => {
  it('returns block for dangerous commands (evaluation order: dangerous first)', () => {
    const r = validateCommand('rm -rf ~/');
    expect(r.action).toBe('block');
    expect(r.pattern?.id).toBeDefined();
    expect(r.pattern?.message).toBeDefined();
  });

  it('returns allow for known-safe commands', () => {
    const r = validateCommand('git status');
    expect(r.action).toBe('allow');
    expect(r.pattern).toBeUndefined();
  });

  it('returns allow for ls', () => {
    const r = validateCommand('ls -la');
    expect(r.action).toBe('allow');
  });

  it('returns elicit for unknown commands (neither dangerous nor safe)', () => {
    const r = validateCommand('mycustomscript.sh --foo');
    expect(r.action).toBe('elicit');
  });
});

describe('validateReadPath', () => {
  it('returns block for credential/dangerous paths (evaluation order: dangerous first)', () => {
    const r = validateReadPath('/home/user/.ssh/id_rsa');
    expect(r.action).toBe('block');
    expect(r.pattern?.id).toBeDefined();
  });

  it('returns warn for sensitive paths', () => {
    const r = validateReadPath('/some/path/passwords.txt');
    expect(r.action).toBe('warn');
    expect(r.pattern).toBeDefined();
  });

  it('returns allow for safe paths (e.g. source code)', () => {
    const r = validateReadPath('/u/myuser/src/main.c');
    expect(r.action).toBe('allow');
  });

  it('returns elicit for unknown paths', () => {
    const r = validateReadPath('/tmp/unknown-file-xyz.xyz');
    expect(r.action).toBe('elicit');
  });

  it('returns allow for path under allowedPrefix (e.g. USS home)', () => {
    const home = '/a/plape03';
    const r = validateReadPath('/a/plape03/all_bytes_37_to_utf8.bin', home);
    expect(r.action).toBe('allow');
  });

  it('returns elicit for path not under allowedPrefix when path would otherwise be unknown', () => {
    const r = validateReadPath('/tmp/unknown-file.xyz', '/a/plape03');
    expect(r.action).toBe('elicit');
  });

  it('returns block for path under allowedPrefix when path is dangerous', () => {
    const r = validateReadPath('/a/plape03/.ssh/id_rsa', '/a/plape03');
    expect(r.action).toBe('block');
  });
});
