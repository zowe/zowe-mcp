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
  getStandalonePasswordFromEnv,
  parseConnectionSpec,
  parseConnectionSpecs,
  parseZoweMcpCredentialsEnv,
  toConnectionsEnvLookupKey,
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

  describe('toConnectionsEnvLookupKey', () => {
    it('omits port when 22', () => {
      expect(toConnectionsEnvLookupKey('USER', 'host.example.com', 22)).toBe(
        'user@host.example.com'
      );
    });

    it('includes non-default port', () => {
      expect(toConnectionsEnvLookupKey('Me', 'H', 2222)).toBe('me@h:2222');
    });
  });

  describe('parseZoweMcpCredentialsEnv', () => {
    it('returns empty map for undefined or blank', () => {
      expect(parseZoweMcpCredentialsEnv(undefined).size).toBe(0);
      expect(parseZoweMcpCredentialsEnv('  ').size).toBe(0);
    });

    it('normalizes JSON keys to lookup keys', () => {
      const map = parseZoweMcpCredentialsEnv(
        JSON.stringify({ 'USER@SYS1.EXAMPLE.COM': 'secret', 'u@h:2222': 'p2' })
      );
      expect(map.get('user@sys1.example.com')).toBe('secret');
      expect(map.get('u@h:2222')).toBe('p2');
    });

    it('throws on invalid JSON', () => {
      expect(() => parseZoweMcpCredentialsEnv('{')).toThrow('valid JSON');
    });

    it('throws when not an object', () => {
      expect(() => parseZoweMcpCredentialsEnv('[]')).toThrow('JSON object');
    });
  });

  describe('getStandalonePasswordFromEnv', () => {
    const spec = parseConnectionSpec('USERID@sys1.example.com');
    const envVar = toPasswordEnvVarName(spec.user, spec.host);

    it('prefers ZOWE_MCP_PASSWORD_* over ZOWE_MCP_CREDENTIALS', () => {
      const prevVar = process.env[envVar];
      const prevCred = process.env.ZOWE_MCP_CREDENTIALS;
      process.env[envVar] = 'from-env';
      process.env.ZOWE_MCP_CREDENTIALS = JSON.stringify({
        'userid@sys1.example.com': 'from-json',
      });
      try {
        expect(getStandalonePasswordFromEnv(spec)).toBe('from-env');
      } finally {
        if (prevVar === undefined) delete process.env[envVar];
        else process.env[envVar] = prevVar;
        if (prevCred === undefined) delete process.env.ZOWE_MCP_CREDENTIALS;
        else process.env.ZOWE_MCP_CREDENTIALS = prevCred;
      }
    });

    it('reads from ZOWE_MCP_CREDENTIALS when per-var unset', () => {
      const prevVar = process.env[envVar];
      const prevCred = process.env.ZOWE_MCP_CREDENTIALS;
      delete process.env[envVar];
      process.env.ZOWE_MCP_CREDENTIALS = JSON.stringify({
        'userid@sys1.example.com': 'from-json',
      });
      try {
        expect(getStandalonePasswordFromEnv(spec)).toBe('from-json');
      } finally {
        if (prevVar === undefined) delete process.env[envVar];
        else process.env[envVar] = prevVar;
        if (prevCred === undefined) delete process.env.ZOWE_MCP_CREDENTIALS;
        else process.env.ZOWE_MCP_CREDENTIALS = prevCred;
      }
    });
  });
});
