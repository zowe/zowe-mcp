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
 * Unit tests for NativeCredentialProvider: elicitation path, fallback to pipe, onElicitedPasswordUsed.
 */

import { describe, expect, it } from 'vitest';
import type { ParsedConnectionSpec } from '../src/zos/native/connection-spec.js';
import { NativeCredentialProvider } from '../src/zos/native/native-credential-provider.js';
import { WaitablePasswordStore } from '../src/zos/native/password-store.js';
import { cacheKey } from '../src/zos/native/ssh-client-cache.js';

const SPEC: ParsedConnectionSpec = {
  user: 'USER',
  host: 'host.example.com',
  port: 22,
};

describe('NativeCredentialProvider', () => {
  describe('requestPasswordViaElicitation and onElicitedPasswordUsed', () => {
    it('uses elicited password and calls onElicitedPasswordUsed', async () => {
      const used: { user: string; host: string; port: number | undefined; password: string }[] =
        [];
      const store = new Map<string, string>();

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        passwordStore: store,
        requestPasswordViaElicitation: async (user, host, port) => {
          expect(user).toBe(SPEC.user);
          expect(host).toBe(SPEC.host);
          expect(port).toBe(SPEC.port);
          await Promise.resolve();
          return 'elicited-secret';
        },
        onElicitedPasswordUsed: (user, host, port, password) => {
          used.push({ user, host, port, password });
        },
      });

      const creds = await provider.getCredentials(SPEC.host);
      expect(creds).toEqual({ user: SPEC.user, password: 'elicited-secret' });
      expect(used).toHaveLength(1);
      expect(used[0]).toEqual({
        user: SPEC.user,
        host: SPEC.host,
        port: SPEC.port,
        password: 'elicited-secret',
      });
      expect(store.get(cacheKey(SPEC))).toBe('elicited-secret');
    });

    it('falls back to pipe when requestPasswordViaElicitation returns undefined', async () => {
      const waitableStore = new WaitablePasswordStore();
      let requestPasswordCalled = false;

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        passwordStore: waitableStore,
        requestPasswordViaElicitation: async () => {
          await Promise.resolve();
          return undefined;
        },
        requestPasswordCallback: () => {
          requestPasswordCalled = true;
          setTimeout(() => {
            waitableStore.set(cacheKey(SPEC), 'pipe-password');
          }, 0);
        },
      });

      const credsPromise = provider.getCredentials(SPEC.host);
      await expect(credsPromise).resolves.toEqual({
        user: SPEC.user,
        password: 'pipe-password',
      });
      expect(requestPasswordCalled).toBe(true);
    });

    it('falls back to pipe when requestPasswordViaElicitation throws', async () => {
      const waitableStore = new WaitablePasswordStore();
      let requestPasswordCalled = false;

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        passwordStore: waitableStore,
        requestPasswordViaElicitation: async () => {
          await Promise.resolve();
          throw new Error('Client does not support elicitation');
        },
        requestPasswordCallback: () => {
          requestPasswordCalled = true;
          setTimeout(() => {
            waitableStore.set(cacheKey(SPEC), 'pipe-password');
          }, 0);
        },
      });

      const credsPromise = provider.getCredentials(SPEC.host);
      await expect(credsPromise).resolves.toEqual({
        user: SPEC.user,
        password: 'pipe-password',
      });
      expect(requestPasswordCalled).toBe(true);
    });

    it('does not call onElicitedPasswordUsed when password comes from store', async () => {
      const store = new Map<string, string>();
      store.set(cacheKey(SPEC), 'cached-password');
      const used: unknown[] = [];

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        passwordStore: store,
        requestPasswordViaElicitation: async () => {
          await Promise.resolve();
          return 'elicited';
        },
        onElicitedPasswordUsed: (...args) => {
          used.push(args);
        },
      });

      const creds = await provider.getCredentials(SPEC.host);
      expect(creds.password).toBe('cached-password');
      expect(used).toHaveLength(0);
    });

    it('does not call onElicitedPasswordUsed when requestPasswordViaElicitation returns empty string', async () => {
      const waitableStore = new WaitablePasswordStore();
      const used: unknown[] = [];

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        passwordStore: waitableStore,
        requestPasswordViaElicitation: async () => {
          await Promise.resolve();
          return '';
        },
        onElicitedPasswordUsed: (...args) => {
          used.push(args);
        },
        requestPasswordCallback: () => {
          setTimeout(() => waitableStore.set(cacheKey(SPEC), 'pipe-password'), 0);
        },
      });

      const creds = await provider.getCredentials(SPEC.host);
      expect(creds.password).toBe('pipe-password');
      expect(used).toHaveLength(0);
    });

    it('serializes concurrent password requests: only one elicitation, both callers get same password', async () => {
      const store = new Map<string, string>();
      let elicitationCount = 0;

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        passwordStore: store,
        requestPasswordViaElicitation: async () => {
          elicitationCount++;
          await Promise.resolve();
          return 'single-prompt-password';
        },
      });

      const [creds1, creds2] = await Promise.all([
        provider.getCredentials(SPEC.host),
        provider.getCredentials(SPEC.host),
      ]);

      expect(elicitationCount).toBe(1);
      expect(creds1.password).toBe('single-prompt-password');
      expect(creds2.password).toBe('single-prompt-password');
      expect(store.get(cacheKey(SPEC))).toBe('single-prompt-password');
    });
  });

  describe('progress reporting', () => {
    it('calls progress with "Waiting for password" when using pipe', async () => {
      const waitableStore = new WaitablePasswordStore();
      const progressMessages: string[] = [];

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        passwordStore: waitableStore,
        requestPasswordCallback: () => {
          setTimeout(() => waitableStore.set(cacheKey(SPEC), 'pwd'), 0);
        },
      });

      const credsPromise = provider.getCredentials(SPEC.host, undefined, {
        progress: msg => progressMessages.push(msg),
      });
      await expect(credsPromise).resolves.toEqual({ user: SPEC.user, password: 'pwd' });
      expect(progressMessages).toContain('Waiting for password');
    });

    it('calls progress with "Waiting for password" when using elicitation', async () => {
      const progressMessages: string[] = [];

      const provider = new NativeCredentialProvider({
        connectionSpecs: [SPEC],
        useEnvForPassword: false,
        requestPasswordViaElicitation: async () => 'elicited-pwd',
      });

      const creds = await provider.getCredentials(SPEC.host, undefined, {
        progress: msg => progressMessages.push(msg),
      });
      expect(creds.password).toBe('elicited-pwd');
      expect(progressMessages).toContain('Waiting for password');
    });
  });
});
