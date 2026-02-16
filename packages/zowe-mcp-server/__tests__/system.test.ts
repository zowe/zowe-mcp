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
 * Unit tests for SystemRegistry.
 */

import { describe, expect, it } from 'vitest';
import { SystemRegistry } from '../src/zos/system.js';

describe('SystemRegistry', () => {
  it('should start empty', () => {
    const reg = new SystemRegistry();
    expect(reg.size).toBe(0);
    expect(reg.list()).toEqual([]);
    expect(reg.listInfo()).toEqual([]);
  });

  it('should register and retrieve a system', () => {
    const reg = new SystemRegistry();
    reg.register({ host: 'sys1.example.com', port: 443, description: 'Dev LPAR' });
    expect(reg.size).toBe(1);
    expect(reg.has('sys1.example.com')).toBe(true);
    expect(reg.get('sys1.example.com')).toEqual({
      host: 'sys1.example.com',
      port: 443,
      description: 'Dev LPAR',
    });
  });

  it('should return undefined for unknown system', () => {
    const reg = new SystemRegistry();
    expect(reg.get('nonexistent')).toBeUndefined();
    expect(reg.has('nonexistent')).toBe(false);
  });

  it('should overwrite existing system on re-register', () => {
    const reg = new SystemRegistry();
    reg.register({ host: 'sys1.example.com', port: 443, description: 'Old' });
    reg.register({ host: 'sys1.example.com', port: 8443, description: 'New' });
    expect(reg.size).toBe(1);
    expect(reg.get('sys1.example.com')?.port).toBe(8443);
    expect(reg.get('sys1.example.com')?.description).toBe('New');
  });

  it('should list all system IDs', () => {
    const reg = new SystemRegistry();
    reg.register({ host: 'sys1.example.com', port: 443 });
    reg.register({ host: 'sys2.example.com', port: 443 });
    expect(reg.list()).toEqual(['sys1.example.com', 'sys2.example.com']);
  });

  it('should list summary info without internal details', () => {
    const reg = new SystemRegistry();
    reg.register({ host: 'sys1.example.com', port: 443, basePath: '/zosmf', description: 'Dev' });
    reg.register({ host: 'sys2.example.com', port: 8443 });
    const info = reg.listInfo();
    expect(info).toEqual([
      { host: 'sys1.example.com', description: 'Dev' },
      { host: 'sys2.example.com', description: undefined },
    ]);
    // Verify port and basePath are NOT exposed
    expect(info[0]).not.toHaveProperty('port');
    expect(info[0]).not.toHaveProperty('basePath');
  });

  it('should handle optional fields', () => {
    const reg = new SystemRegistry();
    reg.register({ host: 'minimal.example.com', port: 443 });
    const sys = reg.get('minimal.example.com');
    expect(sys?.basePath).toBeUndefined();
    expect(sys?.description).toBeUndefined();
  });

  describe('getOrResolve', () => {
    it('returns exact match when host matches', () => {
      const reg = new SystemRegistry();
      reg.register({ host: 'sys1.example.com', port: 443 });
      expect(reg.getOrResolve('sys1.example.com')?.host).toBe('sys1.example.com');
    });

    it('resolves unqualified name when single match', () => {
      const reg = new SystemRegistry();
      reg.register({ host: 'sys1.example.com', port: 443 });
      expect(reg.getOrResolve('sys1')?.host).toBe('sys1.example.com');
      expect(reg.getOrResolve('SYS1')?.host).toBe('sys1.example.com');
      expect(reg.getOrResolve('Sys1')?.host).toBe('sys1.example.com');
    });

    it('resolves by first segment when host has different casing', () => {
      const reg = new SystemRegistry();
      reg.register({ host: 'SYS1.OTHER.COM', port: 443 });
      expect(reg.getOrResolve('sys1')?.host).toBe('SYS1.OTHER.COM');
    });

    it('resolves sys1 when two systems and input is sys1', () => {
      const reg = new SystemRegistry();
      reg.register({ host: 'sys1.example.com', port: 443 });
      reg.register({ host: 'sys2.example.com', port: 443 });
      expect(reg.getOrResolve('sys1')?.host).toBe('sys1.example.com');
    });

    it('returns undefined when unqualified name not found', () => {
      const reg = new SystemRegistry();
      reg.register({ host: 'sys1.example.com', port: 443 });
      reg.register({ host: 'sys2.example.com', port: 443 });
      expect(reg.getOrResolve('sys3')).toBeUndefined();
    });

    it('returns undefined when unqualified name is ambiguous', () => {
      const reg = new SystemRegistry();
      reg.register({ host: 'sys1.example.com', port: 443 });
      reg.register({ host: 'sys1.other.com', port: 443 });
      expect(reg.getOrResolve('sys1')).toBeUndefined();
    });

    it('returns exact match for unqualified-looking host that is full hostname', () => {
      const reg = new SystemRegistry();
      reg.register({ host: 'mysys', port: 443 });
      expect(reg.getOrResolve('mysys')?.host).toBe('mysys');
    });
  });
});
