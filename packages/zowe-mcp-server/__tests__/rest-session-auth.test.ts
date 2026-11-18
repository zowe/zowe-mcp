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

import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  apimlSessionLogin,
  RestSessionAuthentication,
  type RestSessionAuthOptions,
  type SessionCredentialSource,
  type SessionHttpResponse,
  type SessionLoginConfig,
} from '../src/auth/rest-session-auth.js';
import { NativeCredentialProvider } from '../src/zos/native/native-credential-provider.js';

const ORIGIN = 'https://gateway.example.test:7554';
const USER = 'USER1';
const PASSWORD = 'dummy-session-password';
const NEXT_PASSWORD = 'dummy-new-session-password';
const COOKIE = 'dummy-apiml-session-token';
const TOKEN = 'dummy-json-session-token';
const REFRESH_TOKEN = 'dummy-refresh-token-must-not-be-used';
const START = Date.parse('2030-01-01T00:00:00.000Z');
const APIML_LOGIN = apimlSessionLogin(ORIGIN);
const JSON_LOGIN: SessionLoginConfig = {
  url: `${ORIGIN}/service/session`,
  method: 'json',
  tokenField: 'sessionToken',
};

function basic(password = PASSWORD): string {
  return `Basic ${Buffer.from(`${USER}:${password}`).toString('base64')}`;
}

function response(
  status: number,
  body: unknown = {},
  headers: IncomingHttpHeaders = {}
): SessionHttpResponse {
  return {
    status,
    headers,
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function cookieResponse(
  value = COOKIE,
  attributes = 'Max-Age=3600; HttpOnly; Secure'
): SessionHttpResponse {
  return response(200, {}, { 'set-cookie': [`apimlAuthenticationToken=${value}; ${attributes}`] });
}

/** Session JWTs are supplied by the trusted login response; expiry is an eviction hint only. */
function expiryToken(expiresAt: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString('base64url'),
    'dummy-session-signature',
  ].join('.');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** A minimal provider cache makes forget/fresh-elicitation behavior observable. */
function setup(login?: SessionLoginConfig, source: SessionCredentialSource = 'elicited') {
  let currentTime = START;
  let cachedPassword: string | undefined;
  let nextPassword = PASSWORD;
  let prompts = 0;
  const credentialRequests: boolean[] = [];
  const send = vi.fn<RestSessionAuthOptions['send']>().mockResolvedValue(cookieResponse());
  const forgetCredentials = vi.fn(() => {
    cachedPassword = undefined;
  });
  const authentication = new RestSessionAuthentication({
    login,
    now: () => currentTime,
    getCredentials: (forceElicitation: boolean) => {
      credentialRequests.push(forceElicitation);
      if (forceElicitation || cachedPassword === undefined) {
        prompts++;
        cachedPassword = nextPassword;
      }
      return Promise.resolve({ user: USER, password: cachedPassword, source });
    },
    forgetCredentials,
    send,
  });
  return {
    authentication,
    send,
    forgetCredentials,
    credentialRequests,
    getProviderPassword: () => cachedPassword,
    getPrompts: () => prompts,
    setNextPassword: (password: string) => {
      nextPassword = password;
    },
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

function expectSafeDiagnostics(authentication: RestSessionAuthentication, extra: unknown[] = []) {
  const diagnostics = JSON.stringify([
    authentication.getStatus(),
    authentication.getCacheIdentity(),
    ...extra,
  ]);
  for (const secret of [
    PASSWORD,
    NEXT_PASSWORD,
    COOKIE,
    TOKEN,
    REFRESH_TOKEN,
    basic(),
    basic().slice('Basic '.length),
  ]) {
    expect(diagnostics).not.toContain(secret);
  }
}

describe('REST credential-to-session authentication', () => {
  it('builds the APIML login endpoint from the gateway origin', () => {
    expect(apimlSessionLogin(`${ORIGIN}/zo/api/v1`)).toEqual({
      url: `${ORIGIN}/gateway/api/v1/auth/login`,
      method: 'basic',
      cookieName: 'apimlAuthenticationToken',
    });
  });

  it('inspects status, cache identity and existing authentication without acquiring credentials', () => {
    const fixture = setup(APIML_LOGIN);
    expect(fixture.authentication.getStatus()).toEqual({
      exchange: 'unknown',
      token: 'none',
      credentialStorage: 'none',
    });
    expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
    expectSafeDiagnostics(fixture.authentication);
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.credentialRequests).toEqual([]);
    expect(fixture.forgetCredentials).not.toHaveBeenCalled();
  });

  it('exchanges Basic credentials for the APIML cookie, discards the password and reuses only the cookie', async () => {
    const fixture = setup(APIML_LOGIN);
    fixture.send.mockResolvedValue(
      response(
        200,
        {},
        {
          'set-cookie': [
            'unrelated=ignore; Secure',
            `apimlAuthenticationToken=${COOKIE}; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Strict`,
          ],
        }
      )
    );
    const before = fixture.authentication.getCacheIdentity();
    const authentication = await fixture.authentication.getAuthentication();
    expect(fixture.send).toHaveBeenCalledExactlyOnceWith(new URL(APIML_LOGIN.url), basic(), {
      method: 'POST',
    });
    expect(authentication).toEqual({
      mode: 'session-token',
      source: 'elicited',
      headers: { Cookie: `apimlAuthenticationToken=${COOKIE}` },
    });
    expect(fixture.getProviderPassword()).toBeUndefined();
    expect(fixture.forgetCredentials).toHaveBeenCalledTimes(1);
    expect(fixture.authentication.getStatus()).toEqual({
      exchange: 'available',
      token: 'valid',
      expiresAt: START + 3_600_000,
      credentialStorage: 'none',
    });
    expect(fixture.authentication.getCacheIdentity()).not.toBe(before);
    expect(await fixture.authentication.getAuthentication()).toEqual(authentication);
    expect(fixture.authentication.getCachedAuthentication()).toEqual(authentication);
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(fixture.credentialRequests).toEqual([false]);
    expectSafeDiagnostics(fixture.authentication);
  });

  it('uses a declared JSON session login before Basic and ignores a returned refresh token', async () => {
    const fixture = setup(JSON_LOGIN);
    fixture.send.mockResolvedValue(
      response(200, { sessionToken: TOKEN, expires_in: 60, refresh_token: REFRESH_TOKEN })
    );
    const authentication = await fixture.authentication.getAuthentication();
    expect(fixture.send).toHaveBeenCalledExactlyOnceWith(new URL(JSON_LOGIN.url), undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASSWORD }),
    });
    expect(authentication).toEqual({
      authorization: `Bearer ${TOKEN}`,
      mode: 'session-token',
      source: 'elicited',
    });
    expect(fixture.getProviderPassword()).toBeUndefined();
    expect(fixture.forgetCredentials).toHaveBeenCalledTimes(1);
    expect(fixture.authentication.getStatus()).toMatchObject({
      exchange: 'available',
      token: 'valid',
      expiresAt: START + 60_000,
      credentialStorage: 'none',
    });
    expectSafeDiagnostics(fixture.authentication);
  });

  it.each(['access_token', 'token', 'jwtToken'])(
    'accepts the conventional JSON token field %s when none is explicitly declared',
    async field => {
      const fixture = setup({ url: JSON_LOGIN.url, method: 'json' });
      fixture.send.mockResolvedValue(response(200, { [field]: TOKEN }));
      expect(await fixture.authentication.getAuthentication()).toMatchObject({
        authorization: `Bearer ${TOKEN}`,
        mode: 'session-token',
      });
      expect(fixture.getProviderPassword()).toBeUndefined();
    }
  );

  it.each([
    { name: 'cookie Max-Age', login: APIML_LOGIN, first: cookieResponse(COOKIE, 'Max-Age=1') },
    {
      name: 'cookie Expires',
      login: APIML_LOGIN,
      first: cookieResponse(COOKIE, `Expires=${new Date(START + 1000).toUTCString()}`),
    },
    {
      name: 'session JWT exp',
      login: APIML_LOGIN,
      first: cookieResponse(expiryToken(START + 1000)),
    },
    {
      name: 'JSON expires_in',
      login: JSON_LOGIN,
      first: response(200, { sessionToken: TOKEN, expires_in: 1 }),
    },
  ])(
    'forces fresh elicitation after $name expiry, without refreshing or reusing a password',
    async ({ login, first }) => {
      const fixture = setup(login, 'configured');
      fixture.send
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(
          login.method === 'basic'
            ? cookieResponse('replacement-session')
            : response(200, { sessionToken: 'replacement-session' })
        );
      await fixture.authentication.getAuthentication();
      expect(fixture.getProviderPassword()).toBeUndefined();
      const beforeExpiry = fixture.authentication.getCacheIdentity();
      fixture.setNextPassword(NEXT_PASSWORD);
      fixture.advance(1000);
      expect(fixture.authentication.getStatus()).toMatchObject({
        token: 'expired',
        credentialStorage: 'none',
      });
      expect(fixture.authentication.getCacheIdentity()).not.toBe(beforeExpiry);
      expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
      expect(fixture.credentialRequests).toEqual([false]);
      expect(fixture.send).toHaveBeenCalledTimes(1);
      await fixture.authentication.getAuthentication();
      expect(fixture.credentialRequests).toEqual([false, true]);
      expect(fixture.getPrompts()).toBe(2);
      expect(fixture.send).toHaveBeenCalledTimes(2);
      const nextRequest = fixture.send.mock.calls[1];
      expect(nextRequest[1]).toBe(login.method === 'basic' ? basic(NEXT_PASSWORD) : undefined);
      expect(nextRequest[2].body).toBe(
        login.method === 'json'
          ? JSON.stringify({ username: USER, password: NEXT_PASSWORD })
          : undefined
      );
      expect(fixture.getProviderPassword()).toBeUndefined();
      expectSafeDiagnostics(fixture.authentication);
    }
  );

  it.each([
    {
      description: 'cookie Max-Age',
      login: APIML_LOGIN,
      first: cookieResponse(expiryToken(START + 3_600_000), 'Max-Age=1'),
    },
    {
      description: 'cookie Expires',
      login: APIML_LOGIN,
      first: cookieResponse(
        expiryToken(START + 3_600_000),
        `Expires=${new Date(START + 1000).toUTCString()}`
      ),
    },
    {
      description: 'JSON expires_in',
      login: JSON_LOGIN,
      first: response(200, { sessionToken: expiryToken(START + 3_600_000), expires_in: 1 }),
    },
  ])(
    'respects an explicit $description expiry earlier than the JWT exp claim',
    async ({ login, first }) => {
      const fixture = setup(login);
      fixture.send
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(
          login.method === 'basic' ? cookieResponse() : response(200, { sessionToken: TOKEN })
        );
      await fixture.authentication.getAuthentication();
      fixture.advance(1000);
      expect(fixture.authentication.getStatus()).toMatchObject({
        token: 'expired',
        credentialStorage: 'none',
      });
      expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
      await fixture.authentication.getAuthentication();
      expect(fixture.credentialRequests).toEqual([false, true]);
    }
  );

  it.each([0, -1])('does not retain a deleted session cookie with Max-Age=%i', async maxAge => {
    const fixture = setup(APIML_LOGIN);
    fixture.send.mockResolvedValue(cookieResponse(COOKIE, `Max-Age=${maxAge}`));
    await expect(fixture.authentication.getAuthentication()).rejects.toThrow(/expired token/i);
    expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
    expect(fixture.getProviderPassword()).toBeUndefined();
    expect(fixture.authentication.getStatus()).toMatchObject({
      token: 'expired',
      credentialStorage: 'none',
    });
  });

  it('invalidates a rejected session without refreshing and requires new elicitation on the next operation', async () => {
    const fixture = setup(APIML_LOGIN);
    fixture.send
      .mockResolvedValueOnce(cookieResponse())
      .mockResolvedValueOnce(cookieResponse('new-cookie'));
    await fixture.authentication.getAuthentication();
    const acceptedIdentity = fixture.authentication.getCacheIdentity();
    fixture.authentication.invalidate();
    expect(fixture.authentication.getStatus()).toMatchObject({
      token: 'rejected',
      credentialStorage: 'none',
    });
    expect(fixture.authentication.getCacheIdentity()).not.toBe(acceptedIdentity);
    expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(fixture.credentialRequests).toEqual([false]);
    fixture.setNextPassword(NEXT_PASSWORD);
    expect(await fixture.authentication.getAuthentication()).toMatchObject({
      headers: { Cookie: 'apimlAuthenticationToken=new-cookie' },
    });
    expect(fixture.credentialRequests).toEqual([false, true]);
    expect(fixture.send.mock.calls[1][1]).toBe(basic(NEXT_PASSWORD));
    expect(fixture.getProviderPassword()).toBeUndefined();
  });

  it('deduplicates simultaneous credential requests and login exchanges', async () => {
    const fixture = setup(APIML_LOGIN);
    const loginStarted = deferred<void>();
    const loginResponse = deferred<SessionHttpResponse>();
    fixture.send.mockImplementation(() => {
      loginStarted.resolve();
      return loginResponse.promise;
    });
    const operations = Array.from({ length: 8 }, () => fixture.authentication.getAuthentication());
    await loginStarted.promise;
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(fixture.credentialRequests).toEqual([false]);
    expect(fixture.getProviderPassword()).toBe(PASSWORD);
    expect(fixture.forgetCredentials).not.toHaveBeenCalled();
    loginResponse.resolve(cookieResponse());
    const results = await Promise.all(operations);
    expect(results).toHaveLength(8);
    expect(
      results.every(result => result.headers?.Cookie === `apimlAuthenticationToken=${COOKIE}`)
    ).toBe(true);
    expect(fixture.forgetCredentials).toHaveBeenCalledTimes(1);
    expect(fixture.getProviderPassword()).toBeUndefined();
    expect(fixture.send).toHaveBeenCalledTimes(1);
  });

  it.each(['during-login', 'after-login'] as const)(
    'ignores a delayed 401 from the old session %s without discarding replacement credentials',
    async timing => {
      const fixture = setup(APIML_LOGIN);
      const replacementLogin = deferred<SessionHttpResponse>();
      const replacementStarted = deferred<void>();
      fixture.send.mockResolvedValueOnce(cookieResponse()).mockImplementationOnce(() => {
        replacementStarted.resolve();
        return replacementLogin.promise;
      });
      const original = await fixture.authentication.getAuthentication();
      const firstInvalidation = fixture.authentication.invalidate(original);
      fixture.setNextPassword(NEXT_PASSWORD);
      const replacement = fixture.authentication.getAuthentication();
      await replacementStarted.promise;
      const beforeStaleResponse = fixture.forgetCredentials.mock.calls.length;
      const staleInvalidations: boolean[] = [];
      if (timing === 'during-login')
        staleInvalidations.push(fixture.authentication.invalidate(original));
      replacementLogin.resolve(cookieResponse('replacement-cookie'));
      const accepted = await replacement;
      if (timing === 'after-login')
        staleInvalidations.push(fixture.authentication.invalidate(original));
      const next = await fixture.authentication.getAuthentication();
      expect(firstInvalidation).toBe(true);
      expect(staleInvalidations).toEqual([false]);
      expect(next).toBe(accepted);
      expect(next.headers?.Cookie).toBe('apimlAuthenticationToken=replacement-cookie');
      expect(fixture.credentialRequests).toEqual([false, true]);
      expect(fixture.getPrompts()).toBe(2);
      expect(fixture.forgetCredentials).toHaveBeenCalledTimes(beforeStaleResponse + 1);
      expect(fixture.getProviderPassword()).toBeUndefined();
    }
  );

  it('ignores an old Basic authentication failure after fresh password recovery', async () => {
    const fixture = setup();
    const original = await fixture.authentication.getAuthentication();
    fixture.authentication.invalidate(original);
    fixture.setNextPassword(NEXT_PASSWORD);
    const replacement = await fixture.authentication.getAuthentication();
    const staleInvalidation = fixture.authentication.invalidate(original);
    const next = await fixture.authentication.getAuthentication();
    expect(staleInvalidation).toBe(false);
    expect(replacement.authorization).toBe(basic(NEXT_PASSWORD));
    expect(next.authorization).toBe(basic(NEXT_PASSWORD));
    expect(fixture.credentialRequests).toEqual([false, true, false]);
    expect(fixture.getPrompts()).toBe(2);
  });

  it('discards an invalidated pending login response before starting a shared replacement acquisition', async () => {
    const fixture = setup(APIML_LOGIN);
    const firstLogin = deferred<SessionHttpResponse>();
    const loginStarted = deferred<void>();
    fixture.send
      .mockImplementationOnce(() => {
        loginStarted.resolve();
        return firstLogin.promise;
      })
      .mockResolvedValueOnce(cookieResponse('replacement-cookie'));
    const staleFailure = fixture.authentication
      .getAuthentication()
      .catch((error: unknown) => error);
    await loginStarted.promise;
    fixture.authentication.invalidate();
    fixture.setNextPassword(NEXT_PASSWORD);
    const replacements = Array.from({ length: 4 }, () =>
      fixture.authentication.getAuthentication()
    );
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(fixture.credentialRequests).toEqual([false]);
    firstLogin.resolve(cookieResponse('obsolete-cookie'));
    const error = await staleFailure;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/authentication changed/i);
    const accepted = await Promise.all(replacements);
    expect(
      accepted.every(
        authentication =>
          authentication.headers?.Cookie === 'apimlAuthenticationToken=replacement-cookie'
      )
    ).toBe(true);
    expect(fixture.authentication.getCachedAuthentication()).toBe(accepted[0]);
    expect(fixture.credentialRequests).toEqual([false, true]);
    expect(fixture.getPrompts()).toBe(2);
    expect(fixture.getProviderPassword()).toBeUndefined();
  });

  it('discards credentials that arrive after invalidation without sending them or retaining them in the provider', async () => {
    const pendingCredentials =
      deferred<Awaited<ReturnType<RestSessionAuthOptions['getCredentials']>>>();
    let providerPassword: string | undefined;
    const getCredentials = vi
      .fn<RestSessionAuthOptions['getCredentials']>()
      .mockImplementationOnce(async () => {
        const credentials = await pendingCredentials.promise;
        providerPassword = credentials.password;
        return credentials;
      })
      .mockImplementationOnce(() => {
        providerPassword = NEXT_PASSWORD;
        return Promise.resolve({ user: USER, password: NEXT_PASSWORD, source: 'elicited' });
      });
    const send = vi
      .fn<RestSessionAuthOptions['send']>()
      .mockResolvedValue(cookieResponse('replacement-cookie'));
    const authentication = new RestSessionAuthentication({
      login: APIML_LOGIN,
      getCredentials,
      send,
      forgetCredentials: () => {
        providerPassword = undefined;
      },
    });
    const staleFailure = authentication.getAuthentication().catch((error: unknown) => error);
    authentication.invalidate();
    const replacement = authentication.getAuthentication();
    expect(getCredentials).toHaveBeenCalledTimes(1);
    pendingCredentials.resolve({ user: USER, password: PASSWORD, source: 'elicited' });
    const error = await staleFailure;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/authentication changed/i);
    expect(await replacement).toMatchObject({
      headers: { Cookie: 'apimlAuthenticationToken=replacement-cookie' },
    });
    expect(getCredentials.mock.calls).toEqual([[false], [true]]);
    expect(send).toHaveBeenCalledExactlyOnceWith(new URL(APIML_LOGIN.url), basic(NEXT_PASSWORD), {
      method: 'POST',
    });
    expect(providerPassword).toBeUndefined();
  });

  it.each([404, 405, 501])(
    'permits memory-only Basic when login is unsupported with HTTP %i',
    async status => {
      const fixture = setup(APIML_LOGIN);
      fixture.send.mockResolvedValue(response(status));
      const first = await fixture.authentication.getAuthentication();
      const next = await fixture.authentication.getAuthentication();
      expect(first).toEqual({ authorization: basic(), mode: 'password', source: 'elicited' });
      expect(next).toEqual(first);
      expect(fixture.authentication.getStatus()).toEqual({
        exchange: 'unavailable',
        token: 'none',
        credentialStorage: 'memory',
      });
      expect(fixture.send).toHaveBeenCalledTimes(1);
      expect(fixture.getPrompts()).toBe(1);
      expect(fixture.forgetCredentials).not.toHaveBeenCalled();
      expectSafeDiagnostics(fixture.authentication);
    }
  );

  it.each([
    { description: 'no declared login', login: undefined, loginResponse: response(200) },
    {
      description: 'JSON without a token',
      login: JSON_LOGIN,
      loginResponse: response(200, { success: true }),
    },
    {
      description: 'non-JSON body',
      login: JSON_LOGIN,
      loginResponse: response(200, 'unsupported login page'),
    },
    { description: 'no configured cookie', login: APIML_LOGIN, loginResponse: response(204) },
  ])(
    'permits memory-only Basic when exchange capability is unknown: $description',
    async ({ login, loginResponse }) => {
      const fixture = setup(login);
      fixture.send.mockResolvedValue(loginResponse);
      expect(await fixture.authentication.getAuthentication()).toEqual({
        authorization: basic(),
        mode: 'password',
        source: 'elicited',
      });
      expect(await fixture.authentication.getAuthentication()).toMatchObject({ mode: 'password' });
      expect(fixture.authentication.getStatus()).toEqual({
        exchange: 'unknown',
        token: 'none',
        credentialStorage: 'memory',
      });
      expect(fixture.send).toHaveBeenCalledTimes(login ? 1 : 0);
      expect(fixture.getPrompts()).toBe(1);
      expect(fixture.forgetCredentials).not.toHaveBeenCalled();
    }
  );

  it('distinguishes an externally configured Basic password from a password held in memory', async () => {
    const fixture = setup(undefined, 'configured');
    await fixture.authentication.getAuthentication();
    expect(fixture.authentication.getStatus()).toMatchObject({
      exchange: 'unknown',
      credentialStorage: 'configured',
    });
    expectSafeDiagnostics(fixture.authentication);
  });

  it.each([
    { description: 'no declared exchange', login: undefined, loginResponse: response(200) },
    { description: 'unsupported exchange', login: APIML_LOGIN, loginResponse: response(404) },
    {
      description: 'unknown exchange response',
      login: JSON_LOGIN,
      loginResponse: response(200, {}),
    },
  ])(
    'keeps a freshly elicited Basic password after configured credentials were rejected: $description',
    async ({ login, loginResponse }) => {
      vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_GATEWAY_EXAMPLE_TEST', PASSWORD);
      vi.stubEnv('ZOWE_MCP_CREDENTIALS', '');
      const prompt = vi.fn().mockResolvedValue(NEXT_PASSWORD);
      const spec = { user: USER, host: 'gateway.example.test', port: 7554 };
      const provider = new NativeCredentialProvider({
        connectionSpecs: [spec],
        useEnvForPassword: true,
        disableSshKey: true,
        transientPasswords: true,
        requestPasswordViaElicitation: prompt,
      });
      const authentication = new RestSessionAuthentication({
        login,
        getCredentials: async forceElicitation => {
          const credentials = await provider.getCredentials(spec.host, spec.user, {
            forceElicitation,
          });
          return {
            user: credentials.user,
            password: credentials.password ?? '',
            source: provider.getCredentialSource(spec.host, spec.user) ?? 'configured',
          };
        },
        forgetCredentials: () => provider.forgetPassword(spec),
        send: vi.fn<RestSessionAuthOptions['send']>().mockResolvedValue(loginResponse),
      });
      try {
        expect(await authentication.getAuthentication()).toMatchObject({
          authorization: basic(),
          source: 'configured',
        });
        // The adapter invalidates Basic authentication after an explicit downstream 401.
        authentication.invalidate();
        expect(await authentication.getAuthentication()).toMatchObject({
          authorization: basic(NEXT_PASSWORD),
          source: 'elicited',
        });
        expect(await authentication.getAuthentication()).toMatchObject({
          authorization: basic(NEXT_PASSWORD),
          source: 'elicited',
        });
        expect(prompt).toHaveBeenCalledTimes(1);
        expect(process.env.ZOWE_MCP_PASSWORD_USER1_GATEWAY_EXAMPLE_TEST).toBe(PASSWORD);
        expectSafeDiagnostics(authentication);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  );

  it.each([401, 403])(
    'does not downgrade a failed login (HTTP %i) to Basic and redacts credential/cookie diagnostics',
    async status => {
      const fixture = setup(APIML_LOGIN);
      fixture.send
        .mockResolvedValueOnce(
          response(
            status,
            {
              message: `Rejected ${PASSWORD}, ${basic()}, Cookie: apimlAuthenticationToken=${COOKIE}`,
            },
            { 'set-cookie': [`apimlAuthenticationToken=${COOKIE}`] }
          )
        )
        .mockResolvedValueOnce(cookieResponse());
      const error = await fixture.authentication
        .getAuthentication()
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(`HTTP ${status}`);
      expectSafeDiagnostics(fixture.authentication, [(error as Error).message]);
      expect(fixture.getProviderPassword()).toBeUndefined();
      expect(fixture.forgetCredentials).toHaveBeenCalledTimes(1);
      expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
      await fixture.authentication.getAuthentication();
      expect(fixture.credentialRequests).toEqual([false, true]);
      expect(fixture.send).toHaveBeenCalledTimes(2);
    }
  );

  it.each([400, 408, 409, 429, 500, 502, 503, 504])(
    'retains the current credentials after login HTTP %i so a retry does not prompt again',
    async status => {
      const fixture = setup(APIML_LOGIN);
      fixture.send
        .mockResolvedValueOnce(response(status, { message: `Unavailable ${PASSWORD}` }))
        .mockResolvedValueOnce(cookieResponse());
      const error = await fixture.authentication
        .getAuthentication()
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(`HTTP ${status}`);
      expect((error as Error).message).toMatch(/retry/i);
      expect(fixture.forgetCredentials).not.toHaveBeenCalled();
      expect(fixture.getProviderPassword()).toBe(PASSWORD);
      expect(fixture.authentication.getStatus().credentialStorage).toBe('memory');
      await fixture.authentication.getAuthentication();
      expect(fixture.credentialRequests).toEqual([false, false]);
      expect(fixture.getPrompts()).toBe(1);
      expect(fixture.forgetCredentials).toHaveBeenCalledTimes(1);
      expectSafeDiagnostics(fixture.authentication, [(error as Error).message]);
    }
  );

  it('keeps freshly elicited replacement credentials through a transient login failure', async () => {
    const fixture = setup(APIML_LOGIN);
    fixture.send
      .mockResolvedValueOnce(cookieResponse())
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(cookieResponse('replacement-cookie'));
    const original = await fixture.authentication.getAuthentication();
    fixture.authentication.invalidate(original);
    fixture.setNextPassword(NEXT_PASSWORD);
    await expect(fixture.authentication.getAuthentication()).rejects.toThrow(/HTTP 429/);
    expect(fixture.getProviderPassword()).toBe(NEXT_PASSWORD);
    expect(await fixture.authentication.getAuthentication()).toMatchObject({
      headers: { Cookie: 'apimlAuthenticationToken=replacement-cookie' },
    });
    expect(fixture.credentialRequests).toEqual([false, true, false]);
    expect(fixture.getPrompts()).toBe(2);
  });

  it('drops expired tokens returned by login instead of retaining or refreshing them', async () => {
    const fixture = setup(APIML_LOGIN);
    fixture.send
      .mockResolvedValueOnce(cookieResponse(expiryToken(START - 1000)))
      .mockResolvedValueOnce(cookieResponse());
    await expect(fixture.authentication.getAuthentication()).rejects.toThrow(/expired token/i);
    expect(fixture.authentication.getStatus()).toMatchObject({
      token: 'expired',
      credentialStorage: 'none',
    });
    expect(fixture.getProviderPassword()).toBeUndefined();
    expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
    await fixture.authentication.getAuthentication();
    expect(fixture.credentialRequests).toEqual([false, true]);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  it('does not expose credential or cookie material attached to a failed login transport exception', async () => {
    const fixture = setup(JSON_LOGIN);
    fixture.send.mockRejectedValueOnce(
      new Error(
        `Request failed: password=${PASSWORD}; Authorization=${basic()}; Cookie=apimlAuthenticationToken=${COOKIE}; token=${TOKEN}`
      )
    );
    const error = await fixture.authentication
      .getAuthentication()
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Unable to contact the REST session login endpoint'
    );
    expectSafeDiagnostics(fixture.authentication, [(error as Error).message]);
    expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
  });

  it('copies the declared session-login capability before exchanging credentials', async () => {
    const declaration = { ...JSON_LOGIN };
    const fixture = setup(declaration);
    declaration.url = 'https://changed.example.test/login';
    declaration.method = 'basic';
    fixture.send.mockResolvedValue(response(200, { sessionToken: TOKEN }));
    await fixture.authentication.getAuthentication();
    expect(fixture.send.mock.calls[0][0].href).toBe(JSON_LOGIN.url);
    expect(fixture.send.mock.calls[0][1]).toBeUndefined();
    expect(fixture.send.mock.calls[0][2].body).toBe(
      JSON.stringify({ username: USER, password: PASSWORD })
    );
  });

  it('keeps a valid session for an unchanged declaration and replaces it for a changed login endpoint', async () => {
    const fixture = setup(APIML_LOGIN);
    await fixture.authentication.getAuthentication();
    const validIdentity = fixture.authentication.getCacheIdentity();
    fixture.authentication.setLogin({ ...APIML_LOGIN });
    expect(fixture.authentication.getCacheIdentity()).toBe(validIdentity);
    fixture.authentication.setLogin(JSON_LOGIN);
    expect(fixture.authentication.getCachedAuthentication()).toBeUndefined();
    expect(fixture.authentication.getCacheIdentity()).not.toBe(validIdentity);
    fixture.send.mockResolvedValueOnce(response(200, { sessionToken: TOKEN }));
    expect(await fixture.authentication.getAuthentication()).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
    });
    expect(fixture.send.mock.calls[1][0].href).toBe(JSON_LOGIN.url);
    expect(fixture.getProviderPassword()).toBeUndefined();
  });

  it.each([
    { url: 'http://gateway.example.test/login', method: 'basic' as const },
    { url: 'https://user:dummy@host.example.test/login', method: 'basic' as const },
    { url: `${ORIGIN}/login?token=dummy`, method: 'json' as const },
    { url: `${ORIGIN}/login#dummy`, method: 'json' as const },
    { ...APIML_LOGIN, cookieName: 'unsafe;Cookie' },
  ])('rejects unsafe login declarations %#', login => {
    expect(() => setup(login)).toThrow(/HTTPS URL|cookie name/i);
  });
});
