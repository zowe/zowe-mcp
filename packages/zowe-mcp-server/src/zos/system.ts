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
 * z/OS system identity and registry.
 *
 * A {@link SystemId} is the agent-visible identifier for a z/OS system —
 * just a hostname string (e.g. `"sys1.example.com"`).
 *
 * The {@link ZosSystem} interface captures internal connection details
 * hidden from agents. The {@link SystemRegistry} manages the set of
 * known systems.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Agent-visible identifier for a z/OS system — a hostname string. */
export type SystemId = string;

/** Internal connection configuration for a z/OS system. */
export interface ZosSystem {
  /** Hostname of the z/OS system (e.g. `"sys1.example.com"`). */
  host: string;
  /** Port number (e.g. `443`). */
  port: number;
  /** Optional API base path (depends on the backend API used). */
  basePath?: string;
  /** Human-readable description (e.g. `"Development LPAR"`). */
  description?: string;
  /** Connection specs (user@host or user@host:port) that target this system. Set by native loader; mock leaves unset. */
  connectionSpecs?: string[];
}

/** Summary information returned to agents by `listSystems`. */
export interface SystemInfo {
  host: string;
  description?: string;
  /** Connection specs for this system (when multiple connections exist for the same host). */
  connections?: string[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * In-memory registry of known z/OS systems.
 *
 * Keyed by {@link SystemId} (the hostname). Populated at startup from
 * configuration (mock `systems.json`, Zowe team config, etc.).
 */
export class SystemRegistry {
  private readonly systems = new Map<SystemId, ZosSystem>();

  /** Remove all registered systems. Used when applying a new list (e.g. connections-update from VS Code). */
  clear(): void {
    this.systems.clear();
  }

  /** Register a system. Overwrites any existing entry with the same host. */
  register(system: ZosSystem): void {
    this.systems.set(system.host, system);
  }

  /** Look up a system by its host. Returns `undefined` if not found. */
  get(systemId: SystemId): ZosSystem | undefined {
    return this.systems.get(systemId);
  }

  /**
   * Resolve a system by exact host or by unqualified hostname when unambiguous.
   * Tries exact match first, then case-insensitive match on full host or on
   * the first hostname segment (part before the first '.'). Returns the system
   * only when exactly one match is found; returns undefined if not found or ambiguous.
   */
  getOrResolve(systemId: SystemId): ZosSystem | undefined {
    const exact = this.systems.get(systemId);
    if (exact) return exact;

    const inputLower = systemId.toLowerCase();
    const matches: ZosSystem[] = [];

    for (const system of this.systems.values()) {
      const hostLower = system.host.toLowerCase();
      if (hostLower === inputLower) {
        matches.push(system);
        continue;
      }
      const firstSegment = system.host.split('.')[0]?.toLowerCase() ?? '';
      if (firstSegment === inputLower) {
        matches.push(system);
      }
    }

    return matches.length === 1 ? matches[0] : undefined;
  }

  /** Return all registered system IDs. */
  list(): SystemId[] {
    return [...this.systems.keys()];
  }

  /** Return summary info for all registered systems. */
  listInfo(): SystemInfo[] {
    return [...this.systems.values()].map(s => ({
      host: s.host,
      description: s.description,
      ...(s.connectionSpecs && s.connectionSpecs.length > 0
        ? { connections: s.connectionSpecs }
        : {}),
    }));
  }

  /** Check whether a system is registered. */
  has(systemId: SystemId): boolean {
    return this.systems.has(systemId);
  }

  /** Number of registered systems. */
  get size(): number {
    return this.systems.size;
  }
}
