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

import { createServer, type Server } from 'node:https';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestSessionAuthentication } from '../src/auth/rest-session-auth.js';
import { loadRest } from '../src/zos/rest/load-rest.js';
import { generateHttpsTestCertificate } from './helpers/https-test-certificate.js';

const HOST = '127.0.0.1';
const USER = 'USER1';
const PASSWORDS = ['dummy-initial-password', 'dummy-second-password', 'dummy-third-password'];
const servers: Server[] = [];
let certificate: ReturnType<typeof generateHttpsTestCertificate>;

interface RecordedRequest {
  path: string;
  pattern: string;
  authorization: string | undefined;
}

interface FixtureResponse {
  status?: number;
  body: object;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

function token(index: number): string {
  return `Bearer dummy-session-${index}`;
}

function basic(index: number): string {
  return `Basic ${Buffer.from(`${USER}:${PASSWORDS[index - 1]}`).toString('base64')}`;
}

function listing(pattern: string): FixtureResponse {
  return { body: { items: [{ name: pattern, dsorg: 'PS' }], moreRows: false } };
}

function unauthorized(): FixtureResponse {
  return { status: 401, body: { message: 'Authentication rejected by the test service' } };
}

beforeAll(() => {
  certificate = generateHttpsTestCertificate();
});

beforeEach(() => {
  for (const name of [
    'ZOWE_MCP_PASSWORD_USER1_127_0_0_1',
    'ZOWE_MCP_CREDENTIALS',
    'ZOWE_MCP_VAULT_ADDR',
    'ZOWE_MCP_VAULT_TOKEN',
    'ZOWE_MCP_VAULT_KV_PATH',
  ])
    vi.stubEnv(name, '');
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        })
    )
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function fixture(options: {
  session: boolean;
  read(request: RecordedRequest): FixtureResponse | Promise<FixtureResponse>;
  login?(index: number): Promise<void>;
}) {
  const requests: RecordedRequest[] = [];
  let loginCount = 0;
  const server = createServer(certificate, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://localhost');
    const recorded = {
      path: url.pathname,
      pattern: url.searchParams.get('pattern') ?? 'TEST.DATA',
      authorization: req.headers.authorization,
    };
    requests.push(recorded);
    void (async () => {
      let result: FixtureResponse;
      if (recorded.path.endsWith('/system/info')) result = { body: { version: '0.6.0' } };
      else if (recorded.path === '/session') {
        const index = ++loginCount;
        await options.login?.(index);
        result = { body: { token: `dummy-session-${index}` } };
      } else result = await options.read(recorded);
      res.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    })();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, HOST, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const origin = `https://${HOST}:${address.port}`;
  let promptCount = 0;
  const prompt = vi.fn(() => Promise.resolve(PASSWORDS[promptCount++] ?? 'dummy-extra-password'));
  const rest = loadRest({
    systems: [
      {
        url: origin,
        user: USER,
        deployment: 'direct',
        rejectUnauthorized: false,
        timeoutSeconds: 5,
        ...(options.session
          ? { sessionLogin: { url: '/session', method: 'basic', tokenField: 'token' } }
          : {}),
      },
    ],
    useEnvForPassword: true,
    requestPasswordViaElicitation: prompt,
  });
  return {
    rest,
    prompt,
    requests,
    read: (pattern: string) => rest.backend.listDatasets(HOST, pattern),
  };
}

function capture<T>(operation: Promise<T>): Promise<unknown> {
  return operation.catch((error: unknown) => error);
}

function expectUnauthorized(error: unknown) {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('HTTP 401');
}

describe('REST authentication across concurrent HTTPS failures', () => {
  it.each(['during-login', 'after-replacement'] as const)(
    'reuses one replacement after parallel old-session 401s: %s',
    async timing => {
      const bothOldRequests = deferred();
      const releaseFirst = deferred();
      const releaseSecond = deferred();
      const replacementStarted = deferred();
      const releaseReplacement = deferred();
      let oldRequests = 0;
      const invalidations = vi.spyOn(RestSessionAuthentication.prototype, 'invalidate');
      const service = await fixture({
        session: true,
        login: async index => {
          if (index === 2) {
            replacementStarted.resolve();
            await releaseReplacement.promise;
          }
        },
        read: async request => {
          if (
            request.authorization === token(1) &&
            ['TEST.A', 'TEST.B'].includes(request.pattern)
          ) {
            if (++oldRequests === 2) bothOldRequests.resolve();
            await (request.pattern === 'TEST.A' ? releaseFirst.promise : releaseSecond.promise);
            return unauthorized();
          }
          return listing(request.pattern);
        },
      });
      await service.read('TEST.WARM');
      const first = capture(service.read('TEST.A'));
      const second = capture(service.read('TEST.B'));
      await bothOldRequests.promise;
      releaseFirst.resolve();
      await replacementStarted.promise;
      if (timing === 'during-login') {
        releaseSecond.resolve();
        await vi.waitFor(() => {
          if (invalidations.mock.calls.length < 2)
            throw new Error('Waiting for second old-session 401');
        });
      }
      releaseReplacement.resolve();
      expect(await first).toEqual([expect.objectContaining({ dsn: 'TEST.A' })]);
      releaseSecond.resolve();
      expect(await second).toEqual([expect.objectContaining({ dsn: 'TEST.B' })]);
      expect(service.prompt).toHaveBeenCalledTimes(2);
      expect(
        service.requests
          .filter(request => request.path === '/session')
          .map(request => request.authorization)
      ).toEqual([basic(1), basic(2)]);
      expect(invalidations.mock.results.map(result => result.value)).toEqual([true, false]);
      expect(invalidations.mock.calls[0][0]).toBe(invalidations.mock.calls[1][0]);
      expect(
        service.requests
          .filter(request => request.pattern === 'TEST.B')
          .map(request => request.authorization)
      ).toEqual([token(1), token(2)]);
      expect(service.rest.backend.getConnectionStatuses!()[0].authentication).toMatchObject({
        active: 'session-token',
        verified: true,
        session: { token: 'valid', credentialStorage: 'none' },
      });
    }
  );

  it('does not let a delayed final Basic 401 discard a freshly elicited password', async () => {
    const bothOldRequests = deferred();
    const releaseFirst = deferred();
    const releaseSecond = deferred();
    let oldRequests = 0;
    const invalidations = vi.spyOn(RestSessionAuthentication.prototype, 'invalidate');
    const service = await fixture({
      session: false,
      read: async request => {
        if (request.authorization === basic(1) && ['TEST.A', 'TEST.B'].includes(request.pattern)) {
          if (++oldRequests === 2) bothOldRequests.resolve();
          await (request.pattern === 'TEST.A' ? releaseFirst.promise : releaseSecond.promise);
          return unauthorized();
        }
        return listing(request.pattern);
      },
    });
    await service.read('TEST.WARM');
    const first = capture(service.read('TEST.A'));
    const second = capture(service.read('TEST.B'));
    await bothOldRequests.promise;
    releaseFirst.resolve();
    expectUnauthorized(await first);
    await service.read('TEST.C');
    releaseSecond.resolve();
    expectUnauthorized(await second);
    expect(service.rest.backend.getConnectionStatuses!()[0].authentication).toMatchObject({
      active: 'password',
      verified: true,
      lastHttpStatus: 200,
      passwordSource: 'elicited',
      session: { credentialStorage: 'memory' },
    });
    await service.read('TEST.D');
    expect(service.prompt).toHaveBeenCalledTimes(2);
    expect(
      service.requests
        .filter(request => ['TEST.C', 'TEST.D'].includes(request.pattern))
        .map(request => request.authorization)
    ).toEqual([basic(2), basic(2)]);
    expect(invalidations.mock.results.map(result => result.value)).toEqual([true, false]);
  });

  it('does not let a delayed final retry 401 invalidate a newer session token', async () => {
    const retryArrived = deferred();
    const releaseFinalFailure = deferred();
    const invalidations = vi.spyOn(RestSessionAuthentication.prototype, 'invalidate');
    const service = await fixture({
      session: true,
      read: async request => {
        if (request.pattern === 'TEST.A' && request.authorization === token(1))
          return unauthorized();
        if (request.pattern === 'TEST.A' && request.authorization === token(2)) {
          retryArrived.resolve();
          await releaseFinalFailure.promise;
          return unauthorized();
        }
        if (request.pattern === 'TEST.C' && request.authorization === token(2))
          return unauthorized();
        return listing(request.pattern);
      },
    });
    await service.read('TEST.WARM');
    const first = capture(service.read('TEST.A'));
    await retryArrived.promise;
    await service.read('TEST.C');
    releaseFinalFailure.resolve();
    expectUnauthorized(await first);
    expect(service.rest.backend.getConnectionStatuses!()[0].authentication).toMatchObject({
      active: 'session-token',
      verified: true,
      lastHttpStatus: 200,
      session: { token: 'valid', credentialStorage: 'none' },
    });
    await service.read('TEST.D');
    expect(service.prompt).toHaveBeenCalledTimes(3);
    expect(service.requests.filter(request => request.path === '/session')).toHaveLength(3);
    expect(
      service.requests
        .filter(request => request.pattern === 'TEST.D')
        .map(request => request.authorization)
    ).toEqual([token(3)]);
    expect(invalidations.mock.results.map(result => result.value)).toEqual([true, true, false]);
    expect(invalidations.mock.calls[1][0]).toBe(invalidations.mock.calls[2][0]);
  });
});
