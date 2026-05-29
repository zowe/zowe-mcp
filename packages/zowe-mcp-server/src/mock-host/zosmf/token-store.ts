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
 * In-memory store for z/OSMF LTPA2 tokens.
 *
 * Tokens are opaque random 64-hex strings (mimics LTPA2 — real LtpaToken2 is
 * also an opaque base64 blob; the mock keeps it hex for log readability).
 * Default TTL is 30 minutes to match the real z/OSMF default. Expiry is lazy
 * — cleanup happens when `resolve()` walks past an expired entry. There is no
 * background timer, so disposal is a trivial `clear()`.
 *
 * Tokens do NOT survive a daemon restart — this is deliberate. The mock is for
 * tests and dev loops; persisting tokens would create unexpected cross-run
 * state and risk surprising operators on real z/OS that has its own session
 * lifecycle quirks (the `_csrf` cache bug, etc.).
 */

import { randomBytes } from 'node:crypto';
import type { MockUser } from '../users.js';

export interface TokenInfo {
  token: string;
  username: string;
  /** Original scenario flag for the issuing user (for instrumentation). */
  scenario?: MockUser['scenario'];
  /** Epoch millis at which this token was minted. */
  issuedAt: number;
  /** Epoch millis after which this token is no longer valid. */
  expiresAt: number;
}

export interface TokenStoreOptions {
  /** Token TTL in milliseconds. Defaults to 30 minutes. */
  ttlMs?: number;
  /** Optional clock override for deterministic tests. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class TokenStore {
  private readonly tokens = new Map<string, TokenInfo>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: TokenStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Mint a fresh token for the given user. Multiple concurrent tokens per user are allowed. */
  mint(user: MockUser): TokenInfo {
    const issuedAt = this.now();
    const info: TokenInfo = {
      token: randomBytes(32).toString('hex'),
      username: user.username.toUpperCase(),
      scenario: user.scenario,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
    };
    this.tokens.set(info.token, info);
    return info;
  }

  /**
   * Look up a token. Returns the entry if present and not expired; otherwise
   * `undefined` (and deletes the entry if it had expired).
   */
  resolve(token: string): TokenInfo | undefined {
    if (!token) return undefined;
    const entry = this.tokens.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.tokens.delete(token);
      return undefined;
    }
    return entry;
  }

  /** Invalidate a token. Returns true if the token existed. */
  revoke(token: string): boolean {
    return this.tokens.delete(token);
  }

  /** Number of live (non-expired) tokens. Mainly for tests. */
  size(): number {
    let live = 0;
    const now = this.now();
    for (const e of this.tokens.values()) {
      if (e.expiresAt > now) live++;
    }
    return live;
  }

  /** Drop all tokens. Called by the daemon's `dispose()`. */
  dispose(): void {
    this.tokens.clear();
  }
}
