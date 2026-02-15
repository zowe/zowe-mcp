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

import type { SystemId } from './system.js';

// ---------------------------------------------------------------------------
// Per-system context
// ---------------------------------------------------------------------------

/** Working context for a single z/OS system. */
export interface SystemContext {
  /** Active user ID on this system (e.g. `"IBMUSER"`). */
  userId: string;
  /** DSN prefix — defaults to `userId`. Like `cwd` in the dataset tree. */
  dsnPrefix: string;
}

/** Serializable summary of a system context (for tool responses). */
export interface SystemContextSummary {
  system: SystemId;
  userId: string;
  dsnPrefix: string;
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
   * Set the active system. If the system has no context yet, one is
   * created with the given `defaultUserId` as both `userId` and
   * `dsnPrefix`.
   *
   * @returns The context for the newly active system.
   */
  setActiveSystem(systemId: SystemId, defaultUserId: string): SystemContext {
    this.activeSystemId = systemId;
    if (!this.contexts.has(systemId)) {
      this.contexts.set(systemId, {
        userId: defaultUserId,
        dsnPrefix: defaultUserId,
      });
    }
    return this.contexts.get(systemId)!;
  }

  /**
   * Get the context for the active system.
   *
   * @throws {Error} if no system is active.
   */
  getActiveContext(): SystemContext {
    if (this.activeSystemId === undefined) {
      throw new Error('No active z/OS system. Use set_system to select a system first.');
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
      'No active z/OS system. Use set_system to select a system, or pass the "system" parameter explicitly.'
    );
  }

  /**
   * Get the DSN prefix for a system.
   *
   * @param systemId - If omitted, uses the active system.
   */
  getDsnPrefix(systemId?: SystemId): string | undefined {
    const id = systemId ?? this.activeSystemId;
    if (!id) return undefined;
    return this.contexts.get(id)?.dsnPrefix;
  }

  /**
   * Set the DSN prefix for the active system.
   *
   * @throws {Error} if no system is active.
   */
  setDsnPrefix(prefix: string): SystemContext {
    const ctx = this.getActiveContext();
    ctx.dsnPrefix = prefix.toUpperCase();
    return ctx;
  }

  /** Return summary info for all system contexts. */
  getAllContexts(): SystemContextSummary[] {
    return [...this.contexts.entries()].map(([system, ctx]) => ({
      system,
      userId: ctx.userId,
      dsnPrefix: ctx.dsnPrefix,
    }));
  }

  /** Get context for a specific system (may be `undefined`). */
  getContext(systemId: SystemId): SystemContext | undefined {
    return this.contexts.get(systemId);
  }
}
