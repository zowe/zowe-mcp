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
 * SSH key authentication end-to-end against the standalone mock z/OS host.
 *
 * The mock host (`src/mock-host/`) speaks real SSH via `ssh2` and accepts
 * publickey auth from a user's `authorizedKeys`. These tests drive the real
 * native stack (NativeCredentialProvider → SshClientCache → real ZSshClient →
 * mock RPC) so we exercise an actual SSH handshake: a real key file is
 * presented, an encrypted key is decrypted with its passphrase, and the
 * key→password fallback runs when the key is rejected.
 *
 * Scenarios:
 *   1. Authorized key            → connects via key.
 *   2. Unauthorized key          → falls back to password, then connects.
 *   3. Encrypted key + passphrase → decrypts and connects via key.
 *   4. Encrypted key, no passphrase → falls back to password, then connects.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import ssh2 from 'ssh2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  parseConnectionSpec,
  toKeyPassphraseEnvVarName,
  toPasswordEnvVarName,
  toPrivateKeyEnvVarName,
  type ParsedConnectionSpec,
} from '../src/zos/native/connection-spec.js';
import { NativeBackend } from '../src/zos/native/native-backend.js';
import { NativeCredentialProvider } from '../src/zos/native/native-credential-provider.js';
import { SshClientCache } from '../src/zos/native/ssh-client-cache.js';
import { spawnMockZos, type SpawnedMockZos } from './helpers/spawn-mock-zos.js';

const PASSWORD = 'password';
const PASSPHRASE = 'pw1234';

let keyDir: string;
let plainKeyPath: string;
let plainPublic: string;
let encKeyPath: string;
let encPublic: string;

beforeAll(async () => {
  keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-key-auth-'));

  const plain = ssh2.utils.generateKeyPairSync('ed25519');
  plainKeyPath = path.join(keyDir, 'id_plain');
  plainPublic = plain.public;
  await fs.writeFile(plainKeyPath, plain.private, { mode: 0o600 });

  const enc = ssh2.utils.generateKeyPairSync('ed25519', {
    passphrase: PASSPHRASE,
    cipher: 'aes256-cbc',
    rounds: 16,
  });
  encKeyPath = path.join(keyDir, 'id_enc');
  encPublic = enc.public;
  await fs.writeFile(encKeyPath, enc.private, { mode: 0o600 });
});

afterAll(async () => {
  await fs.rm(keyDir, { recursive: true, force: true });
});

/** Saves and restores the SSH-key-related env vars for one connection around a test. */
function withEnv(
  spec: ParsedConnectionSpec,
  vars: { privateKey?: string; passphrase?: string; password?: string }
): () => void {
  const keys: Record<string, string | undefined> = {
    [toPrivateKeyEnvVarName(spec.user, spec.host)]: vars.privateKey,
    [toKeyPassphraseEnvVarName(spec.user, spec.host)]: vars.passphrase,
    [toPasswordEnvVarName(spec.user, spec.host)]: vars.password,
  };
  const prev: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(keys)) {
    prev[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return () => {
    for (const [name, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

/** Spawn a mock host where USER1 has the given authorized keys and a seeded dataset. */
async function spawnWithAuthorizedKeys(authorizedKeys: string[]): Promise<SpawnedMockZos> {
  return spawnMockZos({
    users: [
      {
        username: 'USER1',
        password: PASSWORD,
        home: '/u/user1',
        systemId: 'sys1',
        scenario: 'normal',
        authorizedKeys,
      },
    ],
    httpPort: undefined,
    seedDatasets: [{ dsn: 'USER1.TEST', dsorg: 'PS', recfm: 'FB', lrecl: 80, content: 'hello\n' }],
  });
}

/** Build the native stack (provider + cache + backend) pointed at the mock host. */
function buildStack(spec: ParsedConnectionSpec): {
  backend: NativeBackend;
  provider: NativeCredentialProvider;
  clientCache: SshClientCache;
} {
  const provider = new NativeCredentialProvider({
    connectionSpecs: [spec],
    useEnvForPassword: true,
  });
  // autoInstallZowex: false — the mock already serves the RPC, so never try to install.
  const clientCache = new SshClientCache({ autoInstallZowex: false, responseTimeout: 30 });
  const backend = new NativeBackend({
    credentialProvider: provider,
    clientCache,
    getSpec: () => spec,
    getResponseTimeout: () => 30,
  });
  return { backend, provider, clientCache };
}

// Real ssh2 handshakes against the in-process mock host are CPU-heavy; under coverage
// instrumentation on loaded CI runners the key exchange can stall past the client's auth
// window and misread as a key failure. Retry so a slow moment doesn't fail the suite.
describe('SSH key authentication against mock z/OS host', { retry: 2 }, () => {
  it('1. connects with an authorized key (no password fallback)', async () => {
    const mock = await spawnWithAuthorizedKeys([plainPublic]);
    const spec = parseConnectionSpec(`USER1@127.0.0.1:${mock.sshPort}`);
    const restoreEnv = withEnv(spec, { privateKey: plainKeyPath });
    const { backend, provider, clientCache } = buildStack(spec);
    const markKeyFailed = vi.spyOn(provider, 'markKeyFailed');
    try {
      const result = await backend.listDatasets(spec.host, 'USER1.*');
      expect(Array.isArray(result)).toBe(true);
      expect(markKeyFailed).not.toHaveBeenCalled();
    } finally {
      clientCache.dispose();
      restoreEnv();
      await mock.handle.dispose();
    }
  });

  it('2. falls back to password when the key is not authorized', async () => {
    const mock = await spawnWithAuthorizedKeys([]); // key not trusted
    const spec = parseConnectionSpec(`USER1@127.0.0.1:${mock.sshPort}`);
    const restoreEnv = withEnv(spec, { privateKey: plainKeyPath, password: PASSWORD });
    const { backend, provider, clientCache } = buildStack(spec);
    const markKeyFailed = vi.spyOn(provider, 'markKeyFailed');
    try {
      const result = await backend.listDatasets(spec.host, 'USER1.*');
      expect(Array.isArray(result)).toBe(true);
      expect(markKeyFailed).toHaveBeenCalledWith(spec);
    } finally {
      clientCache.dispose();
      restoreEnv();
      await mock.handle.dispose();
    }
  });

  it('3. connects with an encrypted key using its passphrase', async () => {
    const mock = await spawnWithAuthorizedKeys([encPublic]);
    const spec = parseConnectionSpec(`USER1@127.0.0.1:${mock.sshPort}`);
    const restoreEnv = withEnv(spec, { privateKey: encKeyPath, passphrase: PASSPHRASE });
    const { backend, provider, clientCache } = buildStack(spec);
    const markKeyFailed = vi.spyOn(provider, 'markKeyFailed');
    try {
      const result = await backend.listDatasets(spec.host, 'USER1.*');
      expect(Array.isArray(result)).toBe(true);
      expect(markKeyFailed).not.toHaveBeenCalled();
    } finally {
      clientCache.dispose();
      restoreEnv();
      await mock.handle.dispose();
    }
  });

  it('4. falls back to password for an encrypted key with no passphrase', async () => {
    const mock = await spawnWithAuthorizedKeys([encPublic]);
    const spec = parseConnectionSpec(`USER1@127.0.0.1:${mock.sshPort}`);
    // Encrypted key present but no passphrase configured → provider skips the key entirely.
    const restoreEnv = withEnv(spec, { privateKey: encKeyPath, password: PASSWORD });
    const { backend, provider, clientCache } = buildStack(spec);
    try {
      const creds = await provider.getCredentials(spec.host);
      expect(creds.authMethod).toBe('password');
      const result = await backend.listDatasets(spec.host, 'USER1.*');
      expect(Array.isArray(result)).toBe(true);
    } finally {
      clientCache.dispose();
      restoreEnv();
      await mock.handle.dispose();
    }
  });
});
