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
 * Waitable password store for VS Code mode.
 *
 * Used when the server sends request-password to the extension and must wait
 * for the extension to prompt (or read from SecretStorage) and send a password
 * event. getCredentials() awaits waitFor() instead of throwing immediately.
 */

interface PendingWaiter {
  resolve: (value: string | undefined) => void;
  reject: (reason: Error) => void;
}

export class WaitablePasswordStore {
  private readonly store = new Map<string, string>();
  private readonly pending = new Map<string, PendingWaiter[]>();

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
    const waiters = this.pending.get(key);
    if (waiters?.length) {
      this.pending.delete(key);
      for (const w of waiters) {
        w.resolve(value);
      }
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Waits for a password for the given key to be set (e.g. by a password event from the extension).
   * Resolves with the password, or undefined if the timeout is reached.
   */
  waitFor(key: string, timeoutMs: number): Promise<string | undefined> {
    const existing = this.store.get(key);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return new Promise<string | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.pending.get(key);
        if (list) {
          const idx = list.findIndex(w => w.resolve === resolve);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.pending.delete(key);
        }
        resolve(undefined);
      }, timeoutMs);
      const waiter: PendingWaiter = {
        resolve: (value: string | undefined) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      const list = this.pending.get(key) ?? [];
      list.push(waiter);
      this.pending.set(key, list);
    });
  }
}
