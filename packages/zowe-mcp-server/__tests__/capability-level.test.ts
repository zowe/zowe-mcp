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
  type CapabilityTier,
  type EffectLevel,
  ResourceEffect,
  hintsForTool,
  maxEffectLevel,
  parseCapabilityTier,
  parseEffectLevel,
  resolveCapabilityTier,
} from '../src/capability-level.js';

describe('parseCapabilityTier', () => {
  it.each([
    ['read-strict', 'read-strict'],
    ['read', 'read'],
    ['update', 'update'],
    ['delete', 'delete'],
    ['full', 'full'],
    ['  READ  ', 'read'],
    ['FULL', 'full'],
    ['Read-Strict', 'read-strict'],
  ] as [string, CapabilityTier][])('parses "%s" as %s', (input, expected) => {
    expect(parseCapabilityTier(input)).toBe(expected);
  });

  it('returns undefined for unrecognised input', () => {
    expect(parseCapabilityTier('invalid')).toBeUndefined();
    expect(parseCapabilityTier('')).toBeUndefined();
    expect(parseCapabilityTier(undefined)).toBeUndefined();
  });
});

describe('resolveCapabilityTier', () => {
  it('returns the option when provided', () => {
    expect(resolveCapabilityTier({ option: 'full', env: 'read', argv: 'delete' })).toBe('full');
  });

  it('falls back to argv when option is absent', () => {
    expect(resolveCapabilityTier({ argv: 'update', env: 'full' })).toBe('update');
  });

  it('falls back to env when option and argv are absent', () => {
    expect(resolveCapabilityTier({ env: 'delete' })).toBe('delete');
  });

  it('defaults to read-strict when all sources are absent', () => {
    expect(resolveCapabilityTier({})).toBe('read-strict');
  });

  it('skips invalid argv and falls to env', () => {
    expect(resolveCapabilityTier({ argv: 'bogus', env: 'update' })).toBe('update');
  });

  it('skips invalid env and defaults to read-strict', () => {
    expect(resolveCapabilityTier({ env: 'bogus' })).toBe('read-strict');
  });
});

describe('maxEffectLevel', () => {
  it.each([
    ['read-strict', ResourceEffect.READ],
    ['read', ResourceEffect.READ],
    ['update', ResourceEffect.UPDATE],
    ['delete', ResourceEffect.DELETE],
    ['full', ResourceEffect.EXECUTE],
  ] as [CapabilityTier, EffectLevel][])('tier %s allows max level %d', (tier, expected) => {
    expect(maxEffectLevel(tier)).toBe(expected);
  });
});

describe('hintsForTool', () => {
  it('level NONE always returns readOnlyHint regardless of tier', () => {
    for (const tier of ['read-strict', 'read', 'update', 'delete', 'full'] as CapabilityTier[]) {
      expect(hintsForTool(ResourceEffect.NONE, tier)).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
  });

  it('level READ + read-strict returns readOnlyHint=false (prompt)', () => {
    expect(hintsForTool(ResourceEffect.READ, 'read-strict')).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it('level READ + read returns readOnlyHint=true (auto-approved)', () => {
    expect(hintsForTool(ResourceEffect.READ, 'read')).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it('level READ + higher tiers returns readOnlyHint=true', () => {
    for (const tier of ['update', 'delete', 'full'] as CapabilityTier[]) {
      expect(hintsForTool(ResourceEffect.READ, tier)).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
  });

  it('level UPDATE returns not-readonly, not-destructive', () => {
    expect(hintsForTool(ResourceEffect.UPDATE, 'update')).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it('level DELETE returns destructiveHint=true', () => {
    expect(hintsForTool(ResourceEffect.DELETE, 'delete')).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('level EXECUTE returns destructiveHint=true', () => {
    expect(hintsForTool(ResourceEffect.EXECUTE, 'full')).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });
});

describe('parseEffectLevel', () => {
  it.each([
    ['none', 0],
    ['read', 1],
    ['update', 2],
    ['delete', 3],
    ['execute', 4],
    ['NONE', 0],
    ['Read', 1],
    ['UPDATE', 2],
    [' execute ', 4],
  ] as const)('parses name %s → %d', (input, expected) => {
    expect(parseEffectLevel(input)).toBe(expected);
  });

  it.each([0, 1, 2, 3, 4] as const)('accepts numeric %d', n => {
    expect(parseEffectLevel(n)).toBe(n);
  });

  it.each([-1, 5, 99])('rejects out-of-range number %d', n => {
    expect(parseEffectLevel(n)).toBeUndefined();
  });

  it.each(['bad', 'readwrite', ''])('rejects unknown string "%s"', s => {
    expect(parseEffectLevel(s)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(parseEffectLevel(undefined)).toBeUndefined();
  });
});

describe('ResourceEffect constants', () => {
  it('has expected numeric values', () => {
    expect(ResourceEffect.NONE).toBe(0);
    expect(ResourceEffect.READ).toBe(1);
    expect(ResourceEffect.UPDATE).toBe(2);
    expect(ResourceEffect.DELETE).toBe(3);
    expect(ResourceEffect.EXECUTE).toBe(4);
  });
});
