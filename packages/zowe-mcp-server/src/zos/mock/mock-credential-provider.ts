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
 * Mock credential provider that reads credentials from `systems.json`.
 *
 * Supports multiple users per system. When `userId` is omitted,
 * returns credentials for the system's `defaultUser`.
 */

import type { CredentialProvider, Credentials, GetCredentialsOptions } from '../credentials.js';
import type { SystemId } from '../system.js';
import type { MockSystemsConfig } from './mock-types.js';

export class MockCredentialProvider implements CredentialProvider {
  constructor(private readonly config: MockSystemsConfig) {}

  getCredentials(
    systemId: SystemId,
    userId?: string,
    _options?: GetCredentialsOptions
  ): Promise<Credentials> {
    const system = this.config.systems.find(s => s.host === systemId);
    if (!system) {
      return Promise.reject(new Error(`System '${systemId}' not found in mock configuration.`));
    }

    const targetUser = userId ?? system.defaultUser ?? system.credentials[0]?.user;
    if (!targetUser) {
      return Promise.reject(new Error(`No credentials configured for system '${systemId}'.`));
    }
    const cred = system.credentials.find(c => c.user.toUpperCase() === targetUser.toUpperCase());
    if (!cred) {
      return Promise.reject(
        new Error(
          `User '${targetUser}' not found for system '${systemId}'. ` +
            `Available users: ${system.credentials.map(c => c.user).join(', ')}`
        )
      );
    }

    return Promise.resolve({ user: cred.user, password: cred.password });
  }

  listUsers(systemId: SystemId): Promise<string[]> {
    const system = this.config.systems.find(s => s.host === systemId);
    if (!system) {
      return Promise.reject(new Error(`System '${systemId}' not found in mock configuration.`));
    }
    return Promise.resolve(system.credentials.map(c => c.user));
  }
}
