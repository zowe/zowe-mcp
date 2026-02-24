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
 * Unit tests for SessionState and resolveSystemForTool.
 */

import { describe, expect, it } from 'vitest';
import { resolveSystemForTool, SessionState } from '../src/zos/session.js';
import { SystemRegistry } from '../src/zos/system.js';

describe('SessionState', () => {
  describe('initial state', () => {
    it('should have no active system initially', () => {
      const state = new SessionState();
      expect(state.getActiveSystem()).toBeUndefined();
    });

    it('should return empty contexts list initially', () => {
      const state = new SessionState();
      expect(state.getAllContexts()).toEqual([]);
    });
  });

  describe('setActiveSystem', () => {
    it('should set the active system and create context with user ID', () => {
      const state = new SessionState();
      const ctx = state.setActiveSystem('sys1', 'USER');
      expect(state.getActiveSystem()).toBe('sys1');
      expect(ctx.userId).toBe('USER');
    });

    it('should preserve context when switching back to a previously used system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'USER');
      state.setActiveSystem('sys2', 'DEVUSER');
      const ctx = state.setActiveSystem('sys1', 'USER');
      expect(ctx.userId).toBe('USER');
    });

    it('should update existing context on re-activation', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'USER');
      const ctx = state.setActiveSystem('sys1', 'OTHERUSER');
      expect(ctx.userId).toBe('OTHERUSER');
    });
  });

  describe('getActiveContext', () => {
    it('should throw when no system is active', () => {
      const state = new SessionState();
      expect(() => state.getActiveContext()).toThrow('No active z/OS system');
    });

    it('should return context for the active system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'USER');
      const ctx = state.getActiveContext();
      expect(ctx.userId).toBe('USER');
    });
  });

  describe('requireSystem', () => {
    it('should return explicit system ID when provided', () => {
      const state = new SessionState();
      expect(state.requireSystem('explicit')).toBe('explicit');
    });

    it('should return active system when no explicit ID', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'USER');
      expect(state.requireSystem()).toBe('sys1');
    });

    it('should prefer explicit ID over active system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'USER');
      expect(state.requireSystem('sys2')).toBe('sys2');
    });

    it('should throw when no system is active and none provided', () => {
      const state = new SessionState();
      expect(() => state.requireSystem()).toThrow('No active z/OS system');
    });
  });

  describe('getAllContexts', () => {
    it('should return summaries for all systems', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'USER');
      state.setActiveSystem('sys2', 'DEVUSER');
      const contexts = state.getAllContexts();
      expect(contexts).toHaveLength(2);
      expect(contexts).toContainEqual({ system: 'sys1', userId: 'USER' });
      expect(contexts).toContainEqual({ system: 'sys2', userId: 'DEVUSER' });
    });
  });

  describe('getContext', () => {
    it('should return context for a known system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'USER');
      expect(state.getContext('sys1')).toEqual({ userId: 'USER' });
    });

    it('should return undefined for unknown system', () => {
      const state = new SessionState();
      expect(state.getContext('unknown')).toBeUndefined();
    });
  });
});

describe('resolveSystemForTool', () => {
  it('should return active system when system param is omitted', () => {
    const registry = new SystemRegistry();
    registry.register({ host: 'sys1.example.com', port: 443 });
    const state = new SessionState();
    state.setActiveSystem('sys1.example.com', 'USER');
    expect(resolveSystemForTool(registry, state).systemId).toBe('sys1.example.com');
  });

  it('should throw when no system param and no active system', () => {
    const registry = new SystemRegistry();
    registry.register({ host: 'sys1.example.com', port: 443 });
    const state = new SessionState();
    expect(() => resolveSystemForTool(registry, state)).toThrow('No active z/OS system');
  });

  it('should resolve FQDN to canonical host when registered', () => {
    const registry = new SystemRegistry();
    registry.register({ host: 'sys1.example.com', port: 443 });
    const state = new SessionState();
    expect(resolveSystemForTool(registry, state, 'sys1.example.com').systemId).toBe(
      'sys1.example.com'
    );
  });

  it('should resolve unqualified hostname to FQDN when unambiguous', () => {
    const registry = new SystemRegistry();
    registry.register({ host: 'sys1.example.com', port: 443 });
    const state = new SessionState();
    expect(resolveSystemForTool(registry, state, 'sys1').systemId).toBe('sys1.example.com');
  });

  it('should resolve case-insensitively', () => {
    const registry = new SystemRegistry();
    registry.register({ host: 'Sys1.Example.COM', port: 443 });
    const state = new SessionState();
    expect(resolveSystemForTool(registry, state, 'SYS1').systemId).toBe('Sys1.Example.COM');
  });

  it('should throw when system not found', () => {
    const registry = new SystemRegistry();
    registry.register({ host: 'sys1.example.com', port: 443 });
    const state = new SessionState();
    expect(() => resolveSystemForTool(registry, state, 'unknown')).toThrow(
      "System 'unknown' not found"
    );
  });

  it('should throw when unqualified name is ambiguous', () => {
    const registry = new SystemRegistry();
    registry.register({ host: 'sys1.a.example.com', port: 443 });
    registry.register({ host: 'sys1.b.example.com', port: 443 });
    const state = new SessionState();
    expect(() => resolveSystemForTool(registry, state, 'sys1')).toThrow("System 'sys1' not found");
  });
});
