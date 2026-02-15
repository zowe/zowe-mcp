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
 * Unit tests for SessionState — per-system working context management.
 */

import { describe, expect, it } from 'vitest';
import { SessionState } from '../src/zos/session.js';

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

    it('should return undefined prefix when no system is active', () => {
      const state = new SessionState();
      expect(state.getDsnPrefix()).toBeUndefined();
    });
  });

  describe('setActiveSystem', () => {
    it('should set the active system and create context with user ID as prefix', () => {
      const state = new SessionState();
      const ctx = state.setActiveSystem('sys1', 'IBMUSER');
      expect(state.getActiveSystem()).toBe('sys1');
      expect(ctx.userId).toBe('IBMUSER');
      expect(ctx.dsnPrefix).toBe('IBMUSER');
    });

    it('should preserve context when switching back to a previously used system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      state.setDsnPrefix('IBMUSER.DEV');
      state.setActiveSystem('sys2', 'DEVUSER');
      // Switch back to sys1
      const ctx = state.setActiveSystem('sys1', 'IBMUSER');
      expect(ctx.dsnPrefix).toBe('IBMUSER.DEV'); // preserved, not reset
      expect(ctx.userId).toBe('IBMUSER');
    });

    it('should not overwrite existing context on re-activation', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      state.setDsnPrefix('CUSTOM.PREFIX');
      // Re-activate with a different defaultUserId — should NOT reset
      const ctx = state.setActiveSystem('sys1', 'OTHERUSER');
      expect(ctx.userId).toBe('IBMUSER'); // original, not OTHERUSER
      expect(ctx.dsnPrefix).toBe('CUSTOM.PREFIX');
    });
  });

  describe('getActiveContext', () => {
    it('should throw when no system is active', () => {
      const state = new SessionState();
      expect(() => state.getActiveContext()).toThrow('No active z/OS system');
    });

    it('should return context for the active system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      const ctx = state.getActiveContext();
      expect(ctx.userId).toBe('IBMUSER');
    });
  });

  describe('requireSystem', () => {
    it('should return explicit system ID when provided', () => {
      const state = new SessionState();
      expect(state.requireSystem('explicit')).toBe('explicit');
    });

    it('should return active system when no explicit ID', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      expect(state.requireSystem()).toBe('sys1');
    });

    it('should prefer explicit ID over active system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      expect(state.requireSystem('sys2')).toBe('sys2');
    });

    it('should throw when no system is active and none provided', () => {
      const state = new SessionState();
      expect(() => state.requireSystem()).toThrow('No active z/OS system');
    });
  });

  describe('DSN prefix management', () => {
    it('should default prefix to user ID', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      expect(state.getDsnPrefix()).toBe('IBMUSER');
    });

    it('should update prefix and uppercase it', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      const ctx = state.setDsnPrefix('ibmuser.dev.src');
      expect(ctx.dsnPrefix).toBe('IBMUSER.DEV.SRC');
    });

    it('should throw when setting prefix with no active system', () => {
      const state = new SessionState();
      expect(() => state.setDsnPrefix('TEST')).toThrow('No active z/OS system');
    });

    it('should get prefix for a specific system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      state.setActiveSystem('sys2', 'DEVUSER');
      expect(state.getDsnPrefix('sys1')).toBe('IBMUSER');
      expect(state.getDsnPrefix('sys2')).toBe('DEVUSER');
    });

    it('should return undefined prefix for unknown system', () => {
      const state = new SessionState();
      expect(state.getDsnPrefix('unknown')).toBeUndefined();
    });

    it('should isolate prefixes between systems', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      state.setDsnPrefix('IBMUSER.PROD');
      state.setActiveSystem('sys2', 'DEVUSER');
      state.setDsnPrefix('DEVUSER.TEST');
      expect(state.getDsnPrefix('sys1')).toBe('IBMUSER.PROD');
      expect(state.getDsnPrefix('sys2')).toBe('DEVUSER.TEST');
    });
  });

  describe('getAllContexts', () => {
    it('should return summaries for all systems', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      state.setActiveSystem('sys2', 'DEVUSER');
      const contexts = state.getAllContexts();
      expect(contexts).toHaveLength(2);
      expect(contexts).toContainEqual({ system: 'sys1', userId: 'IBMUSER', dsnPrefix: 'IBMUSER' });
      expect(contexts).toContainEqual({ system: 'sys2', userId: 'DEVUSER', dsnPrefix: 'DEVUSER' });
    });
  });

  describe('getContext', () => {
    it('should return context for a known system', () => {
      const state = new SessionState();
      state.setActiveSystem('sys1', 'IBMUSER');
      expect(state.getContext('sys1')).toEqual({ userId: 'IBMUSER', dsnPrefix: 'IBMUSER' });
    });

    it('should return undefined for unknown system', () => {
      const state = new SessionState();
      expect(state.getContext('unknown')).toBeUndefined();
    });
  });
});
