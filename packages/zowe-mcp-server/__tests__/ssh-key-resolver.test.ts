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
 * Unit tests for the SSH key resolver. Uses dependency injection so no real
 * ~/.ssh is read, and real generated keys (ssh2) for encryption detection.
 */

import { join } from 'node:path';
import ssh2 from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedConnectionSpec } from '../src/zos/native/connection-spec.js';
import {
  classifyKeyEncryption,
  getKeyPassphraseFromEnv,
  isPassphraseValid,
  resolveSshKey,
  type SshKeyResolverDeps,
} from '../src/zos/native/ssh-key-resolver.js';

const SPEC: ParsedConnectionSpec = { user: 'USER', host: 'host.example.com', port: 22 };

const unencrypted = ssh2.utils.generateKeyPairSync('ed25519');
const encrypted = ssh2.utils.generateKeyPairSync('ed25519', {
  passphrase: 'pw',
  cipher: 'aes256-cbc',
  rounds: 16,
});

/** Build resolver deps with sensible empty defaults; override per test. */
function deps(overrides: Partial<SshKeyResolverDeps>): Partial<SshKeyResolverDeps> {
  return {
    getEnv: () => undefined,
    loadSshConfigEntries: () => Promise.resolve([]),
    loadDefaultKeyPaths: () => Promise.resolve([]),
    readKeyFile: () => unencrypted.private,
    home: () => '/home/u',
    ...overrides,
  };
}

describe('classifyKeyEncryption', () => {
  it('returns false for an unencrypted key', () => {
    expect(classifyKeyEncryption(unencrypted.private)).toBe(false);
  });
  it('returns true for an encrypted key', () => {
    expect(classifyKeyEncryption(encrypted.private)).toBe(true);
  });
  it('returns undefined for a non-key blob', () => {
    expect(classifyKeyEncryption('not a key')).toBeUndefined();
  });
});

describe('isPassphraseValid', () => {
  it('accepts the correct passphrase', () => {
    expect(isPassphraseValid(encrypted.private, 'pw')).toBe(true);
  });
  it('rejects a wrong passphrase', () => {
    expect(isPassphraseValid(encrypted.private, 'nope')).toBe(false);
  });
});

describe('getKeyPassphraseFromEnv', () => {
  it('reads ZOWE_MCP_KEY_PASSPHRASE_<USER>_<HOST>', () => {
    const getEnv = vi.fn((name: string) =>
      name === 'ZOWE_MCP_KEY_PASSPHRASE_USER_HOST_EXAMPLE_COM' ? 'envpass' : undefined
    );
    expect(getKeyPassphraseFromEnv(SPEC, { getEnv })).toBe('envpass');
  });
  it('returns undefined when unset', () => {
    expect(getKeyPassphraseFromEnv(SPEC, { getEnv: () => undefined })).toBeUndefined();
  });
});

describe('resolveSshKey', () => {
  it('prefers the explicit env override and expands ~', async () => {
    const expandedPath = join('/home/u', 'keys/id');
    const result = await resolveSshKey(
      SPEC,
      deps({
        getEnv: name =>
          name === 'ZOWE_MCP_PRIVATE_KEY_USER_HOST_EXAMPLE_COM' ? '~/keys/id' : undefined,
        readKeyFile: p => {
          expect(p).toBe(expandedPath);
          return unencrypted.private;
        },
      })
    );
    expect(result).toEqual({ privateKeyPath: expandedPath, encrypted: false });
  });

  it('matches a ~/.ssh/config entry by Host alias', async () => {
    const result = await resolveSshKey(
      SPEC,
      deps({
        loadSshConfigEntries: () =>
          Promise.resolve([{ name: 'host.example.com', privateKey: '/home/u/.ssh/cfgkey' }]),
      })
    );
    expect(result).toEqual({ privateKeyPath: '/home/u/.ssh/cfgkey', encrypted: false });
  });

  it('matches a ~/.ssh/config entry by HostName', async () => {
    const result = await resolveSshKey(
      SPEC,
      deps({
        loadSshConfigEntries: () =>
          Promise.resolve([
            { name: 'alias', hostname: 'host.example.com', privateKey: '/home/u/.ssh/hk' },
          ]),
      })
    );
    expect(result?.privateKeyPath).toBe('/home/u/.ssh/hk');
  });

  it('falls back to the first default identity file', async () => {
    const result = await resolveSshKey(
      SPEC,
      deps({ loadDefaultKeyPaths: () => Promise.resolve(['/home/u/.ssh/id_ed25519']) })
    );
    expect(result?.privateKeyPath).toBe('/home/u/.ssh/id_ed25519');
  });

  it('reports encrypted keys', async () => {
    const result = await resolveSshKey(
      SPEC,
      deps({
        loadDefaultKeyPaths: () => Promise.resolve(['/home/u/.ssh/id_rsa']),
        readKeyFile: () => encrypted.private,
      })
    );
    expect(result).toEqual({ privateKeyPath: '/home/u/.ssh/id_rsa', encrypted: true });
  });

  it('returns undefined when no key is found', async () => {
    expect(await resolveSshKey(SPEC, deps({}))).toBeUndefined();
  });

  it('skips an unreadable key file', async () => {
    const result = await resolveSshKey(
      SPEC,
      deps({
        loadDefaultKeyPaths: () => Promise.resolve(['/home/u/.ssh/missing']),
        readKeyFile: () => {
          throw new Error('ENOENT');
        },
      })
    );
    expect(result).toBeUndefined();
  });

  it('skips a candidate that is not a usable private key', async () => {
    const result = await resolveSshKey(
      SPEC,
      deps({
        loadDefaultKeyPaths: () => Promise.resolve(['/home/u/.ssh/garbage']),
        readKeyFile: () => 'this is not a key',
      })
    );
    expect(result).toBeUndefined();
  });
});
