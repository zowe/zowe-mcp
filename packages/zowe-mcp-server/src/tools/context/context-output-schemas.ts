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
 * MCP output schemas (Zod) for context tools.
 *
 * Used as outputSchema in registerTool so tools/list advertises the structure
 * and tool results can return validated structuredContent.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// listSystems
// ---------------------------------------------------------------------------

const listSystemsEntrySchema = z.object({
  host: z.string().describe('z/OS system hostname (e.g. sys1.example.com).'),
  description: z.string().optional().describe('Optional human-readable label for the system.'),
  connections: z
    .array(z.string())
    .optional()
    .describe(
      'Connection specs (user@host or user@host:port) when multiple connections exist for this host. Use setSystem with one of these when disambiguating.'
    ),
  active: z.boolean().describe('True if this system is the currently active one.'),
});

export const listSystemsOutputSchema = z
  .object({
    systems: z
      .array(listSystemsEntrySchema)
      .describe('All configured z/OS systems you have access to.'),
    messages: z
      .array(z.string())
      .optional()
      .describe('Informational messages (e.g. resolution notes). Omitted when empty.'),
  })
  .describe(
    'List of configured z/OS systems. Each entry has host, optional description and connections, and active flag. Use setSystem to select the active system.'
  );

// ---------------------------------------------------------------------------
// setSystem
// ---------------------------------------------------------------------------

export const setSystemOutputSchema = z
  .object({
    activeSystem: z.string().describe('Resolved hostname of the active z/OS system.'),
    userId: z.string().describe('User ID on that system (e.g. from credentials).'),
    description: z
      .string()
      .optional()
      .describe('Optional system description/label from configuration.'),
    messages: z
      .array(z.string())
      .optional()
      .describe(
        'Resolution or connection messages (e.g. "System resolved from unqualified name \'sys1\'."). Omitted when empty.'
      ),
    mainframeMvsEncoding: z
      .union([z.string(), z.null()])
      .optional()
      .describe(
        'Per-system MVS/data set encoding override (e.g. IBM-037). null = use MCP server default.'
      ),
    mainframeUssEncoding: z
      .union([z.string(), z.null()])
      .optional()
      .describe(
        'Per-system USS encoding override (e.g. IBM-1047). null = use MCP server default.'
      ),
  })
  .describe(
    'Result of setting the active z/OS system: resolved host, user, optional description and encoding overrides.'
  );

// ---------------------------------------------------------------------------
// getContext
// ---------------------------------------------------------------------------

const getContextActiveSystemSchema = z.object({
  system: z.string().describe('Hostname of the active z/OS system.'),
  userId: z.string().describe('User ID on that system.'),
  activeConnection: z
    .string()
    .optional()
    .describe('Connection spec (user@host) for the active system.'),
  ussHome: z
    .string()
    .optional()
    .describe('USS home directory path for this system/user (when known).'),
  ussCwd: z
    .string()
    .optional()
    .describe('Current USS working directory (when set via changeUssDirectory).'),
  mainframeMvsEncoding: z
    .string()
    .optional()
    .describe(
      'Effective MVS/data set encoding for this system (e.g. IBM-037). Resolved from per-system override or server default.'
    ),
  mainframeUssEncoding: z
    .string()
    .optional()
    .describe(
      'Effective USS encoding for this system (e.g. IBM-1047). Resolved from per-system override or server default.'
    ),
  jobCard: z
    .string()
    .optional()
    .describe(
      'Job card for this connection when configured. Used by submitJob when JCL has no job card.'
    ),
});

const getContextSystemEntrySchema = z.object({
  host: z.string().describe('System hostname.'),
  description: z.string().optional().describe('Optional label.'),
  connections: z
    .array(z.string())
    .optional()
    .describe('Connection specs when multiple connections exist for this host.'),
  active: z.boolean().describe('True if this system is the active one.'),
});

const getContextRecentlyUsedEntrySchema = z.object({
  system: z.string().describe('System hostname.'),
  userId: z.string().describe('User ID used on that system.'),
  ussHome: z.string().optional().describe('USS home when known.'),
  ussCwd: z.string().optional().describe('USS current working directory when set.'),
  mainframeMvsEncoding: z
    .union([z.string(), z.null()])
    .optional()
    .describe('Per-system MVS encoding when set.'),
  mainframeUssEncoding: z
    .union([z.string(), z.null()])
    .optional()
    .describe('Per-system USS encoding when set.'),
});

export const getContextOutputSchema = z
  .object({
    activeSystem: z
      .union([getContextActiveSystemSchema, z.null()])
      .describe('Currently selected system and user; null if no system has been set yet.'),
    allSystems: z
      .array(getContextSystemEntrySchema)
      .describe(
        'All configured z/OS systems with host, optional description/connections, and active flag.'
      ),
    recentlyUsedSystems: z
      .array(getContextRecentlyUsedEntrySchema)
      .describe(
        'Systems that have been used in this session (have saved context: userId, optional ussHome/encodings).'
      ),
    messages: z
      .array(z.string())
      .optional()
      .describe('Informational messages. Omitted when empty.'),
  })
  .describe(
    'Current session context: active system (or null), all configured systems, recently used systems, and messages.'
  );
