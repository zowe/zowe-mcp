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

import { WaitablePasswordStore } from './native/password-store.js';

/**
 * In-memory store for JCL job cards per connection spec (user@host or user@host:port).
 * Used when submitting JCL that does not include a job card; the store provides the
 * card to prepend. Populated from config file (jobCards section) and/or VS Code
 * settings and elicitation.
 */

/** Key is connection spec (e.g. user@host or user@host:port). Value is full job card text (multi-line). */
export type JobCardsMap = Record<string, string>;

/** Input for job cards: value may be a single string or an array of lines (user-friendly in JSON). */
export type JobCardsMapInput = Record<string, string | string[]>;

function normalizeJobCardValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value
      .map(line => (typeof line === 'string' ? line : String(line)))
      .join('\n')
      .trim();
  }
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Store for job cards per connection spec. Merge-only from config/extension;
 * no file path or loadFromFile.
 */
export interface JobCardStore {
  /** Get job card for a connection spec, or undefined if not set. */
  get(connectionSpec: string): string | undefined;
  /** Set job card for a connection spec (e.g. after elicitation). */
  set(connectionSpec: string, jobCard: string): void;
  /** Merge entries from an object (e.g. config.jobCards or VS Code setting). Values may be string or array of lines. Does not remove existing. */
  mergeFromObject(obj: JobCardsMapInput | undefined | null): void;
}

/**
 * Create an in-memory job card store. Use mergeFromObject to load from
 * config JSON or VS Code setting.
 */
export function createJobCardStore(): JobCardStore {
  const map = new Map<string, string>();

  return {
    get(connectionSpec: string): string | undefined {
      return map.get(connectionSpec);
    },
    set(connectionSpec: string, jobCard: string): void {
      map.set(connectionSpec, jobCard.trim());
    },
    mergeFromObject(obj: JobCardsMapInput | undefined | null): void {
      if (obj == null || typeof obj !== 'object') return;
      for (const [spec, value] of Object.entries(obj)) {
        if (spec.trim().length > 0 && (typeof value === 'string' || Array.isArray(value))) {
          const normalized = normalizeJobCardValue(value);
          if (normalized.length > 0) {
            map.set(spec.trim(), normalized);
          }
        }
      }
    },
  };
}

/**
 * Job card store that can wake waiters when the VS Code extension sends a `job-card`
 * event (same pattern as {@link WaitablePasswordStore} for passwords).
 */
export type JobCardStoreWithWait = JobCardStore & {
  waitForJobCard(connectionSpec: string, timeoutMs: number): Promise<string | undefined>;
};

/**
 * Creates a {@link JobCardStore} plus {@link JobCardStoreWithWait.waitForJobCard} so the server
 * can await a `job-card` response after sending `request-job-card`.
 */
export function createWaitableJobCardStore(): JobCardStoreWithWait {
  const inner = createJobCardStore();
  const signal = new WaitablePasswordStore();

  return {
    get(connectionSpec: string): string | undefined {
      return inner.get(connectionSpec);
    },
    set(connectionSpec: string, jobCard: string): void {
      const t = jobCard.trim();
      inner.set(connectionSpec, t);
      signal.set(connectionSpec, t);
    },
    mergeFromObject(obj: JobCardsMapInput | undefined | null): void {
      inner.mergeFromObject(obj);
    },
    waitForJobCard(connectionSpec: string, timeoutMs: number): Promise<string | undefined> {
      return signal.waitFor(connectionSpec, timeoutMs);
    },
  };
}
