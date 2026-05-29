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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MockSystemsConfig } from '../zos/mock/mock-types.js';

/**
 * Per-user behavior knobs for SSH-layer realism.
 * Sourced from `<mockDir>/_ssh/users.json` overrides on top of `systems.json` credentials.
 */
export interface MockUser {
  username: string;
  /** Password (clear text — this is a test mock). */
  password?: string;
  /** Optional uid for `id` shell output. Default 12345. */
  uid?: number;
  /** Optional gid for `id` shell output. Default 10. */
  gid?: number;
  /** Optional primary group name. Default 'STCGROUP'. */
  primaryGroup?: string;
  /** Optional secondary group names. */
  groups?: string[];
  /** USS home directory. Default `/u/<USERNAME>`. */
  home?: string;
  /** Optional shell scenario behavior. */
  scenario?: 'normal' | 'passwordExpired' | 'racfRevoked' | 'authDelay' | 'passwordExpiresInDays';
  /** Numeric value associated with the scenario (e.g. days, ms). */
  scenarioValue?: number;
  /** Which mock systemId this user serves data from. Default the first system. */
  systemId?: string;
  /** OpenSSH-style authorized_keys (one per line). */
  authorizedKeys?: string[];
}

export interface MockUsersFile {
  users: MockUser[];
  /** Optional default systemId if a user does not specify one. */
  defaultSystemId?: string;
}

/**
 * Load the canonical users for the mock host. Tries `<mockDir>/_ssh/users.json` first,
 * then falls back to deriving entries from `<mockDir>/systems.json`. Returns at least
 * one user (a synthetic USER1 default) if neither file is present.
 */
export async function loadMockUsers(mockDir: string): Promise<{
  users: MockUser[];
  defaultSystemId: string;
}> {
  const ussFile = path.join(mockDir, '_ssh', 'users.json');
  try {
    const raw = await fs.readFile(ussFile, 'utf-8');
    const parsed = JSON.parse(raw) as MockUsersFile;
    const systemId = parsed.defaultSystemId ?? (await defaultSystemIdFromMockDir(mockDir));
    return { users: parsed.users, defaultSystemId: systemId };
  } catch {
    /* fall through */
  }

  // Derive from systems.json
  const sysFile = path.join(mockDir, 'systems.json');
  try {
    const raw = await fs.readFile(sysFile, 'utf-8');
    const cfg = JSON.parse(raw) as MockSystemsConfig;
    const users: MockUser[] = [];
    let defaultSystemId: string | undefined;
    for (const sys of cfg.systems) {
      const sid = sys.host;
      defaultSystemId ??= sid;
      for (const cred of sys.credentials) {
        users.push({
          username: cred.user.toUpperCase(),
          password: cred.password,
          systemId: sid,
        });
      }
    }
    if (users.length === 0) {
      users.push({ username: 'USER1', password: 'password', systemId: defaultSystemId ?? 'sys1' });
    }
    return { users, defaultSystemId: defaultSystemId ?? 'sys1' };
  } catch {
    /* fall through */
  }

  return {
    users: [{ username: 'USER1', password: 'password', systemId: 'sys1' }],
    defaultSystemId: 'sys1',
  };
}

async function defaultSystemIdFromMockDir(mockDir: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(mockDir, 'systems.json'), 'utf-8');
    const cfg = JSON.parse(raw) as MockSystemsConfig;
    return cfg.systems[0]?.host ?? 'sys1';
  } catch {
    return 'sys1';
  }
}

/** Resolve a user by name, case-insensitive (real z/OS user IDs are uppercase). */
export function findUser(users: MockUser[], name: string): MockUser | undefined {
  const target = name.toUpperCase();
  return users.find(u => u.username.toUpperCase() === target);
}

/** Effective home directory for a user. */
export function homeForUser(user: MockUser): string {
  return user.home ?? `/u/${user.username.toLowerCase()}`;
}

/** Effective primary group name. */
export function primaryGroupForUser(user: MockUser): string {
  return user.primaryGroup ?? 'STCGROUP';
}
