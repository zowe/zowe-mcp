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
 * Progressive capability levels for the Zowe MCP Server.
 *
 * Two concepts:
 *
 * 1. **Resource effect level** (per tool, 0-4) — what the tool does to resources:
 *    - 0: No resource effect (MCP server management)
 *    - 1: Read resources
 *    - 2: Update resources (create/write/modify)
 *    - 3: Delete resources
 *    - 4: Execute (submit jobs, run commands)
 *
 * 2. **Capability tier** (operator setting) — how much the server allows:
 *    - read-strict: 0+1 with client confirmations for reads
 *    - read: 0+1 auto-approved
 *    - update: 0+1+2
 *    - delete: 0+1+2+3
 *    - full: 0+1+2+3+4
 *
 * MCP hints (readOnlyHint, destructiveHint) are strictly derived from the
 * effect level and the active capability tier.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from './log.js';

/** Resource effect level declared per tool (0 = no resource effect, 4 = execute). */
export type EffectLevel = 0 | 1 | 2 | 3 | 4;

/** Named constants for resource effect levels. Use these in tool registrations. */
export const ResourceEffect = {
  /** No resource effect — MCP server management (connections, profiles, context). */
  NONE: 0 as EffectLevel,
  /** Read resources (list, read, search, download). */
  READ: 1 as EffectLevel,
  /** Update resources (create, write, copy, rename, modify). */
  UPDATE: 2 as EffectLevel,
  /** Delete resources (delete, cancel). */
  DELETE: 3 as EffectLevel,
  /** Execute (submit jobs, run commands). */
  EXECUTE: 4 as EffectLevel,
} as const;

const EFFECT_NAME_TO_LEVEL: Record<string, EffectLevel> = {
  none: ResourceEffect.NONE,
  read: ResourceEffect.READ,
  update: ResourceEffect.UPDATE,
  delete: ResourceEffect.DELETE,
  execute: ResourceEffect.EXECUTE,
};

export const EFFECT_LEVEL_NAME: Record<EffectLevel, string> = {
  0: 'none',
  1: 'read',
  2: 'update',
  3: 'delete',
  4: 'execute',
};

/**
 * Parses a resource effect level from a name or number.
 * Accepts: `'none'`, `'read'`, `'update'`, `'delete'`, `'execute'` (case-insensitive),
 * or numeric `0`–`4`. Returns undefined for unrecognized input.
 */
export function parseEffectLevel(input: string | number | undefined): EffectLevel | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'number') {
    return input >= 0 && input <= 4 ? (input as EffectLevel) : undefined;
  }
  return EFFECT_NAME_TO_LEVEL[input.trim().toLowerCase()];
}

/** Operator-configured capability tier controlling which tools register. */
export type CapabilityTier = 'read-strict' | 'read' | 'update' | 'delete' | 'full';

export const TIER_NAMES: readonly CapabilityTier[] = [
  'read-strict',
  'read',
  'update',
  'delete',
  'full',
];

export const TIER_TO_MAX_EFFECT: Record<CapabilityTier, EffectLevel> = {
  'read-strict': ResourceEffect.READ,
  read: ResourceEffect.READ,
  update: ResourceEffect.UPDATE,
  delete: ResourceEffect.DELETE,
  full: ResourceEffect.EXECUTE,
};

/**
 * Parses a capability tier string. Returns undefined for unrecognized input.
 */
export function parseCapabilityTier(input: string | undefined): CapabilityTier | undefined {
  if (input === undefined) return undefined;
  const trimmed = input.trim().toLowerCase();
  if (TIER_NAMES.includes(trimmed as CapabilityTier)) {
    return trimmed as CapabilityTier;
  }
  return undefined;
}

/**
 * Resolves the effective capability tier from multiple sources.
 * Precedence: option > argv > env > default ('read-strict').
 */
export function resolveCapabilityTier(opts: {
  option?: CapabilityTier;
  env?: string;
  argv?: string;
}): CapabilityTier {
  if (opts.option !== undefined) return opts.option;
  const fromArgv = parseCapabilityTier(opts.argv);
  if (fromArgv !== undefined) return fromArgv;
  const fromEnv = parseCapabilityTier(opts.env);
  if (fromEnv !== undefined) return fromEnv;
  return 'read-strict';
}

/** Returns the maximum effect level allowed by the given tier. */
export function maxEffectLevel(tier: CapabilityTier): EffectLevel {
  return TIER_TO_MAX_EFFECT[tier];
}

/**
 * Derives MCP tool annotations from the tool's resource effect level and the active tier.
 *
 * - Level 0: always readOnlyHint (no resource impact, never prompt).
 * - Level 1 + read-strict: readOnlyHint=false so clients prompt for confirmation.
 * - Level 1 + any other tier: readOnlyHint=true (auto-approved).
 * - Level 2: readOnlyHint=false, destructiveHint=false.
 * - Level 3-4: readOnlyHint=false, destructiveHint=true.
 */
export function hintsForTool(
  resourceEffectLevel: EffectLevel,
  tier: CapabilityTier
): { readOnlyHint: boolean; destructiveHint: boolean } {
  if (resourceEffectLevel === ResourceEffect.NONE) {
    return { readOnlyHint: true, destructiveHint: false };
  }
  if (resourceEffectLevel === ResourceEffect.READ) {
    if (tier === 'read-strict') {
      return { readOnlyHint: false, destructiveHint: false };
    }
    return { readOnlyHint: true, destructiveHint: false };
  }
  if (resourceEffectLevel === ResourceEffect.UPDATE) {
    return { readOnlyHint: false, destructiveHint: false };
  }
  return { readOnlyHint: false, destructiveHint: true };
}

/**
 * Installs a capability filter on the server by wrapping `registerTool`.
 *
 * The wrapper:
 * 1. Reads `resourceEffectLevel` from the tool config's `_meta` (defaults to NONE if absent).
 * 2. If the effect level exceeds the tier's maximum, skips registration.
 * 3. Replaces `annotations` with hints derived from the effect level and tier.
 *
 * Must be installed **after** `installToolCallLogging` (when enabled) so that
 * logging only wraps tools that actually pass the capability filter.
 */
export function installCapabilityFilter(
  server: McpServer,
  tier: CapabilityTier,
  logger: Logger,
  effectLevelMap?: Map<string, EffectLevel>
): void {
  const maxLevel = maxEffectLevel(tier);
  const log = logger.child('capability');
  const previousRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (
    name: string,
    config: Parameters<McpServer['registerTool']>[1],
    cb: Parameters<McpServer['registerTool']>[2]
  ) {
    const configObj = config as Record<string, unknown>;
    const meta = configObj._meta as Record<string, unknown> | undefined;
    const level: EffectLevel = (meta?.resourceEffectLevel as EffectLevel) ?? ResourceEffect.NONE;

    effectLevelMap?.set(name, level);

    if (level > maxLevel) {
      log.debug('Tool skipped (capability tier)', {
        tool: name,
        resourceEffectLevel: level,
        tier,
        maxEffectLevel: maxLevel,
      });
      return;
    }

    const annotations = hintsForTool(level, tier);
    Object.assign(configObj, { annotations });
    return previousRegisterTool(name, config, cb);
  } as McpServer['registerTool'];

  log.info('Capability filter installed', { tier, maxEffectLevel: maxLevel });
}
