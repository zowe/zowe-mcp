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
 * Session state and per-system working context.
 *
 * Each z/OS system maintains its own independent {@link SystemContext}.
 * When the agent switches systems, the previous system's context is
 * preserved and the target system's context is restored — like
 * switching between terminal sessions on different machines.
 *
 * The {@link SessionState} class manages the active system and the
 * per-system context map.
 */

import { getMcpDeploymentMode } from '../mcp-deployment-mode.js';
import { parseConnectionSpec } from './native/connection-spec.js';
import type { SystemId, SystemRegistry } from './system.js';

/**
 * User-facing hint when resolveSystemForTool fails: empty registry vs listed hosts.
 */
function systemNotFoundHint(systemRegistry: SystemRegistry): string {
  const hosts = systemRegistry.list();
  if (hosts.length > 0) {
    return `Available systems (hosts): ${hosts.join(', ')}. Use listSystems for connection specs.`;
  }
  switch (getMcpDeploymentMode()) {
    case 'http':
      return (
        'No z/OS systems are configured. For this HTTP server, use addZosConnection with a user@host spec (JWT tenant store), ' +
        'or start the process with --config <file> or --system user@host for a base list. Use listSystems to verify.'
      );
    case 'stdio-vscode':
      return (
        'No z/OS systems are configured. In VS Code Settings, set zoweMCP.nativeConnections (native) or zoweMCP.mockDataDirectory (mock), ' +
        'then reload the window if needed so the MCP server restarts. Use listSystems to verify.'
      );
    case 'stdio-standalone':
    default:
      return (
        'No z/OS systems are configured. Start with --config <file> or --system user@host, ' +
        'or set ZOWE_MCP_CREDENTIALS / ZOWE_MCP_PASSWORD_* for SSH. Use listSystems to verify.'
      );
  }
}

// ---------------------------------------------------------------------------
// Resolve system parameter (host or connection spec)
// ---------------------------------------------------------------------------

/** Result of resolving the system parameter; userId is set when disambiguating multiple connections. */
export interface ResolvedSystem {
  systemId: SystemId;
  userId?: string;
}

/**
 * Resolve the system parameter for tools that accept an optional system.
 * Accepts a hostname (FQDN or unqualified when unambiguous) or a connection
 * spec (user@host or user@host:port) when multiple connections exist for a host.
 * When multiple connections exist and only the host is given, throws with valid values.
 *
 * @param systemRegistry - Registry of known systems (for getOrResolve and connectionSpecs).
 * @param sessionState - Session state (for active system when system is omitted).
 * @param system - Optional hostname or connection spec from the tool/prompt argument.
 * @returns The resolved system ID and optional user ID for that connection.
 * @throws {Error} if no system is active and none provided, system not found, or multiple connections and host-only given.
 */
export function resolveSystemForTool(
  systemRegistry: SystemRegistry,
  sessionState: SessionState,
  system?: string
): ResolvedSystem {
  if (system === undefined || system === '') {
    const active = sessionState.getActiveSystem();
    if (active === undefined) {
      throw new Error(
        'No active z/OS system. Use setSystem to select a system, or pass the "system" parameter explicitly.'
      );
    }
    const ctx = sessionState.getContext(active);
    return { systemId: active, userId: ctx?.userId };
  }

  const trimmed = system.trim();
  const isConnectionSpec = trimmed.includes('@');

  if (isConnectionSpec) {
    let parsed: { user: string; host: string };
    try {
      const p = parseConnectionSpec(trimmed);
      parsed = { user: p.user, host: p.host };
    } catch {
      throw new Error(
        `Invalid connection spec "${system}". Expected user@host or user@host:port. Use listSystems to see configured systems and their connections.`
      );
    }
    const sysInfo = systemRegistry.getOrResolve(parsed.host);
    if (!sysInfo) {
      throw new Error(
        `System for connection '${system}' not found. ${systemNotFoundHint(systemRegistry)}`
      );
    }
    const connectionSpecs = sysInfo.connectionSpecs;
    if (connectionSpecs && connectionSpecs.length > 0) {
      const match = connectionSpecs.some(specStr => {
        try {
          const s = parseConnectionSpec(specStr);
          return s.user === parsed.user && s.host === parsed.host;
        } catch {
          return false;
        }
      });
      if (!match) {
        const valid = connectionSpecs.join(', ');
        throw new Error(`Unknown connection "${system}". Valid values for this system: ${valid}`);
      }
    }
    return { systemId: sysInfo.host, userId: parsed.user };
  }

  // Host only
  const sysInfo = systemRegistry.getOrResolve(trimmed);
  if (!sysInfo) {
    throw new Error(`System '${trimmed}' not found. ${systemNotFoundHint(systemRegistry)}`);
  }
  const connectionSpecs = sysInfo.connectionSpecs;
  if (!connectionSpecs || connectionSpecs.length === 0) {
    return { systemId: sysInfo.host };
  }
  if (connectionSpecs.length === 1) {
    try {
      const one = parseConnectionSpec(connectionSpecs[0]);
      return { systemId: sysInfo.host, userId: one.user };
    } catch {
      return { systemId: sysInfo.host };
    }
  }
  const valid = connectionSpecs.join(', ');
  throw new Error(
    `Multiple connections exist for system ${sysInfo.host}. Specify which connection using user@host form. Valid values: ${valid}`
  );
}

// ---------------------------------------------------------------------------
// Per-system context
// ---------------------------------------------------------------------------

/** Optional per-system mainframe encoding overrides. null or missing = use MCP server default. */
export interface SystemEncodingOverrides {
  mainframeMvsEncoding?: string | null;
  mainframeUssEncoding?: string | null;
}

/** Working context for a single z/OS system. */
export interface SystemContext {
  /** Active user ID on this system (e.g. `"USER"`). */
  userId: string;
  /** Mainframe encoding for dataset operations; null/undefined = use server default. */
  mainframeMvsEncoding?: string | null;
  /** Mainframe encoding for USS operations (reserved); null/undefined = use server default. */
  mainframeUssEncoding?: string | null;
  /** USS home directory path (cached when getUssHome or echo $HOME is used). */
  ussHome?: string;
  /** USS current working directory (set by changeUssDirectory). When unset, effective cwd is ussHome. */
  ussCwd?: string;
}

/** Serializable summary of a system context (for tool responses). */
export interface SystemContextSummary {
  system: SystemId;
  userId: string;
  mainframeMvsEncoding?: string | null;
  mainframeUssEncoding?: string | null;
  ussHome?: string;
  ussCwd?: string;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/**
 * Session-level state that tracks the active z/OS system and per-system
 * working contexts.
 */
export class SessionState {
  /** Which system is currently active (`undefined` if none set). */
  private activeSystemId: SystemId | undefined;

  /** Per-system contexts, keyed by {@link SystemId}. */
  private readonly contexts = new Map<SystemId, SystemContext>();

  /** Get the currently active system ID, or `undefined`. */
  getActiveSystem(): SystemId | undefined {
    return this.activeSystemId;
  }

  /**
   * Set the active system. Creates or updates the per-system context so
   * that {@code userId} reflects the credentials used for this connection.
   * When encodingOverrides is provided, sets or clears per-system encoding;
   * when omitted, leaves existing encoding overrides unchanged.
   *
   * @returns The context for the newly active system.
   */
  setActiveSystem(
    systemId: SystemId,
    defaultUserId: string,
    encodingOverrides?: SystemEncodingOverrides
  ): SystemContext {
    this.activeSystemId = systemId;
    const existing = this.contexts.get(systemId);
    if (existing) {
      existing.userId = defaultUserId;
      if (encodingOverrides !== undefined) {
        if ('mainframeMvsEncoding' in encodingOverrides) {
          existing.mainframeMvsEncoding = encodingOverrides.mainframeMvsEncoding;
        }
        if ('mainframeUssEncoding' in encodingOverrides) {
          existing.mainframeUssEncoding = encodingOverrides.mainframeUssEncoding;
        }
      }
      return existing;
    }
    const ctx: SystemContext = {
      userId: defaultUserId,
      mainframeMvsEncoding:
        encodingOverrides?.mainframeMvsEncoding !== undefined
          ? encodingOverrides.mainframeMvsEncoding
          : undefined,
      mainframeUssEncoding:
        encodingOverrides?.mainframeUssEncoding !== undefined
          ? encodingOverrides.mainframeUssEncoding
          : undefined,
    };
    this.contexts.set(systemId, ctx);
    return ctx;
  }

  /**
   * Get the context for the active system.
   *
   * @throws {Error} if no system is active.
   */
  getActiveContext(): SystemContext {
    if (this.activeSystemId === undefined) {
      throw new Error('No active z/OS system. Use setSystem to select a system first.');
    }
    const ctx = this.contexts.get(this.activeSystemId);
    if (!ctx) {
      throw new Error(
        `No context found for active system "${this.activeSystemId}". This should not happen.`
      );
    }
    return ctx;
  }

  /**
   * Require an active system and return its ID.
   *
   * If `systemId` is provided, returns it directly (for tools that accept
   * an explicit `system` parameter). Otherwise returns the active system.
   *
   * @throws {Error} if no system is active and none was provided.
   */
  requireSystem(systemId?: SystemId): SystemId {
    if (systemId) return systemId;
    if (this.activeSystemId) return this.activeSystemId;
    throw new Error(
      'No active z/OS system. Use setSystem to select a system, or pass the "system" parameter explicitly.'
    );
  }

  /** Return summary info for all system contexts. */
  getAllContexts(): SystemContextSummary[] {
    return [...this.contexts.entries()].map(([system, ctx]) => ({
      system,
      userId: ctx.userId,
      mainframeMvsEncoding: ctx.mainframeMvsEncoding,
      mainframeUssEncoding: ctx.mainframeUssEncoding,
      ussHome: ctx.ussHome,
      ussCwd: ctx.ussCwd,
    }));
  }

  /** Get context for a specific system (may be `undefined`). */
  getContext(systemId: SystemId): SystemContext | undefined {
    return this.contexts.get(systemId);
  }
}
