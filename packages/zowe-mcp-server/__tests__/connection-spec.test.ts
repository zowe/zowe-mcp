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

import { describe, expect, it } from 'vitest';
import {
  parseConnectionSpec,
  parseConnectionSpecs,
  toHostNormalized,
  toPasswordEnvVarName,
  toSecretStorageKey,
} from '../src/zos/native/connection-spec.js';

describe('connection-spec', () => {
  describe('parseConnectionSpec', () => {
    it('parses user@host', () => {
      const r = parseConnectionSpec('user@host.example.com');
      expect(r).toEqual({ user: 'user', host: 'host.example.com', port: 22 });
    });

    it('parses user@host:port', () => {
      const r = parseConnectionSpec('USERID@sys1.example.com:22');
      expect(r).toEqual({
        user: 'USERID',
        host: 'sys1.example.com',
        port: 22,
      });
    });

    it('parses custom port', () => {
      const r = parseConnectionSpec('me@host:2222');
      expect(r).toEqual({ user: 'me', host: 'host', port: 2222 });
    });

    it('normalizes host to lowercase', () => {
      const r = parseConnectionSpec('u@HOST.EXAMPLE.COM');
      expect(r.host).toBe('host.example.com');
    });

    it('trims whitespace', () => {
      const r = parseConnectionSpec('  user @ host  ');
      expect(r.user).toBe('user');
      expect(r.host).toBe('host');
    });

    it('throws on empty spec', () => {
      expect(() => parseConnectionSpec('')).toThrow('empty');
      expect(() => parseConnectionSpec('   ')).toThrow('empty');
    });

    it('throws when @ is missing', () => {
      expect(() => parseConnectionSpec('userhost')).toThrow('user@host');
    });

    it('throws when only @', () => {
      expect(() => parseConnectionSpec('@')).toThrow('user@host');
    });

    it('throws when port is invalid', () => {
      expect(() => parseConnectionSpec('u@h:0')).toThrow('Invalid port');
      expect(() => parseConnectionSpec('u@h:99999')).toThrow('Invalid port');
      expect(() => parseConnectionSpec('u@h:abc')).toThrow('Invalid port');
    });
  });

  describe('parseConnectionSpecs', () => {
    it('parses multiple specs', () => {
      const r = parseConnectionSpecs(['u1@h1', 'u2@h2:2222']);
      expect(r).toHaveLength(2);
      expect(r[0]).toEqual({ user: 'u1', host: 'h1', port: 22 });
      expect(r[1]).toEqual({ user: 'u2', host: 'h2', port: 2222 });
    });

    it('throws on first invalid spec', () => {
      expect(() => parseConnectionSpecs(['u@h', 'bad'])).toThrow('Invalid connection spec');
    });
  });

  describe('toHostNormalized', () => {
    it('replaces dots with underscores and lowercases', () => {
      expect(toHostNormalized('sys1.example.com')).toBe('sys1_example_com');
    });
  });

  describe('toPasswordEnvVarName', () => {
    it('produces env var name with uppercase user and host', () => {
      expect(toPasswordEnvVarName('USERID', 'sys1.example.com')).toBe(
        'ZOWE_MCP_PASSWORD_USERID_SYS1_EXAMPLE_COM'
      );
    });
  });

  describe('toSecretStorageKey', () => {
    it('produces shared Zowe OSS key format', () => {
      expect(toSecretStorageKey('USERID', 'sys1.example.com')).toBe(
        'zowe.ssh.password.USERID.sys1_example_com'
      );
    });
  });
});
