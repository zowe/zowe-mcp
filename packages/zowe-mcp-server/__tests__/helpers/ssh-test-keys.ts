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
 * SSH key pairs for tests that exercise key authentication.
 *
 * `ssh2.utils.generateKeyPairSync('ed25519')` occasionally emits a private key
 * that ssh2's own `parseKey` rejects with "Malformed OpenSSH private key" —
 * measured at roughly 0.7% of generated keys (20 of 3000 plain, 2 of 300
 * encrypted, ssh2 1.17.0). Such a key is not a usable identity: the resolver
 * silently skips it (`classifyKeyEncryption` returns undefined), so the failure
 * surfaces far away from its cause — as a password prompt, a missing-password
 * error, or a key-auth assertion that never fires. Test-level `retry` cannot
 * help when the key is generated once in `beforeAll`.
 *
 * Generating through this helper keeps that out of the suite: every key handed
 * back has been parsed by the same code path the resolver uses.
 */

import ssh2 from 'ssh2';

/** Options for an encrypted key pair; omit for an unencrypted one. */
export interface EncryptedKeyOptions {
  passphrase: string;
  cipher?: string;
  rounds?: number;
}

/** A generated key pair: OpenSSH-format private key and its public key. */
export interface TestKeyPair {
  private: string;
  public: string;
}

const MAX_ATTEMPTS = 10;

/**
 * Generates an ed25519 key pair that ssh2 can parse back.
 *
 * @param options - Passphrase and KDF settings to produce an encrypted key. Omit for a plain key.
 * @throws If no parseable key could be generated, which would mean something
 *         systematically wrong with the platform's key generation.
 */
export function generateTestKeyPair(options?: EncryptedKeyOptions): TestKeyPair {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const pair = options
      ? ssh2.utils.generateKeyPairSync('ed25519', {
          passphrase: options.passphrase,
          cipher: options.cipher ?? 'aes256-cbc',
          rounds: options.rounds ?? 16,
        })
      : ssh2.utils.generateKeyPairSync('ed25519');
    const parsed = options
      ? ssh2.utils.parseKey(pair.private, options.passphrase)
      : ssh2.utils.parseKey(pair.private);
    if (!(parsed instanceof Error)) {
      return { private: pair.private, public: pair.public };
    }
  }
  throw new Error(
    `Could not generate a parseable ed25519 key pair in ${MAX_ATTEMPTS} attempts (ssh2 rejected every key)`
  );
}
