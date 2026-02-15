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
}

/** Summary information returned to agents by `list_systems`. */
export interface SystemInfo {
  host: string;
  description?: string;
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

  /** Register a system. Overwrites any existing entry with the same host. */
  register(system: ZosSystem): void {
    this.systems.set(system.host, system);
  }

  /** Look up a system by its host. Returns `undefined` if not found. */
  get(systemId: SystemId): ZosSystem | undefined {
    return this.systems.get(systemId);
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
