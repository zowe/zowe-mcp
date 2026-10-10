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
 * Bounds on anonymous dynamic client registration (`POST /reg`).
 *
 * DCR here is deliberately anonymous (`initialAccessToken: false` — VS Code's
 * MCP client registers itself), which makes the endpoint an unauthenticated
 * writer into oidc-provider's storage. The default MemoryAdapter is ONE shared
 * LRU (maxSize 1000) across all models, so ~1000 spam registrations evict
 * every live session/grant/code — a cheap state-flush of the whole IdP — and
 * each accepted registration otherwise persists for the process lifetime.
 *
 * Two independent bounds, both enforced before the provider sees the request:
 *  - per-source sliding window (slows a single scripted client), and
 *  - a lifetime cap on total accepted registrations, kept well below the
 *    shared LRU size so registrations can never crowd out live sessions.
 *
 * Statically configured clients (`staticClients`) never pass through `/reg`,
 * so they are unaffected by these limits; when the total cap is reached, new
 * clients can still be provisioned statically (or the IdP restarted — this is
 * a dev/test IdP with in-memory state anyway).
 */

export interface RegistrationLimitResult {
  allowed: boolean;
  /** HTTP status to answer with when `allowed` is false (429 or 503). */
  status?: 429 | 503;
  /** Present only for per-source (429) denials. */
  retryAfterSeconds?: number;
}

export class RegistrationLimiter {
  /** Timestamps of guard-passed registrations per source address. */
  private readonly bySource = new Map<string, number[]>();
  /** Registrations the provider actually accepted (201), process lifetime. */
  private totalAccepted = 0;

  constructor(
    private readonly maxPerSource = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly maxTotal = 100
  ) {}

  /**
   * Checks both bounds and, when allowed, counts the request against the
   * per-source window immediately (before the provider runs) so a concurrent
   * burst from one source cannot all pass while none is recorded yet.
   */
  checkAndRecord(source: string): RegistrationLimitResult {
    if (this.totalAccepted >= this.maxTotal) {
      return { allowed: false, status: 503 };
    }
    const now = Date.now();
    const recent = (this.bySource.get(source) ?? []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.maxPerSource) {
      this.bySource.set(source, recent);
      const retryAfterMs = this.windowMs - (now - recent[0]);
      return {
        allowed: false,
        status: 429,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }
    recent.push(now);
    this.bySource.set(source, recent);
    return { allowed: true };
  }

  /** Records a registration the provider accepted (a 201 response). */
  recordAccepted(): void {
    this.totalAccepted++;
  }
}
