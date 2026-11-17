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

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeSshClient extends EventEmitter {
  connect = vi.fn();
  end = vi.fn();
}

let lastClient: FakeSshClient | undefined;

vi.mock('ssh2', () => ({
  // A real function (not an arrow) — the production code calls `new Client()`,
  // and arrow functions cannot be invoked as constructors.
  Client: vi.fn().mockImplementation(function ClientMock() {
    lastClient = new FakeSshClient();
    return lastClient;
  }),
}));

const { verifySafCredential } = await import('../src/saf-check.js');

describe('verifySafCredential', () => {
  beforeEach(() => {
    lastClient = undefined;
  });

  it('resolves authenticated and ends the connection when ssh2 reports ready', async () => {
    const promise = verifySafCredential('userb', 'secret');
    expect(lastClient).toBeDefined();
    lastClient!.emit('ready');
    await expect(promise).resolves.toEqual({ outcome: 'authenticated' });
    expect(lastClient!.end).toHaveBeenCalledOnce();
  });

  it('resolves denied (never rejects) on a client-authentication error', async () => {
    const promise = verifySafCredential('userb', 'wrong');
    const err = Object.assign(new Error('All configured authentication methods failed'), {
      level: 'client-authentication',
    });
    lastClient!.emit('error', err);
    await expect(promise).resolves.toEqual({ outcome: 'denied' });
    expect(lastClient!.end).toHaveBeenCalledOnce();
  });

  it('resolves unavailable (not denied) on a readyTimeout-style error', async () => {
    const promise = verifySafCredential('userb', 'secret', { readyTimeoutMs: 10 });
    const err = Object.assign(new Error('Timed out while waiting for handshake'), {
      level: 'client-timeout',
    });
    lastClient!.emit('error', err);
    await expect(promise).resolves.toMatchObject({ outcome: 'unavailable' });
  });

  it('resolves unavailable on a socket-level error (sshd down says nothing about the password)', async () => {
    const promise = verifySafCredential('userb', 'secret');
    const err = Object.assign(new Error('connect ECONNREFUSED'), {
      level: 'client-socket',
      code: 'ECONNREFUSED',
    });
    lastClient!.emit('error', err);
    const result = await promise;
    expect(result.outcome).toBe('unavailable');
  });

  it('passes host/port/timeout through to ssh2 connect', async () => {
    const promise = verifySafCredential('userb', 'secret', {
      host: '10.0.0.1',
      port: 2222,
      readyTimeoutMs: 1234,
    });
    expect(lastClient!.connect).toHaveBeenCalledWith({
      host: '10.0.0.1',
      port: 2222,
      username: 'userb',
      password: 'secret',
      readyTimeout: 1234,
    });
    lastClient!.emit('ready');
    await promise;
  });

  it('ignores a second event after the first settles the promise', async () => {
    const promise = verifySafCredential('userb', 'secret');
    lastClient!.emit('ready');
    lastClient!.emit('error', new Error('should be ignored'));
    await expect(promise).resolves.toEqual({ outcome: 'authenticated' });
  });
});
