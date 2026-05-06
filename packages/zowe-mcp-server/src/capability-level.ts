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
import type { McpDeploymentMode } from './mcp-deployment-mode.js';
import { installToolCallLogging } from './tool-call-logging.js';

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
 * When also enabling tool-call logging, prefer {@link installServerMiddleware} — it
 * enforces the required installation order (logging first, then capability filter).
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

// ─── Capability Instructions ─────────────────────────────────────────────────

/**
 * Builds the capability-tier section of the MCP server instructions.
 *
 * The returned string is appended to SERVER_INSTRUCTIONS at server creation time
 * so the AI agent knows which z/OS operation categories are disabled, must not
 * attempt workarounds, and learns how to ask the user to raise the tier.
 *
 * Uses the deployment mode to show only the relevant "how to change" path
 * (VS Code Settings vs CLI flag / env var).
 */
export function buildCapabilityInstructions(
  tier: CapabilityTier,
  mode: McpDeploymentMode
): string {
  if (tier === 'full') {
    return 'Capability Tier: full — all z/OS operation categories are enabled.';
  }

  const maxLevel = maxEffectLevel(tier);

  const tierDescription: Record<CapabilityTier, string> = {
    'read-strict': 'read-only with user confirmation required before read operations',
    read: 'read-only, read operations auto-approved',
    update: 'read and update/create allowed; delete and execute are restricted',
    delete:
      'read, update/create, and delete allowed; execute (job submission, commands) is restricted',
    full: '',
  };

  const lines: string[] = [
    `Capability Tier: ${tier} (${tierDescription[tier]})`,
    `Only ${tier === 'read-strict' || tier === 'read' ? 'read and ' : tier === 'update' ? 'read, update/create, and ' : 'read, update/create, delete, and '}server-management z/OS operations are available.`,
    'The following categories of z/OS resource operations are NOT registered because they exceed the configured tier:',
    '',
  ];

  if (maxLevel < ResourceEffect.UPDATE) {
    lines.push(
      'Update/create z/OS resources (requires tier "update" or higher) — examples:',
      '  writeDataset, createDataset, copyDataset, renameDataset, restoreDataset,',
      '  writeUssFile, createUssFile, copyUssFile, chmodUssFile, chownUssFile, chtagUssFile,',
      '  uploadFileToDataset, uploadFileToUssFile, holdJob, releaseJob',
      ''
    );
  }

  if (maxLevel < ResourceEffect.DELETE) {
    lines.push(
      'Delete z/OS resources (requires tier "delete" or higher) — examples:',
      '  deleteDataset, deleteDatasetsUnderPrefix, deleteUssFile, cancelJob, deleteJob',
      ''
    );
  }

  if (maxLevel < ResourceEffect.EXECUTE) {
    lines.push(
      'Execute z/OS operations — job submission and TSO/USS commands (requires tier "full") — examples:',
      '  submitJob, submitJobFromDataset, submitJobFromUss, runSafeTsoCommand, runSafeUssCommand',
      ''
    );
  }

  lines.push(
    'CRITICAL — Do not work around capability restrictions',
    '',
    'If the user asks you to perform an unavailable z/OS operation, you MUST NOT attempt',
    'workarounds such as:',
    '- Calling Zowe CLI commands directly (e.g. zowe files upload, zowe jobs submit, zowe uss mkdir)',
    '- Using SSH, sftp, scp, or any shell access to z/OS',
    '- Calling z/OSMF REST API endpoints directly',
    '- Using any other external tool or method to circumvent the restriction',
    '',
    'The capability tier is an operator-configured policy. Bypassing it violates the intent of',
    'the configuration and may cause unintended changes to z/OS resources.',
    '',
    'Instead, inform the user that the z/OS operation is not available at the current capability',
    'tier and ask them to raise it.'
  );

  if (mode === 'stdio-vscode') {
    lines.push(
      'To change the capability tier: open VS Code Settings and search for "zoweMCP.capabilityTier",',
      'then select a higher tier (read-strict → read → update → delete → full).'
    );
  } else {
    lines.push(
      'To change the capability tier: restart the server with --capability-tier <tier>',
      'or set ZOWE_MCP_CAPABILITY_TIER=<tier>.',
      'Valid tiers (lowest to highest): read-strict, read, update, delete, full.'
    );
  }

  return lines.join('\n');
}

/** Options for {@link installServerMiddleware}. */
export interface ServerMiddlewareOptions {
  /** Capability tier controlling which tools register and how MCP hints are derived. */
  tier: CapabilityTier;
  /**
   * When true, tool-call logging is installed **before** the capability filter so that
   * only tools that pass the capability filter have their callbacks wrapped for logging.
   */
  logToolCalls?: boolean;
  /** Backend kind label for log entries (e.g. `'mock'`, `'zowex'`, or `null`). */
  backendKind?: string | null;
  /** When provided, populated during tool registration with each tool's effect level. */
  effectLevelMap?: Map<string, EffectLevel>;
}

/**
 * Installs both server middleware layers in the required order:
 * 1. Tool-call logging (when `logToolCalls` is true) — wraps tool callbacks for logging.
 * 2. Capability filter — decides which tools register and derives MCP hint annotations.
 *
 * The ordering ensures that only tools which pass the capability filter have their
 * callbacks wrapped for logging — not tools that are silently filtered out.
 *
 * Always prefer this over calling {@link installToolCallLogging} and
 * {@link installCapabilityFilter} separately: the correct order is enforced here.
 */
export function installServerMiddleware(
  server: McpServer,
  logger: Logger,
  opts: ServerMiddlewareOptions
): void {
  if (opts.logToolCalls) {
    installToolCallLogging(server, logger, opts.backendKind ?? null);
  }
  installCapabilityFilter(server, opts.tier, logger, opts.effectLevelMap);
}
