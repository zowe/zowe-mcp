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

import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SshSafCheckResult } from '../src/saf-check.js';

const verifySafCredentialMock =
  vi.fn<(username: string, password: string) => Promise<SshSafCheckResult>>();

vi.mock('../src/saf-check.js', () => ({
  verifySafCredential: verifySafCredentialMock,
}));

const { createIdpApp } = await import('../src/server.js');

interface RunningServer {
  baseUrl: string;
  close(): Promise<void>;
}

function startTestServer(): Promise<RunningServer> {
  const app = createIdpApp('http://127.0.0.1:0', {
    rateLimitMaxAttempts: 3,
    rateLimitWindowMs: 60_000,
  });
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(res => server.close(() => res())),
      });
    });
  });
}

function postLogin(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /login', () => {
  let running: RunningServer;

  beforeEach(async () => {
    verifySafCredentialMock.mockReset();
    running = await startTestServer();
  });

  afterEach(async () => {
    await running.close();
  });

  it('returns 400 when the password is missing', async () => {
    const res = await postLogin(running.baseUrl, { username: 'userb' });
    expect(res.status).toBe(400);
    expect(verifySafCredentialMock).not.toHaveBeenCalled();
  });

  it('returns a generic 401 on bad credentials without echoing the credentials back', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'denied' });
    const res = await postLogin(running.baseUrl, { username: 'userb', password: 'wrong' });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain('userb');
    expect(text).not.toContain('wrong');
  });

  it('mints an access_token on good credentials', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const res = await postLogin(running.baseUrl, { username: 'userb', password: 'secret' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { access_token?: string; token_type?: string };
    expect(json.token_type).toBe('Bearer');
    expect(typeof json.access_token).toBe('string');
    expect(json.access_token?.split('.')).toHaveLength(3);
  });

  it('mints the canonical uppercase SAF userid as sub for a lowercase login', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    const res = await postLogin(running.baseUrl, { username: 'userb', password: 'secret' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { access_token: string };
    const payload = JSON.parse(
      Buffer.from(json.access_token.split('.')[1], 'base64url').toString()
    ) as { sub?: string };
    expect(payload.sub).toBe('USERB');
    // The verifier still receives the username as typed — SAF folds case itself.
    expect(verifySafCredentialMock).toHaveBeenCalledWith('userb', 'secret', expect.anything());
  });

  it('rate-limits repeated failures with a generic 429 and Retry-After', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'denied' });
    let last: Response | undefined;
    for (let i = 0; i < 4; i++) {
      last = await postLogin(running.baseUrl, { username: 'userb', password: 'wrong' });
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
    // The 4th attempt must not have reached SAF at all once the limit tripped.
    expect(verifySafCredentialMock).toHaveBeenCalledTimes(3);
  });

  it('case variants of one userid share a single rate-limit budget', async () => {
    verifySafCredentialMock.mockResolvedValue({ outcome: 'denied' });
    await postLogin(running.baseUrl, { username: 'userb', password: 'wrong' });
    await postLogin(running.baseUrl, { username: 'USERB', password: 'wrong' });
    await postLogin(running.baseUrl, { username: 'Userb', password: 'wrong' });
    const fourth = await postLogin(running.baseUrl, { username: 'userb', password: 'wrong' });
    expect(fourth.status).toBe(429);
    expect(verifySafCredentialMock).toHaveBeenCalledTimes(3);
  });

  it('a success clears the failure count for that (username, IP)', async () => {
    verifySafCredentialMock.mockResolvedValueOnce({ outcome: 'denied' });
    verifySafCredentialMock.mockResolvedValueOnce({ outcome: 'denied' });
    verifySafCredentialMock.mockResolvedValue({ outcome: 'authenticated' });
    await postLogin(running.baseUrl, { username: 'userb', password: 'wrong' });
    await postLogin(running.baseUrl, { username: 'userb', password: 'wrong' });
    const res = await postLogin(running.baseUrl, { username: 'userb', password: 'right' });
    expect(res.status).toBe(200);
  });
});
