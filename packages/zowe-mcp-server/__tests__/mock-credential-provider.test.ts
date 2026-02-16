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
 * Unit tests for MockCredentialProvider.
 */

import { describe, expect, it } from 'vitest';
import { MockCredentialProvider } from '../src/zos/mock/mock-credential-provider.js';
import type { MockSystemsConfig } from '../src/zos/mock/mock-types.js';

/** Helper to build a mock config with sensible defaults. */
function makeConfig(overrides?: Partial<MockSystemsConfig>): MockSystemsConfig {
  return {
    systems: [
      {
        host: 'sys1.example.com',
        port: 443,
        defaultUser: 'USER',
        credentials: [
          { user: 'USER', password: 'secret1' },
          { user: 'DEVUSER', password: 'secret2' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('MockCredentialProvider', () => {
  describe('getCredentials', () => {
    it('should return credentials for the default user when no userId given', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      const credentials = await provider.getCredentials('sys1.example.com');
      expect(credentials).toEqual({ user: 'USER', password: 'secret1' });
    });

    it('should return credentials for a specific user', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      const credentials = await provider.getCredentials('sys1.example.com', 'DEVUSER');
      expect(credentials).toEqual({ user: 'DEVUSER', password: 'secret2' });
    });

    it('should perform case-insensitive user lookup', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      const credentials = await provider.getCredentials('sys1.example.com', 'user');
      expect(credentials).toEqual({ user: 'USER', password: 'secret1' });
    });

    it('should reject for unknown system', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      await expect(provider.getCredentials('unknown.example.com')).rejects.toThrow(
        "System 'unknown.example.com' not found"
      );
    });

    it('should reject for unknown user', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      await expect(provider.getCredentials('sys1.example.com', 'NOBODY')).rejects.toThrow(
        "User 'NOBODY' not found"
      );
    });

    it('should list available users in error message for unknown user', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      await expect(provider.getCredentials('sys1.example.com', 'NOBODY')).rejects.toThrow(
        'USER, DEVUSER'
      );
    });

    it('should fall back to first credential when no defaultUser and no userId', async () => {
      const config: MockSystemsConfig = {
        systems: [
          {
            host: 'sys-no-default.example.com',
            port: 443,
            // no defaultUser
            credentials: [
              { user: 'FIRSTUSER', password: 'pass1' },
              { user: 'SECONDUSER', password: 'pass2' },
            ],
          },
        ],
      };
      const provider = new MockCredentialProvider(config);
      const credentials = await provider.getCredentials('sys-no-default.example.com');
      expect(credentials).toEqual({ user: 'FIRSTUSER', password: 'pass1' });
    });

    it('should reject when system has no credentials at all', async () => {
      const config: MockSystemsConfig = {
        systems: [
          {
            host: 'empty.example.com',
            port: 443,
            credentials: [],
          },
        ],
      };
      const provider = new MockCredentialProvider(config);
      await expect(provider.getCredentials('empty.example.com')).rejects.toThrow(
        'No credentials configured'
      );
    });

    it('should handle multiple systems independently', async () => {
      const config: MockSystemsConfig = {
        systems: [
          {
            host: 'sys1.example.com',
            port: 443,
            defaultUser: 'USER_A',
            credentials: [{ user: 'USER_A', password: 'passA' }],
          },
          {
            host: 'sys2.example.com',
            port: 443,
            defaultUser: 'USER_B',
            credentials: [{ user: 'USER_B', password: 'passB' }],
          },
        ],
      };
      const provider = new MockCredentialProvider(config);
      const creds1 = await provider.getCredentials('sys1.example.com');
      const creds2 = await provider.getCredentials('sys2.example.com');
      expect(creds1.user).toBe('USER_A');
      expect(creds2.user).toBe('USER_B');
    });
  });

  describe('listUsers', () => {
    it('should list all users for a system', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      const users = await provider.listUsers('sys1.example.com');
      expect(users).toEqual(['USER', 'DEVUSER']);
    });

    it('should reject for unknown system', async () => {
      const provider = new MockCredentialProvider(makeConfig());
      await expect(provider.listUsers('unknown.example.com')).rejects.toThrow(
        "System 'unknown.example.com' not found"
      );
    });

    it('should return empty list for system with no credentials', async () => {
      const config: MockSystemsConfig = {
        systems: [{ host: 'empty.example.com', port: 443, credentials: [] }],
      };
      const provider = new MockCredentialProvider(config);
      const users = await provider.listUsers('empty.example.com');
      expect(users).toEqual([]);
    });
  });
});
